import React, { useEffect, useRef, useState } from 'react';
import { Joystick } from './components/Joystick';
import { TouchLook } from './components/TouchLook';
import { GameScene } from './components/GameScene';
import { connectSocket, disconnectSocket, socket } from './services/socketService';
import { JoystickData, PlayerState } from './types';

function App() {
  const [players, setPlayers] = useState<Record<string, PlayerState>>({});
  const [myId, setMyId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);

  // Mutable refs for high-frequency updates to avoid React re-renders in the game loop
  const joystickRef = useRef<JoystickData>({ x: 0, y: 0 });
  const cameraRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0.3 });

  useEffect(() => {
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
      disconnectSocket();
    };
  }, []);

  const addNotification = (msg: string) => {
    setNotifications(prev => [...prev.slice(-4), msg]); // Keep last 5
    // Auto clear after 3 sec
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
    cameraRotationRef.current.pitch -= dy * sensitivity;
  };

  return (
    <div className="w-full h-screen bg-black overflow-hidden relative select-none touch-none">
      
      {/* 3D Game Layer */}
      <div className="absolute inset-0 z-0">
        <GameScene 
            joystickData={joystickRef} 
            cameraRotation={cameraRotationRef} 
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
      </div>

      {/* Controls Layer */}
      <div className="absolute inset-0 z-20 flex">
        {/* Left Side: Joystick */}
        <div className="w-1/2 h-full relative flex items-end justify-start p-12 pointer-events-none">
             {/* Container specifically for joystick to accept pointer events */}
             <div className="pointer-events-auto">
                <Joystick onMove={handleJoystickMove} />
             </div>
        </div>

        {/* Right Side: Camera Touch Area */}
        <div className="w-1/2 h-full relative pointer-events-auto">
            <TouchLook onRotate={handleCameraRotate} />
            <div className="absolute bottom-12 right-12 text-white/30 text-sm pointer-events-none">
                Drag to Look
            </div>
        </div>
      </div>
      
      {/* Mobile Orientation Warning (Optional aesthetics) */}
      <div className="hidden portrait:flex absolute inset-0 bg-black/90 z-50 items-center justify-center text-white text-center p-8">
        <p className="text-xl font-bold">Please rotate your device to landscape mode for the best experience.</p>
      </div>

    </div>
  );
}

export default App;
