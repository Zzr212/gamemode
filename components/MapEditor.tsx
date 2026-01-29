import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, TransformControls, Html, useGLTF } from '@react-three/drei';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';
import { Vector3 } from '../types';
import * as THREE from 'three';

interface MapEditorProps {
  onBack: () => void;
}

const EditorScene: React.FC = () => {
  const [spawnPos, setSpawnPos] = useState<Vector3>({ x: 0, y: 5, z: 0 });
  const transformRef = useRef<any>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    // Request current spawn point on load
    socket.emit('requestSpawnPoint');

    const onUpdate = (pos: Vector3) => {
        setSpawnPos(pos);
    };

    socket.on('spawnPointUpdated', onUpdate);
    return () => {
        socket.off('spawnPointUpdated', onUpdate);
    };
  }, []);

  const handleTransformEnd = () => {
    if (meshRef.current) {
        const { x, y, z } = meshRef.current.position;
        const newPos = { x, y, z };
        setSpawnPos(newPos);
        socket.emit('updateSpawnPoint', newPos);
    }
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <Environment preset="city" />

      <MapModel />

      {/* Camera Controls - Free Roam */}
      <OrbitControls makeDefault />

      {/* Spawn Point Editor */}
      <TransformControls 
        ref={transformRef} 
        object={meshRef} 
        mode="translate" 
        onMouseUp={handleTransformEnd}
      >
          <mesh ref={meshRef} position={[spawnPos.x, spawnPos.y, spawnPos.z]}>
            {/* Hologram Base */}
            <boxGeometry args={[1, 0.2, 1]} />
            <meshBasicMaterial color="#00ff00" wireframe opacity={0.5} transparent />
            
            {/* Hologram Floating Marker */}
            <mesh position={[0, 1, 0]} rotation={[Math.PI, 0, 0]}>
                <coneGeometry args={[0.5, 1, 4]} />
                <meshBasicMaterial color="#00ff00" wireframe opacity={0.8} transparent />
            </mesh>
            
            {/* Text Label */}
            <Html position={[0, 2, 0]} center>
                <div className="bg-black/70 text-green-400 px-2 py-1 rounded text-xs font-mono whitespace-nowrap">
                    SPAWN POINT
                </div>
            </Html>
          </mesh>
      </TransformControls>
    </>
  );
};

export const MapEditor: React.FC<MapEditorProps> = ({ onBack }) => {
  return (
    <div className="w-full h-full relative">
       <Canvas shadows camera={{ position: [0, 10, 20], fov: 50 }}>
          <Suspense fallback={<Html center>Loading Editor...</Html>}>
             <EditorScene />
          </Suspense>
       </Canvas>
       
       <div className="absolute top-4 left-4">
          <button 
            onClick={onBack}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow-md font-bold"
          >
            BACK TO MENU
          </button>
       </div>
       
       <div className="absolute top-4 right-4 bg-black/60 text-white p-4 rounded max-w-xs text-sm pointer-events-none">
          <p className="font-bold mb-2">Editor Controls:</p>
          <ul className="list-disc pl-4 space-y-1">
             <li>Use <strong>One Finger</strong> to rotate camera.</li>
             <li>Use <strong>Two Fingers</strong> to pan/zoom.</li>
             <li>Drag the <strong>Arrows</strong> on the green hologram to move the spawn point.</li>
             <li>Changes save automatically.</li>
          </ul>
       </div>
    </div>
  );
};