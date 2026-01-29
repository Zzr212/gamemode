import { io, Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents } from '../types';

// Detect if we are in production or dev to point to the correct URL
// In production (Render), the backend serves the frontend, so we connect to window.location
// In dev, Vite runs on 5173, Server on 3000.
const URL = process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
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
