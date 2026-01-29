import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { JoystickData, PlayerState, Vector3 } from '../types';
import { PlayerModel } from './PlayerModel';
import { MapModel } from './MapModel';
import { socket } from '../services/socketService';

interface GameSceneProps {
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  players: Record<string, PlayerState>;
  myId: string | null;
}

const CameraController: React.FC<{
  targetPosition: Vector3;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
}> = ({ targetPosition, cameraRotation }) => {
  const { camera } = useThree();
  const currentPos = useRef(new THREE.Vector3(0, 5, 10));

  useFrame(() => {
    // Convert rotation to quaternion/vectors
    // Yaw rotates around Y axis
    // Pitch rotates around local X axis (clamped usually)
    
    // We want the camera to look at the player + offset
    // 3rd Person Offset: Behind and slightly up
    const distance = 8;
    const height = 3;
    const sideOffset = 1.5; // "Character moved little left side on camera" means camera is to the right? Or player is to the left? 
                            // Usually means camera looks over right shoulder (camera is right of player), 
                            // which puts player on left side of screen.

    const yaw = cameraRotation.current.yaw;
    const pitch = Math.max(-0.5, Math.min(1.0, cameraRotation.current.pitch)); // Clamp pitch

    // Calculate camera position relative to target
    // Spherical coordinates logic
    const hDist = distance * Math.cos(pitch);
    const vDist = distance * Math.sin(pitch);

    const offsetX = Math.sin(yaw) * hDist;
    const offsetZ = Math.cos(yaw) * hDist;

    // Target vector (Player Head)
    const targetVec = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.5, targetPosition.z);

    // Apply side offset (Right shoulder view)
    // Right vector relative to yaw
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    
    const camPos = new THREE.Vector3(
        targetVec.x + offsetX + (rightX * sideOffset), 
        targetVec.y + height + vDist, 
        targetVec.z + offsetZ + (rightZ * sideOffset)
    );

    // Smooth camera movement
    currentPos.current.lerp(camPos, 0.1);
    camera.position.copy(currentPos.current);
    
    // Look at the target (slightly offset to keep player on left)
    // Actually, looking directly at targetVec while physically offset creates the "over the shoulder" effect.
    camera.lookAt(targetVec);
  });

  return null;
};

const PlayerController: React.FC<{
  joystickData: React.MutableRefObject<JoystickData>;
  cameraRotation: React.MutableRefObject<{ yaw: number; pitch: number }>;
  onMove: (pos: Vector3, rot: number) => void;
  initialPos: Vector3;
}> = ({ joystickData, cameraRotation, onMove, initialPos }) => {
  const pos = useRef(new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z));
  const rotation = useRef(0);
  const speed = 0.15;

  useFrame(() => {
    const { x, y } = joystickData.current;
    
    if (Math.abs(x) > 0.05 || Math.abs(y) > 0.05) {
      // Movement direction relative to Camera Yaw
      const camYaw = cameraRotation.current.yaw;
      
      // Joystick Y is up/down (-1 is up usually, depends on joystick impl). 
      // In our Joystick.tsx: y is positive down. So -y is forward.
      const forward = -y;
      const strafe = x;

      // Calculate direction vector based on camera angle
      const forwardX = Math.sin(camYaw) * forward;
      const forwardZ = Math.cos(camYaw) * forward;
      
      const rightX = Math.cos(camYaw) * strafe;
      const rightZ = -Math.sin(camYaw) * strafe;

      const moveX = forwardX + rightX;
      const moveZ = forwardZ + rightZ;

      pos.current.x += moveX * speed;
      pos.current.z += moveZ * speed;

      // Character Rotation: Face movement direction
      // Atan2(x, z) gives angle from Z axis
      if (moveX !== 0 || moveZ !== 0) {
        rotation.current = Math.atan2(moveX, moveZ);
      }

      // Sync with server (throttling handled by React update batching or socket implementation)
      // For smoothness, we usually emit less frequently, but for this demo, direct emit is easiest.
      // Better: Emit in a setInterval outside, but here is fine for prototype.
      onMove(pos.current, rotation.current);
    }
  });

  return (
    <>
      <PlayerModel position={pos.current} rotation={rotation.current} isSelf />
      <CameraController targetPosition={pos.current} cameraRotation={cameraRotation} />
    </>
  );
};

export const GameScene: React.FC<GameSceneProps> = ({ joystickData, cameraRotation, players, myId }) => {
  
  const handlePlayerMove = (pos: Vector3, rot: number) => {
    socket.emit('move', pos, rot);
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

      <MapModel />

      {/* Render Other Players */}
      {Object.values(players).map((p) => {
        if (p.id === myId) return null; // Don't render self from server state (latency)
        return <PlayerModel key={p.id} position={p.position} rotation={p.rotation} color={p.color} />;
      })}

      {/* Render Self with Client Prediction/Control */}
      {myId && players[myId] && (
        <PlayerController 
            joystickData={joystickData} 
            cameraRotation={cameraRotation} 
            onMove={handlePlayerMove}
            initialPos={players[myId].position}
        />
      )}
    </Canvas>
  );
};
