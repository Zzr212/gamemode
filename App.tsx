import React, { useEffect, useRef, useState } from 'react';
import { Joystick } from './components/Joystick';
import { TouchLook } from './components/TouchLook';
import { GameScene } from './components/GameScene';
import { MainMenu } from './components/MainMenu';
import { AuthScreen } from './components/AuthScreen';
import { AdminPanel } from './components/AdminPanel';
import { TaskDispatcher } from './components/TaskMinigames';
import { connectSocket, socket, disconnectSocket } from './services/socketService';
import { JoystickData, PlayerState, GamePhase, GameStateData, Role, UserProfile, ChatMessage, GameSettings, TaskLocation, PlayerTask, TaskType, Vector3 } from './types';

type AppState = 'AUTH' | 'MENU' | 'GAME';

function App() {
  const [appState, setAppState] = useState<AppState>('AUTH');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  
  const [gamePhase, setGamePhase] = useState<GamePhase>(GamePhase.WAITING);
  const [timer, setTimer] = useState<number>(0);
  const [survivors, setSurvivors] = useState<number>(0);
  
  const [gameSettings, setGameSettings] = useState<GameSettings>({
      hunterSpeed: 7, hiderSpeed: 6, hunterVisionRadius: 15, hunterVisionAngle: 0.8,
      roundDuration: 300, headStartDuration: 15
  });
  const [taskSpawns, setTaskSpawns] = useState<TaskLocation[]>([]);

  const [roleMessage, setRoleMessage] = useState<string | null>(null);
  const [spectatingIndex, setSpectatingIndex] = useState<number>(0);
  
  // CHAT STATE
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [chatOpacity, setChatOpacity] = useState(1);

  // ADMIN STATE
  const [showCoords, setShowCoords] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [canKill, setCanKill] = useState(false);
  
  // TASK STATE
  const [nearbyTaskId, setNearbyTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<PlayerTask | null>(null);

  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.5 });
  const jumpRef = useRef<boolean>(false);

  const myPlayer = myId ? players[myId] : null;
  const isSpectator = !myPlayer || myPlayer.role === Role.SPECTATOR || myPlayer.isDead;
  const isHunter = myPlayer?.role === Role.HUNTER && !myPlayer.isDead;
  const activePlayers = (Object.values(players) as PlayerState[]).filter((p) => p.role !== Role.SPECTATOR && !p.isDead && !p.isDisconnected);

  const triggerFullScreen = () => {
    try {
        const docEl = document.documentElement as any;
        if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
        else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
        if (window.screen.orientation && (window.screen.orientation as any).lock) (window.screen.orientation as any).lock('landscape').catch(() => {});
    } catch (e) { console.warn("Fullscreen failed", e); }
  };

  const handleLoginSuccess = (user: UserProfile) => { setCurrentUser(user); setAppState('MENU'); };

  // --- PROXIMITY CHECKS (Kill & Tasks) ---
  useEffect(() => {
    if (gamePhase !== GamePhase.IN_PROGRESS || !myPlayer) {
        setCanKill(false);
        setNearbyTaskId(null);
        return;
    }

    const checkInterval = setInterval(() => {
        // KILL CHECK
        if (isHunter) {
            let inRange = false;
            const hiders = Object.values(players).filter(p => p.role === Role.HIDER && !p.isDead && !p.isDisconnected);
            for (const hider of hiders) {
                const dist = Math.hypot(myPlayer.position.x - hider.position.x, myPlayer.position.z - hider.position.z);
                if (dist <= 3.0) { inRange = true; break; }
            }
            setCanKill(inRange);
        }

        // TASK CHECK
        if (myPlayer.role === Role.HIDER && myPlayer.tasks) {
            let foundTask: string | null = null;
            for (const task of myPlayer.tasks) {
                if (task.completed) continue;
                const dist = Math.hypot(myPlayer.position.x - task.position.x, myPlayer.position.z - task.position.z);
                if (dist <= 2.5) { foundTask = task.id; break; }
            }
            setNearbyTaskId(foundTask);
        }
    }, 200);

    return () => clearInterval(checkInterval);
  }, [players, isHunter, gamePhase, myPlayer]);

  useEffect(() => {
    const onConnect = () => setMyId(socket.id || null);
    const onForceDisconnect = (reason: string) => { disconnectSocket(); alert(reason); window.location.reload(); };
    const onCurrentPlayers = (serverPlayers: Record<string, PlayerState>) => setPlayers(serverPlayers);
    const onNewPlayer = (player: PlayerState) => setPlayers((prev) => ({ ...prev, [player.id]: player }));
    const onPlayerMoved = (player: PlayerState) => setPlayers((prev) => ({ ...prev, [player.id]: player }));
    const onPlayerDisconnected = (id: string) => setPlayers((prev) => { const n = { ...prev }; delete n[id]; return n; });
    
    const onGameStateUpdate = (data: GameStateData) => {
        setGamePhase(data.phase);
        setTimer(data.timer);
        setSurvivors(data.survivors);
        if(data.settings) setGameSettings(data.settings);
        if(data.taskSpawns) setTaskSpawns(data.taskSpawns);
    };

    const onGameMessage = (msg: string) => { if (msg.includes("WIN") || msg.includes("Time")) { setRoleMessage(msg); setTimeout(() => setRoleMessage(null), 4000); } };
    const onPlayerKilled = (id: string) => { if (id === myId) { setRoleMessage("YOU DIED"); setTimeout(() => setRoleMessage(null), 3000); } };
    const onChatMessage = (msg: ChatMessage) => { setChatMessages(prev => [...prev.slice(-19), msg]); setLastMessageTime(Date.now()); if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' }); };
    const onToggleLocationDisplay = (_show: boolean) => setShowCoords(prev => !prev);
    const onToggleAdminPanel = (_show: boolean) => setShowAdminPanel(true);
    const onSettingsUpdated = (newSettings: GameSettings) => setGameSettings(newSettings);

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
    socket.on('toggleLocationDisplay', onToggleLocationDisplay);
    socket.on('toggleAdminPanel', onToggleAdminPanel);
    socket.on('settingsUpdated', onSettingsUpdated);

    return () => { socket.off('connect', onConnect); socket.off('forceDisconnect', onForceDisconnect); socket.off('currentPlayers', onCurrentPlayers); socket.off('newPlayer', onNewPlayer); socket.off('playerMoved', onPlayerMoved); socket.off('playerDisconnected', onPlayerDisconnected); socket.off('gameStateUpdate', onGameStateUpdate); socket.off('gameMessage', onGameMessage); socket.off('playerKilled', onPlayerKilled); socket.off('chatMessage', onChatMessage); socket.off('toggleLocationDisplay', onToggleLocationDisplay); socket.off('toggleAdminPanel', onToggleAdminPanel); socket.off('settingsUpdated', onSettingsUpdated); };
  }, [appState, myId]); 

  const handleJoystickMove = (data: JoystickData) => { joystickRef.current = data; };
  const handleCameraRotate = (dx: number, dy: number) => {
    cameraRotationRef.current.yaw -= dx * 0.005;
    cameraRotationRef.current.pitch = Math.max(-1.2, Math.min(1.5, cameraRotationRef.current.pitch - dy * 0.005)); 
  };
  
  const handlePlayGame = () => {
      triggerFullScreen();
      if (currentUser) {
          connectSocket(currentUser);
          setAppState('GAME');
          if (socket.connected) socket.emit('requestGameStart');
          else socket.once('connect', () => socket.emit('requestGameStart'));
      }
  };

  const handleLeaveGame = () => {
      socket.emit('leaveGame'); disconnectSocket();
      setAppState('MENU'); setPlayers({}); setChatMessages([]); setGamePhase(GamePhase.WAITING); setShowCoords(false); setShowAdminPanel(false);
  };
  
  const handleKill = () => { if (isHunter) socket.emit('attemptKill'); };
  
  const handleUseTask = () => {
      if (nearbyTaskId && myPlayer) {
          const t = myPlayer.tasks.find(x => x.id === nearbyTaskId);
          if (t) setActiveTask(t);
      }
  };

  const handleTaskComplete = () => {
      if (activeTask) {
          socket.emit('completeTask', activeTask.id);
          setActiveTask(null);
      }
  };

  const handleUpdateSettings = (s: GameSettings) => socket.emit('updateSettings', s);
  const handleBanPlayer = (u: string) => socket.emit('banPlayer', u);
  const handleAddTaskSpawn = (type: TaskType, pos: Vector3) => socket.emit('addTaskSpawn', type, pos);
  const handleRemoveTaskSpawn = (id: string) => socket.emit('removeTaskSpawn', id);

  const taskProgress = myPlayer?.tasks ? `${myPlayer.tasks.filter(t => t.completed).length}/${myPlayer.tasks.length}` : '';

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none touch-none">
      {appState === 'MENU' && <MainMenu onPlay={handlePlayGame} />}

      {appState === 'GAME' && (
        <>
            <div className="absolute inset-0 z-0">
                <GameScene 
                    joystickData={joystickRef} cameraRotation={cameraRotationRef} jumpPressed={jumpRef}
                    players={players} myId={myId} spectatingId={isSpectator && activePlayers.length ? (activePlayers[spectatingIndex]?.id || null) : null}
                    gamePhase={gamePhase} showCoords={showCoords} settings={gameSettings}
                    taskSpawns={taskSpawns} timer={timer}
                />
            </div>

            {/* MINIGAME OVERLAY */}
            {activeTask && (
                <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                    <TaskDispatcher type={activeTask.type} onComplete={handleTaskComplete} onClose={() => setActiveTask(null)} />
                </div>
            )}

            {showAdminPanel && (
                <AdminPanel 
                    players={players} settings={gameSettings} taskSpawns={taskSpawns}
                    myPosition={myPlayer?.position || {x:0,y:0,z:0}}
                    onClose={() => setShowAdminPanel(false)} onUpdateSettings={handleUpdateSettings} onBanPlayer={handleBanPlayer}
                    onAddTaskSpawn={handleAddTaskSpawn} onRemoveTaskSpawn={handleRemoveTaskSpawn}
                />
            )}

            {roleMessage && <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none"><h1 className="text-5xl font-black text-white tracking-tighter drop-shadow-md animate-bounce bg-black/40 rounded-xl px-4 py-2">{roleMessage}</h1></div>}
            {!isSpectator && <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white/90 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-sm z-10 pointer-events-none" />}

            <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between" style={{padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'}}>
                {/* TOP BAR */}
                <div className="w-full flex justify-between items-start pt-2 px-2 md:px-4">
                    {/* CHAT */}
                    <div className="pointer-events-auto flex flex-col items-start w-1/3 z-50">
                        {!isChatOpen && <button onClick={() => { setIsChatOpen(true); setLastMessageTime(Date.now()); }} className={`w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center border border-white/10 transition-opacity ${chatOpacity===0?'opacity-50':'opacity-100'}`}><svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg></button>}
                        {isChatOpen && (
                            <div className="w-64 h-48 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex flex-col">
                                <div className="flex justify-between p-2 bg-black/40"><span className="text-[10px] text-gray-400 font-bold">CHAT</span><button onClick={()=>setIsChatOpen(false)} className="text-white">X</button></div>
                                <div className="flex-1 overflow-y-auto p-2 space-y-1"><div ref={chatEndRef} />{chatMessages.map((m,i)=><div key={i} className={`text-xs ${m.isSystem?'text-yellow-400':'text-white'}`}>{!m.isSystem && <span className="text-blue-400">{m.sender}: </span>}{m.text}</div>)}</div>
                                <form onSubmit={(e)=>{e.preventDefault(); if(chatInput.trim()){socket.emit('chatMessage',chatInput.trim()); setChatInput('');}}} className="p-2 flex gap-2"><input className="flex-1 bg-transparent border-b text-white text-xs" value={chatInput} onChange={e=>setChatInput(e.target.value)} /><button className="text-blue-400">{'>'}</button></form>
                            </div>
                        )}
                    </div>

                    {/* STATS */}
                    <div className="flex items-center gap-2 md:gap-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 shadow-lg">
                         <div className="text-center"><span className="text-[9px] text-gray-400 font-bold block">TIMER</span><span className={`text-lg font-mono font-bold ${timer<30?'text-red-500 animate-pulse':'text-white'}`}>{Math.floor(timer/60)}:{(timer%60).toString().padStart(2,'0')}</span></div>
                         <div className="w-px h-6 bg-white/20"></div>
                         <div className="text-center"><span className="text-[9px] text-gray-400 font-bold block">ALIVE</span><span className="text-lg font-mono font-bold text-green-400">{survivors}</span></div>
                    </div>

                    {/* TASKS + LEAVE */}
                    <div className="flex gap-4 items-start pointer-events-auto">
                        {!isHunter && !isSpectator && gamePhase === GamePhase.IN_PROGRESS && (
                            <div className="bg-green-900/80 border border-green-500 px-3 py-1 rounded text-green-100 font-bold font-mono">
                                TASKS: {taskProgress}
                            </div>
                        )}
                        <button onClick={handleLeaveGame} className="w-10 h-10 bg-black/50 hover:bg-red-900/50 rounded-full flex items-center justify-center border border-white/10"><svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg></button>
                    </div>
                </div>

                {/* BOTTOM CONTROLS */}
                <div className="flex-1 w-full relative pointer-events-none">
                     {!isSpectator && gamePhase !== GamePhase.GAME_OVER && <div className="absolute inset-0 pointer-events-auto z-20"><TouchLook onRotate={handleCameraRotate} /></div>}
                     {!isSpectator && gamePhase !== GamePhase.GAME_OVER && <div className="absolute bottom-4 left-4 z-40 pointer-events-auto opacity-70"><Joystick onMove={handleJoystickMove} /></div>}
                     {!isSpectator && gamePhase !== GamePhase.GAME_OVER && (
                        <div className="absolute bottom-4 right-4 z-40 pointer-events-auto flex flex-col items-end gap-4">
                            {/* USE BUTTON FOR TASKS */}
                            {nearbyTaskId && !isHunter && (
                                <button onPointerDown={handleUseTask} className="w-20 h-20 rounded-full border-4 border-yellow-400 bg-yellow-500/80 animate-pulse flex items-center justify-center shadow-[0_0_20px_yellow]">
                                    <span className="font-black text-black">USE</span>
                                </button>
                            )}
                            
                            {/* KILL BUTTON */}
                            {isHunter && gamePhase === GamePhase.IN_PROGRESS && (
                                <button onPointerDown={handleKill} className={`w-20 h-20 rounded-full border-2 shadow-[0_0_15px_rgba(255,0,0,0.5)] flex items-center justify-center backdrop-blur-sm transition-all mb-2 ${canKill ? 'bg-red-600 border-red-500 opacity-100 scale-110 animate-pulse' : 'bg-red-900/30 border-red-900/50 opacity-40 grayscale'}`}>
                                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 text-white"><path d="M12 2C7.58 2 4 5.58 4 10C4 12.03 4.67 13.93 5.86 15.5C5.86 15.5 5.86 15.5 5.86 15.5C5.86 15.5 7 19 7 19H17C17 19 18.14 15.5 18.14 15.5C19.33 13.93 20 12.03 20 10C20 5.58 16.42 2 12 2ZM9.5 9.5C9.5 8.67 10.17 8 11 8C11.83 8 12.5 8.67 12.5 9.5C12.5 10.33 11.83 11 11 11C10.17 11 9.5 10.33 9.5 9.5ZM13.5 15H10.5V14H13.5V15ZM14.5 9.5C14.5 10.33 13.83 11 13 11C12.17 11 11.5 10.33 11.5 9.5C11.5 8.67 12.17 8 13 8C13.83 8 14.5 8.67 14.5 9.5Z" /><path d="M7 20H17V22H7V20Z" /></svg>
                                </button>
                            )}
                            <button onPointerDown={() => jumpRef.current = true} className="w-16 h-16 bg-blue-600/40 hover:bg-blue-600/60 rounded-full border-2 border-blue-400/50 flex items-center justify-center font-bold text-white text-xs">JUMP</button>
                        </div>
                     )}
                     {isSpectator && (
                        <div className="absolute bottom-4 left-0 right-0 z-40 flex justify-center items-center gap-4 pointer-events-auto">
                            <button onClick={() => setSpectatingIndex(i => i-1)} className="bg-white/10 p-3 rounded-full text-white">←</button>
                            <button onClick={() => setSpectatingIndex(i => i+1)} className="bg-white/10 p-3 rounded-full text-white">→</button>
                        </div>
                     )}
                </div>
            </div>
        </>
      )}
      <div className="hidden portrait:flex absolute inset-0 bg-black z-[100] items-center justify-center text-white text-center p-8"><p className="text-xl font-bold">ROTATE DEVICE</p></div>
    </div>
  );
}
export default App;
