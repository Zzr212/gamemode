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

export enum TaskType {
  WIRES = 'Fix Wires',
  DOWNLOAD = 'Download Data',
  ANTENNA = 'Repair Antenna',
  REFUEL = 'Refuel Engine',
  UNLOCK = 'Unlock Manifold',
  SHIELDS = 'Prime Shields'
}

export interface TaskLocation {
  id: string;
  type: TaskType;
  position: Vector3;
}

export interface PlayerTask {
  id: string; // Unique instance ID
  type: TaskType;
  locationId: string;
  position: Vector3;
  completed: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  isAdmin?: boolean; 
}

export interface PlayerState {
  id: string; 
  userId: string; 
  username: string;
  deviceId: string; 
  position: Vector3;
  rotation: number;
  animation: string;
  color: string;
  role: Role;
  isDead: boolean;
  isAdmin?: boolean; 
  isDisconnected: boolean;
  disconnectTime?: number;
  tasks: PlayerTask[]; // Assigned tasks
}

export interface GameSettings {
  hunterSpeed: number;
  hiderSpeed: number;
  hunterVisionRadius: number; 
  hunterVisionAngle: number;
  roundDuration: number; // Seconds
  headStartDuration: number; // Seconds (Hunter freeze time)
}

export interface GameStateData {
  phase: GamePhase;
  timer: number; 
  survivors: number; 
  settings: GameSettings;
  taskSpawns: TaskLocation[]; // For Admin visualization
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
  toggleLocationDisplay: (show: boolean) => void;
  toggleAdminPanel: (show: boolean) => void;
  settingsUpdated: (settings: GameSettings) => void;
  taskCompleted: (playerId: string, taskId: string) => void;
}

export interface ClientToServerEvents {
  move: (position: Vector3, rotation: number, animation: string) => void;
  requestGameStart: () => void; 
  attemptKill: () => void; 
  chatMessage: (text: string) => void; 
  leaveGame: () => void; 
  updateSettings: (settings: GameSettings) => void;
  banPlayer: (username: string) => void;
  // Task Logic
  completeTask: (taskId: string) => void;
  addTaskSpawn: (type: TaskType, position: Vector3) => void;
  removeTaskSpawn: (spawnId: string) => void;
}

export interface JoystickData {
  x: number; 
  y: number; 
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
