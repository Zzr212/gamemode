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
        
        // Robust case-insensitive matcher
        const getActionKey = (query: string) => {
             const lowerQuery = query.toLowerCase();
             // 1. Check exact or lowercase match
             const exact = allActions.find(key => key.toLowerCase() === lowerQuery);
             if (exact) return exact;
             
             // 2. Check partial match (e.g. "Armature|Run" matches "run")
             const partial = allActions.find(key => key.toLowerCase().includes(lowerQuery));
             return partial;
        };

        // Determine target action based on prop
        let targetKey: string | undefined = undefined;

        if (animation.toLowerCase() === 'run') {
            targetKey = getActionKey('Run') || getActionKey('Sprint') || getActionKey('Walk');
        } else if (animation.toLowerCase() === 'jump') {
            targetKey = getActionKey('Jump');
        } else {
            targetKey = getActionKey('Idle') || getActionKey('Stand') || getActionKey('Wait');
        }

        // Fallback: If no match found, use the first available animation
        if (!targetKey && allActions.length > 0) {
            targetKey = allActions[0];
        }

        if (targetKey && actions[targetKey]) {
            const currentAction = actions[targetKey];
            const prevKey = previousAction.current;

            // Only transition if the animation key changed OR if it's a jump (which needs reset)
            if (currentAction && (targetKey !== prevKey || animation.toLowerCase() === 'jump')) {
                
                // Fade out all other actions
                allActions.forEach(key => {
                    if (key !== targetKey && actions[key]) {
                        actions[key]?.fadeOut(0.2);
                    }
                });

                // Play new action
                currentAction.reset().fadeIn(0.2).play();

                if (animation.toLowerCase() === 'jump') {
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