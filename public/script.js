const socket = io();

// DOM Elements
const loginModal = document.getElementById('login-modal');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const loginError = document.getElementById('login-error');
const chatContainer = document.getElementById('chat-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messagesArea = document.getElementById('messages');
const recentChatsList = document.getElementById('recent-chats-list');
const logoutBtn = document.getElementById('logout-btn');
const currentChatPartner = document.getElementById('current-chat-partner');
const searchUserInput = document.getElementById('search-user-input');
const searchUserBtn = document.getElementById('search-user-btn');
const searchError = document.getElementById('search-error');
const emptyState = document.getElementById('empty-state');

// State
let currentUser = null;
let activeChat = null; // Username of the person we are currently chatting with
let conversations = {}; // { username: [ { from, to, text, time } ] }
let recentContacts = []; // [username1, username2] - ordered list

// Check LocalStorage on load
const savedUsername = localStorage.getItem('chat_username');
const savedToken = localStorage.getItem('chat_token');
const savedContacts = localStorage.getItem('chat_contacts');
const savedConversations = localStorage.getItem('chat_conversations');

if (savedContacts) {
    recentContacts = JSON.parse(savedContacts);
}
// Optional: Load conversations if we want persistence across reload
// For "temporary message site", maybe we only persist contacts?
// But "If user opens multiple tabs then the message will update in every tab."
// This implies some shared state or fetching.
// Let's persist conversations too for better UX on reload.
if (savedConversations) {
    conversations = JSON.parse(savedConversations);
}

if (savedUsername) {
    // Attempt auto-login
    login(savedUsername, savedToken);
}

// Login Form Submit
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (username) {
        login(username, null);
    }
});

function login(username, token) {
    socket.emit('login', { username, token }, (response) => {
        if (response.success) {
            currentUser = response.username;
            localStorage.setItem('chat_username', response.username);
            if (response.token) {
                localStorage.setItem('chat_token', response.token);
            }

            // UI Updates
            loginModal.classList.add('hidden');
            chatContainer.classList.remove('hidden');
            usernameInput.value = '';
            loginError.textContent = '';

            renderRecentChats();
        } else {
            // Login failed
            if (token) {
                // If auto-login failed (e.g. server restart), clear storage and show login
                handleLogout();
            } else {
                // Manual login failed (username taken)
                loginError.textContent = response.message;
            }
        }
    });
}

// Logout
logoutBtn.addEventListener('click', () => {
    socket.emit('logout');
    handleLogout();
});

function handleLogout() {
    localStorage.removeItem('chat_username');
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_contacts');
    localStorage.removeItem('chat_conversations');
    location.reload(); // Reload to reset state and show login
}

// Socket Events
socket.on('force_logout', () => {
    handleLogout();
});

socket.on('user_logged_out_clear_data', ({ username }) => {
    // Remove from conversations
    if (conversations[username]) {
        delete conversations[username];
    }

    // Remove from recent contacts
    recentContacts = recentContacts.filter(u => u !== username);

    // Save updates
    saveData();

    // Update UI
    renderRecentChats();

    // If currently chatting with this user, clear the view
    if (activeChat === username) {
        activeChat = null;
        currentChatPartner.textContent = 'Select a user to chat';
        messagesArea.classList.add('hidden');
        messageForm.classList.add('hidden');
        emptyState.classList.remove('hidden');
        // Optional: Alert the user
        alert(`User ${username} has logged out. Chat history cleared.`);
    }
});

socket.on('receive_private_message', (data) => {
    const otherUser = data.from === currentUser ? data.to : data.from;

    // Add to conversation
    if (!conversations[otherUser]) {
        conversations[otherUser] = [];
    }
    conversations[otherUser].push(data);
    saveData();

    // Update Recent Contacts (move to top)
    updateRecentContacts(otherUser);

    // If currently chatting with this user, append message
    if (activeChat === otherUser) {
        appendMessage(data);
    } else {
        // Optional: Show unread badge (not implemented yet)
        renderRecentChats(); // Re-render to show updated order/preview
    }
});

// Search User
searchUserBtn.addEventListener('click', performSearch);
searchUserInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
});

function performSearch() {
    const targetUser = searchUserInput.value.trim();
    if (!targetUser) return;
    if (targetUser === currentUser) {
        searchError.textContent = "You cannot chat with yourself.";
        return;
    }

    socket.emit('search_user', targetUser, (response) => {
        if (response.success) {
            searchError.textContent = '';
            searchUserInput.value = '';
            startChat(targetUser);
        } else {
            searchError.textContent = response.message;
        }
    });
}

function startChat(username) {
    if (!conversations[username]) {
        conversations[username] = [];
    }
    updateRecentContacts(username);
    setActiveChat(username);
}

function updateRecentContacts(username) {
    // Remove if exists
    recentContacts = recentContacts.filter(u => u !== username);
    // Add to front
    recentContacts.unshift(username);
    saveData();
    renderRecentChats();
}

function renderRecentChats() {
    recentChatsList.innerHTML = '';
    recentContacts.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user;
        if (user === activeChat) {
            li.classList.add('active');
        }
        li.addEventListener('click', () => setActiveChat(user));
        recentChatsList.appendChild(li);
    });
}

function setActiveChat(username) {
    activeChat = username;
    currentChatPartner.textContent = `Chat with ${username}`;

    // Show chat area
    messagesArea.classList.remove('hidden');
    messageForm.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Render messages
    messagesArea.innerHTML = '';
    const msgs = conversations[username] || [];
    msgs.forEach(msg => appendMessage(msg));

    // Highlight in sidebar
    renderRecentChats();
}

// Send Message
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (message && activeChat) {
        socket.emit('send_private_message', { to: activeChat, message });
        messageInput.value = '';
    }
});

function appendMessage(data) {
    const div = document.createElement('div');
    const isOwn = data.from === currentUser;
    div.classList.add('message', isOwn ? 'own' : 'other');

    div.innerHTML = `
        <div class="meta">
            <span>${isOwn ? 'You' : data.from}</span>
            <span>${data.time}</span>
        </div>
        <div class="content">${escapeHtml(data.text)}</div>
    `;

    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function saveData() {
    localStorage.setItem('chat_contacts', JSON.stringify(recentContacts));
    localStorage.setItem('chat_conversations', JSON.stringify(conversations));
}
