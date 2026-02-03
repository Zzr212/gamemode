import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
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
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (db.findUserByUsername(username)) return res.status(400).json({ error: 'Username already taken' });
    
    if (db.isBanned(username)) return res.status(403).json({ error: 'You are BANNED from this server.' });

    const user = db.createUser(username, email, password);
    console.log(`[AUTH] New user registered: ${username}`);
    res.json({ success: true, user });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (db.isBanned(username)) return res.status(403).json({ error: 'You are BANNED from this server.' });

    const user = db.validateLogin(username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    console.log(`[AUTH] User logged in: ${username}`);
    res.json({ success: true, user });
});

// --- GAME STATE ---
let players: Record<string, PlayerState> = {};
let gamePhase: GamePhase = GamePhase.WAITING;
let gameTimer: number = 0;
let lastHunterUserId: string | null = null;
const adminAttempts: Record<string, number> = {}; // Track password attempts by userID

const ROUND_TIME = 300; 
const COUNTDOWN_TIME = 10;
const GAME_OVER_TIME = 4;
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; 
const ADMIN_PASSWORD = "2702";

const getRandomSpawn = () => {
    const center = db.getSpawnCenter();
    return { 
        x: center.x + (Math.random() * 10) - 5, 
        y: center.y, 
        z: center.z + (Math.random() * 10) - 5 
    };
};

const sendSystemMessage = (text: string, socketId?: string, isError: boolean = false) => {
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

const broadcastBanMessage = (username: string, byAdmin: string | null = null) => {
    const text = byAdmin 
        ? `${username} has been BANNED by ${byAdmin}.` 
        : `${username} has been BANNED by server.`;
    
    io.emit('chatMessage', { 
        id: uuidv4(), 
        sender: 'SERVER', 
        text: text.toUpperCase(), 
        isSystem: true, 
        timestamp: Date.now() 
    });
};

// --- GAME LOOP ---
setInterval(() => {
    const now = Date.now();
    let changed = false;
    
    // Cleanup AFK
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

  // Phase Logic
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
          resetGameRound();
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

function resetGameRound() {
    console.log("[SERVER] Resetting Round.");
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
}

function endGame(reason: string) {
    console.log(`[SERVER] End Game: ${reason}`);
    io.emit('gameMessage', reason);
    sendSystemMessage(`Round Over: ${reason}`);
    gamePhase = GamePhase.GAME_OVER;
    gameTimer = GAME_OVER_TIME;
    broadcastGameState();
}

// --- SOCKET HANDLERS ---

io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId as string;
  const userId = socket.handshake.auth.userId as string;
  const username = (socket.handshake.auth.username as string) || 'Guest';

  if (!userId) { socket.disconnect(); return; }
  
  if (db.isBanned(username)) {
      socket.emit('forceDisconnect', "You are BANNED.");
      socket.disconnect();
      return;
  }

  // --- GHOST FIX START ---
  // Check if this user is already in the player list with an OLD socket ID
  const oldSid = Object.keys(players).find(id => players[id].userId === userId);
  
  if (oldSid) {
      console.log(`[SERVER] Reconnect Detected: ${username} (Old: ${oldSid} -> New: ${socket.id})`);
      
      // 1. Recover state
      const recoveredPlayer = { ...players[oldSid] };
      
      // 2. IMPORTANT: Broadcast 'playerDisconnected' for the OLD ID so clients remove the old mesh
      io.emit('playerDisconnected', oldSid);
      
      // 3. Remove old record from memory
      delete players[oldSid]; 
      
      // 4. Force disconnect old socket to prevent conflict
      const oldSocket = io.sockets.sockets.get(oldSid);
      if (oldSocket) oldSocket.disconnect(true);
      
      // 5. Update state with NEW socket ID
      recoveredPlayer.id = socket.id;
      recoveredPlayer.isDisconnected = false;
      recoveredPlayer.disconnectTime = undefined;
      players[socket.id] = recoveredPlayer; 
      
      // 6. Sync everything up
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', recoveredPlayer);
      sendSystemMessage(`${username} reconnected.`);
  } 
  // --- GHOST FIX END ---
  
  socket.on('requestGameStart', () => {
      // If already exists (handled in reconnection block or just clicking Play while connected)
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

  // --- COMMAND SYSTEM FIX ---
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

          // --- PUBLIC COMMANDS ---

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
              return; // Stop processing
          }

          // --- ADMIN ONLY COMMANDS ---
          if (p.isAdmin) {
              if (command === '/ban') {
                  if (!arg1) { sendSystemMessage("Usage: /ban [username]", socket.id, true); return; }
                  
                  const targetUser = db.findUserByUsername(arg1);
                  if (targetUser) {
                      db.addBan(targetUser.username);
                      broadcastBanMessage(targetUser.username, p.username);
                      
                      // Kick if online
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
                          } else {
                              throw new Error();
                          }
                      } else {
                          throw new Error();
                      }
                  } catch (e) {
                      sendSystemMessage("Invalid format. Use: /setlocation x,y,z", socket.id, true);
                  }
                  return;
              }

              if (command === '/ainfo') {
                  socket.emit('toggleAdminPanel', true);
                  return;
              }
              
              // If admin types unknown command
              sendSystemMessage(`Unknown Admin Command: ${command}`, socket.id, true);
              return;

          } else {
              // If non-admin types unknown command or tries admin command
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
          
          // STRICT: Delete immediately so reconnection logic (oldSid) fails next time
          delete players[socket.id];
          
          io.emit('playerDisconnected', socket.id);
          sendSystemMessage(`${name} left.`);
          broadcastGameState();
      }
  });

  socket.on('disconnect', () => {
    // Only mark disconnected if they are still in the players list (i.e. didn't explicitly leave)
    if (players[socket.id]) {
        console.log(`[SERVER] Disconnect (Grace): ${players[socket.id].username}`);
        players[socket.id].isDisconnected = true;
        players[socket.id].disconnectTime = Date.now();
    }
  });
});

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath) as any);
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
    app.get('/', (_req, res) => res.send("Server running (No Build)."));
}
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));