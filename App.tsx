import { useEffect, useRef, useState } from 'react';
import { Joystick } from './components/Joystick';
import { TouchLook } from './components/TouchLook';
import { GameScene } from './components/GameScene';
import { MainMenu } from './components/MainMenu';
import { connectSocket, disconnectSocket, socket } from './services/socketService';
import { JoystickData, PlayerState } from './types';

type AppState = 'MENU' | 'GAME';

function App() {
  const [appState, setAppState] = useState<AppState>('MENU');
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);

  // Mutable refs for high-frequency updates
  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.3 });
  const jumpRef = useRef<boolean>(false);

  // Handle Socket Connection based on App State
  useEffect(() => {
    // Only connect socket when entering GAME
    if (appState === 'GAME') {
        connectSocket();

        const onConnect = () => {
          console.log("Connected with ID:", socket.id);
          setMyId(socket.id || null);
        };

        const onCurrentPlayers = (serverPlayers: Record<string, PlayerState>) => {
          setPlayers(serverPlayers);
        };

        const onNewPlayer = (player: PlayerState) => {
          setPlayers((prev) => ({ ...prev, [player.id]: player }));
          addNotification(`Player joined`);
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
        socket.on('currentPlayers', onCurrentPlayers);
        socket.on('newPlayer', onNewPlayer);
        socket.on('playerMoved', onPlayerMoved);
        socket.on('playerDisconnected', onPlayerDisconnected);

        return () => {
          socket.off('connect', onConnect);
          socket.off('currentPlayers', onCurrentPlayers);
          socket.off('newPlayer', onNewPlayer);
          socket.off('playerMoved', onPlayerMoved);
          socket.off('playerDisconnected', onPlayerDisconnected);
        };
    } else {
        disconnectSocket();
        setPlayers({});
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
    // Y-axis controls pitch (looking up/down)
    cameraRotationRef.current.pitch -= dy * sensitivity;
  };

  const handleJump = () => {
    jumpRef.current = true;
  };

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative select-none touch-none">
      
      {/* --- MAIN MENU STATE --- */}
      {appState === 'MENU' && (
          <MainMenu 
            onPlay={() => setAppState('GAME')} 
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

            {/* UI Layer */}
            <div className="absolute top-0 left-0 p-4 z-10 pointer-events-none">
                <div className="flex flex-col gap-2">
                    {notifications.map((msg, i) => (
                        <div key={i} className="bg-black/50 text-white px-3 py-1 rounded-md text-sm animate-fade-in-down">
                            {msg}
                        </div>
                    ))}
                </div>
                <button 
                    className="mt-4 pointer-events-auto bg-red-500/50 text-white px-3 py-1 rounded text-xs border border-red-400 hover:bg-red-500"
                    onClick={() => setAppState('MENU')}
                >
                    Exit
                </button>
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
                    
                    {/* Jump Button - Anchored Bottom Right */}
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