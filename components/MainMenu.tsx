import React, { Suspense } from 'react';
import { Canvas, ThreeElements } from '@react-three/fiber';
import { Environment, Float, ContactShadows, SpotLight } from '@react-three/drei';
import { PlayerModel } from './PlayerModel';

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
    }
  }
}

interface MainMenuProps {
  onPlay: () => void;
}

const MenuScene: React.FC = () => {
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

      {/* Podium/Visual Circle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[2, 64]} />
        <meshStandardMaterial color="#222" roughness={0.4} metalness={0.8} />
      </mesh>
      
      {/* Decorative Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <ringGeometry args={[1.9, 2, 64]} />
        <meshBasicMaterial color="#4f46e5" />
      </mesh>

      {/* Floating Character */}
      <Float speed={2} rotationIntensity={0.1} floatIntensity={0.1}>
         <PlayerModel 
            position={{x:0, y:0, z:0}} 
            rotation={0} 
            animation="idle" 
         />
      </Float>

      <ContactShadows resolution={1024} scale={10} blur={2} opacity={0.5} far={10} color="#000000" />
      
      <Environment preset="night" />
    </>
  );
};

export const MainMenu: React.FC<MainMenuProps> = ({ onPlay }) => {
  return (
    <div className="w-full h-full relative bg-gray-900">
      {/* Moved camera back (z: 8) and up slightly so model fits on mobile screens */}
      <Canvas shadows camera={{ position: [0, 1.5, 9], fov: 35 }}>
        <Suspense fallback={null}>
          <MenuScene />
        </Suspense>
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-24 pointer-events-none">
        
        <div className="flex-grow flex items-center justify-center pt-10">
            <h1 className="text-4xl md:text-6xl font-bold text-white tracking-widest uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.5)] opacity-80">
                MULTIPLAYER 3D
            </h1>
        </div>

        <div className="pointer-events-auto">
            <button 
                onClick={onPlay}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-2xl font-bold py-4 px-20 rounded-full shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-all transform hover:scale-105 active:scale-95 border border-indigo-400"
            >
                PLAY GAME
            </button>
        </div>
      </div>
    </div>
  );
};