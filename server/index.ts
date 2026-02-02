import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState, GamePhase, Role } from '../types.js';
import { db } from './db.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json() as any); 

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
} as any);

const PORT = process.env.PORT || 3000;

// --- AUTH API ROUTES ---
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields required' });
    }
    if (db.findUserByUsername(username)) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    const user = db.createUser(username, email, password);
    console.log(`[AUTH] New user registered: ${username}`);
    res.json({ success: true, user });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.validateLogin(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    console.log(`[AUTH] User logged in: ${username}`);
    res.json({ success: true, user });
});

// --- GAME STATE ---
let players: Record<string, PlayerState> = {};
let gamePhase: GamePhase = GamePhase.WAITING;
let gameTimer: number = 0;
let lastHunterUserId: string | null = null;

const ROUND_TIME = 300; 
const COUNTDOWN_TIME = 10;
const GAME_OVER_TIME = 4; // 4 Seconds buffer after round ends
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; 

// Utility: Random Spawn
const getRandomSpawn = () => {
    return {
        x: (Math.random() * 10) - 5, 
        y: 3, 
        z: (Math.random() * 10) - 5 
    };
};

const sendSystemMessage = (text: string) => {
    io.emit('chatMessage', {
        id: uuidv4(),
        sender: 'SYSTEM',
        text: text,
        isSystem: true,
        timestamp: Date.now()
    });
};

// --- AFK CLEANUP LOOP ---
setInterval(() => {
    const now = Date.now();
    const playerIds = Object.keys(players);
    let changed = false;

    playerIds.forEach(id => {
        const p = players[id];
        if (p.isDisconnected && p.disconnectTime) {
            if (now - p.disconnectTime > AFK_TIMEOUT) {
                console.log(`[SERVER] Removing AFK player: ${p.username}`);
                delete players[id];
                io.emit('playerDisconnected', id);
                sendSystemMessage(`${p.username} removed (AFK)`);
                changed = true;
            }
        }
    });

    if (changed) {
        broadcastGameState();
    }
}, 5000);

// --- MAIN GAME LOOP ---
setInterval(() => {
  const playerIds = Object.keys(players);
  
  const connectedPlayers = playerIds.filter(id => !players[id].isDisconnected);

  const activePlayers = connectedPlayers.filter(id => {
      const p = players[id];
      return p.role !== Role.SPECTATOR;
  });

  const activeCount = activePlayers.length;

  // 1. WAITING
  if (gamePhase === GamePhase.WAITING) {
    if (activeCount >= 2) {
      console.log(`[SERVER] ${activeCount} players ready. Starting Countdown.`);
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }
  // 2. COUNTDOWN (10s)
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    
    // Check if players left during countdown
    if (activeCount < 2) {
        console.log("[SERVER] Not enough players during countdown. Resetting.");
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
        broadcastGameState();
        sendSystemMessage("Waiting for more players...");
    } else if (gameTimer <= 0) {
        startGame();
    } else {
        broadcastGameState();
    }
  }
  // 3. IN PROGRESS
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;

    const allPlayerIds = Object.keys(players);
    const livingHunters = allPlayerIds.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = allPlayerIds.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    let reason = null;
    
    if (allPlayerIds.length < 2) {
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
  // 4. GAME OVER (Buffer State - 4s)
  else if (gamePhase === GamePhase.GAME_OVER) {
      gameTimer--;
      
      // Once buffer is done, RESET and go to COUNTDOWN
      if (gameTimer <= 0) {
          console.log("[SERVER] Buffer ended. Respawning all and starting Countdown.");
          
          if (Object.keys(players).length >= 2) {
            gamePhase = GamePhase.COUNTDOWN;
            gameTimer = COUNTDOWN_TIME;
          } else {
            gamePhase = GamePhase.WAITING;
            gameTimer = 0;
          }

          // Full Respawn Logic
          Object.keys(players).forEach(id => {
              players[id].isDead = false;
              players[id].role = Role.HIDER; // Everyone resets to Hider for countdown
              players[id].position = getRandomSpawn();
              players[id].animation = 'Idle';
          });
          
          io.emit('currentPlayers', players);
          broadcastGameState();
      } else {
          broadcastGameState();
      }
  }
}, 1000);

function broadcastGameState() {
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
    sendSystemMessage("Game Started! Hunter chosen.");

    const playerIds = Object.keys(players);
    
    // Set everyone to Hider first
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = getRandomSpawn();
        players[id].isDisconnected = false;
    });

    // Pick Hunter
    let candidates = playerIds;
    if (lastHunterUserId && playerIds.length > 1) {
        const filtered = playerIds.filter(id => players[id].userId !== lastHunterUserId);
        if (filtered.length > 0) {
            candidates = filtered;
        }
    }

    if (candidates.length > 0) {
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const hunterId = candidates[randomIndex];
        players[hunterId].role = Role.HUNTER;
        lastHunterUserId = players[hunterId].userId;
        console.log(`[SERVER] Hunter assigned: ${players[hunterId].username}`);
    }

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason: string) {
    // Only enter GAME_OVER if coming from IN_PROGRESS
    if (gamePhase !== GamePhase.IN_PROGRESS) return;

    console.log(`[SERVER] Round Ended: ${reason}. Entering 4s Buffer.`);
    
    // Switch to Buffer Phase
    gamePhase = GamePhase.GAME_OVER;
    gameTimer = GAME_OVER_TIME;
    
    io.emit('gameMessage', reason);
    sendSystemMessage(`Round Over: ${reason}`);
    
    // We do NOT reset positions here. We wait for the buffer to finish.
    broadcastGameState();
}

io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId || 'unknown';
  const userId = socket.handshake.auth.userId || 'guest-' + socket.id;
  const username = socket.handshake.auth.username || 'Guest';

  if (!userId) {
      console.log("[SERVER] Socket connected without userId, ignoring.");
      return;
  }

  // --- RECONNECTION & ANTI-CLONE LOGIC ---
  
  // 1. Check if this userId already has an entry in `players`
  // We search by userId, NOT socket.id, to find ghosts or lost connections
  const oldSocketId = Object.keys(players).find(id => players[id].userId === userId);

  if (oldSocketId) {
      console.log(`[SERVER] ${username} reconnected. Swapping socket ${oldSocketId} -> ${socket.id}`);
      
      // Grab data
      const playerData = players[oldSocketId];
      
      // CRITICAL: Delete the old key to prevent cloning
      delete players[oldSocketId];
      
      // Update data with new socket ID
      playerData.id = socket.id;
      playerData.isDisconnected = false;
      playerData.disconnectTime = undefined;
      
      // Re-insert with new key
      players[socket.id] = playerData;

      // Force disconnect the old socket if it's still hanging around
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
          oldSocket.disconnect(true);
      }

      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', playerData);
      sendSystemMessage(`${username} reconnected.`);
  }

  // --- NEW JOIN REQUEST ---
  socket.on('requestGameStart', () => {
      // If player already exists (reconnected session), just sync
      if (players[socket.id]) {
          console.log(`[SERVER] ${username} requested start (Existing Session).`);
          socket.emit('currentPlayers', players);
          broadcastGameState();
          return;
      }
      
      // RULE: 
      // If WAITING or COUNTDOWN -> Join as HIDER (Spawn)
      // If IN_PROGRESS or GAME_OVER -> Join as SPECTATOR
      let initialRole = Role.SPECTATOR;
      
      if (gamePhase === GamePhase.WAITING || gamePhase === GamePhase.COUNTDOWN) {
          initialRole = Role.HIDER;
      }
      
      players[socket.id] = {
        id: socket.id,
        userId: userId,
        username: username,
        deviceId: deviceId,
        position: getRandomSpawn(),
        rotation: 0,
        animation: 'Idle',
        color: '#fff',
        role: initialRole,
        isDead: false,
        isDisconnected: false
      };

      console.log(`[SERVER] ${username} joined world (ID: ${userId}) as ${initialRole}`);
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      sendSystemMessage(`${username} joined.`);
      broadcastGameState();
  });

  socket.on('move', (position, rotation, animation) => {
    const p = players[socket.id];
    // Don't allow movement during GAME_OVER buffer
    if (gamePhase === GamePhase.GAME_OVER) return;

    if (p && !p.isDead && p.role !== Role.SPECTATOR && !p.isDisconnected) {
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
              console.log(`[SERVER] Kill: ${hunter.username} -> ${hider.username}`);
              hider.isDead = true;
              io.emit('playerKilled', hider.id);
              io.emit('playerMoved', hider);
              sendSystemMessage(`${hunter.username} killed ${hider.username}!`);
              broadcastGameState(); 
              break; 
          }
      }
  });

  socket.on('chatMessage', (text: string) => {
      if (!text || !text.trim()) return;
      const safeText = text.substring(0, 50);
      console.log(`[CHAT] ${players[socket.id]?.username}: ${safeText}`);
      io.emit('chatMessage', {
          id: uuidv4(),
          sender: players[socket.id]?.username || 'Unknown',
          text: safeText,
          isSystem: false,
          timestamp: Date.now()
      });
  });

  // EXPLICIT LEAVE - Immediate removal
  socket.on('leaveGame', () => {
      if (players[socket.id]) {
          console.log(`[SERVER] ${players[socket.id].username} explicitly left game.`);
          const name = players[socket.id].username;
          delete players[socket.id];
          io.emit('playerDisconnected', socket.id);
          sendSystemMessage(`${name} left the game.`);
          broadcastGameState();
      }
  });

  socket.on('disconnect', () => {
    // If player exists (wasn't removed by leaveGame), treat as accidental disconnect
    if (players[socket.id]) {
        console.log(`[SERVER] ${players[socket.id].username} disconnected (Grace period started).`);
        players[socket.id].isDisconnected = true;
        players[socket.id].disconnectTime = Date.now();
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