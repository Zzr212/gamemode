import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, TransformControls, Html } from '@react-three/drei';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';
import { Vector3 } from '../types';
import * as THREE from 'three';

interface MapEditorProps {
  onBack: () => void;
}

const EditorScene: React.FC<{ 
    setTempPos: (pos: Vector3) => void, 
    savedPos: Vector3 
}> = ({ setTempPos, savedPos }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Initialize with savedPos
  const [localPos, setLocalPos] = useState(savedPos);

  const handleTransformChange = () => {
    if (meshRef.current) {
        const { x, y, z } = meshRef.current.position;
        const newPos = { x, y, z };
        setLocalPos(newPos);
        setTempPos(newPos); // Notify parent of unsaved change
    }
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <Environment preset="city" />

      <MapModel />

      <OrbitControls makeDefault />

      <TransformControls 
          mode="translate" 
          onObjectChange={handleTransformChange}
      >
          <mesh ref={meshRef} position={[savedPos.x, savedPos.y, savedPos.z]}>
              {/* Hologram Base */}
              <boxGeometry args={[1, 0.2, 1]} />
              <meshBasicMaterial color="#00ff00" wireframe opacity={0.5} transparent depthTest={false} />
              
              {/* Hologram Floating Marker */}
              <mesh position={[0, 1, 0]} rotation={[Math.PI, 0, 0]}>
                  <coneGeometry args={[0.5, 1, 4]} />
                  <meshBasicMaterial color="#00ff00" wireframe opacity={0.8} transparent depthTest={false} />
              </mesh>
              
              {/* Text Label */}
              <Html position={[0, 2, 0]} center>
                  <div className="bg-black/70 text-green-400 px-2 py-1 rounded text-xs font-mono whitespace-nowrap select-none border border-green-500">
                      SPAWN POINT
                  </div>
              </Html>
          </mesh>
      </TransformControls>
    </>
  );
};

export const MapEditor: React.FC<MapEditorProps> = ({ onBack }) => {
  const [serverSpawnPos, setServerSpawnPos] = useState<Vector3>({ x: 0, y: 5, z: 0 });
  const [currentEditPos, setCurrentEditPos] = useState<Vector3 | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    const onUpdate = (pos: Vector3) => {
        setServerSpawnPos(pos);
        // If we haven't started editing, update current view too
        if (!hasUnsavedChanges) {
           // We don't force update currentEditPos here to avoid jitter if user is dragging
        }
    };
    
    socket.on('spawnPointUpdated', onUpdate);
    socket.emit('requestSpawnPoint');

    return () => {
        socket.off('spawnPointUpdated', onUpdate);
    };
  }, [hasUnsavedChanges]);

  const handlePosChange = (pos: Vector3) => {
      setCurrentEditPos(pos);
      setHasUnsavedChanges(true);
      setSaveStatus('');
  };

  const handleSave = () => {
      if (currentEditPos) {
          socket.emit('updateSpawnPoint', currentEditPos);
          setServerSpawnPos(currentEditPos);
          setHasUnsavedChanges(false);
          setSaveStatus('Saved!');
          setTimeout(() => setSaveStatus(''), 2000);
      }
  };

  return (
    <div className="w-full h-full relative">
       <Canvas shadows camera={{ position: [0, 10, 20], fov: 50 }}>
          <Suspense fallback={<Html center>Loading Editor...</Html>}>
             <EditorScene 
                savedPos={serverSpawnPos} 
                setTempPos={handlePosChange}
             />
          </Suspense>
       </Canvas>
       
       <div className="absolute top-4 left-4 z-10">
          <button 
            onClick={onBack}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded shadow-md font-bold border border-gray-400"
          >
            BACK TO MENU
          </button>
       </div>
       
       {/* SAVE BUTTON & STATUS */}
       <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 flex flex-col items-center gap-2">
            {saveStatus && (
                <div className="bg-green-500 text-white px-4 py-1 rounded-full shadow-lg font-bold animate-bounce">
                    {saveStatus}
                </div>
            )}
            
            <button 
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
                className={`
                    px-8 py-3 rounded-full font-bold text-xl shadow-lg transition-all
                    ${hasUnsavedChanges 
                        ? 'bg-yellow-500 hover:bg-yellow-400 text-black scale-110' 
                        : 'bg-gray-700 text-gray-400 cursor-not-allowed'}
                `}
            >
                {hasUnsavedChanges ? 'SAVE SPAWN POINT' : 'POSITION SAVED'}
            </button>
       </div>

       <div className="absolute top-4 right-4 bg-black/60 text-white p-4 rounded max-w-xs text-sm pointer-events-none z-10">
          <p className="font-bold mb-2">Editor Controls:</p>
          <ul className="list-disc pl-4 space-y-1">
             <li>Drag arrows to move spawn.</li>
             <li><strong>Click SAVE</strong> to confirm!</li>
          </ul>
       </div>
    </div>
  );
};