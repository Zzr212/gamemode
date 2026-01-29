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
  isSelf?: boolean;
  color?: string;
  animation?: string; // 'idle' | 'walk'
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, animation = 'idle' }) => {
  const group = useRef<THREE.Group>(null);
  
  // Load the GLTF
  // Removed 'materials' from destructuring as it was unused
  const { scene, animations } = useGLTF('/models/character.gltf') as any;

  // CRITICAL FIX: Use SkeletonUtils.clone() to deep clone the model including SkinnedMesh relations.
  // This fixes the bug where "helmet stays behind" while the body moves.
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  
  // useGraph creates a fresh object graph from the clone, needed for useAnimations to bind correctly
  // We call usageGraph to register the graph, but we don't need 'nodes' variable right now
  useGraph(clone);
  
  // Setup Animations on the CLONED group
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    // Traverse to enable shadows and fix frustum culling issues if mesh disappears
    clone.traverse((object: any) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        // Fix for models disappearing at certain angles
        object.frustumCulled = false; 
      }
    });
  }, [clone]);

  useEffect(() => {
    if (actions) {
        // --- SMART ANIMATION MAPPING ---
        // Instead of hardcoding keys, we search for them.
        const allActions = Object.keys(actions);
        
        // Helper to find action by name (case insensitive)
        const findAction = (query: string) => 
            allActions.find(key => key.toLowerCase().includes(query.toLowerCase()));

        // 1. Find correct clips
        const idleKey = findAction('idle') || findAction('wait') || allActions[0];
        const runKey = findAction('run') || findAction('walk') || allActions[1];
        
        const currentActionName = animation === 'walk' ? runKey : idleKey;
        const currentAction = actions[currentActionName || ''];

        // Stop all other actions to prevent mixing weirdness (like death loop)
        allActions.forEach(key => {
            if (key !== currentActionName && actions[key]) {
                actions[key]?.fadeOut(0.2);
            }
        });

        if (currentAction) {
            currentAction.reset().fadeIn(0.2).play();
            // Ensure Idle loops, Run loops. 
            // If you had a 'death' animation playing, it's likely because it was allActions[0] and LoopOnce.
            currentAction.setLoop(THREE.LoopRepeat, Infinity); 
        }

        return () => {
            // Cleanup not strictly necessary with fadeOut logic above, but good practice
        };
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