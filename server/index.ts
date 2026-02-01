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
const KILL_DISTANCE = 3.0;

// --- GAME LOOP ---
setInterval(() => {
  const playerIds = Object.keys(players);
  
  // CRITICAL FIX: "Active" means anyone who is IN THE GAME WORLD (Role is NOT NONE).
  // We exclude Spectators from *starting* the game count logic usually, 
  // but if we are in WAITING, spectators should probably be converted to Hiders to play.
  // For now: Active Candidates = HIDER or HUNTER (Waiting or Playing)
  const validPlayers = playerIds.filter(id => 
    players[id].role === Role.HIDER || players[id].role === Role.HUNTER
  );

  const survivorsCount = validPlayers.filter(id => 
    players[id].role === Role.HIDER && !players[id].isDead
  ).length;

  // 1. WAITING -> COUNTDOWN
  if (gamePhase === GamePhase.WAITING) {
    // If we have 2 or more players sitting in the lobby (HIDER/HUNTER role), start countdown
    if (validPlayers.length >= 2) {
      console.log(`[SERVER] > 2 Players detected (${validPlayers.length}). Starting Countdown.`);
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }

  // 2. COUNTDOWN
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    
    // If players drop below 2 during countdown, abort
    if (validPlayers.length < 2) {
        console.log("[SERVER] Countdown aborted - player left.");
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
        broadcastGameState();
        io.emit('gameMessage', "Waiting for players...");
    } else if (gameTimer <= 0) {
        startGame();
    } else {
        broadcastGameState();
    }
  }

  // 3. IN_PROGRESS
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;

    // Active checks
    const livingHunters = validPlayers.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = validPlayers.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    // Win Conditions
    let reason = null;

    if (validPlayers.length < 2) {
        reason = "Not enough players!";
    }
    else if (livingHunters.length === 0) {
        // Edge case: Hunter left the game
        reason = "HIDERS WIN (Hunter Left)";
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
        broadcastGameState(); // Normal Tick
    }
  }
}, 1000);

function broadcastGameState() {
    // Calculate survivors for UI
    const playerIds = Object.keys(players);
    const survivors = playerIds.filter(id => 
        players[id].role === Role.HIDER && !players[id].isDead
    ).length;

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
    
    // 1. Reset everyone in the game world to HIDER
    playerIds.forEach(id => {
        const p = players[id];
        // Reset anyone who is NOT in menu (Role.NONE)
        if (p.role !== Role.NONE) {
            p.isDead = false;
            p.role = Role.HIDER;
            p.position = { x: 0, y: 10, z: 0 }; // Respawn
        }
    });

    // 2. Filter candidates (Must be HIDER now)
    const candidates = playerIds.filter(id => players[id].role === Role.HIDER);
    
    if (candidates.length > 0) {
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const hunterId = candidates[randomIndex];
        players[hunterId].role = Role.HUNTER;
        console.log(`[SERVER] Assigned Hunter: ${hunterId} (${players[hunterId].deviceId})`);
    } else {
        // Should not happen if loop logic is correct
        console.log("[SERVER] Error: No candidates for Hunter.");
        gamePhase = GamePhase.WAITING;
        return;
    }

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason: string) {
    console.log(`[SERVER] Round Over: ${reason}`);
    io.emit('gameMessage', reason);
    
    // Check if we still have enough players to play another round immediately
    const validPlayers = Object.keys(players).filter(id => players[id].role !== Role.NONE);
    
    if (validPlayers.length >= 2) {
        console.log("[SERVER] Enough players remaining. Restarting countdown.");
        gamePhase = GamePhase.COUNTDOWN;
        gameTimer = COUNTDOWN_TIME;
    } else {
        console.log("[SERVER] Not enough players. Going to Waiting.");
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
    }

    // Reset roles to HIDER (Lobby State) so they count as "Active" for the loop
    validPlayers.forEach(id => {
        players[id].role = Role.HIDER; 
        players[id].isDead = false;
        players[id].position = { x: 0, y: 10, z: 0 };
    });

    io.emit('currentPlayers', players);
    broadcastGameState();
}

io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.token || 'unknown-device';
  console.log(`User connected: ${socket.id} (Device: ${deviceId})`);

  socket.on('requestGameStart', () => {
      // Logic: User clicked "PLAY" in Main Menu
      
      let initialRole = Role.HIDER;
      
      // If game is running, they must spec
      if (gamePhase === GamePhase.IN_PROGRESS) {
          initialRole = Role.SPECTATOR;
      }
      // If Waiting or Countdown, they join as Hider (Candidate)

      players[socket.id] = {
        id: socket.id,
        deviceId: deviceId, // Store persistent ID
        position: { x: 0, y: 10, z: 0 },
        rotation: 0,
        animation: 'Idle',
        color: '#fff',
        role: initialRole,
        isDead: false
      };

      console.log(`[SERVER] Player joined game world: ${socket.id} as ${initialRole}`);
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      
      // Force an immediate broadcast so the loop picks up the new count faster
      broadcastGameState();
  });

  socket.on('move', (position, rotation, animation) => {
    const p = players[socket.id];
    if (p && !p.isDead && p.role !== Role.SPECTATOR && p.role !== Role.NONE) {
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
              console.log(`[SERVER] Kill: ${hunter.id} killed ${hider.id}`);
              hider.isDead = true;
              io.emit('playerKilled', hider.id);
              io.emit('playerMoved', hider);
              broadcastGameState(); // Update survivor count immediately
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
    broadcastGameState(); // Update count immediately
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