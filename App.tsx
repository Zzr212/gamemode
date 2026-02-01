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

            {/* Role Reveal / Game Message Overlay - Z-50 */}
            {roleMessage && (
                <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(0,0,0,1)] animate-bounce text-center px-4">
                        {roleMessage}
                    </h1>
                </div>
            )}

            {/* Crosshair */}
            {!isSpectator && (
                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,0.8)] z-10 pointer-events-none opacity-80" />
            )}

            {/* Top HUD - Z-40 */}
            <div className="absolute top-0 left-0 right-0 p-4 z-40 pointer-events-none flex justify-between items-start">
                <div className="flex flex-col gap-1">
                    {/* Ping */}
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm w-fit border border-white/10">
                        <div className={`w-2 h-2 rounded-full ${ping < 100 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-white text-xs font-mono">{ping} ms</span>
                    </div>
                    {/* Notifications */}
                    <div className="flex flex-col gap-1 mt-2">
                        {notifications.map((msg, i) => (
                            <div key={i} className="bg-black/60 backdrop-blur text-white px-3 py-1 rounded-md text-sm border-l-2 border-blue-500">{msg}</div>
                        ))}
                    </div>
                </div>

                {/* Game Timer & Phase */}
                <div className="flex flex-col items-center">
                    <div className="bg-black/70 px-8 py-3 rounded-b-xl border border-white/20 backdrop-blur-md shadow-xl">
                        <div className="text-blue-400 text-[10px] md:text-xs font-bold tracking-widest uppercase mb-1 text-center">
                            {gamePhase === GamePhase.WAITING ? 'WAITING FOR PLAYERS' : 
                             gamePhase === GamePhase.COUNTDOWN ? 'ROUND STARTS IN' : 'TIME REMAINING'}
                        </div>
                        <div className="text-4xl font-mono font-black text-white text-center tracking-tighter">
                            {gamePhase === GamePhase.WAITING ? '--:--' : 
                             gamePhase === GamePhase.COUNTDOWN ? timer : formatTime(timer)}
                        </div>
                    </div>
                    
                    {/* Status Badge */}
                    {isHunter && <div className="mt-2 bg-red-600/90 backdrop-blur px-4 py-1 rounded-full text-white font-bold text-sm animate-pulse border border-red-400 shadow-[0_0_10px_rgba(220,38,38,0.5)]">YOU ARE HUNTER</div>}
                    {isSpectator && <div className="mt-2 bg-gray-600/90 backdrop-blur px-4 py-1 rounded-full text-white font-bold text-sm border border-gray-400">SPECTATOR MODE</div>}
                </div>

                <div className="w-20"></div> 
            </div>

            {/* Gameplay Controls - Z-30 */}
            {!isSpectator && (
                <div className="absolute inset-0 z-30 flex pointer-events-none">
                    {/* Left: Joystick */}
                    <div className="w-1/2 h-full flex items-end justify-start p-8 md:p-12">
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
                                className="w-20 h-20 bg-blue-600/40 hover:bg-blue-600/60 rounded-full border-4 border-blue-400/50 active:bg-blue-500 active:scale-95 shadow-lg flex items-center justify-center backdrop-blur-sm transition-all"
                            >
                                <span className="font-bold text-white tracking-wider text-sm drop-shadow-md">JUMP</span>
                            </button>
                        </div>

                        {/* Kill Button (Hunter Only) */}
                        {isHunter && (
                            <div className="absolute bottom-12 right-36 pointer-events-auto flex flex-col items-center">
                                <button
                                    onPointerDown={handleKill}
                                    className="w-16 h-16 bg-red-600/60 hover:bg-red-600/80 rounded-full border-4 border-red-500/50 active:bg-red-500 active:scale-95 shadow-[0_0_15px_rgba(220,38,38,0.4)] flex items-center justify-center group backdrop-blur-sm transition-all"
                                >
                                     <svg className="w-8 h-8 text-white drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                </button>
                                <span className="text-red-500 font-black text-xs mt-1 bg-black/50 px-2 py-0.5 rounded backdrop-blur">KILL</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Spectator Controls - Z-30 */}
            {isSpectator && (
                <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center items-center gap-4 pointer-events-auto">
                    <button onClick={() => cycleSpectator(-1)} className="bg-white/10 hover:bg-white/20 active:scale-95 p-4 rounded-full backdrop-blur border border-white/20 text-white transition-all">
                        ← Prev
                    </button>
                    <div className="bg-black/60 px-6 py-3 rounded-full text-white text-sm font-bold border border-white/10 backdrop-blur">
                        WATCHING: <span className="text-blue-400">{activePlayers.length > 0 ? (activePlayers[spectatingIndex]?.id === myId ? "MYSELF" : activePlayers[spectatingIndex]?.role) : "NO PLAYERS"}</span>
                    </div>
                    <button onClick={() => cycleSpectator(1)} className="bg-white/10 hover:bg-white/20 active:scale-95 p-4 rounded-full backdrop-blur border border-white/20 text-white transition-all">
                        Next →
                    </button>
                </div>
            )}
        </>
      )}

      {/* Warning */}
      <div className="hidden portrait:flex absolute inset-0 bg-black/95 z-[100] items-center justify-center text-white text-center p-8">
        <div className="flex flex-col items-center gap-4">
            <svg className="w-16 h-16 animate-spin-slow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            <p className="text-xl font-bold tracking-wider">PLEASE ROTATE DEVICE</p>
        </div>
      </div>

    </div>
  );
}

export default App;