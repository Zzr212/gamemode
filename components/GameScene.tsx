import React, { useRef, Suspense, Component, ReactNode } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { Environment, PerspectiveCamera, Stars, Html, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { JoystickData, PlayerState, Vector3 } from '../types';
import { PlayerModel } from './PlayerModel';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

// Error Boundary to prevent black screen on model load failure
class ModelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("3D Model Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Fallback if the specific model component crashes completely
      return (
        <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="purple" />
        </mesh>
      ); 
    }
    return this.props.children;
  }
}

interface GameSceneProps {
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  players: Record<string, PlayerState>;
  myId: string | null;
}

// Loading UI Component
function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center justify-center bg-black/80 p-6 rounded-lg border border-gray-700 backdrop-blur-md">
        <div className="text-white font-bold text-xl mb-2">LOADING WORLD</div>
        <div className="w-48 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
                className="h-full bg-blue-500 transition-all duration-200 ease-out" 
                style={{ width: `${progress}%` }} 
            />
        </div>
        <div className="text-gray-400 text-xs mt-2 font-mono">{progress.toFixed(0)}%</div>
      </div>
    </Html>
  );
}

const CameraController: React.FC<{
  targetGroup: React.RefObject<THREE.Group>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
}> = ({ targetGroup, cameraRotation }) => {
  const { camera } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 5, 10));

  useFrame(() => {
    if (!targetGroup.current) return;

    const targetPosition = targetGroup.current.position;

    const distance = 8;
    const height = 3;
    const sideOffset = 1.5;

    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-0.5, Math.min(1.0, cameraRotation.current.pitch));

    const hDist = distance * Math.cos(pitch);
    const vDist = distance * Math.sin(pitch);

    const offsetX = Math.sin(yaw) * hDist;
    const offsetZ = Math.cos(yaw) * hDist;

    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.5, targetPosition.z);

    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    
    const camPos = new THREE.Vector3(
        targetVec.x + offsetX + (rightX * sideOffset), 
        targetVec.y + height + vDist, 
        targetVec.z + offsetZ + (rightZ * sideOffset)
    );

    currentPos.current.lerp(camPos, 0.1);
    camera.position.copy(currentPos.current);
    camera.lookAt(targetVec);
  });

  return null;
};

const PlayerController: React.FC<{
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  onMove: (pos: Vector3, rot: number, anim: string) => void;
  initialPos: Vector3;
}> = ({ joystickData, cameraRotation, onMove, initialPos }) => {
  // Logic position
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const animationState = useRef('idle');
  const speed = 0.15;

  // Visual Reference (The actual 3D object wrapper)
  const playerGroupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const { x, y } = joystickData.current;
    
    // Determine movement
    const isMoving = Math.abs(x) > 0.05 || Math.abs(y) > 0.05;
    const newAnim = isMoving ? 'walk' : 'idle';

    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      
      // FIXED: Inverted Y axis logic. 
      // Joystick Up is negative Y (-1). We want to move Forward (Negative Z relative to view).
      // Joystick Down is positive Y (1). We want to move Backward (Positive Z relative to view).
      const forward = y; 
      const strafe = x;

      const forwardX = Math.sin(camYaw) * forward;
      const forwardZ = Math.cos(camYaw) * forward;
      
      const rightX = Math.cos(camYaw) * strafe;
      const rightZ = -Math.sin(camYaw) * strafe;

      const moveX = forwardX + rightX;
      const moveZ = forwardZ + rightZ;

      pos.current.x += moveX * speed;
      pos.current.z += moveZ * speed;

      if (moveX !== 0 || moveZ !== 0) {
        rotation.current = Math.atan2(moveX, moveZ);
      }
    }

    // DIRECT UPDATE: Move the mesh group immediately without waiting for React render
    if (playerGroupRef.current) {
        playerGroupRef.current.position.x = pos.current.x;
        playerGroupRef.current.position.y = pos.current.y;
        playerGroupRef.current.position.z = pos.current.z;
        // Rotation is handled by the PlayerModel inside, but we pass it as a prop.
        // For the self-player, we need to pass rotation via prop or direct ref?
        // Since PlayerModel uses `rotation` prop to set rotation of its internal group, 
        // we can rotate this wrapper group instead for the local player.
        // However, PlayerModel expects to handle rotation. 
        // Optimization: Let's rotate the wrapper group here too.
        // But PlayerModel also applies rotation. 
        // To avoid double rotation, we set PlayerModel rotation to 0 inside this wrapper.
    }

    // Emit if position moved OR animation state changed
    // We limit emit rate slightly in real app, but for now every frame check is okay if logic differs
    if (isMoving || animationState.current !== newAnim) {
        animationState.current = newAnim;
        onMove(pos.current, rotation.current, animationState.current);
    }
  });

  return (
    <>
      {/* Wrapper Group that moves imperatively */}
      <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
          {/* 
            PlayerModel is now static relative to this wrapper group (0,0,0).
            We pass the computed rotation to it.
            Note: Since we are re-rendering this component only on props change? 
            No, useFrame doesn't trigger re-render. 
            So passing `rotation.current` here won't update the child unless we use state.
            
            BETTER FIX: Apply rotation to the wrapper group as well.
          */}
          <group rotation={[0, rotation.current, 0]} ref={(node) => {
             if (node) node.rotation.y = rotation.current;
          }}>
             <PlayerModel 
                position={{x:0, y:0, z:0}} 
                rotation={0} // Handled by wrapper
                animation={animationState.current}
                isSelf 
             />
          </group>
      </group>
      
      <CameraController targetGroup={playerGroupRef} cameraRotation={cameraRotation} />
    </>
  );
};

export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, players, myId }) => {
  
  const handlePlayerMove = (pos: Vector3, rot: number, anim: string) => {
    socket.emit('move', pos, rot, anim);
  };

  return (
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera makeDefault fov={60} />
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[10, 10, 5]} 
        intensity={1} 
        castShadow 
        shadow-mapSize={[1024, 1024]} 
      />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="sunset" />

      {/* Suspense is REQUIRED for useGLTF to work without crashing or black screening initially */}
      <Suspense fallback={<Loader />}>
        <ModelErrorBoundary>
          <MapModel />

          {/* Render Other Players */}
          {Object.values(players).map((p) => {
            if (p.id === myId) return null;
            return (
                <PlayerModel 
                    key={p.id} 
                    position={p.position} 
                    rotation={p.rotation} 
                    color={p.color} 
                    animation={p.animation}
                />
            );
          })}

          {/* Render Self */}
          {myId && players[myId] && (
            <PlayerController 
                joystickData={joystickData} 
                cameraRotation={cameraRotation} 
                onMove={handlePlayerMove}
                initialPos={players[myId].position}
            />
          )}
        </ModelErrorBoundary>
      </Suspense>
    </Canvas>
  );
};