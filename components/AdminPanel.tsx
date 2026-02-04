import React, { useState } from 'react';
import { GameSettings, PlayerState } from '../types';

interface AdminPanelProps {
  players: Record<string, PlayerState>;
  settings: GameSettings;
  onClose: () => void;
  onUpdateSettings: (s: GameSettings) => void;
  onBanPlayer: (username: string) => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ players, settings, onClose, onUpdateSettings, onBanPlayer }) => {
  const [activeTab, setActiveTab] = useState<'PLAYERS' | 'SETTINGS' | 'VISION'>('PLAYERS');
  
  // Local state for sliders to avoid too many socket emits on drag
  const [localSettings, setLocalSettings] = useState<GameSettings>(settings);

  const handleSaveSettings = () => {
      onUpdateSettings(localSettings);
  };

  return (
    <div className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center pointer-events-auto p-4">
      <div className="w-full max-w-2xl bg-slate-800 rounded-xl border border-slate-600 shadow-2xl overflow-hidden flex flex-col md:flex-row h-[80vh]">
        
        {/* SIDEBAR */}
        <div className="w-full md:w-48 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-700 p-4 flex flex-col gap-2">
            <h2 className="text-xl font-black text-blue-400 mb-4 tracking-tighter">ADMIN</h2>
            
            <button 
                onClick={() => setActiveTab('PLAYERS')}
                className={`text-left px-4 py-3 rounded-lg text-sm font-bold transition-all ${activeTab === 'PLAYERS' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
                PLAYERS LIST
            </button>
            <button 
                onClick={() => setActiveTab('SETTINGS')}
                className={`text-left px-4 py-3 rounded-lg text-sm font-bold transition-all ${activeTab === 'SETTINGS' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
                GAMEPLAY
            </button>
            <button 
                onClick={() => setActiveTab('VISION')}
                className={`text-left px-4 py-3 rounded-lg text-sm font-bold transition-all ${activeTab === 'VISION' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
                VISION
            </button>

            <div className="flex-1" />
            <button onClick={onClose} className="text-left px-4 py-3 rounded-lg text-sm font-bold text-red-400 hover:bg-red-900/30">
                CLOSE PANEL
            </button>
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
                                    <div className="text-xs text-slate-400">{p.role} • {p.isAdmin ? 'ADMIN' : 'PLAYER'}</div>
                                </div>
                                {!p.isAdmin && (
                                    <button 
                                        onClick={() => {
                                            if(confirm(`Ban ${p.username}?`)) onBanPlayer(p.username);
                                        }}
                                        className="bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white px-3 py-1 rounded text-xs font-bold transition-colors"
                                    >
                                        BAN
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'SETTINGS' && (
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-4">MOVEMENT SPEEDS</h3>
                    
                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>HUNTER SPEED</span>
                            <span className="text-blue-400">{localSettings.hunterSpeed.toFixed(1)}</span>
                        </div>
                        <input 
                            type="range" min="3" max="15" step="0.5"
                            value={localSettings.hunterSpeed}
                            onChange={(e) => setLocalSettings({...localSettings, hunterSpeed: parseFloat(e.target.value)})}
                            className="w-full accent-blue-500"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>HIDER SPEED</span>
                            <span className="text-green-400">{localSettings.hiderSpeed.toFixed(1)}</span>
                        </div>
                        <input 
                            type="range" min="3" max="15" step="0.5"
                            value={localSettings.hiderSpeed}
                            onChange={(e) => setLocalSettings({...localSettings, hiderSpeed: parseFloat(e.target.value)})}
                            className="w-full accent-green-500"
                        />
                    </div>

                    <button 
                        onClick={handleSaveSettings} 
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg active:scale-95 transition-transform"
                    >
                        APPLY CHANGES
                    </button>
                </div>
            )}

            {activeTab === 'VISION' && (
                <div className="space-y-6">
                    <h3 className="text-lg font-bold text-white mb-4">HUNTER VISION CONFIG</h3>
                    <p className="text-xs text-slate-400 mb-4 bg-slate-900/50 p-2 rounded">
                        Adjust how the Fog of War behaves for the Hunter.
                    </p>

                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
                            <span>VISION RADIUS (Spotlight Range)</span>
                            <span className="text-yellow-400">{localSettings.hunterVisionRadius}</span>
                        </div>
                        <input 
                            type="range" min="5" max="40" step="1"
                            value={localSettings.hunterVisionRadius}
                            onChange={(e) => setLocalSettings({...localSettings, hunterVisionRadius: parseFloat(e.target.value)})}
                            className="w-full accent-yellow-500"
                        />
                    </div>

                    <button 
                        onClick={handleSaveSettings} 
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg active:scale-95 transition-transform"
                    >
                        APPLY CHANGES
                    </button>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};
