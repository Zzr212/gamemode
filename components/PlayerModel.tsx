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
  
  // CHANGED: Load .gltf instead of .glb
  const gltf = useGLTF('/models/character.gltf', undefined, undefined, (loader) => {
     loader.manager.onError = (url) => console.warn(`Failed to load ${url}`);
  }) as any;

  const scene = gltf?.scene;
  const animations = gltf?.animations || [];

  // Setup Animations
  const { actions } = useAnimations(animations, group);

  // Clone scene to allow multiple instances
  const clonedScene = useMemo(() => scene ? scene.clone() : null, [scene]);

  useEffect(() => {
    if (actions && clonedScene) {
        // Animation Mapping
        // We look for 'idle' and 'run' specifically by name if possible, 
        // otherwise fallback to index 0 and 1.
        
        const idleAction = actions['idle'] || actions[Object.keys(actions)[0]];
        // CHANGED: Look for 'run' animation for movement
        const runAction = actions['run'] || actions['walk'] || actions[Object.keys(actions)[1]]; 

        if (!idleAction) return;

        // Cleanup function to fade out old actions
        const fadeDuration = 0.2;

        if (animation === 'walk') {
            // "Walk" state now triggers "Run" animation
            if (runAction) {
                runAction.reset().fadeIn(fadeDuration).play();
                idleAction.fadeOut(fadeDuration);
            }
        } else {
            idleAction.reset().fadeIn(fadeDuration).play();
            if (runAction) runAction.fadeOut(fadeDuration);
        }

        return () => {
            // Optional: stop on unmount or change
        };
    }
  }, [animation, actions, clonedScene]);

  return (
    <group ref={group} position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
      {clonedScene ? (
        <primitive object={clonedScene} scale={1} />
      ) : (
        // Fallback mesh
        <mesh position={[0, 1, 0]}>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
          <meshStandardMaterial color={isSelf ? "#00ff00" : (color || "#ff0000")} />
        </mesh>
      )}
      
      {/* Shadow blob */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.3} transparent />
      </mesh>
    </group>
  );
};

// Preload
useGLTF.preload('/models/character.gltf');