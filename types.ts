export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export enum GamePhase {
  WAITING = 'WAITING',
  COUNTDOWN = 'COUNTDOWN',
  IN_PROGRESS = 'IN_PROGRESS',
  GAME_OVER = 'GAME_OVER'
}

export enum Role {
  NONE = 'NONE',
  HUNTER = 'HUNTER',
  HIDER = 'HIDER',
  SPECTATOR = 'SPECTATOR'
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
}

export interface PlayerState {
  id: string; // Socket ID
  userId: string; // Persistent Account ID
  username: string;
  deviceId: string; 
  position: Vector3;
  rotation: number;
  animation: string;
  color: string;
  role: Role;
  isDead: boolean;
  isAdmin?: boolean; // New Developer Status
  isDisconnected?: boolean; // Handle disconnection state
}

export interface GameStateData {
  phase: GamePhase;
  timer: number;
  survivors: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  isSystem: boolean;
  timestamp: number;
}

export interface ServerToClientEvents {
  currentPlayers: (players: Record<string, PlayerState>) => void;
  newPlayer: (player: PlayerState) => void;
  playerMoved: (player: PlayerState) => void;
  playerDisconnected: (id: string) => void;
  gameStateUpdate: (data: GameStateData) => void;
  playerKilled: (victimId: string) => void;
  roleAssigned: (role: Role) => void;
  gameMessage: (msg: string) => void; 
  chatMessage: (msg: ChatMessage) => void; 
  forceDisconnect: (reason: string) => void;
  forceRefresh: () => void; // New event for server shutdown
}

export interface ClientToServerEvents {
  move: (position: Vector3, rotation: number, animation: string) => void;
  pingSync: (callback: () => void) => void;
  requestGameStart: () => void; 
  attemptKill: () => void; 
  chatMessage: (text: string) => void; 
  leaveGame: () => void; 
}

export interface JoystickData {
  x: number; // -1 to 1
  y: number; // -1 to 1
}

// React Three Fiber JSX elements augmentation
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      primitive: any;
      mesh: any;
      instancedMesh: any;
      boxGeometry: any;
      circleGeometry: any;
      sphereGeometry: any;
      ringGeometry: any;
      planeGeometry: any;
      meshBasicMaterial: any;
      meshStandardMaterial: any;
      ambientLight: any;
      directionalLight: any;
      pointLight: any;
      spotLight: any;
      fog: any;
      color: any;
      [elemName: string]: any;
    }
  }
  
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        group: any;
        primitive: any;
        mesh: any;
        instancedMesh: any;
        boxGeometry: any;
        circleGeometry: any;
        sphereGeometry: any;
        ringGeometry: any;
        planeGeometry: any;
        meshBasicMaterial: any;
        meshStandardMaterial: any;
        ambientLight: any;
        directionalLight: any;
        pointLight: any;
        spotLight: any;
        fog: any;
        color: any;
        [elemName: string]: any;
      }
    }
  }
}