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
    origin: "*", // Allow Vite dev server
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// --- CONFIGURATION & PERSISTENCE ---
const DATA_FILE = path.join(__dirname, 'spawn_config.json');

// Default spawn point
let globalSpawnPoint: Vector3 = { x: 0, y: 5, z: 0 };

// 1. Load Spawn Point from Disk on Startup
try {
    if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
        globalSpawnPoint = JSON.parse(rawData);
        console.log('Loaded spawn point from disk:', globalSpawnPoint);
    } else {
        console.log('No spawn config found, using default:', globalSpawnPoint);
    }
} catch (error) {
    console.error('Error loading spawn config:', error);
}

// Helper to save to disk
const saveSpawnPointToDisk = (pos: Vector3) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(pos, null, 2));
        console.log('Spawn point saved to disk.');
    } catch (error) {
        console.error('Error saving spawn config:', error);
    }
};

// State
const players: Record<string, PlayerState> = {};

// Socket Logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Initial Data Handshake
  // Send the current spawn point immediately (loaded from file or memory)
  socket.emit('spawnPointUpdated', globalSpawnPoint);
  
  // Send current players to new joiner
  socket.emit('currentPlayers', players);

  // 2. Spawn Logic
  const spawnOffset = {
      x: (Math.random() - 0.5) * 2,
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
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  // Broadcast new player to others
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('move', (position, rotation, animation) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      players[socket.id].rotation = rotation;
      players[socket.id].animation = animation;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // EDITOR: Update global spawn point
  socket.on('updateSpawnPoint', (pos: Vector3) => {
      globalSpawnPoint = pos;
      
      // Save to disk immediately
      saveSpawnPointToDisk(globalSpawnPoint);

      // Broadcast to all editors/clients so they update in real-time
      io.emit('spawnPointUpdated', globalSpawnPoint);
      console.log('New Spawn Point Set & Saved:', globalSpawnPoint);
  });
  
  // Explicit request from client (Editor)
  socket.on('requestSpawnPoint', () => {
      socket.emit('spawnPointUpdated', globalSpawnPoint);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Serve Static Files
const distPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../dist' : '../dist');
app.use('/', express.static(distPath));

const rootPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../' : '../');
app.use('/', express.static(path.join(rootPath, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});