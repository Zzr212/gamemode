import React, { useRef, Suspense, Component, ReactNode, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Sky, Loader, PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { JoystickData, PlayerState, Vector3 } from '../types';
import { PlayerModel } from './PlayerModel';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';

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
      // Smoother interpolation logic
      const lerpFactor = distance > 5 ? 1 : 15 * delta; 
      
      groupRef.current.position.lerp(targetPos, lerpFactor);

      // 2. Rotation Interpolation
      let currentRot = groupRef.current.rotation.y;
      let targetRot = data.rotation;
      
      let diff = targetRot - currentRot;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      
      groupRef.current.rotation.y += diff * 15 * delta;
    }
  });

  return (
    <group ref={groupRef}>
      <PlayerModel 
        key={data.animation} // Remount on animation change for instant transition
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
  const { camera, scene } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 10, 10));
  const raycaster = useRef(new THREE.Raycaster());

  useFrame(() => {
    if (!targetGroup.current) return;

    const playerPos = targetGroup.current.position;
    
    // Config
    const maxDistance = 7;
    const minDistance = 2; 
    const playerHeight = 1.5; 
    
    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-1.4, Math.min(1.4, cameraRotation.current.pitch)); 

    const hDist = maxDistance * Math.cos(pitch);
    const vDist = maxDistance * Math.sin(pitch);
    const orbitX = Math.sin(yaw) * hDist;
    const orbitZ = Math.cos(yaw) * hDist;

    const origin = new THREE.Vector3(playerPos.x, playerPos.y + playerHeight, playerPos.z);
    
    const idealPos = new THREE.Vector3(
        origin.x + orbitX,
        origin.y + vDist,
        origin.z + orbitZ
    );

    const direction = new THREE.Vector3().subVectors(idealPos, origin).normalize();
    raycaster.current.set(origin, direction);
    
    const mapObject = scene.getObjectByName('ground-collider');
    let finalDistance = maxDistance;

    if (mapObject) {
        const intersects = raycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0 && intersects[0].distance < maxDistance) {
            finalDistance = Math.max(minDistance, intersects[0].distance - 0.2);
        }
    }

    const safePos = origin.clone().add(direction.multiplyScalar(finalDistance));

    currentPos.current.lerp(safePos, 0.3);
    camera.position.copy(currentPos.current);

    const rightDir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const lookOffsetRight = 2.0; 
    const lookOffsetUp = 0.5;    

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
  const wallRaycaster = useRef(new THREE.Raycaster()); // NEW: Horizontal collision

  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);

  // Tuning
  const MOVE_SPEED = 6.0; 
  const GRAVITY = 18.0;   
  const JUMP_VELOCITY = 8.0; 
  const COLLIDER_NAME = 'ground-collider';
  
  const CHECK_RADIUS = 0.3; 
  const MAX_STEP_HEIGHT = 0.6; // Max height we snap up to (knee height)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    const { x, y } = joystickData.current;
    const mapObject = scene.getObjectByName(COLLIDER_NAME);

    // 1. Calculate Intent (Speed + Rotation)
    const isMoving = Math.abs(x) > 0.1 || Math.abs(y) > 0.1;
    let moveX = 0;
    let moveZ = 0;

    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      const forwardX = Math.sin(camYaw) * y;
      const forwardZ = Math.cos(camYaw) * y;
      const rightX = Math.cos(camYaw) * x;
      const rightZ = -Math.sin(camYaw) * x;

      moveX = (forwardX + rightX) * MOVE_SPEED * dt;
      moveZ = (forwardZ + rightZ) * MOVE_SPEED * dt;

      // Update Rotation
      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          let deltaRot = targetRotation - rotation.current;
          while (deltaRot > Math.PI) deltaRot -= Math.PI * 2;
          while (deltaRot < -Math.PI) deltaRot += Math.PI * 2;
          rotation.current += deltaRot * 10 * dt; 
      }
    }

    // 2. Wall Collision (Horizontal Raycast)
    let isBlocked = false;
    if (isMoving && mapObject && (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001)) {
        const moveVector = new THREE.Vector3(moveX, 0, moveZ);
        const moveLength = moveVector.length();
        const moveDir = moveVector.normalize();
        
        // Raycast from waist height (approx 1.0 unit up) in direction of movement
        // We add a small buffer (0.4) to the check distance (radius + buffer)
        const rayOrigin = pos.current.clone().add(new THREE.Vector3(0, 1.0, 0));
        wallRaycaster.current.set(rayOrigin, moveDir);
        
        // Far distance = Radius + intended move distance
        wallRaycaster.current.far = 0.5 + moveLength; 
        
        const wallIntersects = wallRaycaster.current.intersectObject(mapObject, true);
        if (wallIntersects.length > 0) {
            isBlocked = true;
        }
    }

    if (!isBlocked) {
        pos.current.x += moveX;
        pos.current.z += moveZ;
    }

    // 3. Ground Detection (Gravity & Snapping)
    let groundY = -100;
    
    if (mapObject) {
        const origins = [
            new THREE.Vector3(0, 0, 0), // Center
            new THREE.Vector3(CHECK_RADIUS, 0, 0), // Right
            new THREE.Vector3(-CHECK_RADIUS, 0, 0), // Left
            new THREE.Vector3(0, 0, CHECK_RADIUS), // Front
            new THREE.Vector3(0, 0, -CHECK_RADIUS) // Back
        ];

        let maxHitY = -100;
        let foundValidGround = false;

        for (const offset of origins) {
            // Raycast origin: Position + Offset + High enough to detect floor
            const rayOrigin = pos.current.clone().add(offset).add(new THREE.Vector3(0, 2, 0));
            downRaycaster.current.set(rayOrigin, new THREE.Vector3(0, -1, 0));
            
            const intersects = downRaycaster.current.intersectObject(mapObject, true);
            if (intersects.length > 0) {
                const hitY = intersects[0].point.y;
                
                // IMPORTANT: Prevent snapping to roof (climbing bug)
                // Only treat it as ground if it's not too far above our current feet
                // Logic: If hitY is > currentY + step_height, it's a wall/ceiling, ignore it.
                if (hitY - pos.current.y <= MAX_STEP_HEIGHT) {
                    if (hitY > maxHitY) {
                        maxHitY = hitY;
                        foundValidGround = true;
                    }
                }
            }
        }
        if (foundValidGround) groundY = maxHitY;
    }

    // Jump Logic
    if (jumpPressed.current && isGrounded.current) {
        velocity.current.y = JUMP_VELOCITY;
        isGrounded.current = false;
        jumpPressed.current = false;
    } else {
        jumpPressed.current = false;
    }

    // Apply Gravity / Snap to Floor
    if (pos.current.y > groundY + 0.1 || velocity.current.y > 0) {
        velocity.current.y -= GRAVITY * dt;
        pos.current.y += velocity.current.y * dt;
        isGrounded.current = false;
    } else {
        velocity.current.y = 0;
        // Smooth snap or hard snap? Hard snap prevents jitter.
        pos.current.y = groundY;
        isGrounded.current = true;
    }

    // Respawn Floor
    if (pos.current.y < -20) {
        pos.current.y = 10;
        pos.current.x = 0;
        pos.current.z = 0;
        velocity.current.set(0,0,0);
    }

    // Update Visuals
    if (playerGroupRef.current) playerGroupRef.current.position.lerp(pos.current, 0.6);
    if (modelRotationGroupRef.current) modelRotationGroupRef.current.rotation.y = rotation.current;

    // Animation Logic
    let newAnim = 'Idle';
    if (!isGrounded.current) newAnim = 'Jump'; 
    else if (isMoving && !isBlocked) newAnim = 'Run';

    const animChanged = animationRef.current !== newAnim;

    if (animChanged) {
        animationRef.current = newAnim;
        setVisualAnimation(newAnim);
    }

    // Network Sync
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

  const handlePlayerMove = useCallback((pos: Vector3, rot: number, anim: string) => {
    socket.emit('move', pos, rot, anim);
  }, []);

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