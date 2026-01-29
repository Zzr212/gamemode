import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState } from '../types.js';

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

// State
const players: Record<string, PlayerState> = {};

// Socket Logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create new player at spawn (0, 0, 0)
  players[socket.id] = {
    id: socket.id,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  // Send current players to new joiner
  socket.emit('currentPlayers', players);

  // Broadcast new player to others
  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('move', (position, rotation) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      players[socket.id].rotation = rotation;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Serve Static Files (Production)
// In Dev (ts-node): __dirname is .../server. dist is ../dist
// In Prod (node): __dirname is .../dist-server/server. dist is ../../dist
const distPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../dist' : '../dist');
const rootPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../' : '../');

app.use('/', express.static(distPath));

// EMERGENCY FIX: Serve .glb models from root if not found in dist
// This handles cases where user uploads assets to root instead of public/ folder
app.get('/*.glb', (req, res) => {
    const filePath = path.join(rootPath, req.path);
    res.sendFile(filePath);
});

// Handle client-side routing by returning index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});