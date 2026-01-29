import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Float, ContactShadows, SpotLight } from '@react-three/drei';
import { PlayerModel } from './PlayerModel';

interface MainMenuProps {
  onPlay: () => void;
  onEditor: () => void;
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
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
         <PlayerModel 
            position={{x:0, y:0, z:0}} 
            rotation={0} 
            animation="idle"
            isSelf={true} // Green/Self highlight
            color="#ffffff"
         />
      </Float>

      <ContactShadows resolution={1024} scale={10} blur={2} opacity={0.5} far={10} color="#000000" />
      
      <Environment preset="night" />
    </>
  );
};

export const MainMenu: React.FC<MainMenuProps> = ({ onPlay, onEditor }) => {
  return (
    <div className="w-full h-full relative bg-gray-900">
      <Canvas shadows camera={{ position: [0, 2, 6], fov: 40 }}>
        <Suspense fallback={null}>
          <MenuScene />
        </Suspense>
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-24 pointer-events-none">
        <h1 className="text-4xl md:text-6xl font-bold text-white mb-8 tracking-widest uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
            Game Title
        </h1>

        <div className="flex items-center gap-4 pointer-events-auto">
            {/* Play Button */}
            <button 
                onClick={onPlay}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xl font-bold py-4 px-12 rounded-full shadow-lg shadow-indigo-500/50 transition-all transform hover:scale-105 active:scale-95 border border-indigo-400"
            >
                PLAY
            </button>

            {/* Editor/Settings Button */}
            <button 
                onClick={onEditor}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 p-4 rounded-full shadow-lg border border-gray-600 transition-all transform hover:scale-105 active:scale-95"
                title="Map Editor / Spawn Settings"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l-.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.732.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
        </div>
      </div>
    </div>
  );
};