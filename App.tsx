import { useEffect, useRef, useState } from 'react';
import { Joystick } from './components/Joystick';
import { TouchLook } from './components/TouchLook';
import { GameScene } from './components/GameScene';
import { MainMenu } from './components/MainMenu';
import { connectSocket, socket } from './services/socketService';
import { JoystickData, PlayerState, GamePhase, GameStateData, Role } from './types';

type AppState = 'MENU' | 'GAME';

function App() {
  const [appState, setAppState] = useState<AppState>('MENU');
  
  // Game Data
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  
  // Game State
  const [gamePhase, setGamePhase] = useState<GamePhase>(GamePhase.WAITING);
  const [timer, setTimer] = useState<number>(0);
  const [roleMessage, setRoleMessage] = useState<string | null>(null); // For splash screen
  const [spectatingIndex, setSpectatingIndex] = useState<number>(0);
  
  const [notifications, setNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number>(0);

  // Mutable refs
  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.5 });
  const jumpRef = useRef<boolean>(false);

  // Computed
  const myPlayer = myId ? players[myId] : null;
  const isSpectator = !myPlayer || myPlayer.role === Role.SPECTATOR || myPlayer.isDead;
  const isHunter = myPlayer?.role === Role.HUNTER && !myPlayer.isDead;

  // Active players for spectating
  const activePlayers = Object.values(players).filter(p => p.role !== Role.SPECTATOR && !p.isDead);

  // --- SOCKETS ---
  useEffect(() => {
    connectSocket();

    const onConnect = () => setMyId(socket.id || null);
    
    const onCurrentPlayers = (serverPlayers: Record<string, PlayerState>) => setPlayers(serverPlayers);
    
    const onNewPlayer = (player: PlayerState) => {
        setPlayers((prev) => ({ ...prev, [player.id]: player }));
        if(appState === 'GAME') addNotification(`Player joined`);
    };

    const onPlayerMoved = (player: PlayerState) => {
        setPlayers((prev) => ({ ...prev, [player.id]: player }));
    };

    const onPlayerDisconnected = (id: string) => {
        setPlayers((prev) => {
            const newPlayers = { ...prev };
            delete newPlayers[id];
            return newPlayers;
        });
        if(appState === 'GAME') addNotification(`Player left`);
    };

    const onGameStateUpdate = (data: GameStateData) => {
        setGamePhase(data.phase);
        setTimer(data.timer);
    };

    const onGameMessage = (msg: string) => {
        addNotification(msg);
        // Show big message
        setRoleMessage(msg);
        setTimeout(() => setRoleMessage(null), 4000);
    };

    const onPlayerKilled = (id: string) => {
        if (id === myId) {
            setRoleMessage("YOU DIED");
            setTimeout(() => setRoleMessage(null), 3000);
        } else {
            addNotification("A player has been killed!");
        }
    };

    socket.on('connect', onConnect);
    socket.on('currentPlayers', onCurrentPlayers);
    socket.on('newPlayer', onNewPlayer);
    socket.on('playerMoved', onPlayerMoved);
    socket.on('playerDisconnected', onPlayerDisconnected);
    socket.on('gameStateUpdate', onGameStateUpdate);
    socket.on('gameMessage', onGameMessage);
    socket.on('playerKilled', onPlayerKilled);

    // Ping
    const pingInterval = setInterval(() => {
        const start = Date.now();
        socket.emit('pingSync', () => {
            setPing(Date.now() - start);
        });
    }, 1000);

    return () => {
        socket.off('connect', onConnect);
        socket.off('currentPlayers', onCurrentPlayers);
        socket.off('newPlayer', onNewPlayer);
        socket.off('playerMoved', onPlayerMoved);
        socket.off('playerDisconnected', onPlayerDisconnected);
        socket.off('gameStateUpdate', onGameStateUpdate);
        socket.off('gameMessage', onGameMessage);
        socket.off('playerKilled', onPlayerKilled);
        clearInterval(pingInterval);
    };
  }, [appState, myId]);

  // Handle Role Splash logic locally when phase changes to In Progress
  useEffect(() => {
    if (gamePhase === GamePhase.IN_PROGRESS && myPlayer && !myPlayer.isDead && myPlayer.role !== Role.SPECTATOR) {
        const roleText = myPlayer.role === Role.HUNTER ? "YOU ARE THE HUNTER" : "HIDE!";
        setRoleMessage(roleText);
        setTimeout(() => setRoleMessage(null), 3000);
    }
  }, [gamePhase, myPlayer?.role]);

  const addNotification = (msg: string) => {
    setNotifications(prev => [...prev.slice(-4), msg]); 
    setTimeout(() => {
        setNotifications(prev => prev.slice(1));
    }, 3000);
  };

  const handleJoystickMove = (data: JoystickData) => {
    joystickRef.current = data;
  };

  const handleCameraRotate = (dx: number, dy: number) => {
    const sensitivity = 0.005;
    cameraRotationRef.current.yaw -= dx * sensitivity;
    const currentPitch = cameraRotationRef.current.pitch;
    const newPitch = currentPitch - dy * sensitivity;
    cameraRotationRef.current.pitch = Math.max(-1.2, Math.min(1.5, newPitch)); 
  };

  const handleJump = () => {
    jumpRef.current = true;
  };

  const handlePlayGame = () => {
      if (!socket.connected) connectSocket();
      setAppState('GAME');
      socket.emit('requestGameStart');
  };

  const handleKill = () => {
      if (isHunter) {
          socket.emit('attemptKill');
      }
  };

  const cycleSpectator = (dir: number) => {
      if (activePlayers.length === 0) return;
      let next = spectatingIndex + dir;
      if (next >= activePlayers.length) next = 0;
      if (next < 0) next = activePlayers.length - 1;
      setSpectatingIndex(next);
  };

  const getSpectatingId = () => {
      if (activePlayers.length === 0) return null;
      // Safety check
      if (spectatingIndex >= activePlayers.length) return activePlayers[0].id;
      return activePlayers[spectatingIndex].id;
  };

  const formatTime = (s: number) => {
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative select-none touch-none">
      
      {/* MENU */}
      {appState === 'MENU' && (
          <MainMenu onPlay={handlePlayGame} />
      )}

      {/* GAME */}
      {appState === 'GAME' && (
        <>
            {/* 3D Layer */}
            <div className="absolute inset-0 z-0">
                <GameScene 
                    joystickData={joystickRef} 
                    cameraRotation={cameraRotationRef} 
                    jumpPressed={jumpRef}
                    players={players} 
                    myId={myId}
                    spectatingId={isSpectator ? getSpectatingId() : null}
                />
            </div>

            {/* Role Reveal / Game Message Overlay */}
            {roleMessage && (
                <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,1)] animate-bounce text-center">
                        {roleMessage}
                    </h1>
                </div>
            )}

            {/* Crosshair (Hidden for spectator) */}
            {!isSpectator && (
                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,0.8)] z-10 pointer-events-none opacity-80" />
            )}

            {/* Top HUD */}
            <div className="absolute top-0 left-0 right-0 p-4 z-10 pointer-events-none flex justify-between items-start">
                <div className="flex flex-col gap-1">
                    {/* Ping */}
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm w-fit">
                        <div className={`w-2 h-2 rounded-full ${ping < 100 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-white text-xs font-mono">{ping} ms</span>
                    </div>
                    {/* Notifications */}
                    <div className="flex flex-col gap-1 mt-2">
                        {notifications.map((msg, i) => (
                            <div key={i} className="bg-black/50 text-white px-3 py-1 rounded-md text-sm">{msg}</div>
                        ))}
                    </div>
                </div>

                {/* Game Timer & Phase */}
                <div className="flex flex-col items-center">
                    <div className="bg-black/60 px-6 py-2 rounded-b-xl border border-white/10 backdrop-blur-md">
                        <div className="text-blue-400 text-xs font-bold tracking-widest uppercase mb-1">
                            {gamePhase === GamePhase.WAITING ? 'WAITING FOR PLAYERS' : 
                             gamePhase === GamePhase.COUNTDOWN ? 'STARTING IN' : 'TIME REMAINING'}
                        </div>
                        <div className="text-3xl font-mono font-bold text-white text-center">
                            {gamePhase === GamePhase.WAITING ? '--:--' : 
                             gamePhase === GamePhase.COUNTDOWN ? timer : formatTime(timer)}
                        </div>
                    </div>
                    {isHunter && <div className="mt-2 bg-red-600 px-3 py-1 rounded text-white font-bold text-sm animate-pulse">YOU ARE HUNTER</div>}
                    {isSpectator && <div className="mt-2 bg-gray-600 px-3 py-1 rounded text-white font-bold text-sm">SPECTATING</div>}
                </div>

                <div className="w-20"></div> {/* Spacer for symmetry */}
            </div>

            {/* Gameplay Controls (Only if alive) */}
            {!isSpectator && (
                <div className="absolute inset-0 z-20 flex pointer-events-none">
                    {/* Left: Joystick */}
                    <div className="w-1/2 h-full flex items-end justify-start p-12">
                        <div className="pointer-events-auto">
                            <Joystick onMove={handleJoystickMove} />
                        </div>
                    </div>

                    {/* Right: Look & Actions */}
                    <div className="w-1/2 h-full relative pointer-events-auto">
                        <TouchLook onRotate={handleCameraRotate} />
                        
                        {/* Jump Button */}
                        <div className="absolute bottom-12 right-12 pointer-events-auto">
                            <button
                                onPointerDown={handleJump}
                                className="w-20 h-20 bg-blue-600/60 rounded-full border-4 border-blue-400 active:bg-blue-500 active:scale-95 shadow-lg flex items-center justify-center"
                            >
                                <span className="font-bold text-white tracking-wider text-sm">JUMP</span>
                            </button>
                        </div>

                        {/* Kill Button (Hunter Only) */}
                        {isHunter && (
                            <div className="absolute bottom-12 right-36 pointer-events-auto">
                                <button
                                    onPointerDown={handleKill}
                                    className="w-16 h-16 bg-red-600/80 rounded-full border-4 border-red-400 active:bg-red-500 active:scale-95 shadow-[0_0_15px_rgba(220,38,38,0.6)] flex items-center justify-center group"
                                >
                                     <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                </button>
                                <div className="text-center text-red-500 font-bold text-xs mt-1 shadow-black drop-shadow-md">KILL</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Spectator Controls */}
            {isSpectator && (
                <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center items-center gap-4 pointer-events-auto">
                    <button onClick={() => cycleSpectator(-1)} className="bg-white/10 hover:bg-white/20 p-4 rounded-full backdrop-blur border border-white/20 text-white">
                        ← Prev
                    </button>
                    <div className="bg-black/60 px-4 py-2 rounded text-white text-sm">
                        Watching: {activePlayers.length > 0 ? (activePlayers[spectatingIndex]?.id === myId ? "Myself?" : activePlayers[spectatingIndex]?.role) : "No Players"}
                    </div>
                    <button onClick={() => cycleSpectator(1)} className="bg-white/10 hover:bg-white/20 p-4 rounded-full backdrop-blur border border-white/20 text-white">
                        Next →
                    </button>
                </div>
            )}
        </>
      )}

      {/* Warning */}
      <div className="hidden portrait:flex absolute inset-0 bg-black/90 z-50 items-center justify-center text-white text-center p-8">
        <p className="text-xl font-bold">Please rotate your device.</p>
      </div>

    </div>
  );
}

export default App;