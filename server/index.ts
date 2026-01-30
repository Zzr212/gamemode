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
const waitingQueue: string[] = [];
let isProcessingQueue = false;

// Queue Processor
const processQueue = async () => {
    if (isProcessingQueue || waitingQueue.length === 0) return;

    isProcessingQueue = true;

    // Get first in line
    const socketId = waitingQueue.shift();

    if (socketId) {
        // Notify user they can enter
        io.to(socketId).emit('grantEntry');
        
        // Update positions for everyone else
        waitingQueue.forEach((id, index) => {
            io.to(id).emit('queueUpdate', index + 1);
        });

        // Wait a bit before letting next person in to prevent spawn collisions/race conditions
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    isProcessingQueue = false;
    
    // Keep processing if people are waiting
    if (waitingQueue.length > 0) {
        processQueue();
    }
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Don't spawn immediately. Wait for game entry.

  socket.on('joinQueue', () => {
     if (!waitingQueue.includes(socket.id)) {
         waitingQueue.push(socket.id);
         socket.emit('queueUpdate', waitingQueue.length);
         processQueue();
     }
  });

  socket.on('leaveQueue', () => {
      const idx = waitingQueue.indexOf(socket.id);
      if (idx !== -1) {
          waitingQueue.splice(idx, 1);
          // Update others
          waitingQueue.forEach((id, index) => {
            io.to(id).emit('queueUpdate', index + 1);
          });
      }
  });

  // Client specifically requests game data now (after grantEntry)
  socket.on('requestGameStart', () => {
      // Send existing players
      socket.emit('currentPlayers', players);

      // Random Spawning Logic
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
    
    // Remove from queue if present
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) {
        waitingQueue.splice(idx, 1);
    }

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