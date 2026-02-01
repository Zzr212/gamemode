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
app.use(express.json()); // Enable JSON body parsing for login/register

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

const ROUND_TIME = 300; // 5 minutes
const COUNTDOWN_TIME = 10;
const KILL_DISTANCE = 3.0;

// --- GAME LOOP (Automatic) ---
setInterval(() => {
  const playerIds = Object.keys(players);
  
  const activePlayers = playerIds.filter(id => {
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

    // Valid "Living" players
    const livingHunters = playerIds.filter(id => players[id].role === Role.HUNTER && !players[id].isDead);
    const livingHiders = playerIds.filter(id => players[id].role === Role.HIDER && !players[id].isDead);
    
    // Win Conditions
    let reason = null;
    
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
  const deviceId = socket.handshake.auth.deviceId || 'unknown';
  const userId = socket.handshake.auth.userId || 'guest-' + socket.id;
  const username = socket.handshake.auth.username || 'Guest';

  socket.on('requestGameStart', () => {
      // User clicked Play Game in Menu
      
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
        isDead: false
      };

      console.log(`[SERVER] ${username} joined world (ID: ${userId})`);
      
      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
      broadcastGameState();
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
              console.log(`[SERVER] Kill: ${hunter.username} -> ${hider.username}`);
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
        console.log(`[SERVER] ${players[socket.id].username} left.`);
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