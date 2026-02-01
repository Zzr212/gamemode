import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState, GamePhase, Role } from '../types.js';

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
const KILL_DISTANCE = 3.0; // Increased slightly for better feel

// --- GAME LOOP ---
setInterval(() => {
  const playerIds = Object.keys(players);
  // Active = Not Spectator, Not Dead (Valid candidates for game start)
  const activePlayers = playerIds.filter(id => players[id].role !== Role.SPECTATOR);
  
  // 1. WAITING -> COUNTDOWN
  if (gamePhase === GamePhase.WAITING) {
    if (activePlayers.length >= 2) {
      console.log(`[SERVER] Starting Countdown with ${activePlayers.length} players.`);
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }

  // 2. COUNTDOWN
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    
    if (activePlayers.length < 2) {
        console.log("[SERVER] Countdown aborted - not enough players.");
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
        broadcastGameState();
        io.emit('gameMessage', "Waiting for more players...");
    } else if (gameTimer <= 0) {
        startGame();
    } else {
        // Broadcast timer every second
        broadcastGameState();
    }
  }

  // 3. IN_PROGRESS
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;

    // Valid "Living" players for win condition
    const livingHunters = activePlayers.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = activePlayers.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    // Win Conditions
    if (livingHunters.length === 0) {
        // Hunter disconnected? Or hasn't been picked properly?
        // If game just started, give it a second. But normally valid.
        // Wait, if 2 players, 1 hunter 1 hider.
        endGame("HIDERS WIN (Hunter Left)");
    } 
    else if (livingHiders.length === 0) {
        endGame("HUNTER WINS");
    }
    else if (gameTimer <= 0) {
        endGame("HIDERS WIN (Time Limit)");
    } 
    else {
        // Optimization: Only broadcast timer every second
        broadcastGameState();
    }
  }
}, 1000);

function broadcastGameState() {
    io.emit('gameStateUpdate', { phase: gamePhase, timer: gameTimer });
}

function startGame() {
    console.log("[SERVER] Game Started!");
    gamePhase = GamePhase.IN_PROGRESS;
    gameTimer = ROUND_TIME;

    const playerIds = Object.keys(players);
    
    // 1. Reset everyone to HIDER first
    playerIds.forEach(id => {
        // Only reset if not a spectator who joined late (though in COUNTDOWN phase everyone is valid)
        if (players[id].role !== Role.SPECTATOR) {
            players[id].isDead = false;
            players[id].role = Role.HIDER;
            players[id].position = { x: 0, y: 10, z: 0 }; // Respawn at center
        }
    });

    // 2. Pick Random Hunter
    // Only pick from those who are HIDERs
    const candidates = playerIds.filter(id => players[id].role === Role.HIDER);
    
    if (candidates.length > 0) {
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const hunterId = candidates[randomIndex];
        players[hunterId].role = Role.HUNTER;
        console.log(`[SERVER] Assigned Hunter: ${hunterId}`);
    } else {
        console.error("[SERVER] No candidates for Hunter!");
        gamePhase = GamePhase.WAITING; // Abort
        return;
    }

    // Notify clients
    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason: string) {
    console.log(`[SERVER] Game Ended: ${reason}`);
    io.emit('gameMessage', reason);
    
    // Reset to Lobby
    gamePhase = GamePhase.WAITING;
    gameTimer = 0;

    // Respawn everyone as Hider/Waiting
    Object.keys(players).forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = { x: 0, y: 10, z: 0 };
    });

    io.emit('currentPlayers', players);
    broadcastGameState();
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('requestGameStart', () => {
      // Determine Role based on Phase
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

      console.log(`[SERVER] Player ${socket.id} joined as ${initialRole}`);
      
      // Send Initial State
      socket.emit('currentPlayers', players);
      socket.emit('gameStateUpdate', { phase: gamePhase, timer: gameTimer });
      
      // Notify others
      socket.broadcast.emit('newPlayer', players[socket.id]);
  });

  socket.on('move', (position, rotation, animation) => {
    const p = players[socket.id];
    // Allow movement only if alive and not spectator
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

      const hiders = Object.values(players).filter(p => p.role === Role.HIDER && !p.isDead);
      
      for (const hider of hiders) {
          const dx = hunter.position.x - hider.position.x;
          const dy = hunter.position.y - hider.position.y;
          const dz = hunter.position.z - hider.position.z;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

          if (dist <= KILL_DISTANCE) {
              console.log(`[SERVER] Kill: ${hunter.id} -> ${hider.id}`);
              hider.isDead = true;
              // We don't change role to spectator immediately in 'role' field, 
              // keeping them as HIDER but isDead=true is better for logic, 
              // BUT for client logic we treat dead as spectator mostly.
              // Let's keep role HIDER so we know they were playing.
              
              io.emit('playerKilled', hider.id);
              io.emit('playerMoved', hider); // Update dead state
              break; 
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