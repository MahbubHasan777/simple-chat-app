const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users: { username: { socketIds: Set<string>, token: string, lastActive: number } }
const users = {};

const INACTIVITY_TIMEOUT = 60 * 60 * 1000; // 1 hour in milliseconds

// Check for inactive users every minute
setInterval(() => {
    const now = Date.now();
    for (const username in users) {
        if (now - users[username].lastActive > INACTIVITY_TIMEOUT) {
            console.log(`Logging out inactive user: ${username}`);
            logoutUser(username);
        }
    }
}, 60 * 1000);

function logoutUser(username) {
    if (users[username]) {
        const userSockets = users[username].sockets;
        io.to(username).emit('force_logout');

        // Notify ALL users to clear chat history with this user
        io.emit('user_logged_out_clear_data', { username });

        userSockets.forEach(socketId => {
            const s = io.sockets.sockets.get(socketId);
            if (s) {
                s.username = null;
            }
        });

        delete users[username];
    }
}

io.on('connection', (socket) => {
    // console.log('A user connected:', socket.id);

    socket.on('login', ({ username, token }, callback) => {
        if (!username) return callback({ success: false, message: 'Username required' });

        if (users[username]) {
            // User exists
            if (users[username].token === token) {
                // Correct token, it's the same user (new tab)
                users[username].sockets.add(socket.id);
                users[username].lastActive = Date.now(); // Update activity
                socket.username = username;
                socket.join(username);

                callback({ success: true, username: username, token: token });
            } else {
                // Wrong token, username taken
                callback({ success: false, message: 'Username is already taken.' });
            }
        } else {
            // New user
            const newToken = token || Math.random().toString(36).substr(2) + Date.now().toString(36);

            users[username] = {
                token: newToken,
                sockets: new Set([socket.id]),
                lastActive: Date.now()
            };

            socket.username = username;
            socket.join(username);

            callback({ success: true, username: username, token: newToken });
        }
    });

    socket.on('search_user', (targetUsername, callback) => {
        if (socket.username && users[socket.username]) {
            users[socket.username].lastActive = Date.now(); // Update activity
        }

        if (users[targetUsername]) {
            callback({ success: true });
        } else {
            callback({ success: false, message: 'User not found' });
        }
    });

    socket.on('send_private_message', ({ to, message }) => {
        if (!socket.username) return;

        if (users[socket.username]) {
            users[socket.username].lastActive = Date.now(); // Update activity
        }

        const data = {
            from: socket.username,
            to: to,
            text: message,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        // Send to recipient
        if (users[to]) {
            io.to(to).emit('receive_private_message', data);
        }

        // Send back to sender (for other tabs of the sender)
        io.to(socket.username).emit('receive_private_message', data);
    });

    socket.on('logout', () => {
        const username = socket.username;
        logoutUser(username);
    });

    socket.on('disconnect', () => {
        const username = socket.username;
        if (username && users[username]) {
            users[username].sockets.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
