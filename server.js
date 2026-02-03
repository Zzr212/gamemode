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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "2702";

// --- DATABASE ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR); }

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BANNED_FILE = path.join(DATA_DIR, 'banned.json');
const SPAWN_FILE = path.join(DATA_DIR, 'spawn.json');

if (!fs.existsSync(USERS_FILE)) { fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2)); }
if (!fs.existsSync(BANNED_FILE)) { fs.writeFileSync(BANNED_FILE, JSON.stringify({ banned: [] }, null, 2)); }
if (!fs.existsSync(SPAWN_FILE)) { fs.writeFileSync(SPAWN_FILE, JSON.stringify({ center: { x: 0, y: 3, z: 0 } }, null, 2)); }

const db = {
    getUsers: () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')).users; } catch (e) { return []; } },
    saveUser: (user) => { const users = db.getUsers(); users.push(user); fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2)); },
    findUserByUsername: (username) => db.getUsers().find(u => u.username.toLowerCase() === username.toLowerCase()),
    createUser: (username, email, password) => { const newUser = { id: uuidv4(), username, email, password }; db.saveUser(newUser); return { id: newUser.id, username: newUser.username, email: newUser.email }; },
    validateLogin: (username, password) => { const user = db.findUserByUsername(username); if (user && user.password === password) return { id: user.id, username: user.username, email: user.email }; return null; },
    
    // Admin features
    getBanned: () => { try { return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf-8')).banned; } catch (e) { return []; } },
    addBan: (username) => { const list = db.getBanned(); if (!list.includes(username.toLowerCase())) { list.push(username.toLowerCase()); fs.writeFileSync(BANNED_FILE, JSON.stringify({ banned: list }, null, 2)); } },
    removeBan: (username) => { let list = db.getBanned(); list = list.filter(u => u !== username.toLowerCase()); fs.writeFileSync(BANNED_FILE, JSON.stringify({ banned: list }, null, 2)); },
    isBanned: (username) => { return db.getBanned().includes(username.toLowerCase()); },
    
    getSpawnCenter: () => { try { return JSON.parse(fs.readFileSync(SPAWN_FILE, 'utf-8')).center; } catch (e) { return { x: 0, y: 3, z: 0 }; } },
    setSpawnCenter: (x, y, z) => { fs.writeFileSync(SPAWN_FILE, JSON.stringify({ center: { x, y, z } }, null, 2)); }
};

// --- API ---
app.post('/api/register', (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
        if (db.findUserByUsername(username)) return res.status(400).json({ error: 'Username already taken' });
        if (db.isBanned(username)) return res.status(403).json({ error: 'You are BANNED.' });
        
        const user = db.createUser(username, email, password);
        console.log(`[AUTH] New user: ${username}`);
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (db.isBanned(username)) return res.status(403).json({ error: 'You are BANNED.' });
        
        const user = db.validateLogin(username, password);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        console.log(`[AUTH] Login: ${username}`);
        res.json({ success: true, user });
    } catch (error) { res.status(500).json({ error: "Server Error" }); }
});

// --- GAME STATE ---
const GamePhase = { WAITING: 'WAITING', COUNTDOWN: 'COUNTDOWN', IN_PROGRESS: 'IN_PROGRESS', GAME_OVER: 'GAME_OVER' };
const Role = { NONE: 'NONE', HUNTER: 'HUNTER', HIDER: 'HIDER', SPECTATOR: 'SPECTATOR' };

let players = {}; 
let gamePhase = GamePhase.WAITING;
let gameTimer = 0;
let lastHunterUserId = null; 
const adminAttempts = {}; 

const ROUND_TIME = 300; 
const COUNTDOWN_TIME = 10;
const GAME_OVER_TIME = 4;
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; 

const getRandomSpawn = () => {
    const center = db.getSpawnCenter();
    return { x: center.x + (Math.random() * 10) - 5, y: center.y, z: center.z + (Math.random() * 10) - 5 };
};

const sendSystemMessage = (text, socketId = null, isError = false) => {
    const msg = { 
        id: uuidv4(), 
        sender: isError ? 'ERROR' : 'SYSTEM', 
        text: text, 
        isSystem: true, 
        timestamp: Date.now() 
    };
    if (socketId) {
        io.to(socketId).emit('chatMessage', msg);
    } else {
        io.emit('chatMessage', msg);
    }
};

const broadcastBanMessage = (username, byAdmin = null) => {
    const text = byAdmin ? `${username} has been BANNED by ${byAdmin}.` : `${username} has been BANNED by server.`;
    io.emit('chatMessage', { id: uuidv4(), sender: 'SERVER', text: text.toUpperCase(), isSystem: true, timestamp: Date.now() });
};

// --- LOOPS ---
setInterval(() => {
    const now = Date.now();
    let changed = false;
    Object.keys(players).forEach(id => {
        const p = players[id];
        if (p.isDisconnected && p.disconnectTime) {
            if (now - p.disconnectTime > AFK_TIMEOUT) {
                console.log(`[SERVER] AFK Removal: ${p.username}`);
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
      console.log(`[SERVER] Countdown Started.`);
      gamePhase = GamePhase.COUNTDOWN;
      gameTimer = COUNTDOWN_TIME;
      broadcastGameState();
    }
  }
  else if (gamePhase === GamePhase.COUNTDOWN) {
    gameTimer--;
    if (activeCount < 2) {
        console.log(`[SERVER] Countdown Aborted.`);
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
  else if (gamePhase === GamePhase.GAME_OVER) {
      gameTimer--;
      if (gameTimer <= 0) {
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
    io.emit('gameStateUpdate', { phase: gamePhase, timer: gameTimer, survivors: survivors });
}

function startGame() {
    console.log(`[SERVER] Game Start.`);
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
        console.log(`[SERVER] Hunter: ${players[rid].username}`);
    }

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason) {
    console.log(`[SERVER] End Game: ${reason}`);
    io.emit('gameMessage', reason);
    sendSystemMessage(`Round Over: ${reason}`);
    gamePhase = GamePhase.GAME_OVER;
    gameTimer = GAME_OVER_TIME;
    broadcastGameState();
}

// --- SOCKETS ---
io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId;
  const userId = socket.handshake.auth.userId;
  const username = socket.handshake.auth.username || 'Guest';

  if (!userId) { socket.disconnect(); return; }
  
  if (db.isBanned(username)) {
      socket.emit('forceDisconnect', "You are BANNED.");
      socket.disconnect();
      return;
  }

  // --- GHOST FIX START ---
  const oldSid = Object.keys(players).find(id => players[id].userId === userId);
  if (oldSid) {
      console.log(`[SERVER] Reconnect Detected: ${username} (Old: ${oldSid} -> New: ${socket.id})`);
      const recoveredPlayer = { ...players[oldSid] };
      
      // Notify clients to remove old mesh
      io.emit('playerDisconnected', oldSid);
      
      delete players[oldSid]; 
      const oldSocket = io.sockets.sockets.get(oldSid);
      if (oldSocket) oldSocket.disconnect(true);
      
      recoveredPlayer.id = socket.id;
      recoveredPlayer.isDisconnected = false;
      recoveredPlayer.disconnectTime = null;
      players[socket.id] = recoveredPlayer; 
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', recoveredPlayer);
      sendSystemMessage(`${username} reconnected.`);
  } 
  // --- GHOST FIX END ---

  socket.on('requestGameStart', () => {
      if (players[socket.id]) {
          socket.emit('currentPlayers', players);
          broadcastGameState();
          return;
      }
      
      let initialRole = Role.SPECTATOR;
      if (gamePhase === GamePhase.WAITING || gamePhase === GamePhase.COUNTDOWN) {
          initialRole = Role.HIDER;
      }

      players[socket.id] = {
        id: socket.id,
        userId, username, deviceId,
        position: getRandomSpawn(),
        rotation: 0, animation: 'Idle', color: '#fff',
        role: initialRole, isDead: false, isDisconnected: false,
        isAdmin: false
      };
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      sendSystemMessage(`${username} joined.`);
      console.log(`[SERVER] Join: ${username}`);
      broadcastGameState();
  });

  socket.on('move', (pos, rot, anim) => {
    const p = players[socket.id];
    if (gamePhase === GamePhase.GAME_OVER) return; 
    
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

  // --- COMMAND SYSTEM ---
  socket.on('chatMessage', (text) => {
      if(!text) return;
      const p = players[socket.id];
      if (!p) return;

      const trimmedText = text.trim();
      
      // 1. Check if it's a command
      if (trimmedText.startsWith('/')) {
          const parts = trimmedText.split(' ');
          const command = parts[0].toLowerCase();
          const arg1 = parts[1];

          console.log(`[COMMAND] ${p.username} tried: ${command}`);

          // Login Admin
          if (command === '/adminpw') {
              if (arg1 === ADMIN_PASSWORD) {
                  p.isAdmin = true;
                  sendSystemMessage("ACCESS GRANTED. You are now Admin.", socket.id);
                  socket.emit('toggleAdminPanel', true);
                  adminAttempts[p.userId] = 0; 
              } else {
                  const attempts = (adminAttempts[p.userId] || 0) + 1;
                  adminAttempts[p.userId] = attempts;
                  if (attempts >= 3) {
                      db.addBan(p.username);
                      broadcastBanMessage(p.username);
                      socket.emit('forceDisconnect', "BANNED: Too many failed admin attempts.");
                      socket.disconnect();
                  } else {
                      sendSystemMessage(`ACCESS DENIED. Incorrect password. (${attempts}/3)`, socket.id, true);
                  }
              }
              return; 
          }

          // ADMIN ONLY
          if (p.isAdmin) {
              if (command === '/ban') {
                  if (!arg1) { sendSystemMessage("Usage: /ban [username]", socket.id, true); return; }
                  
                  const targetUser = db.findUserByUsername(arg1);
                  if (targetUser) {
                      db.addBan(targetUser.username);
                      broadcastBanMessage(targetUser.username, p.username);
                      // Kick
                      const targetSocketId = Object.keys(players).find(k => players[k].username.toLowerCase() === arg1.toLowerCase());
                      if (targetSocketId) {
                          const targetSocket = io.sockets.sockets.get(targetSocketId);
                          if (targetSocket) {
                              targetSocket.emit('forceDisconnect', "You have been BANNED by an administrator.");
                              targetSocket.disconnect();
                          }
                      }
                  } else {
                      sendSystemMessage(`User '${arg1}' not found in database.`, socket.id, true);
                  }
                  return;
              }

              if (command === '/unban') {
                  if (!arg1) { sendSystemMessage("Usage: /unban [username]", socket.id, true); return; }
                  if (db.isBanned(arg1)) {
                      db.removeBan(arg1);
                      sendSystemMessage(`User '${arg1}' unbanned.`, socket.id);
                      io.emit('chatMessage', { id: uuidv4(), sender: 'SERVER', text: `${arg1} has been unbanned by ${p.username}`, isSystem: true, timestamp: Date.now() });
                  } else {
                      sendSystemMessage(`User '${arg1}' is not banned.`, socket.id, true);
                  }
                  return;
              }

              if (command === '/location') {
                  socket.emit('toggleLocationDisplay', true);
                  sendSystemMessage("Toggled location display.", socket.id);
                  return;
              }

              if (command === '/setlocation') {
                  try {
                      if (!arg1) throw new Error();
                      const coords = arg1.split(',');
                      if (coords.length === 3) {
                          const x = parseFloat(coords[0]);
                          const y = parseFloat(coords[1]);
                          const z = parseFloat(coords[2]);
                          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                              db.setSpawnCenter(x, y, z);
                              sendSystemMessage(`Spawn center updated to ${x}, ${y}, ${z}`, socket.id);
                          } else { throw new Error(); }
                      } else { throw new Error(); }
                  } catch (e) {
                      sendSystemMessage("Invalid format. Use: /setlocation x,y,z", socket.id, true);
                  }
                  return;
              }

              if (command === '/ainfo') {
                  socket.emit('toggleAdminPanel', true);
                  return;
              }
              
              sendSystemMessage(`Unknown Admin Command: ${command}`, socket.id, true);
              return;
          } else {
              sendSystemMessage(`Unknown Command: ${command}`, socket.id, true);
              return;
          }
      }

      // 2. Normal Chat
      console.log(`[CHAT] ${p.username}: ${trimmedText.substring(0,50)}`);
      io.emit('chatMessage', { id: uuidv4(), sender: p.username, text: trimmedText.substring(0,50), isSystem: false, timestamp: Date.now() });
  });

  socket.on('leaveGame', () => {
      if (players[socket.id]) {
          console.log(`[SERVER] Explicit Leave: ${players[socket.id].username}`);
          const name = players[socket.id].username;
          delete players[socket.id];
          io.emit('playerDisconnected', socket.id);
          sendSystemMessage(`${name} left.`);
          broadcastGameState();
      }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
        console.log(`[SERVER] Disconnect (Grace): ${players[socket.id].username}`);
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