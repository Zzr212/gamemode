import React, { useState } from 'react';
import { GameSettings, PlayerState, TaskType, Vector3, TaskLocation } from '../types';

interface AdminPanelProps {
  players: Record<string, PlayerState>;
  settings: GameSettings;
  taskSpawns: TaskLocation[];
  myPosition: Vector3;
  onClose: () => void;
  onUpdateSettings: (s: GameSettings) => void;
  onBanPlayer: (username: string) => void;
  onAddTaskSpawn: (type: TaskType, pos: Vector3) => void;
  onRemoveTaskSpawn: (id: string) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ 
    players, settings, taskSpawns, myPosition, onClose, 
    onUpdateSettings, onBanPlayer, onAddTaskSpawn, onRemoveTaskSpawn 
}) => {
  const [activeTab, setActiveTab] = useState<'PLAYERS' | 'SETTINGS' | 'VISION' | 'TASKS'>('PLAYERS');
  const [localSettings, setLocalSettings] = useState<GameSettings>(settings);

  const handleSaveSettings = () => {
      onUpdateSettings(localSettings);
  };

  return (
    <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center pointer-events-auto p-4">
      <div className="w-full max-w-3xl bg-slate-800 rounded-xl border border-slate-600 shadow-2xl overflow-hidden flex flex-col md:flex-row h-[80vh]">
        
        {/* SIDEBAR */}
        <div className="w-full md:w-48 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-700 p-4 flex flex-col gap-2">
            <h2 className="text-xl font-black text-blue-400 mb-4 tracking-tighter">ADMIN</h2>
            
            <button onClick={() => setActiveTab('PLAYERS')} className={`admin-tab-btn ${activeTab === 'PLAYERS' ? 'active' : ''}`}>PLAYERS</button>
            <button onClick={() => setActiveTab('TASKS')} className={`admin-tab-btn ${activeTab === 'TASKS' ? 'active' : ''}`}>TASKS</button>
            <button onClick={() => setActiveTab('SETTINGS')} className={`admin-tab-btn ${activeTab === 'SETTINGS' ? 'active' : ''}`}>SETTINGS</button>
            <button onClick={() => setActiveTab('VISION')} className={`admin-tab-btn ${activeTab === 'VISION' ? 'active' : ''}`}>VISION</button>

            <div className="flex-1" />
            <button onClick={onClose} className="text-left px-4 py-3 rounded-lg text-sm font-bold text-red-400 hover:bg-red-900/30">CLOSE</button>
        </div>

        {/* CONTENT */}
        <div className="flex-1 p-6 overflow-y-auto bg-slate-800">
            
            {activeTab === 'PLAYERS' && (
                <div className="space-y-4">
                    <h3 className="text-lg font-bold text-white mb-2">ACTIVE PLAYERS</h3>
                    <div className="space-y-2">
                        {Object.values(players).map(p => (
                            <div key={p.id} className="flex items-center justify-between bg-slate-700/50 p-3 rounded-lg border border-slate-600">
                                <div>
                                    <div className="text-white font-bold text-sm">{p.username}</div>
                                    <div className="text-xs text-slate-400">{p.role} {p.isAdmin && '• ADMIN'}</div>
                                </div>
                                {!p.isAdmin && <button onClick={() => { if(confirm(`Ban ${p.username}?`)) onBanPlayer(p.username); }} className="bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white px-3 py-1 rounded text-xs font-bold">BAN</button>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'TASKS' && (
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white">TASK SPAWNER</h3>
                    <div className="bg-slate-700/50 p-3 rounded text-xs text-gray-300 border border-slate-600">
                        Current Position: <span className="text-green-400 font-mono">X:{myPosition.x.toFixed(1)}, Y:{myPosition.y.toFixed(1)}, Z:{myPosition.z.toFixed(1)}</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Object.values(TaskType).map(type => (
                            <div key={type} className="flex items-center justify-between bg-slate-900 p-3 rounded border border-slate-700">
                                <span className="text-white text-xs font-bold">{type}</span>
                                <button 
                                    onClick={() => onAddTaskSpawn(type, myPosition)}
                                    className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-1 px-3 rounded shadow"
                                >
                                    ADD HERE
                                </button>
                            </div>
                        ))}
                    </div>

                    <h3 className="text-lg font-bold text-white mt-4">EXISTING SPAWNS ({taskSpawns.length})</h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                        {taskSpawns.map(t => (
                            <div key={t.id} className="flex justify-between items-center bg-black/30 p-2 rounded text-xs text-gray-300 border border-white/5">
                                <span>{t.type} <span className="text-gray-500 font-mono">({t.position.x.toFixed(0)}, {t.position.z.toFixed(0)})</span></span>
                                <button onClick={() => onRemoveTaskSpawn(t.id)} className="bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white px-2 py-1 rounded">DEL</button>
                            </div>
                        ))}
                        {taskSpawns.length === 0 && <div className="text-gray-500 italic text-sm">No tasks added yet.</div>}
                    </div>
                </div>
            )}

            {activeTab === 'SETTINGS' && (
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-4">GAMEPLAY SETTINGS</h3>
                    
                    {/* Round Duration */}
                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>ROUND DURATION (Seconds)</span>
                            <span className="text-blue-400">{localSettings.roundDuration}s</span>
                        </div>
                        <input type="range" min="60" max="600" step="30" value={localSettings.roundDuration} onChange={(e) => setLocalSettings({...localSettings, roundDuration: parseInt(e.target.value)})} className="w-full accent-blue-500" />
                    </div>

                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>HUNTER SPEED</span>
                            <span className="text-blue-400">{localSettings.hunterSpeed.toFixed(1)}</span>
                        </div>
                        <input type="range" min="3" max="15" step="0.5" value={localSettings.hunterSpeed} onChange={(e) => setLocalSettings({...localSettings, hunterSpeed: parseFloat(e.target.value)})} className="w-full accent-blue-500" />
                    </div>

                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>HIDER SPEED</span>
                            <span className="text-green-400">{localSettings.hiderSpeed.toFixed(1)}</span>
                        </div>
                        <input type="range" min="3" max="15" step="0.5" value={localSettings.hiderSpeed} onChange={(e) => setLocalSettings({...localSettings, hiderSpeed: parseFloat(e.target.value)})} className="w-full accent-green-500" />
                    </div>

                    <button onClick={handleSaveSettings} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg">APPLY CHANGES</button>
                </div>
            )}

            {activeTab === 'VISION' && (
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-4">HUNTER VISION</h3>
                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>VISION RADIUS (Spotlight)</span>
                            <span className="text-yellow-400">{localSettings.hunterVisionRadius}</span>
                        </div>
                        <input type="range" min="5" max="40" step="1" value={localSettings.hunterVisionRadius} onChange={(e) => setLocalSettings({...localSettings, hunterVisionRadius: parseFloat(e.target.value)})} className="w-full accent-yellow-500" />
                    </div>
                    <button onClick={handleSaveSettings} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg">APPLY CHANGES</button>
                </div>
            )}

        </div>
      </div>
      <style>{`
        .admin-tab-btn { @apply text-left px-4 py-3 rounded-lg text-sm font-bold transition-all text-slate-400 hover:bg-slate-800 hover:text-white; }
        .admin-tab-btn.active { @apply bg-blue-600 text-white shadow-lg; }
      `}</style>
    </div>
  );
};