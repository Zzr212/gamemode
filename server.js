import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // Enable JSON body parsing for login/register

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// --- SIMPLE DB IMPLEMENTATION ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

const db = {
    getUsers: () => {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf-8');
            return JSON.parse(data).users;
        } catch (e) {
            return [];
        }
    },
    saveUser: (user) => {
        const users = db.getUsers();
        users.push(user);
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
    },
    findUserByUsername: (username) => {
        const users = db.getUsers();
        return users.find(u => u.username.toLowerCase() === username.toLowerCase());
    },
    createUser: (username, email, password) => {
        const newUser = {
            id: uuidv4(),
            username,
            email,
            password 
        };
        db.saveUser(newUser);
        return { id: newUser.id, username: newUser.username, email: newUser.email };
    },
    validateLogin: (username, password) => {
        const user = db.findUserByUsername(username);
        if (user && user.password === password) {
            return { id: user.id, username: user.username, email: user.email };
        }
        return null;
    }
};

// --- AUTH API ROUTES ---
app.post('/api/register', (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        if (db.findUserByUsername(username)) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        const user = db.createUser(username, email, password);
        res.json({ success: true, user });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = db.validateLogin(username, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.json({ success: true, user });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- GAME STATE CONSTANTS & VARIABLES ---
const GamePhase = {
  WAITING: 'WAITING',
  COUNTDOWN: 'COUNTDOWN',
  IN_PROGRESS: 'IN_PROGRESS'
};

const Role = {
  NONE: 'NONE',
  HUNTER: 'HUNTER',
  HIDER: 'HIDER',
  SPECTATOR: 'SPECTATOR'
};

// Map of socketId -> PlayerState
let players = {}; 
let gamePhase = GamePhase.WAITING;
let gameTimer = 0;
let lastHunterUserId = null; // Track who was hunter last time

const ROUND_TIME = 300; // 5 minutes
const COUNTDOWN_TIME = 10;
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; // 2 minutes

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
  
  // Only count ACTUALLY connected players for start logic
  const connectedPlayers = playerIds.filter(id => !players[id].isDisconnected);
  
  const activePlayers = connectedPlayers.filter(id => {
      const p = players[id];
      return p.role !== Role.SPECTATOR;
  });

  const activeCount = activePlayers.length;

  // 1. WAITING -> COUNTDOWN
  if (gamePhase === GamePhase.WAITING) {
    if (activeCount >= 2) {
      console.log(`[SERVER] ${activeCount} players ready. Starting Countdown.`);
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
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

    const allPlayerIds = Object.keys(players);
    const livingHunters = allPlayerIds.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = allPlayerIds.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    // Win Conditions
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
    
    // 1. RESET: Everyone becomes a HIDER (Alive) first
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = { x: 0, y: 10, z: 0 }; 
        players[id].isDisconnected = false; // Ensure reconnection resets this status
    });

    // 2. ASSIGN: Pick Random Hunter (Avoiding Last Hunter if possible)
    let candidates = playerIds;
    
    // Try to exclude the last hunter if we have enough players (>2)
    // If only 2 players, we still randomize (50%) or swap depending on logic.
    // Here we strictly exclude unless they are the only option (which shouldn't happen with >1 players if we do it right, but fallback is safe).
    if (lastHunterUserId && playerIds.length > 1) {
        const filtered = playerIds.filter(id => players[id].userId !== lastHunterUserId);
        // If we have other people, use them. If somehow only the last hunter is here (unlikely in >1), default back to everyone.
        if (filtered.length > 0) {
            candidates = filtered;
        }
    }

    if (candidates.length > 0) {
        const randomIndex = Math.floor(Math.random() * candidates.length);
        const hunterId = candidates[randomIndex];
        players[hunterId].role = Role.HUNTER;
        lastHunterUserId = players[hunterId].userId; // Memorize for next round
        console.log(`[SERVER] Hunter assigned: ${players[hunterId].username}`);
    }

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason) {
    console.log(`[SERVER] Game End: ${reason}`);
    io.emit('gameMessage', reason);
    
    if (Object.keys(players).length >= 2) {
        gamePhase = GamePhase.COUNTDOWN;
        gameTimer = COUNTDOWN_TIME;
    } else {
        gamePhase = GamePhase.WAITING;
        gameTimer = 0;
    }

    // Reset everyone to "Lobby Mode" (Hider, Alive)
    Object.keys(players).forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = { x: 0, y: 10, z: 0 };
    });

    io.emit('currentPlayers', players);
    broadcastGameState();
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId || 'unknown';
  const userId = socket.handshake.auth.userId;
  const username = socket.handshake.auth.username || 'Guest';

  if (!userId) {
      console.log("Socket connected without userId, ignoring.");
      return;
  }

  // 1. DUPLICATE CHECK
  const existingSocketId = Object.keys(players).find(id => players[id].userId === userId && !players[id].isDisconnected);
  
  if (existingSocketId) {
      console.log(`[SERVER] Duplicate login for ${username}. Kicking old socket.`);
      io.to(existingSocketId).emit('forceDisconnect', 'New login detected');
      const oldSocket = io.sockets.sockets.get(existingSocketId);
      if (oldSocket) oldSocket.disconnect(true);
  }

  // 2. RECONNECTION LOGIC
  let playerObj = null;
  const oldSessionId = Object.keys(players).find(id => players[id].userId === userId);

  if (oldSessionId) {
      console.log(`[SERVER] ${username} reconnected. restoring session.`);
      playerObj = players[oldSessionId];
      
      // CRITICAL FIX FOR CLONE/GHOST BUG:
      // Tell all clients to delete the OLD socket ID entity immediately.
      io.emit('playerDisconnected', oldSessionId);

      // Remove old key from map
      delete players[oldSessionId];
      
      // Update with new Socket ID
      playerObj.id = socket.id;
      playerObj.isDisconnected = false;
      playerObj.disconnectTime = null;
      
      // Assign to new key
      players[socket.id] = playerObj;

      // Send immediate sync to everyone including the new socket
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', playerObj); 
  }

  socket.on('requestGameStart', () => {
      // If we just reconnected, we might already have a role/body.
      if (players[socket.id]) {
          console.log(`[SERVER] ${username} requested start (Existing Session).`);
          socket.emit('currentPlayers', players);
          broadcastGameState();
          return;
      }

      // New Player Logic
      let initialRole = Role.HIDER;
      if (gamePhase === GamePhase.IN_PROGRESS) {
          initialRole = Role.SPECTATOR;
      }
      
      players[socket.id] = {
        id: socket.id,
        userId: userId,
        username: username,
        deviceId: deviceId,
        position: { x: 0, y: 10, z: 0 },
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
        console.log(`[SERVER] ${players[socket.id].username} disconnected (Grace Period Started).`);
        // DON'T DELETE immediately. Mark as disconnected.
        players[socket.id].isDisconnected = true;
        players[socket.id].disconnectTime = Date.now();
    }
  });
});

// Serve Static Files (Production)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
} else {
    console.log("WARNING: 'dist' folder not found. Running in API-only mode.");
    app.get('/', (req, res) => res.send("Server running. Frontend not built."));
}

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});