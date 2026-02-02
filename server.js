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
app.use(express.json()); 

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// --- DB LOGIC REMOVED FOR BREVITY (Assumed same as previous) ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR); }
const USERS_FILE = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(USERS_FILE)) { fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2)); }
const db = {
    getUsers: () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')).users; } catch (e) { return []; } },
    saveUser: (user) => { const users = db.getUsers(); users.push(user); fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2)); },
    findUserByUsername: (username) => db.getUsers().find(u => u.username.toLowerCase() === username.toLowerCase()),
    createUser: (username, email, password) => { const newUser = { id: uuidv4(), username, email, password }; db.saveUser(newUser); return { id: newUser.id, username: newUser.username, email: newUser.email }; },
    validateLogin: (username, password) => { const user = db.findUserByUsername(username); if (user && user.password === password) return { id: user.id, username: user.username, email: user.email }; return null; }
};

app.post('/api/register', (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
        if (db.findUserByUsername(username)) return res.status(400).json({ error: 'Username already taken' });
        const user = db.createUser(username, email, password);
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = db.validateLogin(username, password);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

const GamePhase = { WAITING: 'WAITING', COUNTDOWN: 'COUNTDOWN', IN_PROGRESS: 'IN_PROGRESS' };
const Role = { NONE: 'NONE', HUNTER: 'HUNTER', HIDER: 'HIDER', SPECTATOR: 'SPECTATOR' };

let players = {}; 
let gamePhase = GamePhase.WAITING;
let gameTimer = 0;
let lastHunterUserId = null; 

const ROUND_TIME = 300; 
const COUNTDOWN_TIME = 10;
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; 

// FIX: Y lowered to 3
const getRandomSpawn = () => ({ x: (Math.random() * 10) - 5, y: 3, z: (Math.random() * 10) - 5 });

const sendSystemMessage = (text) => {
    io.emit('chatMessage', {
        id: uuidv4(),
        sender: 'SYSTEM',
        text: text,
        isSystem: true,
        timestamp: Date.now()
    });
};

setInterval(() => {
    const now = Date.now();
    let changed = false;
    Object.keys(players).forEach(id => {
        const p = players[id];
        if (p.isDisconnected && p.disconnectTime) {
            if (now - p.disconnectTime > AFK_TIMEOUT) {
                delete players[id];
                io.emit('playerDisconnected', id);
                sendSystemMessage(`${p.username} removed (AFK)`);
                changed = true;
            }
        }
    });
    if (changed) broadcastGameState();
}, 5000);

setInterval(() => {
  const activePlayers = Object.keys(players).filter(id => !players[id].isDisconnected && players[id].role !== Role.SPECTATOR);
  const activeCount = activePlayers.length;

  if (gamePhase === GamePhase.WAITING) {
    if (activeCount >= 2) {
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    if (activeCount < 2) {
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
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;
    const allIds = Object.keys(players);
    const hunters = allIds.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const hiders = allIds.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    let reason = null;
    if (allIds.length < 2) reason = "Not enough players!";
    else if (hunters.length === 0) reason = "HIDERS WIN (Hunter Disconnected)";
    else if (hiders.length === 0) reason = "HUNTER WINS";
    else if (gameTimer <= 0) reason = "HIDERS WIN (Time Limit)";

    if (reason) endGame(reason);
    else broadcastGameState();
  }
}, 1000);

function broadcastGameState() {
    const survivors = Object.values(players).filter(p => p.role === Role.HIDER && !p.isDead).length;
    io.emit('gameStateUpdate', { phase: gamePhase, timer: gameTimer, survivors: survivors });
}

function startGame() {
    gamePhase = GamePhase.IN_PROGRESS;
    gameTimer = ROUND_TIME;
    sendSystemMessage("Game Started!");

    const ids = Object.keys(players);
    ids.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = getRandomSpawn();
        players[id].isDisconnected = false;
    });

    let candidates = ids;
    if (lastHunterUserId && ids.length > 1) {
        const f = ids.filter(id => players[id].userId !== lastHunterUserId);
        if (f.length > 0) candidates = f;
    }

    if (candidates.length > 0) {
        const rid = candidates[Math.floor(Math.random() * candidates.length)];
        players[rid].role = Role.HUNTER;
        lastHunterUserId = players[rid].userId;
    }

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason) {
    io.emit('gameMessage', reason);
    sendSystemMessage(`Round Over: ${reason}`);
    
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
  const deviceId = socket.handshake.auth.deviceId;
  const userId = socket.handshake.auth.userId;
  const username = socket.handshake.auth.username || 'Guest';

  if (!userId) return;

  const existing = Object.keys(players).find(id => players[id].userId === userId && !players[id].isDisconnected);
  if (existing) {
      io.to(existing).emit('forceDisconnect', 'New login detected');
      const old = io.sockets.sockets.get(existing);
      if (old) old.disconnect(true);
  }

  const oldSid = Object.keys(players).find(id => players[id].userId === userId);
  if (oldSid) {
      const p = players[oldSid];
      delete players[oldSid];
      p.id = socket.id;
      p.isDisconnected = false;
      p.disconnectTime = null;
      players[socket.id] = p;
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', p);
      sendSystemMessage(`${username} reconnected.`);
  }

  socket.on('requestGameStart', () => {
      if (players[socket.id]) {
          socket.emit('currentPlayers', players);
          broadcastGameState();
          return;
      }
      const role = gamePhase === GamePhase.IN_PROGRESS ? Role.SPECTATOR : Role.HIDER;
      players[socket.id] = {
        id: socket.id,
        userId, username, deviceId,
        position: getRandomSpawn(),
        rotation: 0, animation: 'Idle', color: '#fff',
        role, isDead: false, isDisconnected: false
      };
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      sendSystemMessage(`${username} joined.`);
      broadcastGameState();
  });

  socket.on('move', (pos, rot, anim) => {
    const p = players[socket.id];
    if (p && !p.isDead && p.role !== Role.SPECTATOR && !p.isDisconnected) {
      p.position = pos;
      p.rotation = rot;
      p.animation = anim; 
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
          if (Math.sqrt(dx*dx + dy*dy + dz*dz) <= KILL_DISTANCE) {
              hider.isDead = true;
              io.emit('playerKilled', hider.id);
              io.emit('playerMoved', hider);
              sendSystemMessage(`${hunter.username} killed ${hider.username}`);
              broadcastGameState(); 
              break; 
          }
      }
  });

  socket.on('chatMessage', (text) => {
      if(!text) return;
      io.emit('chatMessage', { id: uuidv4(), sender: players[socket.id]?.username || '?', text: text.substring(0,50), isSystem: false, timestamp: Date.now() });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
        players[socket.id].isDisconnected = true;
        players[socket.id].disconnectTime = Date.now();
    }
  });
});

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
    app.get('/', (req, res) => res.send("Server running (No Build)."));
}
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));