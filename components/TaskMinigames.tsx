import React, { useState, useEffect } from 'react';
import { TaskType } from '../types';

interface TaskProps {
  onComplete: () => void;
  onClose: () => void;
}

// 1. Fix Wires
export const WireTask: React.FC<TaskProps> = ({ onComplete, onClose }) => {
    const colors = ['red', 'blue', 'yellow', 'green'];
    const [left] = useState([...colors].sort(() => Math.random() - 0.5));
    const [right] = useState([...colors].sort(() => Math.random() - 0.5));
    const [connections, setConnections] = useState<Record<string, string>>({});
    const [selected, setSelected] = useState<string | null>(null);

    const handleSelect = (color: string) => {
        if (!selected) setSelected(color);
        else {
            if (color === selected) {
                setConnections(prev => ({ ...prev, [selected]: color }));
            }
            setSelected(null);
        }
    };

    useEffect(() => {
        if (Object.keys(connections).length === 4) setTimeout(onComplete, 500);
    }, [connections, onComplete]);

    return (
        <div className="w-80 bg-gray-900 border-4 border-gray-600 rounded-lg p-4 flex justify-between relative">
            <h3 className="absolute -top-10 left-0 text-white font-bold bg-black/50 px-2">CONNECT WIRES</h3>
            <div className="flex flex-col gap-4">
                {left.map(c => (
                    <button 
                        key={c} 
                        onClick={() => handleSelect(c)}
                        className={`w-12 h-12 rounded-full border-4 ${connections[c] ? 'opacity-50' : 'hover:scale-110'} transition-transform`}
                        style={{ backgroundColor: c, borderColor: selected === c ? 'white' : 'transparent' }}
                    />
                ))}
            </div>
            <div className="flex flex-col gap-4">
                {right.map(c => (
                    <button 
                        key={c} 
                        onClick={() => selected && handleSelect(c)}
                        className={`w-12 h-12 rounded-full border-4 ${Object.values(connections).includes(c) ? 'opacity-50' : ''}`}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>
            <button onClick={onClose} className="absolute -top-10 right-0 text-red-500 font-bold bg-white px-2 rounded">X</button>
        </div>
    );
};

// 2. Download
export const DownloadTask: React.FC<TaskProps> = ({ onComplete, onClose }) => {
    const [progress, setProgress] = useState(0);
    const [running, setRunning] = useState(false);

    useEffect(() => {
        if (running) {
            const int = setInterval(() => {
                setProgress(p => {
                    if (p >= 100) {
                        clearInterval(int);
                        setTimeout(onComplete, 500);
                        return 100;
                    }
                    return p + 2;
                });
            }, 50);
            return () => clearInterval(int);
        }
    }, [running, onComplete]);

    return (
        <div className="w-80 bg-gray-800 border-4 border-blue-500 rounded-lg p-6 flex flex-col items-center gap-4 relative">
             <button onClick={onClose} className="absolute top-2 right-2 text-red-500 font-bold">X</button>
             <h2 className="text-blue-400 font-mono text-xl">DOWNLOADING DATA...</h2>
             <div className="w-full h-8 bg-black rounded overflow-hidden border border-gray-500">
                 <div className="h-full bg-green-500 transition-all duration-75" style={{ width: `${progress}%` }} />
             </div>
             <div className="text-white font-mono">{progress}%</div>
             {!running && (
                 <button onClick={() => setRunning(true)} className="bg-blue-600 px-6 py-2 rounded text-white font-bold shadow-lg active:scale-95">
                     START DOWNLOAD
                 </button>
             )}
        </div>
    );
};

// 3. Repair Antenna (Screws + Switch)
export const AntennaTask: React.FC<TaskProps> = ({ onComplete, onClose }) => {
    const [screws, setScrews] = useState([true, true, true, true]);
    const [opened, setOpened] = useState(false);
    
    const unscrew = (idx: number) => {
        const newScrews = [...screws];
        newScrews[idx] = false;
        setScrews(newScrews);
        if (newScrews.every(s => !s)) setOpened(true);
    };

    return (
        <div className="w-64 h-64 bg-gray-400 rounded-lg relative shadow-xl border-4 border-gray-600">
             <button onClick={onClose} className="absolute -top-8 right-0 text-red-500 font-bold bg-white px-2 rounded">X</button>
            {!opened ? (
                <>
                    <div className="absolute inset-0 flex items-center justify-center text-gray-700 font-bold text-2xl bg-gray-300">PANEL LOCKED</div>
                    {screws[0] && <button onClick={() => unscrew(0)} className="absolute top-2 left-2 w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-200 shadow-md active:rotate-90 transition-transform">X</button>}
                    {screws[1] && <button onClick={() => unscrew(1)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-200 shadow-md active:rotate-90 transition-transform">X</button>}
                    {screws[2] && <button onClick={() => unscrew(2)} className="absolute bottom-2 left-2 w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-200 shadow-md active:rotate-90 transition-transform">X</button>}
                    {screws[3] && <button onClick={() => unscrew(3)} className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-200 shadow-md active:rotate-90 transition-transform">X</button>}
                </>
            ) : (
                <div className="absolute inset-0 bg-gray-800 flex items-center justify-center flex-col gap-4">
                    <div className="text-green-400 font-mono">SYSTEM EXPOSED</div>
                    <button onClick={onComplete} className="w-20 h-20 bg-red-600 rounded-full border-4 border-red-800 shadow-[0_0_20px_red] active:scale-95 flex items-center justify-center text-white font-bold">
                        RESET
                    </button>
                </div>
            )}
        </div>
    );
};

// 4. Refuel
export const RefuelTask: React.FC<TaskProps> = ({ onComplete, onClose }) => {
    const [fuel, setFuel] = useState(0);
    const intervalRef = React.useRef<number | null>(null);

    const startFill = () => {
        intervalRef.current = window.setInterval(() => {
            setFuel(f => {
                if (f >= 100) {
                    if (intervalRef.current) clearInterval(intervalRef.current);
                    setTimeout(onComplete, 500);
                    return 100;
                }
                return f + 1.5;
            });
        }, 30);
    };

    const stopFill = () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
    };

    return (
        <div className="w-64 bg-yellow-600 p-4 rounded-lg border-4 border-yellow-800 flex flex-col gap-4 relative">
            <button onClick={onClose} className="absolute top-1 right-1 text-white font-bold bg-black/20 px-2 rounded">X</button>
            <div className="w-full h-40 bg-gray-900 rounded relative overflow-hidden">
                <div className="absolute bottom-0 left-0 right-0 bg-yellow-400 transition-all duration-75" style={{ height: `${fuel}%` }} />
                <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-2xl drop-shadow-md">{Math.round(fuel)}%</div>
            </div>
            <button 
                onMouseDown={startFill} onMouseUp={stopFill} onMouseLeave={stopFill}
                onTouchStart={startFill} onTouchEnd={stopFill}
                className="w-full py-4 bg-gray-200 rounded text-gray-800 font-bold border-b-4 border-gray-400 active:border-b-0 active:translate-y-1"
            >
                HOLD TO REFUEL
            </button>
        </div>
    );
};

// 5. Unlock Manifold (1-10)
export const UnlockTask: React.FC<TaskProps> = ({ onComplete, onClose }) => {
    const [current, setCurrent] = useState(1);
    
    const handleClick = (num: number) => {
        if (num === current) {
            if (num === 10) onComplete();
            else setCurrent(c => c + 1);
        } else {
            setCurrent(1); // Reset on error
        }
    };

    return (
        <div className="w-72 bg-slate-700 p-4 rounded border-4 border-slate-500 relative">
             <button onClick={onClose} className="absolute -top-8 right-0 text-red-500 font-bold bg-white px-2 rounded">X</button>
            <div className="grid grid-cols-5 gap-2">
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <button 
                        key={n}
                        onClick={() => handleClick(n)}
                        className={`aspect-square flex items-center justify-center font-bold rounded ${n < current ? 'bg-green-500 text-black' : 'bg-slate-900 text-white active:bg-blue-500'}`}
                    >
                        {n}
                    </button>
                ))}
            </div>
        </div>
    );
};

// 6. Prime Shields (Hexagons)
export const ShieldsTask: React.FC<TaskProps> = ({ onComplete, onClose }) => {
    const [hexes, setHexes] = useState([false, false, false, false, false, false, false]);
    
    const handleClick = (idx: number) => {
        const h = [...hexes];
        h[idx] = true;
        setHexes(h);
        if (h.every(x => x)) setTimeout(onComplete, 300);
    };

    return (
        <div className="w-80 bg-red-900 p-6 rounded-lg border-4 border-red-700 flex flex-wrap justify-center gap-2 relative">
             <button onClick={onClose} className="absolute top-1 right-1 text-white font-bold bg-black/20 px-2 rounded">X</button>
            <h3 className="w-full text-center text-white font-bold mb-2">PRIME SHIELDS</h3>
            {hexes.map((active, i) => (
                <button 
                    key={i} 
                    onClick={() => handleClick(i)}
                    className={`w-16 h-16 clip-hex transition-colors ${active ? 'bg-white' : 'bg-red-600 hover:bg-red-500'}`}
                    style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }}
                />
            ))}
        </div>
    );
};

export const TaskDispatcher: React.FC<{ type: TaskType, onComplete: () => void, onClose: () => void }> = ({ type, onComplete, onClose }) => {
    switch (type) {
        case TaskType.WIRES: return <WireTask onComplete={onComplete} onClose={onClose} />;
        case TaskType.DOWNLOAD: return <DownloadTask onComplete={onComplete} onClose={onClose} />;
        case TaskType.ANTENNA: return <AntennaTask onComplete={onComplete} onClose={onClose} />;
        case TaskType.REFUEL: return <RefuelTask onComplete={onComplete} onClose={onClose} />;
        case TaskType.UNLOCK: return <UnlockTask onComplete={onComplete} onClose={onClose} />;
        case TaskType.SHIELDS: return <ShieldsTask onComplete={onComplete} onClose={onClose} />;
        default: return null;
    }
};
