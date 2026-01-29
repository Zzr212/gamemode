import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Vector3 } from '../types';

interface PlayerModelProps {
  position: Vector3;
  rotation: number;
  isSelf?: boolean;
  color?: string;
}

export const PlayerModel: React.FC<PlayerModelProps> = ({ position, rotation, isSelf, color }) => {
  // Use a try-catch pattern for GLTF loading in a real app, 
  // or use ErrorBoundary. Here we attempt to load, but fallback to Box if it fails visually (React suspense handles actual load).
  // We use the 'useGLTF' hook. If the file doesn't exist, this might suspend indefinitely or error. 
  // For the purpose of this demo, we assume the user might not have put the file there yet, 
  // so we'll just code it to try to load but we can't easily catch hook errors inside the component body without boundary.
  
  // NOTE: You must place 'character.glb' in the /public folder.
  // Uncomment the line below if you have the file.
  const { scene } = useGLTF('/character.glb', undefined, undefined, (loader) => {
      // Very basic error handling suppression for the demo
      loader.manager.onError = (url) => console.warn(`Could not load ${url}, ensure file is in public folder.`);
  }) as any;

  // Clone scene so multiple players can use same asset
  const clonedScene = useMemo(() => scene ? scene.clone() : null, [scene]);

  return (
    <group position={[position.x, position.y, position.z]} rotation={[0, rotation, 0]}>
      {clonedScene ? (
        <primitive object={clonedScene} scale={1} />
      ) : (
        // Fallback mesh if GLB not loaded/found
        <mesh position={[0, 1, 0]}>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
          <meshStandardMaterial color={isSelf ? "#00ff00" : (color || "#ff0000")} />
        </mesh>
      )}
      {/* Simple shadow blob */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color="#000000" opacity={0.3} transparent />
      </mesh>
    </group>
  );
};

// Preload to avoid pop-in
useGLTF.preload('/character.glb');