import { io, Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents, UserProfile } from '../types';
import { v4 as uuidv4 } from 'uuid';

// Detect if we are in production or dev
const URL = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000';

// --- DEVICE ID LOGIC ---
const getDeviceId = () => {
  let id = localStorage.getItem('player_device_id');
  if (!id) {
    id = uuidv4();
    localStorage.setItem('player_device_id', id);
  }
  return id;
};

const deviceId = getDeviceId();

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  autoConnect: false,
  transports: ['websocket', 'polling']
});

export const connectSocket = (user: UserProfile) => {
  if (socket.connected) {
      socket.disconnect();
  }
  
  // Update auth payload before connecting
  socket.auth = {
      deviceId: deviceId,
      userId: user.id,
      username: user.username
  };
  
  socket.connect();
};

export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};