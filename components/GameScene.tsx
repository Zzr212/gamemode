import React, { Component, useRef, Suspense, ReactNode, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Sky, Loader, PerformanceMonitor, Html, SpotLight, Text } from '@react-three/drei';
import * as THREE from 'three';
import { JoystickData, PlayerState, Vector3, Role, GamePhase, GameSettings, TaskLocation } from '../types';
import { PlayerModel } from './PlayerModel';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';

interface ErrorBoundaryProps { children?: ReactNode; }
interface ErrorBoundaryState { hasError: boolean; }
class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) { super(props); this.state = { hasError: false }; }
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
  showCoords: boolean;
  settings: GameSettings;
  taskSpawns: TaskLocation[];
  timer: number;
}

// --- TASK HOLOGRAM COMPONENT ---
const TaskHologram: React.FC<{ type: string, position: Vector3 }> = ({ type, position }) => {
    const ref = useRef<THREE.Group>(null);
    useFrame((state) => {
        if(ref.current) {
            ref.current.rotation.y += 0.02;
            ref.current.position.y = position.y + 1 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
        }
    });

    return (
        <group ref={ref} position={[position.x, position.y, position.z]}>
            {/* Wrench Icon */}
            <mesh rotation={[0, 0, Math.PI / 4]}>
                <boxGeometry args={[0.2, 0.8, 0.05]} />
                <meshBasicMaterial color="yellow" transparent opacity={0.8} />
            </mesh>
            <mesh position={[0, 0.4, 0]}>
                <torusGeometry args={[0.15, 0.05, 8, 16, Math.PI * 1.5]} />
                <meshBasicMaterial color="yellow" transparent opacity={0.8} />
            </mesh>
            <Text position={[0, 0.8, 0]} fontSize={0.3} color="yellow" anchorX="center" anchorY="middle">
                {type}
            </Text>
        </group>
    );
};

// --- REMOTE PLAYER ---
const RemotePlayer: React.FC<{ data: PlayerState }> = ({ data }) => {
  const groupRef = useRef<THREE.Group>(null);
  
  useEffect(() => {
    if (groupRef.current) groupRef.current.position.set(data.position.x, data.position.y, data.position.z);
  }, []); 

  useFrame((_, delta) => {
    if (data.role === Role.SPECTATOR || data.isDead || !groupRef.current) return;
    const targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    const distance = groupRef.current.position.distanceTo(targetPos);
    if (distance > 3) groupRef.current.position.copy(targetPos);
    else groupRef.current.position.lerp(targetPos, 12 * delta);

    let currentRot = groupRef.current.rotation.y;
    let diff = data.rotation - currentRot;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    groupRef.current.rotation.y += diff * 15 * delta;
  });

  if (data.role === Role.SPECTATOR || data.isDead) return null;

  return (
    <group ref={groupRef}>
      <PlayerModel position={{x:0, y:0, z:0}} rotation={0} animation={data.animation} />
      {data.isDisconnected && <mesh position={[0, 2.5, 0]}><boxGeometry args={[0.5, 0.2, 0.2]} /><meshBasicMaterial color="red" /></mesh>}
    </group>
  );
};

// --- CAMERA CONTROLLER (Updated for Cutscene) ---
const CameraController: React.FC<{
  targetPos: React.MutableRefObject<THREE.Vector3>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  isHunter: boolean;
  gamePhase: GamePhase;
  timer: number;
  roundDuration: number;
  headStartDuration: number;
}> = ({ targetPos, cameraRotation, isHunter, gamePhase, timer, roundDuration, headStartDuration }) => {
  const { camera, scene } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 10, 10));
  const raycaster = useRef(new THREE.Raycaster());

  useFrame((_, delta) => {
    const playerPos = targetPos.current;

    // --- HUNTER CUTSCENE LOGIC ---
    // If Hunter, Game in Progress, and within the first 15 seconds
    const elapsed = roundDuration - timer;
    if (isHunter && gamePhase === GamePhase.IN_PROGRESS && elapsed < headStartDuration) {
        // Cutscene: From High Up (Birds Eye) down to Player
        const progress = elapsed / headStartDuration; // 0 to 1
        
        // Start Position (High above player)
        const startCamPos = new THREE.Vector3(playerPos.x, playerPos.y + 20, playerPos.z + 10);
        // End Position (Standard play view)
        const endCamPos = new THREE.Vector3(playerPos.x, playerPos.y + 4, playerPos.z + 6);
        
        const currentCamPos = new THREE.Vector3().lerpVectors(startCamPos, endCamPos, progress);
        
        camera.position.copy(currentCamPos);
        camera.lookAt(playerPos);
        return; // Skip normal controls
    }
    
    // --- NORMAL CAMERA ---
    if (currentPos.current.distanceTo(playerPos) > 10) currentPos.current.copy(playerPos).add(new THREE.Vector3(0, 5, 5));
    const maxDistance = 7;
    const minDistance = 2; 
    const playerHeight = 1.5; 
    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-1.4, Math.min(1.4, cameraRotation.current.pitch)); 
    const hDist = maxDistance * Math.cos(pitch);
    const vDist = maxDistance * Math.sin(pitch);
    const origin = new THREE.Vector3(playerPos.x, playerPos.y + playerHeight, playerPos.z);
    const idealPos = new THREE.Vector3(origin.x + Math.sin(yaw) * hDist, origin.y + vDist, origin.z + Math.cos(yaw) * hDist);
    const direction = new THREE.Vector3().subVectors(idealPos, origin).normalize();
    raycaster.current.set(origin, direction);
    const mapObject = scene.getObjectByName('ground-collider');
    let finalDistance = maxDistance;
    if (mapObject) {
        const intersects = raycaster.current.intersectObject(mapObject, true);
        if (intersects.length > 0 && intersects[0].distance < maxDistance) finalDistance = Math.max(minDistance, intersects[0].distance - 0.2);
    }
    currentPos.current.lerp(origin.clone().add(direction.multiplyScalar(finalDistance)), 10 * delta); 
    camera.position.copy(currentPos.current);
    const rightDir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    camera.lookAt(new THREE.Vector3(origin.x + (rightDir.x * 2.0), origin.y + 0.5, origin.z + (rightDir.z * 2.0)));
  });
  return null;
};

// --- PLAYER CONTROLLER ---
const PlayerController: React.FC<{
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  jumpPressed: React.MutableRefObject<boolean>;
  onMove: (pos: Vector3, rot: number, anim: string) => void;
  initialPos: Vector3;
  targetPosRef: React.MutableRefObject<THREE.Vector3>;
  gamePhase: GamePhase; 
  showCoords: boolean;
  role: Role;
  settings: GameSettings;
  timer: number;
}> = ({ joystickData, cameraRotation, jumpPressed, onMove, initialPos, targetPosRef, gamePhase, showCoords, role, settings, timer }) => {
  const { scene } = useThree();
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const isGrounded = useRef(false);
  const lastSendTime = useRef(0);
  const animationRef = useRef('Idle');
  const [visualAnimation, setVisualAnimation] = useState('Idle');
  const [coordText, setCoordText] = useState("");
  const downRaycaster = useRef(new THREE.Raycaster());
  const wallRaycaster = useRef(new THREE.Raycaster());
  const playerGroupRef = useRef<THREE.Group>(null);
  const modelRotationGroupRef = useRef<THREE.Group>(null);
  
  const GRAVITY = 18.0;   
  const JUMP_VELOCITY = 8.0; 

  // Sync position on reset
  useEffect(() => {
    velocity.current.set(0, 0, 0);
    if (pos.current.distanceTo(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z)) > 5.0) {
        pos.current.set(initialPos.x, initialPos.y, initialPos.z);
    }
  }, [initialPos.x, initialPos.y, initialPos.z]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);

    // --- HUNTER FREEZE ---
    let frozen = false;
    if (role === Role.HUNTER && gamePhase === GamePhase.IN_PROGRESS) {
        if ((settings.roundDuration - timer) < settings.headStartDuration) {
            frozen = true;
        }
    }

    const { x, y } = joystickData.current;
    const mapObject = scene.getObjectByName('ground-collider');
    const isMoving = !frozen && (Math.abs(x) > 0.1 || Math.abs(y) > 0.1);
    const moveSpeed = role === Role.HUNTER ? settings.hunterSpeed : settings.hiderSpeed;

    let moveX = 0;
    let moveZ = 0;

    if (isMoving) {
      const camYaw = cameraRotation.current.yaw;
      moveX = (Math.sin(camYaw) * y + Math.cos(camYaw) * x) * moveSpeed * dt;
      moveZ = (Math.cos(camYaw) * y + -Math.sin(camYaw) * x) * moveSpeed * dt;
      if (Math.abs(moveX) > 0.001 || Math.abs(moveZ) > 0.001) {
          const targetRotation = Math.atan2(moveX, moveZ);
          let deltaRot = targetRotation - rotation.current;
          while (deltaRot > Math.PI) deltaRot -= Math.PI * 2;
          while (deltaRot < -Math.PI) deltaRot += Math.PI * 2;
          rotation.current += deltaRot * 10 * dt; 
      }
    }

    // Collision & Gravity (Simplified for brevity - logic remains same as before)
    // ... [Collision Logic Here] ... 
    // Re-implementing simplified collision for stability
    let isBlocked = false;
    if (isMoving && mapObject) {
         const moveDir = new THREE.Vector3(moveX, 0, moveZ).normalize();
         const origin = pos.current.clone().add(new THREE.Vector3(0, 0.5, 0));
         wallRaycaster.current.set(origin, moveDir);
         wallRaycaster.current.far = 0.5;
         if (wallRaycaster.current.intersectObject(mapObject, true).length > 0) isBlocked = true;
    }
    if (!isBlocked) { pos.current.x += moveX; pos.current.z += moveZ; }

    // Ground Check
    let groundY = -100;
    if (mapObject) {
        downRaycaster.current.set(pos.current.clone().add(new THREE.Vector3(0,2,0)), new THREE.Vector3(0,-1,0));
        const hits = downRaycaster.current.intersectObject(mapObject, true);
        if (hits.length > 0 && hits[0].point.y > pos.current.y - 1.0) groundY = hits[0].point.y;
    }

    if (!frozen && jumpPressed.current && isGrounded.current) {
        velocity.current.y = JUMP_VELOCITY;
        isGrounded.current = false;
        jumpPressed.current = false;
    } else jumpPressed.current = false;

    if (pos.current.y > groundY + 0.1 || velocity.current.y > 0) {
        velocity.current.y -= GRAVITY * dt;
        pos.current.y += velocity.current.y * dt;
        isGrounded.current = false;
    } else {
        velocity.current.y = 0;
        pos.current.y = groundY;
        isGrounded.current = true;
    }
    
    if (pos.current.y < -20) pos.current.set((Math.random()*10)-5, 3, (Math.random()*10)-5);

    if (playerGroupRef.current) playerGroupRef.current.position.lerp(pos.current, 0.6);
    if (modelRotationGroupRef.current) modelRotationGroupRef.current.rotation.y = rotation.current;
    targetPosRef.current.copy(pos.current);

    const newAnim = !isGrounded.current ? 'Jump' : (isMoving && !isBlocked ? 'Run' : 'Idle');
    if (animationRef.current !== newAnim) {
        animationRef.current = newAnim;
        setVisualAnimation(newAnim);
    }
    if (showCoords) setCoordText(`X: ${pos.current.x.toFixed(1)}, Y: ${pos.current.y.toFixed(1)}`);

    const now = Date.now();
    if ((now - lastSendTime.current > 25) || animationRef.current !== newAnim) {
        onMove(pos.current, rotation.current, animationRef.current);
        lastSendTime.current = now;
    }
  });

  return (
    <group ref={playerGroupRef} position={[initialPos.x, initialPos.y, initialPos.z]}>
        <group ref={modelRotationGroupRef}>
            <PlayerModel position={{x:0,y:0,z:0}} rotation={0} animation={visualAnimation} />
        </group>
        {role === Role.HUNTER && (
             <SpotLight position={[0, 10, 0]} angle={0.7} penumbra={0.2} distance={settings.hunterVisionRadius} attenuation={5} anglePower={5} intensity={5} color="white" castShadow target={playerGroupRef.current || undefined} />
        )}
        {showCoords && <Html position={[0, 2.2, 0]} center><div className="bg-black/70 text-green-400 text-xs px-2 rounded font-mono">{coordText}</div></Html>}
    </group>
  );
};

// --- SPECTATOR ---
const SpectatorController: React.FC<{ targetId: string | null; players: Record<string, PlayerState>; targetPosRef: React.MutableRefObject<THREE.Vector3>; }> = ({ targetId, players, targetPosRef }) => {
    useFrame((_, delta) => {
        if (targetId && players[targetId]) targetPosRef.current.lerp(new THREE.Vector3(players[targetId].position.x, players[targetId].position.y, players[targetId].position.z), 10 * delta);
    });
    return null;
}

// --- MAIN SCENE ---
export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, jumpPressed, players, myId, spectatingId, gamePhase, showCoords, settings, taskSpawns, timer }) => {
  const [dpr, setDpr] = useState(1.5); 
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  const isSpectating = !myId || !players[myId] || players[myId].role === Role.SPECTATOR || players[myId].isDead;
  const isHunter = myId && players[myId]?.role === Role.HUNTER;

  const handlePlayerMove = useCallback((pos: Vector3, rot: number, anim: string) => { socket.emit('move', pos, rot, anim); }, []);

  // Use default if roundDuration is missing (for older configs)
  const safeRoundDur = settings.roundDuration || 300;
  const safeHeadStart = settings.headStartDuration || 15;

  return (
    <>
      <Canvas dpr={dpr} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.8 }} shadows>
        <PerformanceMonitor onIncline={() => setDpr(1.5)} onDecline={() => setDpr(1)} />
        <PerspectiveCamera makeDefault position={[0, 20, 20]} fov={60} far={100} onUpdate={c => c.lookAt(0, 0, 0)}/>

        {isHunter ? (
             <>
                 {/* HUNTER VISION FIX: Ambient light is low (0.3) so he can see nearby objects dimly.
                     Spotlight on player illuminates immediate area.
                     Fog starts AFTER vision radius to hide distant runners. */}
                 <fog attach="fog" args={['#000000', settings.hunterVisionRadius - 5, settings.hunterVisionRadius + 5]} />
                 <color attach="background" args={['#000000']} />
                 <ambientLight intensity={0.3} /> 
             </>
        ) : (
            <>
                <fog attach="fog" args={['#eefbff', 20, 80]} />
                <color attach="background" args={['#eefbff']} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[50, 80, 30]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0001}/>
                <Sky sunPosition={[100, 20, 100]} turbidity={0.5} />
            </>
        )}
        
        <Suspense fallback={null}>
          <ModelErrorBoundary>
            <MapModel />
            {Object.values(players).map((p: PlayerState) => { if (p.id === myId) return null; return <RemotePlayer key={p.id} data={p} />; })}
            
            {!isSpectating ? (
                <PlayerController 
                    joystickData={joystickData} cameraRotation={cameraRotation} jumpPressed={jumpPressed}
                    onMove={handlePlayerMove} initialPos={players[myId].position} targetPosRef={cameraTargetRef}
                    gamePhase={gamePhase} showCoords={showCoords} role={players[myId].role} settings={settings}
                    timer={timer}
                />
            ) : (
                <SpectatorController targetId={spectatingId} players={players} targetPosRef={cameraTargetRef} />
            )}

            <CameraController 
                targetPos={cameraTargetRef} cameraRotation={cameraRotation} 
                isHunter={!!isHunter} gamePhase={gamePhase} timer={timer} 
                roundDuration={safeRoundDur} headStartDuration={safeHeadStart}
            />

            {/* RENDER TASKS */}
            {taskSpawns.map(task => (
                <TaskHologram key={task.id} type={task.type} position={task.position} />
            ))}
            
          </ModelErrorBoundary>
        </Suspense>
      </Canvas>
      <Loader containerStyles={{ background: 'black' }} />
    </>
  );
};
