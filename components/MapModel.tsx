import React from 'react';
import { useGLTF } from '@react-three/drei';
import { ThreeElements } from '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

export const MapModel: React.FC = () => {
  let scene = null;
  
  // Safe load
  try {
      const gltf = useGLTF('/models/map.glb', undefined, undefined, (loader) => {
         loader.manager.onError = () => {};
      }) as any;
      scene = gltf.scene;
  } catch (e) {
      console.warn("Map GLB not loaded, using fallback");
  }

  return (
    <group>
      {scene ? (
        <primitive object={scene} />
      ) : (
        // Fallback map
        <group>
            {/* Ground */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
            <planeGeometry args={[100, 100]} />
            <meshStandardMaterial color="#333" />
            </mesh>
            {/* Grid helper for scale reference */}
            <gridHelper args={[100, 100]} />
            {/* Some obstacles */}
            <mesh position={[5, 1, 5]}>
                <boxGeometry args={[2, 2, 2]} />
                <meshStandardMaterial color="gray" />
            </mesh>
            <mesh position={[-5, 2, -5]}>
                <cylinderGeometry args={[1, 1, 4]} />
                <meshStandardMaterial color="gray" />
            </mesh>
        </group>
      )}
    </group>
  );
};
// Preload
useGLTF.preload('/models/map.glb');