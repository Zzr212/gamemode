import React, { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useGraph } from '@react-three/fiber';
import { Vector3 } from '../types';
import * as THREE from 'three';
import { clone as cloneGLTF } from 'three-stdlib';
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

  // Deep clone
  const clone = useMemo(() => cloneGLTF(scene), [scene]);
  
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
        
        // DEBUG: Print animations to console so user can verify names
        // Check your browser console to see what your model actually has!
        // console.log("Available Animations:", allActions);

        // Helper: Case insensitive partial match
        const findAction = (query: string) => 
            allActions.find(key => key.toLowerCase().includes(query.toLowerCase()));

        // MAPPING
        const jumpKey = findAction('jump');
        
        // Fix: Broaden search for run. Look for 'run', 'sprint', 'fast', or fallback to 'walk'.
        const runKey = findAction('run') || findAction('sprint') || findAction('fast') || findAction('walk') || findAction('move');
        
        const idleKey = findAction('idle') || findAction('wait') || findAction('stand') || allActions[0];

        let targetKey = '';

        if (animation === 'jump' && jumpKey) {
            targetKey = jumpKey;
        } else if (animation === 'run') {
            // Explicitly requested run
            targetKey = runKey || idleKey || '';
        } else {
            // Default to idle
            targetKey = idleKey || '';
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