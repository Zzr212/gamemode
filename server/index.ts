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
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'spawn_config.json');
let globalSpawnPoint: Vector3 = { x: 0, y: 5, z: 0 };

// LOAD SPAWN
const loadSpawn = () => {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
            globalSpawnPoint = JSON.parse(rawData);
            console.log('✅ Spawn loaded:', globalSpawnPoint);
        }
    } catch (e) {
        console.error('Spawn load error:', e);
    }
};

loadSpawn();

// SAVE SPAWN
const saveSpawnPointToDisk = (pos: Vector3) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(pos, null, 2));
        console.log('💾 Spawn saved:', pos);
    } catch (error) {
        console.error('Error saving spawn:', error);
    }
};

const players: Record<string, PlayerState> = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // IMPORTANT: Reload from disk/memory to ensure fresh data for new connection
  socket.emit('spawnPointUpdated', globalSpawnPoint);
  socket.emit('currentPlayers', players);

  const spawnOffset = {
      x: (Math.random() - 0.5) * 2,
      z: (Math.random() - 0.5) * 2
  };

  players[socket.id] = {
    id: socket.id,
    // Use the CURRENT globalSpawnPoint
    position: { 
        x: globalSpawnPoint.x + spawnOffset.x, 
        y: globalSpawnPoint.y, 
        z: globalSpawnPoint.z + spawnOffset.z 
    },
    rotation: 0,
    animation: 'idle',
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  socket.broadcast.emit('newPlayer', players[socket.id]);

  socket.on('move', (position, rotation, animation) => {
    if (players[socket.id]) {
      players[socket.id].position = position;
      players[socket.id].rotation = rotation;
      players[socket.id].animation = animation;
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  socket.on('updateSpawnPoint', (pos: Vector3) => {
      globalSpawnPoint = pos;
      saveSpawnPointToDisk(globalSpawnPoint);
      io.emit('spawnPointUpdated', globalSpawnPoint);
  });
  
  socket.on('requestSpawnPoint', () => {
      socket.emit('spawnPointUpdated', globalSpawnPoint);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

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