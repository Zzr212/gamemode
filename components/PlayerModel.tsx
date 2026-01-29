import React, { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { Vector3 } from '../types';
import * as THREE from 'three';
import { ThreeElements } from '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

interface PlayerModelProps {
  position: Vector3;
  rotation: number;
  isSelf?: boolean;
  color?: string;
  animation?: string; // 'idle' | 'walk'
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, isSelf, color, animation = 'idle' }) => {
  const group = useRef<THREE.Group>(null);
  
  // Use a try-catch pattern via the loader callback to avoid hard crashes
  const gltf = useGLTF('/models/character.glb', undefined, undefined, (loader) => {
     loader.manager.onError = (url) => console.warn(`Failed to load ${url}`);
  }) as any;

  const scene = gltf?.scene;
  const animations = gltf?.animations || [];

  // Setup Animations
  const { actions } = useAnimations(animations, group);

  // Clone scene to allow multiple instances (players) to have independent animations
  const clonedScene = useMemo(() => scene ? scene.clone() : null, [scene]);

  useEffect(() => {
    if (actions && clonedScene) {
        // MAPPING:
        // Animation 0: Idle
        // Animation 1: Walk
        
        const actionKeys = Object.keys(actions);
        if (actionKeys.length === 0) return;

        const idleAction = actions[actionKeys[0]]; // First animation
        const walkAction = actions[actionKeys[1]] || idleAction; // Second animation (fallback to first)

        if (!idleAction) return;

        // Reset all
        idleAction.stop();
        if (walkAction !== idleAction) walkAction?.stop();

        if (animation === 'walk' && walkAction) {
            walkAction.reset().fadeIn(0.2).play();
        } else {
            idleAction.reset().fadeIn(0.2).play();
        }

        return () => {
            idleAction.fadeOut(0.2);
            if (walkAction !== idleAction) walkAction?.fadeOut(0.2);
        };
    }
  }, [animation, actions, clonedScene]);

  return (
    <group ref={group} position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
      {clonedScene ? (
        <primitive object={clonedScene} scale={1} />
      ) : (
        // Fallback mesh if GLB not loaded
        <mesh position={[0, 1, 0]}>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
          <meshStandardMaterial color={isSelf ? "#00ff00" : (color || "#ff0000")} />
        </mesh>
      )}
      
      {/* Simple shadow blob */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.3} transparent />
      </mesh>
    </group>
  );
};

// Preload to avoid pop-in
useGLTF.preload('/models/character.glb');