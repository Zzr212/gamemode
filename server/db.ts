import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Initialize file if not exists
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
}

interface UserRecord {
    id: string;
    username: string;
    email: string;
    password: string; // In a real app, hash this!
}

export const db = {
    getUsers: (): UserRecord[] => {
        try {
            const data = fs.readFileSync(USERS_FILE, 'utf-8');
            return JSON.parse(data).users;
        } catch (e) {
            return [];
        }
    },

    saveUser: (user: UserRecord) => {
        const users = db.getUsers();
        users.push(user);
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
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
            password 
        };
        db.saveUser(newUser);
        return { id: newUser.id, username: newUser.username, email: newUser.email };
    },
    
    validateLogin: (username: string, password: string) => {
        const user = db.findUserByUsername(username);
        if (user && user.password === password) {
            return { id: user.id, username: user.username, email: user.email };
        }
        return null;
    }
};