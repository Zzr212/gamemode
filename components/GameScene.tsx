import React, { useRef, Suspense, Component, ReactNode, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeElements } from '@react-three/fiber';
import { PerspectiveCamera, Sky, Loader, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { JoystickData, PlayerState, Vector3 } from '../types';
import { PlayerModel } from './PlayerModel';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {
        fog: any;
        ambientLight: any;
        directionalLight: any;
        group: any;
    }
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

// --- REMOTE PLAYER COMPONENT (Interpolation Logic) ---
// This handles smoothing out the movement of other players so they don't teleport.
const RemotePlayer: React.FC<{ data: PlayerState }> = ({ data }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  // We keep a reference to the current animation to avoid passing unstable props
  // However, we pass data.animation directly to PlayerModel which handles the blending.
  
  useFrame((state, delta) => {
    if (groupRef.current) {
      // 1. Position Interpolation (Lerp)
      // Smoothly move from current position to target position (data.position)
      // Factor 10 * delta gives a quick but smooth catch-up
      const targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
      groupRef.current.position.lerp(targetPos, 12 * delta);

      // 2. Rotation Interpolation
      // Smoothly rotate towards target rotation
      let currentRot = groupRef.current.rotation.y;
      let targetRot = data.rotation;
      
      // Shortest path rotation logic
      let diff = targetRot - currentRot;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      
      groupRef.current.rotation.y += diff * 10 * delta;
    }
  });

  return (
    <group ref={groupRef} position={[data.position.x, data.position.y, data.position.z]}>
      {/* 
         We render PlayerModel at 0,0,0 inside this interpolated group. 
         We pass the animation state directly from the server data.
      */}
      <PlayerModel 
        position={{x:0, y:0, z:0}} 
        rotation={0} 
        animation={data.animation} 
      />
    </group>
  );
};

// --- CAMERA CONTROLLER ---
const CameraController: React.FC<{
  targetGroup: React.RefObject<THREE.Group>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
}> = ({ targetGroup, cameraRotation }) => {
  const { camera } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 10, 10));

  useFrame(() => {
    if (!targetGroup.current) return;

    const targetPosition = targetGroup.current.position;
    const distance = 8;
    const height = 4;

    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-0.5, Math.min(1.5, cameraRotation.current.pitch));

    const hDist = distance * Math.cos(pitch);
    const vDist = distance * Math.sin(pitch);

    const offsetX = Math.sin(yaw) * hDist;
    const offsetZ = Math.cos(yaw) * hDist;

    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.5, targetPosition.z);
    
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

// --- PLAYER CONTROLLER (Local Physics) ---
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
  const isGrounded = useRef(false);
  const lastSendTime = useRef(0);
  
  const animationRef = useRef('Idle');
  const [visualAnimation, setVisualAnimation] = useState('Idle');
  
  const downRaycaster = useRef(new THREE.Raycaster());
  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);

  const SPEED = 0.15;
  const GRAVITY = 0.02;
  const JUMP_FORCE = 0.4;
  const COLLIDER_NAME = 'ground-collider';

  useFrame(() => {
    const { x, y } = joystickData.current;
    const mapObject = scene.getObjectByName(COLLIDER_NAME);

    // 1. Movement Logic
    const isMoving = Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
    let moveX = 0;
    let moveZ = 0;

    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      const forwardX = Math.sin(camYaw) * y;
      const forwardZ = Math.cos(camYaw) * y;
      const rightX = Math.cos(camYaw) * x;
      const rightZ = -Math.sin(camYaw) * x;

      moveX = (forwardX + rightX) * SPEED;
      moveZ = (forwardZ + rightZ) * SPEED;

      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          let delta = targetRotation - rotation.current;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          rotation.current += delta * 0.2;
      }
    }

    // 2. Physics & Collision (Simplified)
    let groundY = -100;
    if (mapObject) {
        const origin = pos.current.clone().add(new THREE.Vector3(0, 5, 0));
        downRaycaster.current.set(origin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0) groundY = intersects[0].point.y;
    }

    // Gap Protection
    let allowMove = true;
    if (isMoving && mapObject) {
        const futurePos = pos.current.clone().add(new THREE.Vector3(moveX, 0, moveZ));
        const futureOrigin = futurePos.clone().add(new THREE.Vector3(0, 5, 0));
        downRaycaster.current.set(futureOrigin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0) {
            if (intersects[0].point.y - pos.current.y > 0.6) allowMove = false;
        } else if (isGrounded.current) {
            allowMove = false; 
        }
    }

    if (allowMove) {
        pos.current.x += moveX;
        pos.current.z += moveZ;
    }

    // Gravity
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

    if (pos.current.y < -20) {
        pos.current.y = 10;
        velocity.current.set(0,0,0);
    }

    // Update Visuals
    if (playerGroupRef.current) playerGroupRef.current.position.lerp(pos.current, 0.6);
    if (modelRotationGroupRef.current) modelRotationGroupRef.current.rotation.y = rotation.current;

    // Animation
    let newAnim = 'Idle';
    if (!isGrounded.current && velocity.current.y > 0) newAnim = 'Jump';
    else if (isMoving) newAnim = 'Run';

    if (animationRef.current !== newAnim) {
        animationRef.current = newAnim;
        setVisualAnimation(newAnim);
    }

    // 3. Network Optimization
    // Send update only every 50ms OR if animation changed critically
    const now = Date.now();
    const shouldSend = (now - lastSendTime.current > 50) || (animationRef.current !== newAnim);
    
    if (shouldSend) {
        onMove(pos.current, rotation.current, animationRef.current);
        lastSendTime.current = now;
    }
  });

  return (
    <>
      <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
          <group ref={modelRotationGroupRef}>
             <PlayerModel position={{x:0,y:0,z:0}} rotation={0} animation={visualAnimation} />
          </group>
      </group>
      <CameraController targetGroup={playerGroupRef} cameraRotation={cameraRotation} />
    </>
  );
};

// --- MAIN GAME SCENE ---
export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, jumpPressed, players, myId }) => {
  const [dpr, setDpr] = useState(1.5); 

  const handlePlayerMove = (pos: Vector3, rot: number, anim: string) => {
    socket.emit('move', pos, rot, anim);
  };

  return (
    <>
      <Canvas 
        dpr={dpr} 
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.8 }} 
        shadows
      >
        <PerformanceMonitor 
             onIncline={() => setDpr(1.5)} 
             onDecline={() => setDpr(1)} 
        />

        <PerspectiveCamera makeDefault position={[0, 20, 20]} fov={60} far={100} onUpdate={c => c.lookAt(0, 0, 0)}/>

        {/* 4. Visuals: Day & Fog */}
        {/* White fog for distance, matches sky */}
        <fog attach="fog" args={['#eefbff', 20, 80]} />
        <color attach="background" args={['#eefbff']} />

        {/* Daylight Lighting */}
        <ambientLight intensity={0.6} />
        <directionalLight 
          position={[50, 80, 30]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize={[2048, 2048]} 
          shadow-bias={-0.0001}
        />

        {/* Sky with Clouds (Day effect) */}
        <Sky 
            sunPosition={[100, 20, 100]} 
            turbidity={0.5} 
            rayleigh={0.5} 
            mieCoefficient={0.005} 
            mieDirectionalG={0.8} 
        />
        
        <Suspense fallback={null}>
          <ModelErrorBoundary>
            <MapModel />

            {/* Render Other Players using RemotePlayer for interpolation */}
            {Object.values(players).map((p) => {
              if (p.id === myId) return null;
              return <RemotePlayer key={p.id} data={p} />;
            })}

            {/* Render Local Player */}
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