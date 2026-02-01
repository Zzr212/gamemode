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
} as any);

const PORT = process.env.PORT || 3000;

// Game State
let players: Record<string, PlayerState> = {};
let gamePhase: GamePhase = GamePhase.WAITING;
let gameTimer: number = 0;

const ROUND_TIME = 300; // 5 minutes
const COUNTDOWN_TIME = 10;
const KILL_DISTANCE = 3.0;

// --- GAME LOOP ---
setInterval(() => {
  const playerIds = Object.keys(players);
  
  const activePlayers = playerIds.filter(id => {
      const p = players[id];
      return p.role !== Role.SPECTATOR;
  });

  const activeCount = activePlayers.length;

  // 1. WAITING
  // REMOVED: Automatic transition to COUNTDOWN. 
  // Now handled by 'startMatch' event below.
  if (gamePhase === GamePhase.WAITING) {
      // Just keep broadcasting state so clients know how many people are there
      broadcastGameState();
  }

  // 2. COUNTDOWN
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    
    // Check if players left during countdown
    if (activeCount < 2) {
        console.log("[SERVER] Not enough players during countdown. Resetting.");
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
        broadcastGameState();
        io.emit('gameMessage', "Waiting for more players...");
    } else if (gameTimer <= 0) {
        startGame();
    } else {
        broadcastGameState();
    }
  }

  // 3. IN_PROGRESS
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;

    // Valid "Living" players
    const livingHunters = playerIds.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = playerIds.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    // Win Conditions
    let reason = null;
    
    // If everyone left mid-game
    const totalInGame = livingHunters.length + livingHiders.length + playerIds.filter(id => players[id].isDead).length;
    if (totalInGame < 2) {
        reason = "Not enough players!";
    }
    else if (livingHunters.length === 0) {
        reason = "HIDERS WIN (Hunter Disconnected)";
    } 
    else if (livingHiders.length === 0) {
        reason = "HUNTER WINS";
    }
    else if (gameTimer <= 0) {
        reason = "HIDERS WIN (Time Limit)";
    }

    if (reason) {
        endGame(reason);
    } else {
        broadcastGameState();
    }
  }
}, 1000);

function broadcastGameState() {
    // Count survivors (Active Hiders)
    const survivors = Object.values(players).filter(p => p.role === Role.HIDER && !p.isDead).length;
    io.emit('gameStateUpdate', { 
        phase: gamePhase, 
        timer: gameTimer,
        survivors: survivors
    });
}

function startGame() {
    console.log("[SERVER] Game Started!");
    gamePhase = GamePhase.IN_PROGRESS;
    gameTimer = ROUND_TIME;

    const playerIds = Object.keys(players);
    
    // 1. RESET: Everyone becomes a HIDER (Alive) first
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = { x: 0, y: 10, z: 0 }; 
    });

    // 2. ASSIGN: Pick Random Hunter
    if (playerIds.length > 0) {
        const randomIndex = Math.floor(Math.random() * playerIds.length);
        const hunterId = playerIds[randomIndex];
        players[hunterId].role = Role.HUNTER;
        console.log(`[SERVER] Hunter assigned: ${hunterId}`);
    }

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason: string) {
    console.log(`[SERVER] Game End: ${reason}`);
    io.emit('gameMessage', reason);
    
    // Reset to Waiting immediately
    // Players have to press START again to play another round
    gamePhase = GamePhase.WAITING;
    gameTimer = 0;

    // Reset everyone to "Lobby Mode" (Hider, Alive)
    Object.keys(players).forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = { x: 0, y: 10, z: 0 };
    });

    io.emit('currentPlayers', players);
    broadcastGameState();
}

io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.token || 'unknown';

  socket.on('requestGameStart', () => {
      // User clicked Play Game in Menu (Joining Lobby)
      
      let initialRole = Role.HIDER;
      
      if (gamePhase === GamePhase.IN_PROGRESS) {
          initialRole = Role.SPECTATOR;
      }
      
      players[socket.id] = {
        id: socket.id,
        deviceId: deviceId,
        position: { x: 0, y: 10, z: 0 },
        rotation: 0,
        animation: 'Idle',
        color: '#fff',
        role: initialRole,
        isDead: false
      };

      console.log(`[SERVER] Player joined world: ${socket.id} (${initialRole})`);
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      broadcastGameState();
  });

  // NEW: Manual Round Start Trigger
  socket.on('startMatch', () => {
      if (gamePhase !== GamePhase.WAITING) return;

      const activePlayers = Object.values(players).filter(p => p.role !== Role.SPECTATOR);
      
      if (activePlayers.length >= 2) {
          console.log(`[SERVER] Match started by ${socket.id}`);
          gamePhase = GamePhase.COUNTDOWN;
          gameTimer = COUNTDOWN_TIME;
          broadcastGameState();
      } else {
          // Optional: Could send specific error to client, but client handles UI blink
          console.log(`[SERVER] Start failed: not enough players (${activePlayers.length})`);
      }
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
      if (!hunter || hunter.role !== Role.HUNTER || hunter.isDead || gamePhase !== GamePhase.IN_PROGRESS) return;

      const hiders = Object.values(players).filter(p => p.role === Role.HIDER && !p.isDead);
      
      for (const hider of hiders) {
          const dx = hunter.position.x - hider.position.x;
          const dy = hunter.position.y - hider.position.y;
          const dz = hunter.position.z - hider.position.z;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

          if (dist <= KILL_DISTANCE) {
              console.log(`[SERVER] Kill: ${hunter.id} -> ${hider.id}`);
              hider.isDead = true;
              io.emit('playerKilled', hider.id);
              io.emit('playerMoved', hider);
              broadcastGameState(); 
              break; 
          }
      }
  });

  socket.on('pingSync', (callback) => {
    if (typeof callback === 'function') callback(); 
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
        console.log(`[SERVER] Player left: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        broadcastGameState();
    }
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