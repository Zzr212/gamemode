import React, { Component, useRef, Suspense, ReactNode, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Sky, Loader, PerformanceMonitor, Html } from '@react-three/drei';
import * as THREE from 'three';
import { JoystickData, PlayerState, Vector3, Role, GamePhase } from '../types';
import { PlayerModel } from './PlayerModel';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';

// Error Boundary
interface ErrorBoundaryProps {
  children?: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
}

class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
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
  spectatingId: string | null;
  gamePhase: GamePhase;
  showCoords: boolean; // Admin toggle
}

// --- REMOTE PLAYER COMPONENT ---
const RemotePlayer: React.FC<{ data: PlayerState }> = ({ data }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  useEffect(() => {
    if (groupRef.current) {
        groupRef.current.position.set(data.position.x, data.position.y, data.position.z);
    }
  }, []); 

  useFrame((_, delta) => {
    if (data.role === Role.SPECTATOR || data.isDead || !groupRef.current) return;

    const targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    const distance = groupRef.current.position.distanceTo(targetPos);
      
    if (distance > 3) {
        groupRef.current.position.copy(targetPos);
    } else {
        groupRef.current.position.lerp(targetPos, 12 * delta);
    }

    let currentRot = groupRef.current.rotation.y;
    let targetRot = data.rotation;
    let diff = targetRot - currentRot;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
      
    groupRef.current.rotation.y += diff * 15 * delta;
  });

  if (data.role === Role.SPECTATOR || data.isDead) return null;

  return (
    <group ref={groupRef}>
      <PlayerModel 
        key={data.animation} 
        position={{x:0, y:0, z:0}} 
        rotation={0} 
        animation={data.animation} 
      />
      {data.isDisconnected && (
          <mesh position={[0, 2.5, 0]}>
              <boxGeometry args={[0.5, 0.2, 0.2]} />
              <meshBasicMaterial color="red" />
          </mesh>
      )}
    </group>
  );
};

// --- CAMERA CONTROLLER ---
const CameraController: React.FC<{
  targetPos: React.MutableRefObject<THREE.Vector3>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
}> = ({ targetPos, cameraRotation }) => {
  const { camera, scene } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 10, 10));
  const raycaster = useRef(new THREE.Raycaster());

  useFrame((_, delta) => {
    const playerPos = targetPos.current;
    
    if (currentPos.current.distanceTo(playerPos) > 10) {
        currentPos.current.copy(playerPos).add(new THREE.Vector3(0, 5, 5));
    }

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

    currentPos.current.lerp(safePos, 10 * delta); 
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
  targetPosRef: React.MutableRefObject<THREE.Vector3>;
  gamePhase: GamePhase; 
  showCoords: boolean;
}> = ({ joystickData, cameraRotation, jumpPressed, onMove, initialPos, targetPosRef, gamePhase, showCoords }) => {
  const { scene } = useThree();
  
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const isGrounded = useRef(false);
  const lastSendTime = useRef(0);
  
  const animationRef = useRef('Idle');
  const [visualAnimation, setVisualAnimation] = useState('Idle');
  // For coords display
  const [coordText, setCoordText] = useState("");
  
  const downRaycaster = useRef(new THREE.Raycaster());
  const wallRaycaster = useRef(new THREE.Raycaster());

  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);

  const MOVE_SPEED = 6.0; 
  const GRAVITY = 18.0;   
  const JUMP_VELOCITY = 8.0; 
  const COLLIDER_NAME = 'ground-collider';
  const CHECK_RADIUS = 0.3; 
  const MAX_STEP_HEIGHT = 0.6;

  useEffect(() => {
    velocity.current.set(0, 0, 0);
    const dist = pos.current.distanceTo(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
    if (dist > 5.0) {
        pos.current.set(initialPos.x, initialPos.y, initialPos.z);
        velocity.current.set(0, 0, 0);
        lastSendTime.current = 0; 
    }
  }, [initialPos.x, initialPos.y, initialPos.z, gamePhase]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    const { x, y } = joystickData.current;
    const mapObject = scene.getObjectByName(COLLIDER_NAME);

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

      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          let deltaRot = targetRotation - rotation.current;
          while (deltaRot > Math.PI) deltaRot -= Math.PI * 2;
          while (deltaRot < -Math.PI) deltaRot += Math.PI * 2;
          rotation.current += deltaRot * 10 * dt; 
      }
    }

    let isBlocked = false;
    if (isMoving && mapObject && (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001)) {
        const moveVector = new THREE.Vector3(moveX, 0, moveZ);
        const moveLength = moveVector.length();
        const moveDir = moveVector.normalize();
        
        const checkHeights = [0.2, 0.9, 1.6];
        
        for (const h of checkHeights) {
            if (isBlocked) break;
            const rayOrigin = pos.current.clone().add(new THREE.Vector3(0, h, 0));
            rayOrigin.sub(moveDir.clone().multiplyScalar(0.2));
            wallRaycaster.current.set(rayOrigin, moveDir);
            wallRaycaster.current.far = 0.2 + 0.3 + moveLength + 0.2; 
            const wallIntersects = wallRaycaster.current.intersectObject(mapObject, true);
            if (wallIntersects.length > 0) isBlocked = true;
        }
    }

    if (!isBlocked) {
        pos.current.x += moveX;
        pos.current.z += moveZ;
    }

    let groundY = -100;
    if (mapObject) {
        const origins = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(CHECK_RADIUS, 0, 0),
            new THREE.Vector3(-CHECK_RADIUS, 0, 0),
            new THREE.Vector3(0, 0, CHECK_RADIUS),
            new THREE.Vector3(0, 0, -CHECK_RADIUS)
        ];

        let maxHitY = -100;
        let foundValidGround = false;

        for (const offset of origins) {
            const rayOrigin = pos.current.clone().add(offset).add(new THREE.Vector3(0, 2, 0));
            downRaycaster.current.set(rayOrigin, new THREE.Vector3(0, -1, 0));
            
            const intersects = downRaycaster.current.intersectObject(mapObject, true);
            if (intersects.length > 0) {
                const hitY = intersects[0].point.y;
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

    if (jumpPressed.current && isGrounded.current) {
        velocity.current.y = JUMP_VELOCITY;
        isGrounded.current = false;
        jumpPressed.current = false;
    } else {
        jumpPressed.current = false;
    }

    if (pos.current.y > groundY + 0.1 || velocity.current.y > 0) {
        velocity.current.y -= GRAVITY * dt;
        pos.current.y += velocity.current.y * dt;
        isGrounded.current = false;
    } else {
        velocity.current.y = 0;
        pos.current.y = groundY;
        isGrounded.current = true;
    }

    if (pos.current.y < -20) {
        pos.current.y = 3; 
        pos.current.x = (Math.random() * 10) - 5; 
        pos.current.z = (Math.random() * 10) - 5;
        velocity.current.set(0,0,0);
    }

    if (playerGroupRef.current) playerGroupRef.current.position.lerp(pos.current, 0.6);
    if (modelRotationGroupRef.current) modelRotationGroupRef.current.rotation.y = rotation.current;

    targetPosRef.current.copy(pos.current);

    let newAnim = 'Idle';
    if (!isGrounded.current) newAnim = 'Jump'; 
    else if (isMoving && !isBlocked) newAnim = 'Run';

    const animChanged = animationRef.current !== newAnim;
    if (animChanged) {
        animationRef.current = newAnim;
        setVisualAnimation(newAnim);
    }
    
    // Update Coords text only if showing to save perf
    if (showCoords) {
        setCoordText(`X: ${pos.current.x.toFixed(1)}, Y: ${pos.current.y.toFixed(1)}, Z: ${pos.current.z.toFixed(1)}`);
    }

    const now = Date.now();
    const shouldSend = (now - lastSendTime.current > 25) || animChanged; 
    
    if (shouldSend) {
        onMove(pos.current, rotation.current, animationRef.current);
        lastSendTime.current = now;
    }
  });

  return (
    <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
        <group ref={modelRotationGroupRef}>
            <PlayerModel position={{x:0,y:0,z:0}} rotation={0} animation={visualAnimation} />
        </group>
        {showCoords && (
             <Html position={[0, 2.2, 0]} center>
                <div className="bg-black/70 text-green-400 text-xs px-2 py-1 rounded font-mono whitespace-nowrap border border-green-500/30">
                    {coordText}
                </div>
            </Html>
        )}
    </group>
  );
};

// --- SPECTATOR CONTROLLER ---
const SpectatorController: React.FC<{
    targetId: string | null;
    players: Record<string, PlayerState>;
    targetPosRef: React.MutableRefObject<THREE.Vector3>;
}> = ({ targetId, players, targetPosRef }) => {
    useFrame((_, delta) => {
        if (!targetId || !players[targetId]) return;
        const p = players[targetId];
        const target = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
        targetPosRef.current.lerp(target, 10 * delta);
    });
    return null;
}

// --- MAIN GAME SCENE ---
export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, jumpPressed, players, myId, spectatingId, gamePhase, showCoords }) => {
  const [dpr, setDpr] = useState(1.5); 
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  const handlePlayerMove = useCallback((pos: Vector3, rot: number, anim: string) => {
    socket.emit('move', pos, rot, anim);
  }, []);

  const isSpectating = !myId || !players[myId] || players[myId].role === Role.SPECTATOR || players[myId].isDead;

  return (
    <>
      <Canvas 
        dpr={dpr} 
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.8 }} 
        shadows
      >
        <PerformanceMonitor onIncline={() => setDpr(1.5)} onDecline={() => setDpr(1)} />

        <PerspectiveCamera makeDefault position={[0, 20, 20]} fov={60} far={100} onUpdate={c => c.lookAt(0, 0, 0)}/>

        <fog attach="fog" args={['#eefbff', 20, 80]} />
        <color attach="background" args={['#eefbff']} />

        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 80, 30]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0001}/>
        <Sky sunPosition={[100, 20, 100]} turbidity={0.5} rayleigh={0.5} mieCoefficient={0.005} mieDirectionalG={0.8} />
        
        <Suspense fallback={null}>
          <ModelErrorBoundary>
            <MapModel />

            {Object.values(players).map((p: PlayerState) => {
              if (p.id === myId) return null;
              return <RemotePlayer key={p.id} data={p} />;
            })}

            {!isSpectating ? (
                <PlayerController 
                    joystickData={joystickData} 
                    cameraRotation={cameraRotation} 
                    jumpPressed={jumpPressed}
                    onMove={handlePlayerMove}
                    initialPos={players[myId].position}
                    targetPosRef={cameraTargetRef}
                    gamePhase={gamePhase}
                    showCoords={showCoords}
                />
            ) : (
                <SpectatorController 
                    targetId={spectatingId} 
                    players={players} 
                    targetPosRef={cameraTargetRef}
                />
            )}

            <CameraController targetPos={cameraTargetRef} cameraRotation={cameraRotation} />
            
          </ModelErrorBoundary>
        </Suspense>
      </Canvas>
      <Loader containerStyles={{ background: 'black' }} />
    </>
  );
};