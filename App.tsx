import React, { useEffect, useRef, useState } from 'react';
import { Joystick } from './components/Joystick';
import { TouchLook } from './components/TouchLook';
import { GameScene } from './components/GameScene';
import { MainMenu } from './components/MainMenu';
import { AuthScreen } from './components/AuthScreen';
import { connectSocket, socket, disconnectSocket } from './services/socketService';
import { JoystickData, PlayerState, GamePhase, GameStateData, Role, UserProfile, ChatMessage } from './types';

// App Phases: AUTH (Portrait) -> MENU (Landscape) -> GAME (Landscape)
type AppState = 'AUTH' | 'MENU' | 'GAME';

function App() {
  const [appState, setAppState] = useState<AppState>('AUTH');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  
  const [gamePhase, setGamePhase] = useState<GamePhase>(GamePhase.WAITING);
  const [timer, setTimer] = useState<number>(0);
  const [survivors, setSurvivors] = useState<number>(0);
  
  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [spectatingIndex, setSpectatingIndex] = useState<number>(0);
  
  // CHAT STATE
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatOpacity, setChatOpacity] = useState(1);

  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.5 });
  const jumpRef = useRef<boolean>(false);

  const myPlayer = myId ? players[myId] : null;
  const isSpectator = !myPlayer || myPlayer.role === Role.SPECTATOR || myPlayer.isDead;
  const isHunter = myPlayer?.role === Role.HUNTER && !myPlayer.isDead;

  const activePlayers = (Object.values(players) as PlayerState[]).filter((p: PlayerState) => p.role !== Role.SPECTATOR && !p.isDead && !p.isDisconnected);

  // --- FULLSCREEN HELPER ---
  const triggerFullScreen = () => {
    try {
        const docEl = document.documentElement as any;
        if (docEl.requestFullscreen) {
            docEl.requestFullscreen().catch(() => {});
        } else if (docEl.webkitRequestFullscreen) { 
            docEl.webkitRequestFullscreen();
        } else if (docEl.msRequestFullscreen) {
            docEl.msRequestFullscreen();
        }
        if (window.screen.orientation && (window.screen.orientation as any).lock) {
            (window.screen.orientation as any).lock('landscape').catch(() => {});
        }
    } catch (e) {
        console.warn("Fullscreen request failed", e);
    }
  };

  const handleLoginSuccess = (user: UserProfile) => {
      setCurrentUser(user);
      setAppState('MENU');
  };

  // --- CHAT FADE EFFECT ---
  useEffect(() => {
      const interval = setInterval(() => {
          const timeSinceLast = Date.now() - lastMessageTime;
          if (!isChatOpen && timeSinceLast > 2000) {
              setChatOpacity(0);
          } else {
              setChatOpacity(1);
          }
      }, 500);
      return () => clearInterval(interval);
  }, [lastMessageTime, isChatOpen]);

  useEffect(() => {
    // Socket Listeners
    const onConnect = () => setMyId(socket.id || null);
    
    const onForceDisconnect = (reason: string) => {
        alert(reason);
        window.location.reload();
    };

    const onCurrentPlayers = (serverPlayers: Record<string, PlayerState>) => setPlayers(serverPlayers);
    const onNewPlayer = (player: PlayerState) => {
        setPlayers((prev) => ({ ...prev, [player.id]: player }));
    };
    const onPlayerMoved = (player: PlayerState) => setPlayers((prev) => ({ ...prev, [player.id]: player }));
    const onPlayerDisconnected = (id: string) => {
        setPlayers((prev) => {
            const newPlayers = { ...prev };
            delete newPlayers[id]; 
            return newPlayers;
        });
    };

    const onGameStateUpdate = (data: GameStateData) => {
        setGamePhase(data.phase);
        setTimer(data.timer);
        setSurvivors(data.survivors);
    };

    const onGameMessage = (msg: string) => {
        if (msg.includes("WIN")) {
            setRoleMessage(msg);
            setTimeout(() => setRoleMessage(null), 4000);
        }
    };

    const onPlayerKilled = (id: string) => {
        if (id === myId) {
            setRoleMessage("YOU DIED");
            setTimeout(() => setRoleMessage(null), 3000);
        }
    };

    const onChatMessage = (msg: ChatMessage) => {
        setChatMessages(prev => [...prev.slice(-19), msg]); 
        setLastMessageTime(Date.now());
        if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    };

    socket.on('connect', onConnect);
    socket.on('forceDisconnect', onForceDisconnect);
    socket.on('currentPlayers', onCurrentPlayers);
    socket.on('newPlayer', onNewPlayer);
    socket.on('playerMoved', onPlayerMoved);
    socket.on('playerDisconnected', onPlayerDisconnected);
    socket.on('gameStateUpdate', onGameStateUpdate);
    socket.on('gameMessage', onGameMessage);
    socket.on('playerKilled', onPlayerKilled);
    socket.on('chatMessage', onChatMessage);

    return () => {
        socket.off('connect', onConnect);
        socket.off('forceDisconnect', onForceDisconnect);
        socket.off('currentPlayers', onCurrentPlayers);
        socket.off('newPlayer', onNewPlayer);
        socket.off('playerMoved', onPlayerMoved);
        socket.off('playerDisconnected', onPlayerDisconnected);
        socket.off('gameStateUpdate', onGameStateUpdate);
        socket.off('gameMessage', onGameMessage);
        socket.off('playerKilled', onPlayerKilled);
        socket.off('chatMessage', onChatMessage);
    };
  }, [appState, myId, players]); 

  useEffect(() => {
    if (gamePhase === GamePhase.IN_PROGRESS && myPlayer && !myPlayer.isDead && myPlayer.role !== Role.SPECTATOR) {
        const roleText = myPlayer.role === Role.HUNTER ? "YOU ARE THE HUNTER" : "HIDE!";
        setRoleMessage(roleText);
        setTimeout(() => setRoleMessage(null), 3000);
    }
  }, [gamePhase, myPlayer?.role]); 

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
      triggerFullScreen();
      if (currentUser) {
          connectSocket(currentUser);
          setAppState('GAME');
          if (socket.connected) {
              socket.emit('requestGameStart');
          } else {
              socket.once('connect', () => {
                  socket.emit('requestGameStart');
              });
          }
      }
  };

  const handleLeaveGame = () => {
      socket.emit('leaveGame'); // Tell server we are leaving intentionally
      disconnectSocket();
      setAppState('MENU');
      setPlayers({});
      setChatMessages([]);
  };
  
  const handleKill = () => { if (isHunter) socket.emit('attemptKill'); };

  const sendChat = (e?: React.FormEvent) => {
      e?.preventDefault();
      if (chatInput.trim()) {
          socket.emit('chatMessage', chatInput.trim());
          setChatInput('');
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
      if (spectatingIndex >= activePlayers.length) return activePlayers[0]?.id;
      return activePlayers[spectatingIndex]?.id;
  };

  const formatTime = (s: number) => {
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  if (appState === 'AUTH') return <AuthScreen onLogin={handleLoginSuccess} />;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none touch-none">
      {appState === 'MENU' && <MainMenu onPlay={handlePlayGame} />}

      {appState === 'GAME' && (
        <>
            <div className="absolute inset-0 z-0">
                <GameScene 
                    joystickData={joystickRef} 
                    cameraRotation={cameraRotationRef} 
                    jumpPressed={jumpRef}
                    players={players} 
                    myId={myId}
                    spectatingId={isSpectator ? getSpectatingId() : null}
                    gamePhase={gamePhase}
                />
            </div>

            {roleMessage && (
                <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                    <h1 className="text-5xl font-black text-white tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,1)] animate-bounce text-center px-4 bg-black/40 backdrop-blur-sm rounded-xl py-2">
                        {roleMessage}
                    </h1>
                </div>
            )}

            {!isSpectator && (
                <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white/90 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,1)] z-10 pointer-events-none" />
            )}

            <div 
                className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between"
                style={{
                    paddingTop: 'env(safe-area-inset-top, 20px)',
                    paddingRight: 'env(safe-area-inset-right, 20px)',
                    paddingBottom: 'env(safe-area-inset-bottom, 20px)',
                    paddingLeft: 'env(safe-area-inset-left, 20px)'
                }}
            >
                {/* TOP BAR */}
                <div className="w-full flex justify-between items-start pt-2 px-2 md:px-4">
                    {/* CHAT */}
                    <div className="pointer-events-auto flex flex-col items-start w-1/3 z-50">
                        {!isChatOpen && (
                            <button 
                                onClick={() => { setIsChatOpen(true); setLastMessageTime(Date.now()); }}
                                className={`w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center border border-white/10 backdrop-blur-md transition-opacity duration-500 ${chatOpacity === 0 ? 'opacity-50' : 'opacity-100'}`}
                            >
                                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                            </button>
                        )}

                        <div className={`mt-2 flex flex-col items-start transition-all duration-300 ${isChatOpen ? 'w-64 h-48' : 'w-48'}`}>
                            {isChatOpen ? (
                                <div className="flex flex-col w-full h-full bg-black/60 backdrop-blur-md rounded-lg border border-white/10 overflow-hidden">
                                    <div className="flex justify-between items-center p-2 bg-black/40">
                                        <span className="text-[10px] text-gray-400 font-bold tracking-wider">GAME CHAT</span>
                                        <button onClick={() => setIsChatOpen(false)} className="text-gray-400 hover:text-white">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide">
                                        {chatMessages.map((msg, i) => (
                                            <div key={i} className={`text-xs break-words ${msg.isSystem ? 'text-yellow-400 italic' : 'text-white'}`}>
                                                {!msg.isSystem && <span className="text-blue-400 font-bold">{msg.sender}: </span>}
                                                {msg.text}
                                            </div>
                                        ))}
                                        <div ref={chatEndRef} />
                                    </div>
                                    <form onSubmit={sendChat} className="p-2 bg-black/40 flex gap-2">
                                        <input 
                                            type="text" 
                                            value={chatInput} 
                                            onChange={e => setChatInput(e.target.value)}
                                            className="flex-1 bg-transparent border-b border-gray-500 text-white text-xs focus:outline-none focus:border-blue-400 placeholder-gray-500"
                                            placeholder="Type..."
                                        />
                                        <button type="submit" className="text-blue-400 hover:text-white">
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                        </button>
                                    </form>
                                </div>
                            ) : (
                                <div 
                                    className={`flex flex-col gap-1 transition-opacity duration-500 pointer-events-auto cursor-pointer`} 
                                    style={{ opacity: chatOpacity }}
                                    onClick={() => { setIsChatOpen(true); setLastMessageTime(Date.now()); }}
                                >
                                    {chatMessages.slice(-3).map((msg, i) => (
                                        <div key={msg.id || i} className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-white break-words border-l-2 border-blue-500 max-w-full">
                                            {msg.isSystem ? msg.text : `${msg.sender}: ${msg.text}`}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* STATS */}
                    <div className="flex items-center gap-2 md:gap-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 shadow-lg pointer-events-auto">
                         <div className="flex flex-col items-center justify-center min-w-[50px]">
                            <span className="text-[9px] text-gray-400 font-bold uppercase">TIMER</span>
                            <span className={`text-lg font-mono font-bold leading-none ${timer < 30 && gamePhase === GamePhase.IN_PROGRESS ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                                {gamePhase === GamePhase.WAITING ? '--' : 
                                gamePhase === GamePhase.COUNTDOWN ? timer : formatTime(timer)}
                            </span>
                        </div>
                        <div className="w-px h-6 bg-white/20"></div>
                        <div className="flex flex-col items-center min-w-[50px]">
                            <span className="text-[9px] text-gray-400 font-bold uppercase">ALIVE</span>
                            <span className="text-lg font-mono font-bold text-green-400 leading-none">{survivors}</span>
                        </div>
                        <div className="w-px h-6 bg-white/20"></div>
                        <div className="flex flex-col items-center min-w-[50px]">
                            {gamePhase !== GamePhase.IN_PROGRESS ? <span className="text-xs text-gray-400 font-bold">READY</span> :
                            isHunter ? <span className="text-xs text-red-500 font-black animate-pulse">HUNTER</span> :
                            isSpectator ? <span className="text-xs text-gray-400 font-bold">SPEC</span> :
                            <span className="text-xs text-blue-400 font-bold">HIDER</span>}
                        </div>
                    </div>

                    {/* LEAVE */}
                    <div className="w-1/3 flex justify-end pointer-events-auto">
                        <button 
                            onClick={handleLeaveGame}
                            className="w-10 h-10 bg-black/50 hover:bg-red-900/50 rounded-full flex items-center justify-center border border-white/10 backdrop-blur-md group transition-colors"
                        >
                            <svg className="w-5 h-5 text-gray-300 group-hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                        </button>
                    </div>

                </div>

                {/* BOTTOM CONTROLS */}
                <div className="flex-1 w-full relative pointer-events-none">
                     {!isSpectator && (
                        <div className="absolute inset-0 pointer-events-auto z-20">
                            <TouchLook onRotate={handleCameraRotate} />
                        </div>
                     )}
                     {!isSpectator && (
                        <div className="absolute bottom-4 left-4 z-40 pointer-events-auto opacity-70 hover:opacity-100 transition-opacity">
                            <Joystick onMove={handleJoystickMove} />
                        </div>
                     )}
                     {!isSpectator && (
                        <div className="absolute bottom-4 right-4 z-40 pointer-events-auto flex flex-col items-end gap-4">
                            {isHunter && gamePhase === GamePhase.IN_PROGRESS && (
                                <button
                                    onPointerDown={handleKill}
                                    className="w-16 h-16 bg-red-600/60 hover:bg-red-600/80 rounded-full border-2 border-red-500/50 active:bg-red-500 active:scale-95 shadow-[0_0_15px_rgba(220,38,38,0.4)] flex items-center justify-center backdrop-blur-sm transition-all mb-2"
                                >
                                     <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                </button>
                            )}
                            <button
                                onPointerDown={handleJump}
                                className="w-20 h-20 bg-blue-600/40 hover:bg-blue-600/60 rounded-full border-2 border-blue-400/50 active:bg-blue-500 active:scale-95 shadow-lg flex items-center justify-center backdrop-blur-sm transition-all"
                            >
                                <span className="font-bold text-white text-sm tracking-widest">JUMP</span>
                            </button>
                        </div>
                     )}
                     {isSpectator && (
                        <div className="absolute bottom-4 left-0 right-0 z-40 flex justify-center items-center gap-4 pointer-events-auto">
                            <button onClick={() => cycleSpectator(-1)} className="bg-white/10 hover:bg-white/20 p-3 rounded-full backdrop-blur border border-white/20 text-white">←</button>
                            <div className="bg-black/60 px-4 py-1 rounded-full text-white text-xs font-bold border border-white/10 backdrop-blur">
                                VIEW: <span className="text-blue-400">{activePlayers.length > 0 ? (activePlayers[spectatingIndex]?.id === myId ? "MYSELF" : activePlayers[spectatingIndex]?.role) : "NONE"}</span>
                            </div>
                            <button onClick={() => cycleSpectator(1)} className="bg-white/10 hover:bg-white/20 p-3 rounded-full backdrop-blur border border-white/20 text-white">→</button>
                        </div>
                     )}
                </div>
            </div>
        </>
      )}

      <div className="hidden portrait:flex absolute inset-0 bg-black z-[100] items-center justify-center text-white text-center p-8">
        <p className="text-xl font-bold tracking-wider">PLEASE ROTATE DEVICE</p>
      </div>

    </div>
  );
}

export default App;
