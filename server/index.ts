import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
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

// --- CONFIGURATION ---
// Default spawn point (editable via Map Editor)
// Stores in memory (will reset on server restart)
let globalSpawnPoint: Vector3 = { x: 0, y: 5, z: 0 };

// State
const players: Record<string, PlayerState> = {};

// Socket Logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Initial Data Handshake
  // Send the current spawn point immediately so Editor/Game knows where to start
  socket.emit('spawnPointUpdated', globalSpawnPoint);
  
  // Send current players to new joiner
  socket.emit('currentPlayers', players);

  // 2. Spawn Logic
  // Use the global spawn point with a tiny random offset
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
      // Broadcast to all editors/clients so they update in real-time
      io.emit('spawnPointUpdated', globalSpawnPoint);
      console.log('New Spawn Point Set:', globalSpawnPoint);
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