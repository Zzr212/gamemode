import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PlayerState, Vector3 } from '../types.js';

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

// FILE SYSTEM PATHS
const DATA_FILE = path.join(__dirname, 'spawn_config.json');

// GLOBAL STATE
let globalSpawnPoint: Vector3 = { x: 0, y: 5, z: 0 };
const players: Record<string, PlayerState> = {};

// 1. LOAD SPAWN ON STARTUP (Sync to ensure it's ready before anyone connects)
try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.x === 'number') {
            globalSpawnPoint = parsed;
            console.log('✅ Spawn Point Loaded from Disk:', globalSpawnPoint);
        }
    } else {
        console.log('⚠️ No spawn file found, using default (0,5,0)');
        // Create default file
        fs.writeFileSync(DATA_FILE, JSON.stringify(globalSpawnPoint));
    }
} catch (e) {
    console.error('❌ Error loading spawn config:', e);
}

// HELPER: Save Spawn
const saveSpawn = (pos: Vector3) => {
    globalSpawnPoint = pos;
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(pos, null, 2));
        console.log('💾 Spawn Point Saved:', pos);
    } catch (e) {
        console.error('Error saving spawn:', e);
    }
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 2. CREATE PLAYER AT SPAWN POINT IMMEDIATELY
  const spawnOffset = {
      x: (Math.random() - 0.5) * 2, // Random spread +/- 1m
      z: (Math.random() - 0.5) * 2
  };

  players[socket.id] = {
    id: socket.id,
    position: { 
        x: globalSpawnPoint.x + spawnOffset.x, 
        y: globalSpawnPoint.y, 
        z: globalSpawnPoint.z + spawnOffset.z 
    },
    rotation: 0,
    animation: 'idle',
    color: '#ffffff'
  };

  // 3. SEND STATE TO CLIENT
  // Send the player their OWN ID so they know who they are immediately
  socket.emit('connectionData', { 
      id: socket.id,
      spawnPoint: globalSpawnPoint,
      players: players
  });

  // Notify others
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // MOVEMENT
  socket.on('move', (position, rotation, animation) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      players[socket.id].rotation = rotation;
      players[socket.id].animation = animation;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // EDITOR: UPDATE SPAWN
  socket.on('updateSpawnPoint', (pos: Vector3) => {
      console.log(`Editor (User ${socket.id}) updated spawn to:`, pos);
      saveSpawn(pos);
      io.emit('spawnPointUpdated', pos); // Notify everyone (e.g. other editors)
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// STATIC FILES
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