import { io } from 'socket.io-client';
import { API_URL } from './apiConfig';

const socket = io(API_URL, {
  autoConnect: false,
});

if (__DEV__) {
  socket.on('connect', () => console.log('[Socket] Connected'));
  socket.on('connect_error', (err) => console.log('[Socket] Connection Error:', err.message));
}

export default socket;
