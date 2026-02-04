import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { GameSettings } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BANNED_FILE = path.join(DATA_DIR, 'banned.json');
const SPAWN_FILE = path.join(DATA_DIR, 'spawn.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Initialize files if not exist
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
if (!fs.existsSync(BANNED_FILE)) fs.writeFileSync(BANNED_FILE, JSON.stringify({ banned: [] }, null, 2));
if (!fs.existsSync(SPAWN_FILE)) fs.writeFileSync(SPAWN_FILE, JSON.stringify({ center: { x: 0, y: 3, z: 0 } }, null, 2));

const DEFAULT_SETTINGS: GameSettings = {
    hunterSpeed: 7.0,
    hiderSpeed: 6.0,
    hunterVisionRadius: 15,
    hunterVisionAngle: 0.8
};

if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));

interface UserRecord {
    id: string;
    username: string;
    email: string;
    password: string;
    isAdmin?: boolean;
}

export const db = {
    getUsers: (): UserRecord[] => {
        try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')).users; } catch (e) { return []; }
    },

    saveUser: (user: UserRecord) => {
        const users = db.getUsers();
        // Check if updating existing
        const index = users.findIndex(u => u.id === user.id);
        if (index >= 0) {
            users[index] = user;
        } else {
            users.push(user);
        }
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
    },

    setAdminStatus: (userId: string, isAdmin: boolean) => {
        const users = db.getUsers();
        const user = users.find(u => u.id === userId);
        if (user) {
            user.isAdmin = isAdmin;
            fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
            return true;
        }
        return false;
    },

    findUserByUsername: (username: string) => {
        const users = db.getUsers();
        return users.find(u => u.username.toLowerCase() === username.toLowerCase());
    },

    createUser: (username: string, email: string, password: string) => {
        const newUser: UserRecord = {
            id: uuidv4(),
            username,
            email,
            password,
            isAdmin: false
        };
        db.saveUser(newUser);
        return { id: newUser.id, username: newUser.username, email: newUser.email, isAdmin: false };
    },
    
    validateLogin: (username: string, password: string) => {
        const user = db.findUserByUsername(username);
        if (user && user.password === password) {
            return { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin || false };
        }
        return null;
    },

    // --- BAN SYSTEM ---
    getBanned: (): string[] => { // Returns usernames
        try { return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf-8')).banned; } catch (e) { return []; }
    },

    addBan: (username: string) => {
        const list = db.getBanned();
        if (!list.includes(username.toLowerCase())) {
            list.push(username.toLowerCase());
            fs.writeFileSync(BANNED_FILE, JSON.stringify({ banned: list }, null, 2));
        }
    },

    removeBan: (username: string) => {
        let list = db.getBanned();
        list = list.filter(u => u !== username.toLowerCase());
        fs.writeFileSync(BANNED_FILE, JSON.stringify({ banned: list }, null, 2));
    },

    isBanned: (username: string) => {
        const list = db.getBanned();
        return list.includes(username.toLowerCase());
    },

    // --- SPAWN SYSTEM ---
    getSpawnCenter: () => {
        try { return JSON.parse(fs.readFileSync(SPAWN_FILE, 'utf-8')).center; } 
        catch (e) { return { x: 0, y: 3, z: 0 }; }
    },

    setSpawnCenter: (x: number, y: number, z: number) => {
        fs.writeFileSync(SPAWN_FILE, JSON.stringify({ center: { x, y, z } }, null, 2));
    },

    // --- GAME SETTINGS ---
    getSettings: (): GameSettings => {
        try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); }
        catch (e) { return DEFAULT_SETTINGS; }
    },

    saveSettings: (settings: GameSettings) => {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    }
};
