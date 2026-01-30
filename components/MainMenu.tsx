import React, { Suspense, useRef, useState } from 'react';
import { Canvas, ThreeElements, useFrame, ThreeEvent } from '@react-three/fiber';
import { Environment, ContactShadows, SpotLight, Text } from '@react-three/drei';
import { PlayerModel } from './PlayerModel';
import * as THREE from 'three';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {
        ambientLight: any;
        pointLight: any;
        mesh: any;
        circleGeometry: any;
        meshStandardMaterial: any;
        ringGeometry: any;
        meshBasicMaterial: any;
        group: any;
    }
  }
}

interface MainMenuProps {
  onStartQueue: () => void;
  queuePosition: number | null;
  isReady: boolean;
}

// --- 3D PLAY BUTTON HOLOGRAM ---
const PlayHologram: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    const groupRef = useRef<THREE.Group>(null);
    const [hovered, setHovered] = useState(false);

    useFrame((state) => {
        if (groupRef.current) {
            // Gentle floating and rotation
            groupRef.current.rotation.y += 0.02;
            groupRef.current.position.y = 1.8 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
            
            // Pulse scale on hover
            const targetScale = hovered ? 1.2 : 1;
            groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
        }
    });

    return (
        <group 
            ref={groupRef} 
            position={[-1.2, 1.8, 0]} // Left of the head
            onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onClick(); }}
            onPointerOver={() => { document.body.style.cursor = 'pointer'; setHovered(true); }}
            onPointerOut={() => { document.body.style.cursor = 'auto'; setHovered(false); }}
        >
            {/* Holographic Ring */}
            <mesh rotation={[0, 0, 0]}>
                <ringGeometry args={[0.3, 0.35, 32]} />
                <meshBasicMaterial color="#00ffff" side={THREE.DoubleSide} transparent opacity={0.8} />
            </mesh>
            
            {/* Play Triangle Symbol */}
            <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.05, 0, 0]}>
                <circleGeometry args={[0.2, 3]} />
                <meshBasicMaterial color="#00ffff" transparent opacity={0.6} />
            </mesh>

            {/* Glow Effect */}
            <pointLight distance={1} intensity={2} color="#00ffff" />
        </group>
    );
};

// --- 3D QUEUE STATUS HOLOGRAM ---
const QueueHologram: React.FC<{ positionNum: number | null; isReady: boolean }> = ({ positionNum, isReady }) => {
    const groupRef = useRef<THREE.Group>(null);

    useFrame((state) => {
        if (groupRef.current) {
             // Rotate slowly
             groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime) * 0.2;
        }
    });

    let textContent = "CONNECTING...";
    let color = "#ffaa00";

    if (positionNum !== null) {
        textContent = `QUEUE: ${positionNum}`;
        color = "#ffaa00";
    }
    
    if (isReady) {
        textContent = "LOADING..."; // Transition to game
        color = "#00ff00";
    }

    return (
        <group ref={groupRef} position={[0, 0.2, 1]} rotation={[-Math.PI / 6, 0, 0]}>
             {/* Holographic Base */}
             <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.4, 0.5, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide}/>
            </mesh>

             {/* Text Display */}
             <Text
                position={[0, 0.4, 0]}
                fontSize={0.25}
                color={color}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.02}
                outlineColor="#000000"
             >
                {textContent}
             </Text>
             <pointLight distance={1} intensity={1} color={color} position={[0, 0.2, 0]}/>
        </group>
    );
};

const MenuScene: React.FC<{ 
    queueActive: boolean; 
    onPlay: () => void; 
    queuePosition: number | null;
    isReady: boolean;
}> = ({ queueActive, onPlay, queuePosition, isReady }) => {
  return (
    <>
      <ambientLight intensity={0.2} />
      <SpotLight 
        position={[0, 10, 5]} 
        angle={0.3} 
        penumbra={0.5} 
        intensity={2} 
        castShadow 
        color="#ffffff"
      />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="blue" />

      {/* Podium */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[2, 64]} />
        <meshStandardMaterial color="#222" roughness={0.4} metalness={0.8} />
      </mesh>
      
      {/* Decorative Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[1.9, 2, 64]} />
        <meshBasicMaterial color="#4f46e5" />
      </mesh>

      {/* Character */}
      <group position={[0, 0, 0]}>
         <PlayerModel 
            position={{x:0, y:0, z:0}} 
            rotation={0} 
            animation="Idle" 
         />
      </group>

      {/* --- CONDITIONAL UI ELEMENTS --- */}
      
      {/* 1. Play Button (Show only if NOT queueing) */}
      {!queueActive && (
          <PlayHologram onClick={onPlay} />
      )}

      {/* 2. Queue Info (Show only if queueing) */}
      {queueActive && (
          <QueueHologram positionNum={queuePosition} isReady={isReady} />
      )}

      <ContactShadows resolution={1024} scale={10} blur={2} opacity={0.5} far={10} color="#000000" />
      <Environment preset="night" />
    </>
  );
};

export const MainMenu: React.FC<MainMenuProps> = ({ onStartQueue, queuePosition, isReady }) => {
  // Local state to track if we clicked play to switch visualization
  // The actual connection logic is driven by App.tsx, but we need to know locally to hide the button
  const [hasClickedPlay, setHasClickedPlay] = useState(false);

  const handlePlay = () => {
    setHasClickedPlay(true);
    onStartQueue();
  };

  return (
    <div className="w-full h-full relative bg-gray-900">
      <Canvas shadows camera={{ position: [0, 1.5, 6], fov: 40 }}>
        <Suspense fallback={null}>
          <MenuScene 
            queueActive={hasClickedPlay} 
            onPlay={handlePlay} 
            queuePosition={queuePosition}
            isReady={isReady}
          />
        </Suspense>
      </Canvas>
      {/* No HTML UI Overlays anymore - purely 3D interaction */}
    </div>
  );
};