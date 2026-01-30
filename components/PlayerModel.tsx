import React, { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useGraph, ThreeElements } from '@react-three/fiber';
import { Vector3 } from '../types';
import { Group, LoopOnce, LoopRepeat, Mesh, AnimationAction } from 'three';
import { SkeletonUtils } from 'three-stdlib';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

interface PlayerModelProps {
  position: Vector3;
  rotation: number;
  animation?: string; // 'idle' | 'run' | 'jump'
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, animation = 'idle' }) => {
  const group = useRef<Group>(null);
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
        // Optimization: Disable frustum culling for animated meshes to prevent flickering at edges
        object.frustumCulled = false; 
      }
    });
  }, [clone]);

  // ANIMATION LOGIC
  useEffect(() => {
    if (actions) {
        // EXACT NAMES FROM YOUR SCREENSHOT:
        // "Run", "Idle", "Jump", "Walk"
        
        const actionNames = {
            idle: 'Idle',
            run: 'Run',
            jump: 'Jump',
            walk: 'Walk'
        };

        // Determine which animation to play based on prop
        let targetName = actionNames.idle; // Default

        if (animation === 'run') {
            targetName = actionNames.run;
        } else if (animation === 'jump') {
            targetName = actionNames.jump;
        } else if (animation === 'walk') {
            targetName = actionNames.walk;
        }

        // Fallback checks if exact name doesn't exist (safety)
        if (!actions[targetName]) {
             // Try case-insensitive search if "Run" isn't found
             const found = Object.keys(actions).find(key => key.toLowerCase() === animation.toLowerCase());
             if (found) targetName = found;
        }

        const currentAction = actions[targetName];
        
        if (currentAction && (targetName !== previousAction.current || animation === 'jump')) {
            
            // Fade out all other actions
            Object.values(actions).forEach((action: any) => {
                if (action !== currentAction) {
                    action.fadeOut(0.2);
                }
            });

            currentAction.reset().fadeIn(0.2).play();

            if (animation === 'jump') {
                currentAction.setLoop(LoopOnce, 1);
                currentAction.clampWhenFinished = true;
            } else {
                currentAction.setLoop(LoopRepeat, Infinity);
            }

            previousAction.current = targetName;
        }
    }
  }, [animation, actions]);

  return (
    <group ref={group} position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
      <primitive object={clone} scale={1} />
      {/* Shadow Blob for weak devices instead of real shadow if needed */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.5, 16]} />
        <meshBasicMaterial color="#000000" opacity={0.3} transparent depthWrite={false} />
      </mesh>
    </group>
  );
};

useGLTF.preload('/models/character.gltf');