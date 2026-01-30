import React, { useRef, Suspense, Component, ReactNode, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { PerspectiveCamera, Stars, Loader, PerformanceMonitor } from '@react-three/drei';
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
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

interface GameSceneProps {
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  jumpPressed: React.MutableRefObject<boolean>;
  players: Record<string, PlayerState>;
  myId: string | null;
}

// Camera follows player
const CameraController: React.FC<{
  targetGroup: React.RefObject<THREE.Group>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
}> = ({ targetGroup, cameraRotation }) => {
  const { camera } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 5, 10));

  useFrame(() => {
    if (!targetGroup.current) return;

    const targetPosition = targetGroup.current.position;
    // Lower distance for performance, closer feel
    const distance = 8;
    const height = 4;

    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-0.2, Math.min(1.2, cameraRotation.current.pitch));

    const hDist = distance * Math.cos(pitch);
    const vDist = distance * Math.sin(pitch);

    const offsetX = Math.sin(yaw) * hDist;
    const offsetZ = Math.cos(yaw) * hDist;

    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.5, targetPosition.z);
    
    // Smooth lerp for camera
    currentPos.current.lerp(new THREE.Vector3(
        targetVec.x + offsetX, 
        targetVec.y + height + vDist, 
        targetVec.z + offsetZ
    ), 0.15);

    camera.position.copy(currentPos.current);
    camera.lookAt(targetVec);
  });

  return null;
};

// Physics & Logic
const PlayerController: React.FC<{
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  jumpPressed: React.MutableRefObject<boolean>;
  onMove: (pos: Vector3, rot: number, anim: string) => void;
  initialPos: Vector3;
}> = ({ joystickData, cameraRotation, jumpPressed, onMove, initialPos }) => {
  const { scene } = useThree();
  
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const animationState = useRef('idle');
  const isGrounded = useRef(false);
  
  // Raycaster
  const downRaycaster = useRef(new THREE.Raycaster());
  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);

  // Constants
  const SPEED = 0.15;
  const GRAVITY = 0.02;
  const JUMP_FORCE = 0.4;
  const COLLIDER_NAME = 'ground-collider';

  useFrame(() => {
    const { x, y } = joystickData.current;
    const mapObject = scene.getObjectByName(COLLIDER_NAME);

    // 1. Calculate Intended Move
    const isMoving = Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
    let moveX = 0;
    let moveZ = 0;

    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      // Rotate input based on camera
      const forwardX = Math.sin(camYaw) * y;
      const forwardZ = Math.cos(camYaw) * y;
      const rightX = Math.cos(camYaw) * x;
      const rightZ = -Math.sin(camYaw) * x;

      moveX = (forwardX + rightX) * SPEED;
      moveZ = (forwardZ + rightZ) * SPEED;

      // Rotation
      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          let delta = targetRotation - rotation.current;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          rotation.current += delta * 0.2;
      }
    }

    // 2. PHYSICS & COLLISION
    let groundY = -100; // Default floor (void)

    // Check CURRENT ground
    if (mapObject) {
        const origin = pos.current.clone().add(new THREE.Vector3(0, 5, 0));
        downRaycaster.current.set(origin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0) {
            groundY = intersects[0].point.y;
        }
    }

    // Check FUTURE ground (Gap Protection)
    let allowMove = true;
    
    if (isMoving && mapObject) {
        const futurePos = pos.current.clone().add(new THREE.Vector3(moveX, 0, moveZ));
        const futureOrigin = futurePos.clone().add(new THREE.Vector3(0, 5, 0));
        
        downRaycaster.current.set(futureOrigin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        
        if (intersects.length > 0) {
            const futureGroundY = intersects[0].point.y;
            const heightDiff = futureGroundY - pos.current.y;
            
            // Wall check: Too high to step up
            if (heightDiff > 0.6) allowMove = false;
        } else {
            // GAP DETECTED: No ground found at future position
            // If we are currently grounded, do NOT allow walking into void (small cracks)
            // Exception: If we are jumping/falling already, allow it.
            if (isGrounded.current) {
                allowMove = false; 
            }
        }
    }

    if (allowMove) {
        pos.current.x += moveX;
        pos.current.z += moveZ;
    }

    // 3. Gravity
    if (jumpPressed.current && isGrounded.current) {
        velocity.current.y = JUMP_FORCE;
        isGrounded.current = false;
        jumpPressed.current = false;
    } else {
        jumpPressed.current = false;
    }

    if (pos.current.y > groundY + 0.1 || velocity.current.y > 0) {
        velocity.current.y -= GRAVITY;
        pos.current.y += velocity.current.y;
        isGrounded.current = false;
    } else {
        velocity.current.y = 0;
        pos.current.y = groundY;
        isGrounded.current = true;
    }

    // Void reset
    if (pos.current.y < -20) {
        pos.current.set(initialPos.x, initialPos.y + 2, initialPos.z);
        velocity.current.set(0,0,0);
    }

    // 4. Update Refs
    if (playerGroupRef.current) playerGroupRef.current.position.lerp(pos.current, 0.6);
    if (modelRotationGroupRef.current) modelRotationGroupRef.current.rotation.y = rotation.current;

    // 5. Animation
    let newAnim = 'idle';
    if (!isGrounded.current && velocity.current.y > 0) newAnim = 'jump';
    else if (isMoving) newAnim = 'run';

    // 6. Sync
    if (animationState.current !== newAnim || (isMoving && Math.random() < 0.2)) {
        animationState.current = newAnim;
        onMove(pos.current, rotation.current, animationState.current);
    }
  });

  return (
    <>
      <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
          <group ref={modelRotationGroupRef}>
             <PlayerModel position={{x:0,y:0,z:0}} rotation={0} animation={animationState.current} />
          </group>
      </group>
      <CameraController targetGroup={playerGroupRef} cameraRotation={cameraRotation} />
    </>
  );
};

export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, jumpPressed, players, myId }) => {
  // Optimization: Decrease pixel ratio on low perf
  const [dpr, setDpr] = useState(1.5); 

  const handlePlayerMove = (pos: Vector3, rot: number, anim: string) => {
    socket.emit('move', pos, rot, anim);
  };

  return (
    <>
      <Canvas 
        dpr={dpr} // Dynamic pixel ratio
        gl={{ antialias: false, powerPreference: 'high-performance' }} // Disable AA for perf
      >
        <PerformanceMonitor 
             onIncline={() => setDpr(1.5)} 
             onDecline={() => setDpr(1)} // Drop to 1.0 DPR on weak devices
        />

        {/* Reduce draw distance (far=50) and add fog to hide cutoff */}
        <PerspectiveCamera makeDefault fov={60} far={50} />
        <fog attach="fog" args={['#000', 30, 50]} />

        <ambientLight intensity={0.7} />
        {/* Shadow optimization: reduce map size */}
        <directionalLight 
          position={[20, 30, 10]} 
          intensity={1.2} 
          castShadow 
          shadow-mapSize={[1024, 1024]} 
          shadow-bias={-0.0001}
        />
        
        {/* Simple sky */}
        <Stars radius={40} depth={20} count={2000} factor={3} fade />
        
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
                      animation={p.animation}
                  />
              );
            })}

            {myId && players[myId] && (
              <PlayerController 
                  joystickData={joystickData} 
                  cameraRotation={cameraRotation} 
                  jumpPressed={jumpPressed}
                  onMove={handlePlayerMove}
                  initialPos={players[myId].position}
              />
            )}
          </ModelErrorBoundary>
        </Suspense>
      </Canvas>
      <Loader containerStyles={{ background: 'black' }} />
    </>
  );
};