import 'react';

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
  isAdmin?: boolean; // Persistent Admin Flag
}

export interface PlayerState {
  id: string; // Socket ID (temporary session)
  userId: string; // Persistent Account ID
  username: string;
  deviceId: string; // Persistent Device ID (fallback)
  position: Vector3;
  rotation: number;
  animation: string;
  color: string;
  role: Role;
  isDead: boolean;
  isAdmin?: boolean; 
  isDisconnected: boolean;
  disconnectTime?: number;
}

export interface GameSettings {
  hunterSpeed: number;
  hiderSpeed: number;
  hunterVisionRadius: number; // Distance of the light
  hunterVisionAngle: number; // Width of the cone (if using cone) or general intensity
}

export interface GameStateData {
  phase: GamePhase;
  timer: number; // seconds
  survivors: number; // Active hiders count
  settings: GameSettings; // Sync settings to client
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
  // Admin events
  toggleLocationDisplay: (show: boolean) => void;
  toggleAdminPanel: (show: boolean) => void;
  settingsUpdated: (settings: GameSettings) => void;
}

export interface ClientToServerEvents {
  move: (position: Vector3, rotation: number, animation: string) => void;
  pingSync: (callback: () => void) => void;
  requestGameStart: () => void; 
  attemptKill: () => void; 
  chatMessage: (text: string) => void; 
  leaveGame: () => void; 
  // Admin
  updateSettings: (settings: GameSettings) => void;
  banPlayer: (username: string) => void;
}

export interface JoystickData {
  x: number; // -1 to 1
  y: number; // -1 to 1
}

// React Three Fiber JSX elements augmentation
declare module 'react' {
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
}
