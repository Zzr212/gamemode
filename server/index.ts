import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState, GamePhase, Role } from '../types.js';
import { db } from './db.js';
import { v4 as uuidv4 } from 'uuid';
import readline from 'readline';

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
let spawnPoints: {x: number, y: number, z: number}[] = [];

const ROUND_TIME = 300; 
const COUNTDOWN_TIME = 10;
const GAME_OVER_TIME = 4;
const KILL_DISTANCE = 3.0;

// Utility: Spawn Logic
const getRandomSpawn = () => {
    // If Admin set specific spawn points, pick one randomly
    if (spawnPoints.length > 0) {
        const idx = Math.floor(Math.random() * spawnPoints.length);
        return spawnPoints[idx];
    }
    // Default Random Range
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

// --- MAIN GAME LOOP ---
setInterval(() => {
  const activePlayers = Object.values(players).filter(p => p.role !== Role.SPECTATOR);
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
  // 2. COUNTDOWN
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
  // 3. IN PROGRESS
  else if (gamePhase === GamePhase.IN_PROGRESS) {
    gameTimer--;
    const allPlayerIds = Object.keys(players);
    const livingHunters = allPlayerIds.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = allPlayerIds.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    let reason = null;
    if (allPlayerIds.length < 2) reason = "Not enough players!";
    else if (livingHunters.length === 0) reason = "HIDERS WIN (Hunter Disconnected)";
    else if (livingHiders.length === 0) reason = "HUNTER WINS";
    else if (gameTimer <= 0) reason = "HIDERS WIN (Time Limit)";

    if (reason) endGame(reason);
    else broadcastGameState();
  }
  // 4. GAME OVER (Buffer)
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
    playerIds.forEach(id => {
        players[id].isDead = false;
        players[id].role = Role.HIDER;
        players[id].position = getRandomSpawn();
    });

    let candidates = playerIds;
    if (lastHunterUserId && playerIds.length > 1) {
        const filtered = playerIds.filter(id => players[id].userId !== lastHunterUserId);
        if (filtered.length > 0) candidates = filtered;
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
    if (gamePhase !== GamePhase.IN_PROGRESS) return;
    console.log(`[SERVER] Round Ended: ${reason}`);
    gamePhase = GamePhase.GAME_OVER;
    gameTimer = GAME_OVER_TIME;
    io.emit('gameMessage', reason);
    sendSystemMessage(`Round Over: ${reason}`);
    broadcastGameState();
}

io.on('connection', (socket) => {
  const deviceId = socket.handshake.auth.deviceId || 'unknown';
  const userId = socket.handshake.auth.userId || 'guest-' + socket.id;
  const username = socket.handshake.auth.username || 'Guest';

  // --- STRICT NO-RECONNECT LOGIC ---
  // If user connects, they are a NEW player. 
  // If there was an old phantom player with same ID, it should have been deleted on disconnect.
  // Just in case, we check by userId and cleanup if needed.
  const existingId = Object.keys(players).find(id => players[id].userId === userId);
  if (existingId) {
      delete players[existingId];
      const oldSock = io.sockets.sockets.get(existingId);
      if(oldSock) oldSock.disconnect(true);
  }

  // --- JOIN LOGIC ---
  socket.on('requestGameStart', () => {
      // If player already in memory (double request), ignore
      if (players[socket.id]) return;
      
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
        isAdmin: false
      };

      console.log(`[SERVER] ${username} joined (ID: ${userId})`);
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      sendSystemMessage(`${username} joined.`);
      broadcastGameState();
  });

  socket.on('move', (position, rotation, animation) => {
    const p = players[socket.id];
    if (gamePhase === GamePhase.GAME_OVER) return;
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
      io.emit('chatMessage', {
          id: uuidv4(),
          sender: players[socket.id]?.username || 'Unknown',
          text: safeText,
          isSystem: false,
          timestamp: Date.now()
      });
  });

  socket.on('leaveGame', () => {
      // Explicit leave
      if (players[socket.id]) {
          const name = players[socket.id].username;
          delete players[socket.id];
          io.emit('playerDisconnected', socket.id);
          sendSystemMessage(`${name} left.`);
          broadcastGameState();
      }
  });

  // --- IMMEDIATE DISCONNECT ---
  socket.on('disconnect', () => {
    // Treat connection loss exactly like leaving the game
    if (players[socket.id]) {
        console.log(`[SERVER] ${players[socket.id].username} disconnected (Immediate removal).`);
        const name = players[socket.id].username;
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        sendSystemMessage(`${name} disconnected.`);
        broadcastGameState();
    }
  });
});

// --- CLI ADMIN COMMANDS ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("[CLI] Admin console ready. Commands: /admin <user>, /unadmin <user>, /setspawn <x> <y> <z>");

rl.on('line', (line) => {
    const args = line.trim().split(' ');
    const command = args[0];

    if (command === '/admin') {
        const targetName = args[1];
        if (!targetName) { console.log("Usage: /admin <username>"); return; }
        
        const targetId = Object.keys(players).find(id => players[id].username.toLowerCase() === targetName.toLowerCase());
        
        if (targetId) {
            players[targetId].isAdmin = true;
            io.emit('playerMoved', players[targetId]); // Sync state
            sendSystemMessage(`SERVER: ${players[targetId].username} is now an Admin/Developer.`);
            console.log(`[CLI] Granted admin to ${targetName}`);
        } else {
            console.log(`[CLI] Player ${targetName} not found.`);
        }
    }
    else if (command === '/unadmin') {
        const targetName = args[1];
        if (!targetName) { console.log("Usage: /unadmin <username>"); return; }

        const targetId = Object.keys(players).find(id => players[id].username.toLowerCase() === targetName.toLowerCase());
        
        if (targetId) {
            players[targetId].isAdmin = false;
            io.emit('playerMoved', players[targetId]); 
            sendSystemMessage(`SERVER: ${players[targetId].username} is no longer an Admin.`);
            console.log(`[CLI] Removed admin from ${targetName}`);
        } else {
            console.log(`[CLI] Player ${targetName} not found.`);
        }
    }
    else if (command === '/setspawn') {
        // Usage: /setspawn 10 2 -5
        const x = parseFloat(args[1]);
        const y = parseFloat(args[2]);
        const z = parseFloat(args[3]);

        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            spawnPoints.push({x, y, z});
            console.log(`[CLI] Added new spawn point at ${x}, ${y}, ${z}`);
            console.log(`Total spawn points: ${spawnPoints.length}`);
        } else {
            console.log("Usage: /setspawn <x> <y> <z>");
        }
    }
});

// --- GRACEFUL SHUTDOWN ---
const handleShutdown = () => {
    console.log("\n[SERVER] Shutting down... Refreshing clients.");
    sendSystemMessage("SERVER RESTARTING IN 3 SECONDS...");
    io.emit('forceRefresh');
    
    // Give sockets time to receive the message
    setTimeout(() => {
        process.exit(0);
    }, 3000);
};

process.on('SIGINT', handleShutdown); // CTRL+C
process.on('SIGTERM', handleShutdown); // Kill command

// --- STATIC SERVING ---
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