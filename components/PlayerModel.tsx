import React, { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useGraph, ThreeElements } from '@react-three/fiber';
import { Vector3 } from '../types';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {
        group: any;
        primitive: any;
        mesh: any;
        circleGeometry: any;
        meshBasicMaterial: any;
    }
  }
}

interface PlayerModelProps {
  position: Vector3;
  rotation: number;
  animation?: string; // 'idle' | 'run' | 'jump'
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, animation = 'idle' }) => {
  const group = useRef<THREE.Group>(null);
  const previousAction = useRef<string>('');
  
  const { scene, animations } = useGLTF('/models/character.gltf') as any;

  // Deep clone using SkeletonUtils to ensure SkinnedMesh works correctly
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  
  useGraph(clone);
  
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    clone.traverse((object: any) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false; 
      }
    });
  }, [clone]);

  // ANIMATION LOGIC
  useEffect(() => {
    if (actions) {
        const allActions = Object.keys(actions);
        
        // Helper: Case insensitive partial match
        const findAction = (query: string) => 
            allActions.find(key => key.toLowerCase().includes(query.toLowerCase()));

        // MAPPING
        // Fix 1: Explicitly check for "Run" as requested and ensure we use the string key
        const runKey = (actions['Run'] ? 'Run' : null) || findAction('Run') || findAction('run') || findAction('sprint');
        const jumpKey = (actions['Jump'] ? 'Jump' : null) || findAction('Jump') || findAction('jump');
        // Default idle fallback
        const idleKey = (actions['Idle'] ? 'Idle' : null) || findAction('Idle') || findAction('idle') || allActions[0];

        let targetKey = '';

        if (animation === 'jump' && jumpKey) {
            targetKey = jumpKey;
        } else if (animation === 'run') {
            targetKey = runKey || '';
        } else {
            targetKey = idleKey || '';
        }

        // Final safety check if targetKey is actually in actions
        // If not found, default to first available animation to prevent T-pose
        if (!actions[targetKey] && allActions.length > 0) {
            targetKey = allActions[0];
        }

        const currentAction = actions[targetKey];
        
        if (currentAction && (targetKey !== previousAction.current || animation === 'jump')) {
            
            // Fade out others
            allActions.forEach(key => {
                if (key !== targetKey && actions[key]) {
                    actions[key]?.fadeOut(0.2);
                }
            });

            currentAction.reset().fadeIn(0.2).play();

            if (animation === 'jump') {
                currentAction.setLoop(THREE.LoopOnce, 1);
                currentAction.clampWhenFinished = true;
            } else {
                currentAction.setLoop(THREE.LoopRepeat, Infinity);
            }

            previousAction.current = targetKey;
        }
    }
  }, [animation, actions]);

  return (
    <group ref={group} position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
      <primitive object={clone} scale={1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.4} transparent />
      </mesh>
    </group>
  );
};

useGLTF.preload('/models/character.gltf');