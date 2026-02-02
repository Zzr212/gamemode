import 'react';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export enum GamePhase {
  WAITING = 'WAITING',
  COUNTDOWN = 'COUNTDOWN',
  IN_PROGRESS = 'IN_PROGRESS'
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
  // New fields for reconnection logic
  isDisconnected: boolean;
  disconnectTime?: number;
}

export interface GameStateData {
  phase: GamePhase;
  timer: number; // seconds
  survivors: number; // Active hiders count
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
  forceDisconnect: (reason: string) => void; // New event to kick duplicates
}

export interface ClientToServerEvents {
  move: (position: Vector3, rotation: number, animation: string) => void;
  pingSync: (callback: () => void) => void;
  requestGameStart: () => void; // Player joining from menu
  attemptKill: () => void; // Hunter clicking kill button
}

export interface JoystickData {
  x: number; // -1 to 1
  y: number; // -1 to 1
}

// React Three Fiber JSX elements
declare global {
  namespace JSX {
    interface IntrinsicElements {
      // Containers
      group: any;
      primitive: any;
      
      // Objects
      mesh: any;
      instancedMesh: any;
      
      // Geometries
      circleGeometry: any;
      sphereGeometry: any;
      ringGeometry: any;
      
      // Materials
      meshBasicMaterial: any;
      meshStandardMaterial: any;
      
      // Lights
      ambientLight: any;
      directionalLight: any;
      pointLight: any;
      spotLight: any;
      
      // Scene & Effects
      fog: any;
      color: any;

      // Catch-all
      [elemName: string]: any;
    }
  }
}