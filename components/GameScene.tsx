import React, { useRef, Suspense, Component, ReactNode } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { Environment, PerspectiveCamera, Stars, Loader } from '@react-three/drei';
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
      return null;
    }
    return this.props.children;
  }
}

interface GameSceneProps {
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  jumpPressed: React.MutableRefObject<boolean>;
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
    const height = 4;

    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-0.2, Math.min(1.2, cameraRotation.current.pitch));

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

    currentPos.current.lerp(camPos, 0.15);
    camera.position.copy(currentPos.current);
    camera.lookAt(targetVec);
  });

  return null;
};

const PlayerController: React.FC<{
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  jumpPressed: React.MutableRefObject<boolean>;
  onMove: (pos: Vector3, rot: number, anim: string) => void;
  initialPos: Vector3;
}> = ({ joystickData, cameraRotation, jumpPressed, onMove, initialPos }) => {
  const { scene } = useThree();
  
  // State
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const animationState = useRef('idle');
  const isGrounded = useRef(false);
  
  // Raycasters
  const downRaycaster = useRef(new THREE.Raycaster());
  
  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);

  // Physics Config
  const speed = 0.15;
  const gravity = 0.02;
  const jumpForce = 0.4;
  const maxStepHeight = 0.5; // Max height player can climb automatically
  const colliderName = 'ground-collider';

  useFrame(() => {
    const { x, y } = joystickData.current;
    const mapObject = scene.getObjectByName(colliderName);

    // 1. Input Handling
    const forwardInput = y; 
    const strafeInput = x;
    const isMoving = Math.abs(x) > 0.1 || Math.abs(y) > 0.1; // Increased threshold slightly
    
    let moveX = 0;
    let moveZ = 0;

    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      const forwardX = Math.sin(camYaw) * forwardInput;
      const forwardZ = Math.cos(camYaw) * forwardInput;
      const rightX = Math.cos(camYaw) * strafeInput;
      const rightZ = -Math.sin(camYaw) * strafeInput;

      moveX = (forwardX + rightX) * speed;
      moveZ = (forwardZ + rightZ) * speed;

      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          let delta = targetRotation - rotation.current;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          rotation.current += delta * 0.2;
      }
    }

    // 2. WALL / COLLISION DETECTION (Future Step Prediction)
    let canMove = true;
    let groundY = -100;

    // First, find ground height at CURRENT position
    if (mapObject) {
        const origin = pos.current.clone().add(new THREE.Vector3(0, 5, 0));
        downRaycaster.current.set(origin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0) {
            groundY = intersects[0].point.y;
        }
    }

    if (isMoving && mapObject) {
        // Check FUTURE position
        const futurePos = pos.current.clone().add(new THREE.Vector3(moveX, 0, moveZ));
        const origin = futurePos.clone().add(new THREE.Vector3(0, 5, 0)); // Cast from above
        
        downRaycaster.current.set(origin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        
        if (intersects.length > 0) {
            const futureGroundY = intersects[0].point.y;
            const heightDiff = futureGroundY - pos.current.y;

            // FIX: If the step is too high (wall), block movement
            // Also block if the slope is extremely steep (optional, but step height covers most walls)
            if (heightDiff > maxStepHeight) {
                canMove = false;
            }
        } else {
            // If future pos has NO ground (cliff edge), you might want to stop or let them fall. 
            // Letting them fall is standard.
        }
    }

    if (canMove) {
        pos.current.x += moveX;
        pos.current.z += moveZ;
    }

    // 3. Gravity & Jumping
    if (jumpPressed.current && isGrounded.current) {
        velocity.current.y = jumpForce;
        isGrounded.current = false;
        jumpPressed.current = false;
    } else {
        jumpPressed.current = false;
    }

    // Apply Velocity
    if (pos.current.y > groundY + 0.1 || velocity.current.y > 0) {
        velocity.current.y -= gravity;
        pos.current.y += velocity.current.y;
        isGrounded.current = false;
    } else {
        velocity.current.y = 0;
        pos.current.y = groundY;
        isGrounded.current = true;
    }
    
    // Void reset
    if (pos.current.y < -50) {
        pos.current.set(initialPos.x, initialPos.y + 5, initialPos.z); 
        velocity.current.set(0,0,0);
    }

    // 4. Update Visuals
    if (playerGroupRef.current) playerGroupRef.current.position.lerp(pos.current, 0.6);
    if (modelRotationGroupRef.current) modelRotationGroupRef.current.rotation.y = rotation.current;

    // 5. Animation Logic (Strict)
    let newAnim = 'idle';
    if (!isGrounded.current && velocity.current.y > 0) {
        newAnim = 'jump';
    } else if (isMoving) {
        newAnim = 'run';
    }

    // 6. Network Sync (Throttled slightly)
    if (animationState.current !== newAnim || (isMoving && Math.random() < 0.2) || !isGrounded.current) {
        animationState.current = newAnim;
        onMove(pos.current, rotation.current, animationState.current);
    }
  });

  return (
    <>
      <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
          <group ref={modelRotationGroupRef}>
             <PlayerModel 
                position={{x:0, y:0, z:0}} 
                rotation={0} 
                animation={animationState.current}
             />
          </group>
      </group>
      <CameraController targetGroup={playerGroupRef} cameraRotation={cameraRotation} />
    </>
  );
};

export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, jumpPressed, players, myId }) => {
  
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