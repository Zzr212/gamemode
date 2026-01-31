import ReactDOM from 'react-dom/client';
import App from './App';

// Fix for React Three Fiber JSX elements not being recognized by TypeScript
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      primitive: any;
      instancedMesh: any;
      ambientLight: any;
      pointLight: any;
      directionalLight: any;
      fog: any;
      color: any;
      meshBasicMaterial: any;
      meshStandardMaterial: any;
      circleGeometry: any;
      sphereGeometry: any;
      ringGeometry: any;
    }
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

ReactDOM.createRoot(rootElement).render(
  // StrictMode removed to prevent double-connect in dev for sockets (optional choice, but cleaner logs)
  <App />
);