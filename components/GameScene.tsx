import React, { useRef, Suspense, Component, ReactNode, useState, useEffect } from 'react';
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

// --- REMOTE PLAYER COMPONENT ---
const RemotePlayer: React.FC<{ data: PlayerState }> = ({ data }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  // Set initial position once
  useEffect(() => {
    if (groupRef.current) {
        groupRef.current.position.set(data.position.x, data.position.y, data.position.z);
    }
  }, []); 

  useFrame((_, delta) => {
    if (groupRef.current) {
      // 1. Position Interpolation (Lerp)
      const targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
      
      const distance = groupRef.current.position.distanceTo(targetPos);
      const lerpFactor = distance > 3 ? 1 : 12 * delta; 
      
      groupRef.current.position.lerp(targetPos, lerpFactor);

      // 2. Rotation Interpolation
      let currentRot = groupRef.current.rotation.y;
      let targetRot = data.rotation;
      
      let diff = targetRot - currentRot;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      
      groupRef.current.rotation.y += diff * 12 * delta;
    }
  });

  return (
    <group ref={groupRef}>
      <PlayerModel 
        position={{x:0, y:0, z:0}} 
        rotation={0} 
        animation={data.animation} 
      />
    </group>
  );
};

// --- CAMERA CONTROLLER (Advanced Third Person with Collision) ---
const CameraController: React.FC<{
  targetGroup: React.RefObject<THREE.Group>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
}> = ({ targetGroup, cameraRotation }) => {
  const { camera, scene } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 10, 10));
  const raycaster = useRef(new THREE.Raycaster());

  useFrame(() => {
    if (!targetGroup.current) return;

    const playerPos = targetGroup.current.position;
    
    // Config
    const maxDistance = 7;
    const minDistance = 2; // Closest camera can get to player
    const playerHeight = 1.5; // Origin of look (Head level)
    
    // Yaw/Pitch from inputs
    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-1.4, Math.min(1.4, cameraRotation.current.pitch)); // Full freedom up/down

    // 1. Calculate ideal relative position based on spherical coordinates
    // "Orbit" around 0,0,0
    const hDist = maxDistance * Math.cos(pitch);
    const vDist = maxDistance * Math.sin(pitch);
    const orbitX = Math.sin(yaw) * hDist;
    const orbitZ = Math.cos(yaw) * hDist;

    // 2. Define origin (Player Head)
    const origin = new THREE.Vector3(playerPos.x, playerPos.y + playerHeight, playerPos.z);
    
    // 3. Define Ideal Camera Position (without collision)
    const idealPos = new THREE.Vector3(
        origin.x + orbitX,
        origin.y + vDist,
        origin.z + orbitZ
    );

    // 4. Collision Detection (Raycast from Head to IdealPos)
    const direction = new THREE.Vector3().subVectors(idealPos, origin).normalize();
    raycaster.current.set(origin, direction);
    
    // Find map object to collide with
    const mapObject = scene.getObjectByName('ground-collider');
    let finalDistance = maxDistance;

    if (mapObject) {
        const intersects = raycaster.current.intersectObject(mapObject, true);
        // If we hit something between player and ideal camera position
        if (intersects.length > 0 && intersects[0].distance < maxDistance) {
            // Pull camera in slightly in front of the wall (buffer 0.2)
            finalDistance = Math.max(minDistance, intersects[0].distance - 0.2);
        }
    }

    // 5. Recalculate Camera Position with safe distance
    // We scale the vector from origin by the safe distance
    const safePos = origin.clone().add(direction.multiplyScalar(finalDistance));

    // Smoothly move camera there
    currentPos.current.lerp(safePos, 0.3);
    camera.position.copy(currentPos.current);

    // 6. Look At Logic (Offset for Crosshair)
    // To have the Crosshair (Screen Center) point at an enemy, the Camera must look at the "Aim Point".
    // To have the Character on the LEFT, we must look at a point to the RIGHT of the character.
    
    // Calculate Right Vector relative to camera yaw
    const rightDir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    
    // Look Target Offset
    const lookOffsetRight = 2.0; // Pushes character left
    const lookOffsetUp = 0.5;    // Pushes character down slightly (Crosshair goes up)

    const targetLookAt = new THREE.Vector3(
        origin.x + (rightDir.x * lookOffsetRight),
        origin.y + lookOffsetUp,
        origin.z + (rightDir.z * lookOffsetRight)
    );

    camera.lookAt(targetLookAt);
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

    // 2. Physics & Collision
    let groundY = -100;
    if (mapObject) {
        const origin = pos.current.clone().add(new THREE.Vector3(0, 5, 0));
        downRaycaster.current.set(origin, new THREE.Vector3(0, -1, 0));
        const intersects = downRaycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0) groundY = intersects[0].point.y;
    }

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

    // Animation Logic
    let newAnim = 'Idle';
    if (!isGrounded.current && velocity.current.y > 0) newAnim = 'Jump';
    else if (isMoving) newAnim = 'Run';

    const animChanged = animationRef.current !== newAnim;

    if (animChanged) {
        animationRef.current = newAnim;
        setVisualAnimation(newAnim);
    }

    const now = Date.now();
    const shouldSend = (now - lastSendTime.current > 50) || animChanged;
    
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

        <fog attach="fog" args={['#eefbff', 20, 80]} />
        <color attach="background" args={['#eefbff']} />

        <ambientLight intensity={0.6} />
        <directionalLight 
          position={[50, 80, 30]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize={[2048, 2048]} 
          shadow-bias={-0.0001}
        />

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

            {/* Render Other Players */}
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