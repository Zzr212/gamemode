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
  animation?: string; // 'Idle' | 'Run' | 'Jump'
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, animation = 'Idle' }) => {
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
        // console.log("Available animations on model:", allActions); // Uncomment to debug

        // Helper: Find matching action key case-insensitively
        const getActionKey = (query: string) => {
             // 1. Exact match
             if (actions[query]) return query;
             // 2. Case insensitive match
             const found = allActions.find(key => key.toLowerCase() === query.toLowerCase());
             if (found) return found;
             // 3. Partial match (e.g. "Armature|Run" matches "Run")
             const partial = allActions.find(key => key.toLowerCase().includes(query.toLowerCase()));
             return partial;
        };

        // Determine target action based on prop
        let targetKey: string | undefined = undefined;

        if (animation === 'Run') {
            targetKey = getActionKey('Run') || getActionKey('Sprint') || getActionKey('Walk');
        } else if (animation === 'Jump') {
            targetKey = getActionKey('Jump');
        } else {
            targetKey = getActionKey('Idle') || getActionKey('Stand');
        }

        // Fallback: If no match found, use the first available animation
        if (!targetKey && allActions.length > 0) {
            targetKey = allActions[0];
        }

        if (targetKey && actions[targetKey]) {
            const currentAction = actions[targetKey];
            const prevKey = previousAction.current;

            // Fix TS18047: Ensure currentAction is not null before using it
            if (currentAction && (targetKey !== prevKey || animation === 'Jump')) {
                
                // Fade out all other actions
                allActions.forEach(key => {
                    if (key !== targetKey && actions[key]) {
                        actions[key]?.fadeOut(0.2);
                    }
                });

                // Play new action
                currentAction.reset().fadeIn(0.2).play();

                if (animation === 'Jump') {
                    currentAction.setLoop(THREE.LoopOnce, 1);
                    currentAction.clampWhenFinished = true;
                } else {
                    currentAction.setLoop(THREE.LoopRepeat, Infinity);
                }

                previousAction.current = targetKey;
            }
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