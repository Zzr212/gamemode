import React, { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

export const MapModel: React.FC = () => {
  // Simple loading. Suspense in GameScene will handle the waiting time.
  const gltf = useGLTF('/models/map.glb') as any;
  const scene = gltf.scene;

  useEffect(() => {
    if (scene) {
        // Optimization: Traverse the map to enable shadows and identify it for physics
        scene.traverse((child: any) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Important: Ensure material is compatible with lighting
                if (child.material) {
                    child.material.side = THREE.DoubleSide; 
                }
            }
        });
    }
  }, [scene]);

  return (
    // We name this group 'ground-collider' so the PlayerController can find it to check for gravity
    <group name="ground-collider">
      <primitive object={scene} />
    </group>
  );
};

// Preload to start downloading immediately
useGLTF.preload('/models/map.glb');