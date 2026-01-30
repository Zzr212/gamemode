import { useEffect, useRef, useState } from 'react';
import { Joystick } from './components/Joystick';
import { TouchLook } from './components/TouchLook';
import { GameScene } from './components/GameScene';
import { MainMenu } from './components/MainMenu';
import { connectSocket, disconnectSocket, socket } from './services/socketService';
import { JoystickData, PlayerState } from './types';

type AppState = 'MENU' | 'QUEUE' | 'GAME';

function App() {
  const [appState, setAppState] = useState<AppState>('MENU');
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number>(0);
  
  // Queue State
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [isLoginReady, setIsLoginReady] = useState(false);

  // Mutable refs for high-frequency updates
  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.5 });
  const jumpRef = useRef<boolean>(false);

  // Connection & Game Loop Logic
  useEffect(() => {
    // We connect socket when entering QUEUE state
    if (appState === 'QUEUE' || appState === 'GAME') {
        connectSocket();

        const onConnect = () => {
          console.log("Connected to server");
        };

        const onQueueUpdate = (pos: number) => {
            setQueuePosition(pos);
        };

        const onLoginAllowed = () => {
            setIsLoginReady(true);
            setQueuePosition(null); // Clear queue number
            
            // Wait a moment for "Loading..." animation then spawn
            setTimeout(() => {
                socket.emit('spawn');
                setAppState('GAME');
            }, 1000);
        };

        const onCurrentPlayers = (serverPlayers: Record<string, PlayerState>) => {
          setPlayers(serverPlayers);
        };

        const onNewPlayer = (player: PlayerState) => {
          setPlayers((prev) => ({ ...prev, [player.id]: player }));
          if (player.id === socket.id) {
              setMyId(player.id);
          } else {
              addNotification(`Player joined`);
          }
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
          addNotification(`Player left`);
        };

        socket.on('connect', onConnect);
        socket.on('queueUpdate', onQueueUpdate);
        socket.on('loginAllowed', onLoginAllowed);
        socket.on('currentPlayers', onCurrentPlayers);
        socket.on('newPlayer', onNewPlayer);
        socket.on('playerMoved', onPlayerMoved);
        socket.on('playerDisconnected', onPlayerDisconnected);

        // Ping Loop
        const pingInterval = setInterval(() => {
            if (appState === 'GAME') {
                const start = Date.now();
                socket.emit('pingSync', () => {
                    const latency = Date.now() - start;
                    setPing(latency);
                });
            }
        }, 1000);

        return () => {
          socket.off('connect', onConnect);
          socket.off('queueUpdate', onQueueUpdate);
          socket.off('loginAllowed', onLoginAllowed);
          socket.off('currentPlayers', onCurrentPlayers);
          socket.off('newPlayer', onNewPlayer);
          socket.off('playerMoved', onPlayerMoved);
          socket.off('playerDisconnected', onPlayerDisconnected);
          clearInterval(pingInterval);
        };
    } else {
        disconnectSocket();
        setPlayers({});
        setQueuePosition(null);
        setIsLoginReady(false);
    }
  }, [appState]);

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

  // Called when 3D Play Button is clicked
  const handleStartQueue = () => {
      setAppState('QUEUE');
  };

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative select-none touch-none">
      
      {/* --- MENU / QUEUE STATE --- */}
      {(appState === 'MENU' || appState === 'QUEUE') && (
          <MainMenu 
            onStartQueue={handleStartQueue}
            queuePosition={queuePosition}
            isReady={isLoginReady}
          />
      )}

      {/* --- GAME STATE --- */}
      {appState === 'GAME' && (
        <>
            {/* 3D Game Layer */}
            <div className="absolute inset-0 z-0">
                <GameScene 
                    joystickData={joystickRef} 
                    cameraRotation={cameraRotationRef} 
                    jumpPressed={jumpRef}
                    players={players} 
                    myId={myId}
                />
            </div>

            {/* Crosshair */}
            <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_2px_rgba(0,0,0,0.8)] z-10 pointer-events-none opacity-80" />

            {/* UI Layer */}
            <div className="absolute top-0 left-0 right-0 p-4 z-10 pointer-events-none flex justify-between items-start">
                
                {/* Left: Notifications (Exit Button Removed) */}
                <div className="flex flex-col gap-2 items-start">
                    {notifications.map((msg, i) => (
                        <div key={i} className="bg-black/50 text-white px-3 py-1 rounded-md text-sm animate-fade-in-down">
                            {msg}
                        </div>
                    ))}
                </div>

                {/* Right: Ping Indicator */}
                <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
                    <div className={`w-2 h-2 rounded-full ${ping < 100 ? 'bg-green-500' : ping < 200 ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
                    <span className="text-white text-xs font-mono">{ping} ms</span>
                </div>
            </div>

            {/* Controls Layer */}
            <div className="absolute inset-0 z-20 flex">
                {/* Left: Joystick */}
                <div className="w-1/2 h-full relative flex items-end justify-start p-12 pointer-events-none">
                    <div className="pointer-events-auto">
                        <Joystick onMove={handleJoystickMove} />
                    </div>
                </div>

                {/* Right: Look & Jump */}
                <div className="w-1/2 h-full relative pointer-events-auto">
                    {/* Look Area */}
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
                    
                    <div className="absolute bottom-36 right-16 text-white/30 text-xs pointer-events-none text-center">
                        Drag area to Look
                    </div>
                </div>
            </div>
        </>
      )}
      
      {/* Mobile Orientation Warning */}
      <div className="hidden portrait:flex absolute inset-0 bg-black/90 z-50 items-center justify-center text-white text-center p-8">
        <p className="text-xl font-bold">Please rotate your device to landscape mode.</p>
      </div>

    </div>
  );
}

export default App;