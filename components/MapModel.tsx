import React from 'react';
import { useGLTF } from '@react-three/drei';

export const MapModel: React.FC = () => {
  // NOTE: You must place 'map.glb' in the /public folder.
  const { scene } = useGLTF('/map.glb', undefined, undefined, (loader) => {
      loader.manager.onError = (url) => console.warn(`Could not load ${url}, ensure file is in public folder.`);
  }) as any;

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

useGLTF.preload('/map.glb');
