import React, { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useGraph } from '@react-three/fiber';
import { Vector3 } from '../types';
import * as THREE from 'three';
// We need SkeletonUtils to properly clone skinned meshes (fixes parts staying behind)
import { SkeletonUtils } from 'three-stdlib';
import { ThreeElements } from '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

interface PlayerModelProps {
  position: Vector3;
  rotation: number;
  animation?: string; // 'idle' | 'walk' | 'run' | 'jump'
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, animation = 'idle' }) => {
  const group = useRef<THREE.Group>(null);
  const previousAction = useRef<string>('');
  
  const { scene, animations } = useGLTF('/models/character.gltf') as any;

  // CRITICAL FIX: Use SkeletonUtils.clone() to deep clone the model including SkinnedMesh relations.
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  
  useGraph(clone);
  
  // Setup Animations on the CLONED group
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

  useEffect(() => {
    if (actions) {
        const allActions = Object.keys(actions);
        
        // Helper to find action by name (case insensitive)
        const findAction = (query: string) => 
            allActions.find(key => key.toLowerCase().includes(query.toLowerCase()));

        // MAPPING LOGIC
        // 1. Jump
        const jumpKey = findAction('jump');
        // 2. Run / Walk (Prioritize Run if requested, but fallback to walk)
        const runKey = findAction('run') || findAction('sprint') || findAction('walk');
        
        // 3. Idle
        const idleKey = findAction('idle') || findAction('wait') || findAction('breath') || allActions[0];

        let targetKey = '';

        if (animation === 'jump' && jumpKey) {
            targetKey = jumpKey;
        } else if ((animation === 'run' || animation === 'walk') && runKey) {
            targetKey = runKey;
        } else {
            targetKey = idleKey || '';
        }

        const currentAction = actions[targetKey];
        
        // Only transition if the action actually changed or if it's a jump (which needs re-triggering)
        if (currentAction && (targetKey !== previousAction.current || animation === 'jump')) {
            
            // Fade out everyone else
            allActions.forEach(key => {
                if (key !== targetKey && actions[key]) {
                    actions[key]?.fadeOut(0.2);
                }
            });

            currentAction.reset().fadeIn(0.2).play();

            if (animation === 'jump') {
                currentAction.setLoop(THREE.LoopOnce, 1);
                currentAction.clampWhenFinished = true;
                
                // After jump finishes, we usually want to blend back to idle/run via the parent component updating state,
                // but setting clampWhenFinished helps it not snap back instantly.
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
      
      {/* Simple shadow blob for grounding */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.4} transparent />
      </mesh>
    </group>
  );
};

// Preload
useGLTF.preload('/models/character.gltf');