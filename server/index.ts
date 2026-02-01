import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState, GamePhase, Role, GameStateData } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Game State
let players: Record<string, PlayerState> = {};
let gamePhase: GamePhase = GamePhase.WAITING;
let gameTimer: number = 0;

const ROUND_TIME = 300; // 5 minutes
const COUNTDOWN_TIME = 10;
const KILL_DISTANCE = 2.5; // Meters

// --- GAME LOOP ---
setInterval(() => {
  const playerIds = Object.keys(players);
  const activePlayers = playerIds.filter(id => players[id].role !== Role.SPECTATOR && !players[id].isDead);
  const allInGame = playerIds.filter(id => players[id].role !== Role.NONE); // Everyone who clicked Play

  // 1. WAITING -> COUNTDOWN
  if (gamePhase === GamePhase.WAITING) {
    // Need at least 2 active players (or 1 waiting and 1 joining)
    // Actually, we check if we have 2+ people who are not just sitting in menu (Role.NONE)
    if (allInGame.length >= 2) {
      console.log("Starting Countdown...");
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }

  // 2. COUNTDOWN
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    
    if (allInGame.length < 2) {
        // Abort if someone leaves
        gamePhase = GamePhase.WAITING;
        broadcastGameState();
        io.emit('gameMessage', "Not enough players!");
    } else if (gameTimer <= 0) {
        startGame();
    } else {
        broadcastGameState();
    }
  }

  // 3. IN_PROGRESS
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;

    // Check Win Conditions
    const hunters = activePlayers.filter(id => players[id].role === Role.HUNTER);
    const hiders = activePlayers.filter(id => players[id].role === Role.HIDER);

    // If Hunter left
    if (hunters.length === 0) {
        endGame("HIDERS WIN (Hunter left)");
    } 
    // If all Hiders dead
    else if (hiders.length === 0) {
        endGame("HUNTER WINS");
    }
    // Time out
    else if (gameTimer <= 0) {
        endGame("HIDERS WIN (Time Limit)");
    } 
    // Just tick
    else {
        // Only broadcast timer every few seconds to save bandwidth, or every second if critical
        // For 5 mins, every second is fine for modern connection
        broadcastGameState();
    }
  }
}, 1000);

function broadcastGameState() {
    io.emit('gameStateUpdate', { phase: gamePhase, timer: gameTimer });
}

function startGame() {
    console.log("Game Started!");
    gamePhase = GamePhase.IN_PROGRESS;
    gameTimer = ROUND_TIME;

    const playerIds = Object.keys(players);
    // Filter out people who might be stuck in menu or spectators
    // For simplicity, everyone currently connected and 'ready' (requestGameStart called) plays
    
    // Reset everyone
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER; // Default
    });

    // Pick Random Hunter
    const randomIndex = Math.floor(Math.random() * playerIds.length);
    const hunterId = playerIds[randomIndex];
    players[hunterId].role = Role.HUNTER;

    // Notify clients
    io.emit('currentPlayers', players); // Updates roles
    broadcastGameState();
}

function endGame(reason: string) {
    console.log("Game Ended:", reason);
    io.emit('gameMessage', reason);
    
    // Reset to Lobby
    gamePhase = GamePhase.WAITING;
    gameTimer = 0;

    // Respawn everyone as Hider/Waiting
    Object.keys(players).forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER; // Or NONE/WAITING
        // Teleport to spawn
        players[id].position = { x: 0, y: 10, z: 0 };
    });

    io.emit('currentPlayers', players);
    broadcastGameState();
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('requestGameStart', () => {
      // Logic: 
      // If Waiting -> Join as Hider (will be assigned later)
      // If Countdown -> Join as Hider
      // If InProgress -> Join as Spectator

      let initialRole = Role.HIDER;
      if (gamePhase === GamePhase.IN_PROGRESS) {
          initialRole = Role.SPECTATOR;
      }

      players[socket.id] = {
        id: socket.id,
        position: { x: 0, y: 10, z: 0 },
        rotation: 0,
        animation: 'Idle',
        color: '#fff',
        role: initialRole,
        isDead: false
      };

      socket.emit('currentPlayers', players);
      socket.emit('gameStateUpdate', { phase: gamePhase, timer: gameTimer });
      socket.broadcast.emit('newPlayer', players[socket.id]);
      
      console.log(`Player ${socket.id} joined as ${initialRole}`);
  });

  socket.on('move', (position, rotation, animation) => {
    const p = players[socket.id];
    if (p && !p.isDead && p.role !== Role.SPECTATOR) {
      p.position = position;
      p.rotation = rotation;
      p.animation = animation; 
      socket.broadcast.emit('playerMoved', p);
    }
  });

  socket.on('attemptKill', () => {
      const hunter = players[socket.id];
      if (!hunter || hunter.role !== Role.HUNTER || hunter.isDead) return;

      // Check distance to all Hiders
      const hiders = Object.values(players).filter(p => p.role === Role.HIDER && !p.isDead);
      
      for (const hider of hiders) {
          const dx = hunter.position.x - hider.position.x;
          const dy = hunter.position.y - hider.position.y;
          const dz = hunter.position.z - hider.position.z;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

          if (dist <= KILL_DISTANCE) {
              // Kill confirmed
              console.log(`Hunter ${hunter.id} killed ${hider.id}`);
              hider.isDead = true;
              hider.role = Role.SPECTATOR; // Convert to spectator
              io.emit('playerKilled', hider.id);
              io.emit('playerMoved', hider); // Update state to dead
              break; // One kill per click? Or multi? Let's do one.
          }
      }
  });

  socket.on('pingSync', (callback) => {
    if (typeof callback === 'function') callback(); 
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const distPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../dist' : '../dist');
app.use('/', express.static(distPath) as any);

const rootPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../' : '../');
app.use('/', express.static(path.join(rootPath, 'public')) as any);

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});