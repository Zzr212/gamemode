import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, ThreeElements } from '@react-three/fiber';
import { Environment, Float, ContactShadows, SpotLight } from '@react-three/drei';
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
        planeGeometry: any;
    }
  }
}

interface MainMenuProps {
  onPlay: () => void;
  queuePosition: number | null;
  isInQueue: boolean;
}

// Snow Particle System
const Snow: React.FC = () => {
    const count = 400;
    const mesh = useRef<THREE.InstancedMesh>(null);
    
    const particles = useMemo(() => {
        const temp = [];
        for(let i=0; i<count; i++) {
            const t = {
                x: (Math.random() - 0.5) * 25,
                y: Math.random() * 20,
                z: (Math.random() - 0.5) * 15 - 5, // Keep slightly behind/around
                speed: Math.random() * 0.05 + 0.02,
                factor: Math.random() * 0.1 + 0.9
            };
            temp.push(t);
        }
        return temp;
    }, []);

    const dummy = new THREE.Object3D();

    useFrame((state) => {
        if(!mesh.current) return;
        
        particles.forEach((particle, i) => {
            particle.y -= particle.speed;
            
            // Wind effect
            particle.x += Math.sin(state.clock.elapsedTime * 0.5 + i) * 0.005;

            // Reset if hits floor
            if (particle.y < -1) {
                particle.y = 20;
                particle.x = (Math.random() - 0.5) * 25;
            }

            dummy.position.set(particle.x, particle.y, particle.z);
            dummy.scale.setScalar(0.05);
            dummy.updateMatrix();
            mesh.current!.setMatrixAt(i, dummy.matrix);
        });
        mesh.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color="#ffffff" />
        </instancedMesh>
    );
};

// Floor that gets white over time
const AccumulatingSnowFloor: React.FC = () => {
    const matRef = useRef<THREE.MeshStandardMaterial>(null);

    useFrame((state) => {
        if(matRef.current) {
            // Slowly increase opacity to simulate accumulation, max out at 0.8
            // Start accumulating after 1 second
            const opacity = Math.min(0.8, Math.max(0, (state.clock.elapsedTime - 1) * 0.05));
            matRef.current.opacity = opacity;
        }
    });

    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <planeGeometry args={[50, 50]} />
            <meshStandardMaterial 
                ref={matRef}
                color="#ffffff" 
                transparent 
                opacity={0} 
                roughness={1}
            />
        </mesh>
    );
};

const MenuScene: React.FC = () => {
  return (
    <>
      <ambientLight intensity={0.4} />
      <SpotLight 
        position={[-3, 10, 5]} 
        angle={0.5} 
        penumbra={0.5} 
        intensity={2} 
        castShadow 
        color="#a5f3fc" // Icy blue tint
      />
      <pointLight position={[5, -5, -5]} intensity={0.5} color="#4f46e5" />

      <Snow />
      <AccumulatingSnowFloor />

      {/* Podium moved to left */}
      <group position={[-2.5, -1, 0]}>
        {/* Visual Circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
            <circleGeometry args={[1.5, 64]} />
            <meshStandardMaterial color="#1f2937" roughness={0.4} metalness={0.8} />
        </mesh>
        
        {/* Decorative Ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
            <ringGeometry args={[1.4, 1.5, 64]} />
            <meshBasicMaterial color="#38bdf8" />
        </mesh>

        {/* Floating Character - Rotated slightly to look at menu */}
        <Float speed={2} rotationIntensity={0.1} floatIntensity={0.1}>
            <PlayerModel 
                position={{x:0, y:0, z:0}} 
                rotation={0.4} 
                animation="idle" 
            />
        </Float>

        <ContactShadows resolution={1024} scale={10} blur={2} opacity={0.5} far={10} color="#000000" />
      </group>
      
      <Environment preset="night" />
    </>
  );
};

export const MainMenu: React.FC<MainMenuProps> = ({ onPlay, queuePosition, isInQueue }) => {
  return (
    <div className="w-full h-full relative bg-gray-900 overflow-hidden">
      {/* 3D Scene */}
      <Canvas shadows camera={{ position: [0, 1, 8], fov: 40 }}>
        <Suspense fallback={null}>
          <MenuScene />
        </Suspense>
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute inset-0 flex flex-row items-center justify-between p-8 md:p-16 pointer-events-none">
        
        {/* Left Side: Space for character */}
        <div className="w-1/2 h-full"></div>

        {/* Right Side: News & Actions */}
        <div className="w-1/2 h-full flex flex-col justify-center items-end gap-6 pointer-events-auto">
            
            {/* News Card */}
            <div className="w-full max-w-md bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-2xl animate-fade-in-up">
                <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                    <h2 className="text-white font-bold text-xl tracking-wider">LATEST NEWS</h2>
                    <span className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">V 1.2</span>
                </div>
                <div className="space-y-4">
                    <div className="group cursor-pointer">
                        <h3 className="text-blue-300 font-semibold group-hover:text-blue-200 transition-colors">Winter Update is Live!</h3>
                        <p className="text-gray-400 text-sm mt-1">Experience the new snowy map and improved weapon mechanics.</p>
                    </div>
                    <div className="group cursor-pointer">
                        <h3 className="text-blue-300 font-semibold group-hover:text-blue-200 transition-colors">Server Maintenance</h3>
                        <p className="text-gray-400 text-sm mt-1">Scheduled maintenance every Tuesday at 4 AM UTC.</p>
                    </div>
                </div>
                <div className="mt-4 pt-2 border-t border-white/10 text-right">
                    <button className="text-xs text-gray-500 hover:text-white transition-colors">READ MORE &rarr;</button>
                </div>
            </div>

            {/* Play Button Area */}
            <div className="flex flex-col items-end w-full max-w-md">
                <button 
                    onClick={!isInQueue ? onPlay : undefined}
                    disabled={isInQueue}
                    className={`
                        relative overflow-hidden group
                        bg-gradient-to-r from-blue-600 to-indigo-600 
                        hover:from-blue-500 hover:to-indigo-500 
                        text-white font-bold py-3 px-12 rounded-lg 
                        shadow-[0_0_20px_rgba(79,70,229,0.4)] 
                        transition-all transform hover:scale-105 active:scale-95 
                        border border-blue-400/30
                        disabled:opacity-70 disabled:cursor-not-allowed disabled:scale-100
                    `}
                >
                    <span className="relative z-10 flex items-center gap-2">
                        {isInQueue ? (
                            <>
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                {queuePosition ? `POSITION: ${queuePosition}` : 'JOINING QUEUE...'}
                            </>
                        ) : (
                            <>
                                PLAY GAME
                                <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                            </>
                        )}
                    </span>
                </button>
            </div>

        </div>
      </div>
    </div>
  );
};