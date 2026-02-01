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

export interface PlayerState {
  id: string;
  position: Vector3;
  rotation: number;
  animation: string;
  color: string;
  role: Role;
  isDead: boolean;
}

export interface GameStateData {
  phase: GamePhase;
  timer: number; // seconds
}

export interface ServerToClientEvents {
  currentPlayers: (players: Record<string, PlayerState>) => void;
  newPlayer: (player: PlayerState) => void;
  playerMoved: (player: PlayerState) => void;
  playerDisconnected: (id: string) => void;
  gameStateUpdate: (data: GameStateData) => void;
  playerKilled: (victimId: string) => void;
  roleAssigned: (role: Role) => void;
  gameMessage: (msg: string) => void; // "Hiders Win", "Hunter Wins"
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