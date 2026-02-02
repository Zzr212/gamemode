import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState, GamePhase, Role } from '../types.js';
import { db } from './db.js';

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
    res.json({ success: true, user });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.validateLogin(username, password);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ success: true, user });
});

// --- GAME STATE ---
let players: Record<string, PlayerState> = {};
let gamePhase: GamePhase = GamePhase.WAITING;
let gameTimer: number = 0;
let lastHunterUserId: string | null = null;

const ROUND_TIME = 300; 
const COUNTDOWN_TIME = 10;
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; 

// Utility: Random Spawn
const getRandomSpawn = () => {
    return {
        x: (Math.random() * 10) - 5, 
        y: 10,
        z: (Math.random() * 10) - 5 
    };
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
                io.emit('gameMessage', `${p.username} removed (AFK)`);
                changed = true;
            }
        }
    });

    if (changed) {
        broadcastGameState();
    }
}, 5000);

// --- GAME LOOP ---
setInterval(() => {
  const playerIds = Object.keys(players);
  
  const connectedPlayers = playerIds.filter(id => !players[id].isDisconnected);

  const activePlayers = connectedPlayers.filter(id => {
      const p = players[id];
      return p.role !== Role.SPECTATOR;
  });

  const activeCount = activePlayers.length;

  if (gamePhase === GamePhase.WAITING) {
    if (activeCount >= 2) {
      console.log(`[SERVER] ${activeCount} players ready. Starting Countdown.`);
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    
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

    const playerIds = Object.keys(players);
    
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = getRandomSpawn();
        players[id].isDisconnected = false;
    });

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
    console.log(`[SERVER] Game End: ${reason}`);
    io.emit('gameMessage', reason);
    
    if (Object.keys(players).length >= 2) {
        gamePhase = GamePhase.COUNTDOWN;
        gameTimer = COUNTDOWN_TIME;
    } else {
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
    }

    Object.keys(players).forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = getRandomSpawn();
    });

    io.emit('currentPlayers', players);
    broadcastGameState();
}

io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId || 'unknown';
  const userId = socket.handshake.auth.userId || 'guest-' + socket.id;
  const username = socket.handshake.auth.username || 'Guest';

  if (!userId) {
      console.log("Socket connected without userId, ignoring.");
      return;
  }

  const existingSocketId = Object.keys(players).find(id => players[id].userId === userId && !players[id].isDisconnected);
  
  if (existingSocketId) {
      console.log(`[SERVER] Duplicate login for ${username}. Kicking old socket.`);
      io.to(existingSocketId).emit('forceDisconnect', 'New login detected');
      const oldSocket = io.sockets.sockets.get(existingSocketId);
      if (oldSocket) oldSocket.disconnect(true);
  }

  let playerObj = null;
  const oldSessionId = Object.keys(players).find(id => players[id].userId === userId);

  if (oldSessionId) {
      console.log(`[SERVER] ${username} reconnected. Restoring session.`);
      playerObj = players[oldSessionId];
      
      io.emit('playerDisconnected', oldSessionId);
      delete players[oldSessionId];
      
      playerObj.id = socket.id;
      playerObj.isDisconnected = false;
      playerObj.disconnectTime = undefined;
      
      players[socket.id] = playerObj;

      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', playerObj);
  }

  socket.on('requestGameStart', () => {
      if (players[socket.id]) {
          console.log(`[SERVER] ${username} requested start (Existing Session).`);
          socket.emit('currentPlayers', players);
          broadcastGameState();
          return;
      }
      
      let initialRole = Role.HIDER;
      if (gamePhase === GamePhase.IN_PROGRESS) {
          initialRole = Role.SPECTATOR;
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

      console.log(`[SERVER] ${username} joined world (ID: ${userId})`);
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      broadcastGameState();
  });

  socket.on('move', (position, rotation, animation) => {
    const p = players[socket.id];
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
              broadcastGameState(); 
              break; 
          }
      }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
        console.log(`[SERVER] ${players[socket.id].username} left.`);
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