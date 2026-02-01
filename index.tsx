import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

ReactDOM.createRoot(rootElement).render(
  // StrictMode removed to prevent double-connect in dev for sockets (optional choice, but cleaner logs)
  <App />
);