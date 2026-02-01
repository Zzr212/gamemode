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
  
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  
  const [gamePhase, setGamePhase] = useState<GamePhase>(GamePhase.WAITING);
  const [timer, setTimer] = useState<number>(0);
  const [survivors, setSurvivors] = useState<number>(0);
  
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [spectatingIndex, setSpectatingIndex] = useState<number>(0);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number>(0);

  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.5 });
  const jumpRef = useRef<boolean>(false);

  const myPlayer = myId ? players[myId] : null;
  const isSpectator = !myPlayer || myPlayer.role === Role.SPECTATOR || myPlayer.isDead;
  const isHunter = myPlayer?.role === Role.HUNTER && !myPlayer.isDead;

  const activePlayers = Object.values(players).filter(p => p.role !== Role.SPECTATOR && !p.isDead);

  useEffect(() => {
    connectSocket();

    const onConnect = () => setMyId(socket.id || null);
    const onCurrentPlayers = (serverPlayers: Record<string, PlayerState>) => setPlayers(serverPlayers);
    const onNewPlayer = (player: PlayerState) => {
        setPlayers((prev) => ({ ...prev, [player.id]: player }));
        if(appState === 'GAME') addNotification(`Player joined`);
    };
    const onPlayerMoved = (player: PlayerState) => setPlayers((prev) => ({ ...prev, [player.id]: player }));
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
        setSurvivors(data.survivors);
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
    setNotifications(prev => [...prev.slice(-3), msg]); 
    setTimeout(() => setNotifications(prev => prev.slice(1)), 3000);
  };

  const handleJoystickMove = (data: JoystickData) => { joystickRef.current = data; };
  const handleCameraRotate = (dx: number, dy: number) => {
    const sensitivity = 0.005;
    cameraRotationRef.current.yaw -= dx * sensitivity;
    const currentPitch = cameraRotationRef.current.pitch;
    const newPitch = currentPitch - dy * sensitivity;
    cameraRotationRef.current.pitch = Math.max(-1.2, Math.min(1.5, newPitch)); 
  };
  const handleJump = () => { jumpRef.current = true; };
  const handlePlayGame = () => {
      if (!socket.connected) connectSocket();
      setAppState('GAME');
      socket.emit('requestGameStart');
  };
  const handleKill = () => { if (isHunter) socket.emit('attemptKill'); };

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
      
      {appState === 'MENU' && <MainMenu onPlay={handlePlayGame} />}

      {appState === 'GAME' && (
        <>
            {/* 3D Scene */}
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

            {/* Large Splash Messages */}
            {roleMessage && (
                <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                    <h1 className="text-5xl font-black text-white tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,1)] animate-bounce text-center px-4 bg-black/40 backdrop-blur-sm rounded-xl py-2">
                        {roleMessage}
                    </h1>
                </div>
            )}

            {/* Crosshair */}
            {!isSpectator && (
                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white/90 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,1)] z-10 pointer-events-none" />
            )}

            {/* COMPACT HUD - Top Bar */}
            <div className="absolute top-2 left-0 right-0 px-4 z-40 pointer-events-none flex justify-center items-start">
                
                {/* Main Info Box */}
                <div className="flex items-center gap-4 bg-black/70 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 shadow-lg">
                    
                    {/* Phase / Timer */}
                    <div className="flex flex-col items-center min-w-[60px]">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                            {gamePhase === GamePhase.WAITING ? 'LOBBY' : 
                             gamePhase === GamePhase.COUNTDOWN ? 'STARTING' : 'TIME'}
                        </span>
                        <span className={`text-xl font-mono font-bold leading-none ${timer < 30 && gamePhase === GamePhase.IN_PROGRESS ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                            {gamePhase === GamePhase.WAITING ? '--:--' : 
                             gamePhase === GamePhase.COUNTDOWN ? timer : formatTime(timer)}
                        </span>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-8 bg-white/20"></div>

                    {/* Survivors */}
                    <div className="flex flex-col items-center min-w-[60px]">
                        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">ALIVE</span>
                        <span className="text-xl font-mono font-bold text-green-400 leading-none">{survivors}</span>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-8 bg-white/20"></div>

                     {/* Role / Ping */}
                    <div className="flex flex-col items-center min-w-[60px]">
                         {isHunter ? (
                             <span className="text-xs font-black text-red-500 animate-pulse">HUNTER</span>
                         ) : isSpectator ? (
                             <span className="text-xs font-bold text-gray-400">SPECTATOR</span>
                         ) : (
                             <span className="text-xs font-bold text-blue-400">HIDER</span>
                         )}
                         <span className="text-[10px] text-gray-500 font-mono">{ping}ms</span>
                    </div>

                </div>
            </div>

            {/* Notifications (Top Left) */}
            <div className="absolute top-16 left-4 z-30 flex flex-col gap-1 pointer-events-none">
                {notifications.map((msg, i) => (
                    <div key={i} className="bg-black/60 text-white text-xs px-2 py-1 rounded backdrop-blur border-l-2 border-blue-500 opacity-90">
                        {msg}
                    </div>
                ))}
            </div>

            {/* Gameplay Controls */}
            {!isSpectator && (
                <div className="absolute inset-0 z-30 flex pointer-events-none">
                    {/* Left: Joystick */}
                    <div className="w-1/2 h-full flex items-end justify-start p-8 md:p-12">
                        <div className="pointer-events-auto opacity-70 hover:opacity-100 transition-opacity">
                            <Joystick onMove={handleJoystickMove} />
                        </div>
                    </div>

                    {/* Right: Look & Actions */}
                    <div className="w-1/2 h-full relative pointer-events-auto">
                        <TouchLook onRotate={handleCameraRotate} />
                        
                        {/* Jump Button */}
                        <div className="absolute bottom-8 right-8 pointer-events-auto">
                            <button
                                onPointerDown={handleJump}
                                className="w-16 h-16 bg-blue-600/40 hover:bg-blue-600/60 rounded-full border-2 border-blue-400/50 active:bg-blue-500 active:scale-95 shadow-lg flex items-center justify-center backdrop-blur-sm transition-all"
                            >
                                <span className="font-bold text-white text-xs">JUMP</span>
                            </button>
                        </div>

                        {/* Kill Button (Hunter Only) */}
                        {isHunter && (
                            <div className="absolute bottom-8 right-28 pointer-events-auto flex flex-col items-center">
                                <button
                                    onPointerDown={handleKill}
                                    className="w-14 h-14 bg-red-600/60 hover:bg-red-600/80 rounded-full border-2 border-red-500/50 active:bg-red-500 active:scale-95 shadow-[0_0_15px_rgba(220,38,38,0.4)] flex items-center justify-center group backdrop-blur-sm transition-all"
                                >
                                     <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Spectator Controls */}
            {isSpectator && (
                <div className="absolute bottom-4 left-0 right-0 z-30 flex justify-center items-center gap-4 pointer-events-auto">
                    <button onClick={() => cycleSpectator(-1)} className="bg-white/10 hover:bg-white/20 p-3 rounded-full backdrop-blur border border-white/20 text-white">←</button>
                    <div className="bg-black/60 px-4 py-1 rounded-full text-white text-xs font-bold border border-white/10 backdrop-blur">
                        VIEW: <span className="text-blue-400">{activePlayers.length > 0 ? (activePlayers[spectatingIndex]?.id === myId ? "MYSELF" : activePlayers[spectatingIndex]?.role) : "NONE"}</span>
                    </div>
                    <button onClick={() => cycleSpectator(1)} className="bg-white/10 hover:bg-white/20 p-3 rounded-full backdrop-blur border border-white/20 text-white">→</button>
                </div>
            )}
        </>
      )}

      {/* Warning */}
      <div className="hidden portrait:flex absolute inset-0 bg-black z-[100] items-center justify-center text-white text-center p-8">
        <p className="text-xl font-bold tracking-wider">PLEASE ROTATE DEVICE</p>
      </div>

    </div>
  );
}

export default App;