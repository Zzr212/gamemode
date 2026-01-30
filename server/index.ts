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
const MAX_PLAYERS = 20; // Real limit for server capacity

// Game State
const players: Record<string, PlayerState> = {};
// Queue State
const loginQueue: string[] = [];

// Real Queue Processor (Event Driven, No Interval)
const manageQueue = () => {
    // Count current active players
    const currentCount = Object.keys(players).length;
    
    // Check if we have space
    if (currentCount < MAX_PLAYERS && loginQueue.length > 0) {
        // How many slots are open?
        const slotsAvailable = MAX_PLAYERS - currentCount;
        
        // Let that many people in from the front of the queue
        for (let i = 0; i < slotsAvailable; i++) {
            if (loginQueue.length === 0) break;
            
            const socketId = loginQueue.shift(); // Remove from queue
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('loginAllowed');
                }
            }
        }
        
        // Notify everyone remaining in queue of their new position
        loginQueue.forEach((sid, index) => {
            const s = io.sockets.sockets.get(sid);
            if (s) s.emit('queueUpdate', index + 1);
        });
    }
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Add user to Queue immediately
  loginQueue.push(socket.id);
  socket.emit('queueUpdate', loginQueue.length);
  
  // 2. Try to let them in immediately if space exists
  manageQueue();

  // 3. Wait for spawn request (Login successful)
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
      
      // Check queue again (just in case)
      manageQueue();
  });

  socket.on('move', (position, rotation, animation) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      players[socket.id].rotation = rotation;
      players[socket.id].animation = animation; 
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

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

    // A slot opened up! Let someone in!
    manageQueue();
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