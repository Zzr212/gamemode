import React, { useState } from 'react';
import { UserProfile } from '../types';

interface AuthScreenProps {
  onLogin: (user: UserProfile) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const endpoint = isRegistering ? '/api/register' : '/api/login';
    const payload = isRegistering 
        ? { username, email, password } 
        : { username, password };

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success) {
            onLogin(data.user);
        } else {
            setError(data.error || 'Authentication failed');
        }
    } catch (err) {
        setError('Network error. Please try again.');
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-slate-900 flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-md space-y-8">
        
        {/* Header */}
        <div className="text-center">
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 tracking-tighter">
                HIDE ONLINE
            </h1>
            <p className="mt-2 text-sm text-gray-400">
                {isRegistering ? 'Create your profile' : 'Sign in to play'}
            </p>
        </div>

        {/* Form Container */}
        <div className="bg-slate-800/50 backdrop-blur-lg border border-slate-700 p-8 rounded-2xl shadow-xl">
            <form onSubmit={handleSubmit} className="space-y-5">
                
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg text-center">
                        {error}
                    </div>
                )}

                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Username</label>
                    <input 
                        type="text" 
                        required 
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        className="w-full bg-slate-900/50 border border-slate-600 text-white text-lg rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 outline-none transition-all placeholder-gray-600"
                        placeholder="Player123"
                    />
                </div>

                {isRegistering && (
                    <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Email</label>
                        <input 
                            type="email" 
                            required 
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full bg-slate-900/50 border border-slate-600 text-white text-lg rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 outline-none transition-all placeholder-gray-600"
                            placeholder="you@example.com"
                        />
                    </div>
                )}

                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Password</label>
                    <input 
                        type="password" 
                        required 
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full bg-slate-900/50 border border-slate-600 text-white text-lg rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 outline-none transition-all placeholder-gray-600"
                        placeholder="••••••••"
                    />
                </div>

                <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-lg text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                >
                    {loading ? 'Processing...' : (isRegistering ? 'CREATE ACCOUNT' : 'LOGIN')}
                </button>
            </form>

            {/* Toggle */}
            <div className="mt-6 text-center">
                <p className="text-gray-400 text-sm">
                    {isRegistering ? 'Already have an ID?' : 'New player?'}
                    <button 
                        onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
                        className="ml-2 font-bold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                        {isRegistering ? 'Login here' : 'Register now'}
                    </button>
                </p>
            </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-500 text-xs">
            Build v1.2 • Mobile Optimized
        </div>

      </div>
    </div>
  );
};