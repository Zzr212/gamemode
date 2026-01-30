export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  position: Vector3;
  rotation: number; // Y-axis rotation in radians
  animation: string; // 'idle' | 'walk' | 'run' | 'jump'
  color: string; // Helper for visual distinction if model fails
}

export interface ServerToClientEvents {
  currentPlayers: (players: Record<string, PlayerState>) => void;
  newPlayer: (player: PlayerState) => void;
  playerMoved: (player: PlayerState) => void;
  playerDisconnected: (id: string) => void;
}

export interface ClientToServerEvents {
  move: (position: Vector3, rotation: number, animation: string) => void;
}

export interface JoystickData {
  x: number; // -1 to 1
  y: number; // -1 to 1
}