import { io, Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents } from '../types';
import { v4 as uuidv4 } from 'uuid';

// Detect if we are in production or dev
const URL = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000';

// --- DEVICE ID LOGIC ---
// Generate a unique ID for this browser/device if it doesn't exist
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
  transports: ['websocket', 'polling'],
  auth: {
    token: deviceId // Send persistent ID to server
  }
});

export const connectSocket = () => {
  if (!socket.connected) {
    socket.connect();
  }
};

export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};