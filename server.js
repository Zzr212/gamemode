import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

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
const MAX_PLAYERS = 20;

// State
const players = {};
// Queue State
const loginQueue = [];

// Real Queue Processor
const manageQueue = () => {
    const currentCount = Object.keys(players).length;
    
    if (currentCount < MAX_PLAYERS && loginQueue.length > 0) {
        const slotsAvailable = MAX_PLAYERS - currentCount;
        
        for (let i = 0; i < slotsAvailable; i++) {
            if (loginQueue.length === 0) break;
            
            const socketId = loginQueue.shift();
            if (socketId) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.emit('loginAllowed');
                }
            }
        }
        
        loginQueue.forEach((sid, index) => {
            const s = io.sockets.sockets.get(sid);
            if (s) s.emit('queueUpdate', index + 1);
        });
    }
};

// Socket Logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Add to Queue
  loginQueue.push(socket.id);
  socket.emit('queueUpdate', loginQueue.length);
  
  // 2. Try enter
  manageQueue();

  // 3. Spawn
  socket.on('spawn', () => {
      const randomX = (Math.random() - 0.5) * 40; 
      const randomZ = (Math.random() - 0.5) * 40;

      players[socket.id] = {
        id: socket.id,
        position: { x: randomX, y: 5, z: randomZ },
        rotation: 0,
        animation: 'Idle',
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
      };

      socket.emit('currentPlayers', players);
      socket.broadcast.emit('newPlayer', players[socket.id]);
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
    callback();
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    const qIndex = loginQueue.indexOf(socket.id);
    if (qIndex !== -1) {
        loginQueue.splice(qIndex, 1);
    }

    if (players[socket.id]) {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    }
    
    // Slot opened
    manageQueue();
  });
});

// Serve Static Files (Production)
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Handle client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});