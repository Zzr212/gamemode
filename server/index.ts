import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerState } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(app, {
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
// We assume 'dist' is in the project root, so we go up one level from 'server'
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Handle client-side routing by returning index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
