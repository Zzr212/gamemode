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
  // Use try-catch block conceptually by relying on useGLTF's error handler
  let scene = null;
  try {
      const gltf = useGLTF('/character.glb', undefined, undefined, (loader) => {
         // Prevent console spam if missing
         loader.manager.onError = () => {}; 
      }) as any;
      scene = gltf.scene;
  } catch (e) {
      // If loading fails, scene remains null, fallback renders
      console.warn("Character GLB not loaded, using fallback");
  }

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

// Preload (optional, safe to remove if causing issues)
// useGLTF.preload('/character.glb');