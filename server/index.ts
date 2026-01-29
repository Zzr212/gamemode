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

// --- CONFIGURATION ---
// Add safe spawn coordinates (x, y, z) here based on your map layout
const SPAWN_POINTS = [
    { x: 0, y: 5, z: 0 },    // Center (high up to drop down safely)
    { x: 5, y: 5, z: 5 },
    { x: -5, y: 5, z: -5 },
    { x: 10, y: 5, z: 0 },
    { x: 0, y: 5, z: 10 }
];

function getRandomSpawn() {
    const randomIndex = Math.floor(Math.random() * SPAWN_POINTS.length);
    const spawn = SPAWN_POINTS[randomIndex];
    // Return a copy to avoid modifying the const
    return { ...spawn };
}

// State
const players: Record<string, PlayerState> = {};

// Socket Logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Pick a random spawn point
  const spawnPos = getRandomSpawn();

  players[socket.id] = {
    id: socket.id,
    position: spawnPos,
    rotation: 0,
    animation: 'idle',
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  // Send current players to new joiner
  socket.emit('currentPlayers', players);

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

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Serve Static Files
const distPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../dist' : '../dist');
// Fix: Cast express.static to RequestHandler to satisfy TypeScript overload matching
app.use('/', express.static(distPath) as express.RequestHandler);

const rootPath = path.resolve(__dirname, process.env.NODE_ENV === 'production' ? '../../' : '../');
// Fix: Cast express.static to RequestHandler to satisfy TypeScript overload matching
app.use('/', express.static(path.join(rootPath, 'public')) as express.RequestHandler);

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});