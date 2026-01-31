import React, { useEffect, useMemo, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useGraph } from '@react-three/fiber';
import { Vector3 } from '../types';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

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
    // FIX: Optimized Weapon Filtering
    // Logic: Find FIRST rifle-like object, make it visible. Hide EVERYTHING else that looks like a prop.
    let mainWeaponFound = false;

    clone.traverse((object: any) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false; 
        
        const name = object.name.toLowerCase();
        
        // Keywords for items to ALWAYS hide if not the chosen weapon
        const unwantedKeywords = [
            'sword', 'shield', 'axe', 'shovel', 'pickaxe', 'pistol', 'bow', 'dagger', 'spear', 
            'hammer', 'mace', 'club', 'staff', 'wand', 'knife', 'tool', 'prop', 'item', 
            'bag', 'backpack', 'helmet', 'hat' // Added accessories to be safe, remove if you want hats
        ];
        
        // Keywords for the Primary Weapon we want to keep
        const wantedKeywords = ['rifle', 'gun', 'ak', 'smg', 'carbine', 'sniper'];

        const isWanted = wantedKeywords.some(w => name.includes(w));
        const isUnwanted = unwantedKeywords.some(u => name.includes(u));

        if (isWanted) {
            if (!mainWeaponFound) {
                // Found our main gun!
                object.visible = true;
                mainWeaponFound = true;
            } else {
                // Already have a gun, hide duplicates
                object.visible = false;
            }
        } else if (isUnwanted) {
            // Hide all secondary trash
            object.visible = false;
        }
        // If it's not in either list (like Body, Head, Arm), it stays visible by default
      }
    });
  }, [clone]);

  // ANIMATION LOGIC
  useEffect(() => {
    if (actions) {
        const allActions = Object.keys(actions);
        
        const getActionKey = (query: string) => {
             if (!query) return undefined;
             const lowerQuery = query.toLowerCase();
             const exact = allActions.find(key => key.toLowerCase() === lowerQuery);
             if (exact) return exact;
             const partial = allActions.find(key => key.toLowerCase().includes(lowerQuery));
             return partial;
        };

        let targetKey: string | undefined = undefined;

        if (animation.toLowerCase() === 'run') {
            targetKey = getActionKey('Run') || getActionKey('Sprint') || getActionKey('Walk');
        } else if (animation.toLowerCase() === 'jump') {
            targetKey = getActionKey('Jump') || getActionKey('Fall'); // Fallback to fall if no jump
        } else {
            targetKey = getActionKey('Idle') || getActionKey('Stand') || getActionKey('Wait');
        }

        if (!targetKey && allActions.length > 0) {
            targetKey = allActions[0];
        }

        if (targetKey && actions[targetKey]) {
            const currentAction = actions[targetKey];
            const prevKey = previousAction.current;

            if (currentAction && (targetKey !== prevKey || animation.toLowerCase() === 'jump' || !currentAction.isRunning())) {
                
                allActions.forEach(key => {
                    if (key !== targetKey && actions[key]) {
                        actions[key]?.fadeOut(0.2);
                    }
                });

                currentAction.reset().fadeIn(0.2).play();

                if (animation.toLowerCase() === 'jump') {
                    // Make jump snappier
                    currentAction.setLoop(THREE.LoopOnce, 1);
                    currentAction.clampWhenFinished = true;
                } else {
                    currentAction.setLoop(THREE.LoopRepeat, Infinity);
                    // Sync Run speed if needed
                    if(animation.toLowerCase() === 'run') {
                        currentAction.timeScale = 1.2; // Slightly faster animation for better feel
                    } else {
                        currentAction.timeScale = 1;
                    }
                }

                previousAction.current = targetKey;
            }
        }
    }
  }, [animation, actions]);

  return (
    <group ref={group} position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
      <primitive object={clone} scale={1} />
      {/* Simple shadow blob */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.4} transparent />
      </mesh>
    </group>
  );
};

useGLTF.preload('/models/character.gltf');