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

// Game State
const players: Record<string, PlayerState> = {};
// Queue State
const loginQueue: string[] = [];
let isProcessingQueue = false;

// Queue Processor loop
const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    // Process one player every 1.5 seconds to prevent spawn overlapping/lag
    const interval = setInterval(() => {
        if (loginQueue.length > 0) {
            const socketId = loginQueue.shift(); // Get first in line
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('loginAllowed');
                }
            }
            // Update positions for everyone else remaining in queue
            loginQueue.forEach((sid, index) => {
                const s = io.sockets.sockets.get(sid);
                if (s) s.emit('queueUpdate', index + 1);
            });
        } else {
            // Queue empty, stop processing
            clearInterval(interval);
            isProcessingQueue = false;
        }
    }, 1500);
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Add user to Queue immediately upon connection
  loginQueue.push(socket.id);
  socket.emit('queueUpdate', loginQueue.length);
  
  // Trigger queue processor if it's not running
  if (!isProcessingQueue) {
      processQueue();
  }

  // 2. Wait for user to request Spawn (after they pass the queue)
  socket.on('spawn', () => {
      // Logic for spawning the player
      const randomX = (Math.random() - 0.5) * 40; 
      const randomZ = (Math.random() - 0.5) * 40;

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

      // Send existing players to the new guy
      socket.emit('currentPlayers', players);
      // Notify others
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
    
    // Remove from queue if they leave while waiting
    const qIndex = loginQueue.indexOf(socket.id);
    if (qIndex !== -1) {
        loginQueue.splice(qIndex, 1);
    }

    // Remove from game
    if (players[socket.id]) {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
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