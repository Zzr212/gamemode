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
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

const players: Record<string, PlayerState> = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // We do NOT spawn the player immediately on connection anymore.
  // We wait for the client to click "Play" and emit 'requestGameStart'.

  socket.on('requestGameStart', () => {
      console.log(`Player ${socket.id} joining game...`);

      // Send existing players to the new joiner
      socket.emit('currentPlayers', players);

      // Random Spawning Logic
      const randomX = (Math.random() - 0.5) * 40; 
      const randomZ = (Math.random() - 0.5) * 40;

      // Create new player state
      players[socket.id] = {
        id: socket.id,
        position: { 
            x: randomX, 
            y: 5, 
            z: randomZ 
        },
        rotation: 0,
        animation: 'Idle',
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
      };

      // Broadcast new player to everyone else
      socket.broadcast.emit('newPlayer', players[socket.id]);
  });

  socket.on('move', (position, rotation, animation) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      players[socket.id].rotation = rotation;
      players[socket.id].animation = animation; 
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // Ping listener for latency check
  socket.on('pingSync', (callback) => {
    if (typeof callback === 'function') callback(); 
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
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