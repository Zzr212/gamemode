import React, { useRef, Suspense, Component, ReactNode, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { Environment, PerspectiveCamera, Stars, Html, useProgress, Loader } from '@react-three/drei';
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

// Error Boundary
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
      return null; // Just don't render the broken part, avoid crashing app
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
    const height = 4; // Slightly higher camera
    const sideOffset = 0; // Centered camera feels better for platforming

    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-0.2, Math.min(1.2, cameraRotation.current.pitch)); // Limit pitch to avoid going under ground

    const hDist = distance * Math.cos(pitch);
    const vDist = distance * Math.sin(pitch);

    const offsetX = Math.sin(yaw) * hDist;
    const offsetZ = Math.cos(yaw) * hDist;

    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.5, targetPosition.z);
    
    const camPos = new THREE.Vector3(
        targetVec.x + offsetX, 
        targetVec.y + height + vDist, 
        targetVec.z + offsetZ
    );

    currentPos.current.lerp(camPos, 0.15); // Smooth camera
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
  const { scene } = useThree();
  
  // Logic position & physics
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const animationState = useRef('idle');
  const isGrounded = useRef(false);
  
  // Raycaster for gravity
  const raycaster = useRef(new THREE.Raycaster());
  const downVector = new THREE.Vector3(0, -1, 0);

  // Visual Reference
  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);

  const speed = 0.15;
  const gravity = 0.02;

  useFrame(() => {
    const { x, y } = joystickData.current;
    
    // Joystick Logic
    // Joystick Y: negative is UP (Forward), positive is DOWN (Back)
    // We want Forward to go into screen (negative Z)
    const forwardInput = y; 
    const strafeInput = x;
    
    const isMoving = Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
    const newAnim = isMoving ? 'walk' : 'idle';

    // 1. Horizontal Movement
    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      
      const forwardX = Math.sin(camYaw) * forwardInput;
      const forwardZ = Math.cos(camYaw) * forwardInput;
      
      const rightX = Math.cos(camYaw) * strafeInput;
      const rightZ = -Math.sin(camYaw) * strafeInput;

      const moveX = forwardX + rightX;
      const moveZ = forwardZ + rightZ;

      pos.current.x += moveX * speed;
      pos.current.z += moveZ * speed;

      // Calculate Rotation (Face movement direction)
      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          // Smooth rotation (Lerp angle)
          let delta = targetRotation - rotation.current;
          // Normalize delta to -PI to PI
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          rotation.current += delta * 0.2; // 0.2 is turn speed
      }
    }

    // 2. Physics & Gravity (Raycasting)
    // Find the ground
    let groundY = -100; // abyss
    
    // Locate the map collider group
    const groundObject = scene.getObjectByName('ground-collider');
    
    if (groundObject) {
        // Cast ray from above the player downwards
        const rayOrigin = pos.current.clone().add(new THREE.Vector3(0, 5, 0));
        raycaster.current.set(rayOrigin, downVector);
        
        // Check intersections recursively
        const intersects = raycaster.current.intersectObject(groundObject, true);
        
        if (intersects.length > 0) {
            // Found ground
            groundY = intersects[0].point.y;
        }
    }

    // Apply Gravity
    if (pos.current.y > groundY + 0.1) {
        // Falling
        velocity.current.y -= gravity;
        pos.current.y += velocity.current.y;
        isGrounded.current = false;
    } else {
        // On Ground
        velocity.current.y = 0;
        pos.current.y = groundY;
        isGrounded.current = true;
    }
    
    // Safety net for falling through world
    if (pos.current.y < -50) {
        pos.current.set(0, 10, 0); // Respawn in air
        velocity.current.set(0,0,0);
    }

    // 3. Update Visuals
    if (playerGroupRef.current) {
        playerGroupRef.current.position.lerp(pos.current, 0.5); // Slight smoothing
    }
    if (modelRotationGroupRef.current) {
        modelRotationGroupRef.current.rotation.y = rotation.current;
    }

    // 4. Network Sync
    if (isMoving || animationState.current !== newAnim || !isGrounded.current) {
        animationState.current = newAnim;
        // Only emit every few frames to save bandwidth? 
        // For now, every frame is smoothest for local prediction, but expensive.
        // We rely on socket.io packing.
        onMove(pos.current, rotation.current, animationState.current);
    }
  });

  return (
    <>
      <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
          {/* Inner group for rotation to separate it from position interpolation */}
          <group ref={modelRotationGroupRef}>
             <PlayerModel 
                position={{x:0, y:0, z:0}} 
                rotation={0} 
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
    <>
      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true }}>
        <PerspectiveCamera makeDefault fov={60} />
        <ambientLight intensity={0.6} />
        <directionalLight 
          position={[20, 30, 10]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize={[2048, 2048]} 
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        <Environment preset="city" />

        <Suspense fallback={null}>
          <ModelErrorBoundary>
            <MapModel />

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
      {/* 2D HTML Loader Overlay */}
      <Loader 
        containerStyles={{ background: 'black' }}
        innerStyles={{ width: '50vw', height: '10px', background: '#333' }}
        barStyles={{ height: '100%', background: '#4f46e5' }}
        dataStyles={{ fontSize: '1.2rem', fontFamily: 'monospace', fontWeight: 'bold' }}
      />
    </>
  );
};