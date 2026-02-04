import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { PlayerState, GamePhase, Role, GameSettings, TaskType, PlayerTask, TaskLocation, Vector3 } from '../types.js';
import { db } from './db.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json() as any); 

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
} as any);

const PORT = process.env.PORT || 3000;

// --- AUTH ---
app.post('/api/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (db.findUserByUsername(username)) return res.status(400).json({ error: 'Username already taken' });
    if (db.isBanned(username)) return res.status(403).json({ error: 'You are BANNED.' });
    const user = db.createUser(username, email, password);
    res.json({ success: true, user });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (db.isBanned(username)) return res.status(403).json({ error: 'You are BANNED.' });
    const user = db.validateLogin(username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ success: true, user });
});

// --- STATE ---
let players: Record<string, PlayerState> = {};
let gamePhase: GamePhase = GamePhase.WAITING;
let gameTimer: number = 0;
let lastHunterUserId: string | null = null;
const adminAttempts: Record<string, number> = {}; 
let gameSettings: GameSettings = db.getSettings();
let taskSpawns: TaskLocation[] = db.getTaskSpawns();

const COUNTDOWN_TIME = 10;
const GAME_OVER_TIME = 4;
const KILL_DISTANCE = 3.0;
const AFK_TIMEOUT = 120 * 1000; 
const ADMIN_PASSWORD = "2702";

const getRandomSpawn = () => {
    const center = db.getSpawnCenter();
    return { x: center.x + (Math.random() * 10) - 5, y: center.y, z: center.z + (Math.random() * 10) - 5 };
};

const sendSystemMessage = (text: string, socketId?: string, isError: boolean = false) => {
    const msg = { id: uuidv4(), sender: isError ? 'ERROR' : 'SYSTEM', text: text, isSystem: true, timestamp: Date.now() };
    if (socketId) io.to(socketId).emit('chatMessage', msg); else io.emit('chatMessage', msg);
};

const broadcastBanMessage = (username: string, byAdmin: string | null = null) => {
    const text = byAdmin ? `${username} has been BANNED by ${byAdmin}.` : `${username} has been BANNED by server.`;
    io.emit('chatMessage', { id: uuidv4(), sender: 'SERVER', text: text.toUpperCase(), isSystem: true, timestamp: Date.now() });
};

// --- LOOP ---
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
    // Note: Can add task win condition here if desired

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
    io.emit('gameStateUpdate', { 
        phase: gamePhase, 
        timer: gameTimer, 
        survivors: survivors,
        settings: gameSettings,
        taskSpawns: taskSpawns
    });
}

function assignTasksToHiders(hiders: string[]) {
    const availableTaskTypes = Object.values(TaskType);
    
    hiders.forEach(id => {
        players[id].tasks = [];
        // Select 4 unique random task types
        const shuffled = [...availableTaskTypes].sort(() => 0.5 - Math.random());
        const selectedTypes = shuffled.slice(0, 4);

        selectedTypes.forEach(type => {
            // Find spawns for this type
            const spawns = taskSpawns.filter(t => t.type === type);
            if (spawns.length > 0) {
                // Pick a random spawn point for this task type
                const spawn = spawns[Math.floor(Math.random() * spawns.length)];
                players[id].tasks.push({
                    id: uuidv4(),
                    type: type,
                    locationId: spawn.id,
                    position: spawn.position,
                    completed: false
                });
            }
        });
    });
}

function startGame() {
    console.log(`[SERVER] Game Start.`);
    gamePhase = GamePhase.IN_PROGRESS;
    gameTimer = gameSettings.roundDuration || 300;
    sendSystemMessage("Game Started!");

    const ids = Object.keys(players);
    ids.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = getRandomSpawn();
        players[id].isDisconnected = false;
        players[id].tasks = [];
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

    // Assign tasks to everyone who is HIDER
    const hiders = ids.filter(id => players[id].role === Role.HIDER);
    assignTasksToHiders(hiders);

    io.emit('currentPlayers', players);
    broadcastGameState();
}

function resetGameRound() {
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
        players[id].tasks = [];
    });
    io.emit('currentPlayers', players);
    broadcastGameState();
}

function endGame(reason: string) {
    io.emit('gameMessage', reason);
    sendSystemMessage(`Round Over: ${reason}`);
    gamePhase = GamePhase.GAME_OVER;
    gameTimer = GAME_OVER_TIME;
    broadcastGameState();
}

// --- SOCKETS ---
io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId as string;
  const userId = socket.handshake.auth.userId as string;
  const username = (socket.handshake.auth.username as string) || 'Guest';

  if (!userId) { socket.disconnect(); return; }
  if (db.isBanned(username)) { socket.emit('forceDisconnect', "You are BANNED."); socket.disconnect(); return; }

  const userRecord = db.findUserByUsername(username);
  const isPersistentAdmin = userRecord?.isAdmin || false;

  const oldSid = Object.keys(players).find(id => players[id].userId === userId);
  if (oldSid) {
      const recoveredPlayer = { ...players[oldSid] };
      io.emit('playerDisconnected', oldSid);
      delete players[oldSid]; 
      const oldSocket = io.sockets.sockets.get(oldSid);
      if (oldSocket) oldSocket.disconnect(true);
      recoveredPlayer.id = socket.id;
      recoveredPlayer.isDisconnected = false;
      recoveredPlayer.isAdmin = isPersistentAdmin;
      players[socket.id] = recoveredPlayer; 
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', recoveredPlayer);
      sendSystemMessage(`${username} reconnected.`);
  } 

  socket.on('requestGameStart', () => {
      if (players[socket.id]) { socket.emit('currentPlayers', players); broadcastGameState(); return; }
      let initialRole = Role.SPECTATOR;
      if (gamePhase === GamePhase.WAITING || gamePhase === GamePhase.COUNTDOWN) initialRole = Role.HIDER;
      players[socket.id] = {
        id: socket.id,
        userId, username, deviceId,
        position: getRandomSpawn(),
        rotation: 0, animation: 'Idle', color: '#fff',
        role: initialRole, isDead: false, isDisconnected: false,
        isAdmin: isPersistentAdmin,
        tasks: []
      };
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      sendSystemMessage(`${username} joined.`);
      broadcastGameState();
  });

  socket.on('move', (pos, rot, anim) => {
    const p = players[socket.id];
    if (gamePhase === GamePhase.GAME_OVER) return; 

    // HUNTER HEADSTART LOGIC (Freeze hunter for first 15s)
    if (p && p.role === Role.HUNTER && gamePhase === GamePhase.IN_PROGRESS) {
        const elapsedTime = gameSettings.roundDuration - gameTimer;
        if (elapsedTime < gameSettings.headStartDuration) {
            return; // Ignore movement inputs
        }
    }
    
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
      
      // Prevent kill during headstart
      const elapsedTime = gameSettings.roundDuration - gameTimer;
      if (elapsedTime < gameSettings.headStartDuration) return;

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

  // --- TASK LOGIC ---
  socket.on('completeTask', (taskId) => {
      const p = players[socket.id];
      if (p && p.role === Role.HIDER && !p.isDead) {
          const task = p.tasks.find(t => t.id === taskId);
          if (task && !task.completed) {
              task.completed = true;
              socket.emit('currentPlayers', players); // Send back to confirm UI
              // Optional: Win condition check here if all tasks done
          }
      }
  });

  // --- ADMIN ---
  socket.on('updateSettings', (newSettings) => {
      if (players[socket.id]?.isAdmin) {
          gameSettings = newSettings;
          db.saveSettings(gameSettings);
          io.emit('settingsUpdated', gameSettings);
          broadcastGameState();
          sendSystemMessage("Settings Updated by Admin.");
      }
  });

  socket.on('addTaskSpawn', (type, position) => {
      if (players[socket.id]?.isAdmin) {
          const newTask = db.addTaskSpawn(type, position);
          taskSpawns.push(newTask);
          broadcastGameState();
          sendSystemMessage(`Added spawn for ${type}.`);
      }
  });

  socket.on('removeTaskSpawn', (spawnId) => {
      if (players[socket.id]?.isAdmin) {
          db.removeTaskSpawn(spawnId);
          taskSpawns = taskSpawns.filter(t => t.id !== spawnId);
          broadcastGameState();
          sendSystemMessage("Removed task spawn.");
      }
  });

  socket.on('banPlayer', (targetUsername) => {
      if (players[socket.id]?.isAdmin) {
          const targetUser = db.findUserByUsername(targetUsername);
          if (targetUser) {
              db.addBan(targetUser.username);
              broadcastBanMessage(targetUser.username, players[socket.id].username);
              const targetSocketId = Object.keys(players).find(k => players[k].username.toLowerCase() === targetUsername.toLowerCase());
              if (targetSocketId) {
                  const targetSocket = io.sockets.sockets.get(targetSocketId);
                  targetSocket?.emit('forceDisconnect', "You have been BANNED by an administrator.");
                  targetSocket?.disconnect();
              }
          }
      }
  });

  socket.on('chatMessage', (text) => {
      if(!text) return;
      const p = players[socket.id];
      if (!p) return;
      const trimmedText = text.trim();
      if (trimmedText.startsWith('/')) {
          const parts = trimmedText.split(' ');
          const command = parts[0].toLowerCase();
          const arg1 = parts[1];
          if (command === '/adminpw') {
              if (arg1 === ADMIN_PASSWORD) {
                  p.isAdmin = true;
                  db.setAdminStatus(p.userId, true);
                  sendSystemMessage("ACCESS GRANTED (Persistent).", socket.id);
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
                      sendSystemMessage(`ACCESS DENIED. (${attempts}/3)`, socket.id, true);
                  }
              }
              return; 
          }
          if (p.isAdmin) {
              if (command === '/ban') { socket.emit('toggleAdminPanel', true); return; }
              if (command === '/unban') {
                  if (!arg1) { sendSystemMessage("Usage: /unban [user]", socket.id, true); return; }
                  if (db.isBanned(arg1)) { db.removeBan(arg1); sendSystemMessage(`Unbanned ${arg1}.`, socket.id); } 
                  else sendSystemMessage(`Not banned.`, socket.id, true);
                  return;
              }
              if (command === '/location') { socket.emit('toggleLocationDisplay', true); return; }
              if (command === '/ainfo') { socket.emit('toggleAdminPanel', true); return; }
          }
          return;
      }
      io.emit('chatMessage', { id: uuidv4(), sender: p.username, text: trimmedText.substring(0,50), isSystem: false, timestamp: Date.now() });
  });

  socket.on('leaveGame', () => {
      if (players[socket.id]) {
          const name = players[socket.id].username;
          delete players[socket.id];
          io.emit('playerDisconnected', socket.id);
          sendSystemMessage(`${name} left.`);
          broadcastGameState();
      }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
        players[socket.id].isDisconnected = true;
        players[socket.id].disconnectTime = Date.now();
    }
  });
});

const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath) as any);
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
    app.get('/', (_req, res) => res.send("Server running (No Build)."));
}
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));