const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const session = require('cookie-session');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const dayjs = require('dayjs');

const APP_NAME = 'ChatTalk';
const ADMIN_PIN = '2103';
const RATE_PER_MIN = 10; // Rs 10 per min
const MIN_RECHARGE = 10; // Minimum Rs 10
const UPI_ID = 'st227335-1@okicici';

// --- Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: 'chattalk_sess',
    secret: 'chattalk_secret_key_change_me',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  })
);

// Ensure data dir
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- Database ---
const db = new sqlite3.Database(path.join(DATA_DIR, 'chattalk.db'));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    ref TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL, -- pending | approved | rejected
    reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    stopped_at TEXT,
    last_billed_minute INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender TEXT NOT NULL, -- 'client' | 'admin'
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(chat_id) REFERENCES chats(id)
  )`);
});

// Helpers
function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin login required' });
  next();
}

function getWallet(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT balance FROM wallets WHERE user_id = ?', [userId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.balance : 0);
    });
  });
}
function setWallet(userId, balance) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO wallets(user_id, balance) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance',
      [userId, balance],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

// Billing timers per user
const billingIntervals = new Map(); // userId -> intervalId

async function startBilling(userId, chatId) {
  // Deduct every minute
  stopBilling(userId);
  const intervalId = setInterval(async () => {
    try {
      const bal = await getWallet(userId);
      if (bal < RATE_PER_MIN) {
        await stopChatByServer(userId, chatId, 'Balance exhausted');
        return;
      }
      await setWallet(userId, bal - RATE_PER_MIN);
      io.to(`user_${userId}`).emit('wallet:update', { balance: bal - RATE_PER_MIN });
      io.to(`user_${userId}`).emit('chat:tick', { charged: RATE_PER_MIN, at: new Date().toISOString() });
    } catch (e) {
      console.error('Billing error', e);
    }
  }, 60 * 1000);
  billingIntervals.set(userId, intervalId);
}
function stopBilling(userId) {
  const id = billingIntervals.get(userId);
  if (id) {
    clearInterval(id);
    billingIntervals.delete(userId);
  }
}

function stopChatByServer(userId, chatId, reason = 'Stopped') {
  return new Promise((resolve, reject) => {
    stopBilling(userId);
    const now = new Date().toISOString();
    db.run('UPDATE chats SET active=0, stopped_at=? WHERE id=?', [now, chatId], function (err) {
      if (err) return reject(err);
      io.to(`user_${userId}`).emit('chat:stopped', { reason });
      io.to('admins').emit('chat:stopped', { userId, chatId, reason });
      resolve(true);
    });
  });
}

// --- Static pages ---
app.get('/', (req, res) => {
  res.type('html').send(clientHTML());
});
app.get('/admin', (req, res) => {
  res.type('html').send(adminHTML());
});

// --- Auth (very simple for demo) ---
app.post('/api/register', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const now = new Date().toISOString();
  db.run('INSERT INTO users(name, created_at) VALUES (?,?)', [name, now], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    const id = this.lastID;
    db.run('INSERT OR IGNORE INTO wallets(user_id, balance) VALUES (?,0)', [id]);
    req.session.userId = id;
    req.session.userName = name;
    return res.json({ id, name });
  });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const balance = await getWallet(req.session.userId);
  res.json({ user: { id: req.session.userId, name: req.session.userName, balance } });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// --- Admin auth ---
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  if (String(pin) === ADMIN_PIN) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid PIN' });
});
app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// --- UPI QR ---
app.get('/api/upi-qr.png', async (req, res) => {
  try {
    const url = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(APP_NAME)}&cu=INR`;
    res.type('png');
    await QRCode.toFileStream(res, url, { margin: 1, width: 300 });
  } catch (e) {
    res.status(500).send('QR error');
  }
});

// --- Topups ---
app.post('/api/topups', requireUser, (req, res) => {
  const { amount, ref, note } = req.body;
  const amt = Number(amount);
  if (!amt || amt < MIN_RECHARGE) return res.status(400).json({ error: `Minimum recharge is Rs ${MIN_RECHARGE}` });
  if (!ref || String(ref).trim().length < 4) return res.status(400).json({ error: 'Valid UPI reference/UTR required' });
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO topups(user_id, amount, ref, note, status, reason, created_at, updated_at) VALUES (?,?,?,?,"pending",NULL,?,?)',
    [req.session.userId, amt, String(ref).trim(), note || '', now, now],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      io.to('admins').emit('topup:new', { id: this.lastID });
      res.json({ id: this.lastID, status: 'pending' });
    }
  );
});

app.get('/api/topups/mine', requireUser, (req, res) => {
  db.all('SELECT * FROM topups WHERE user_id = ? ORDER BY id DESC', [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// Admin endpoints
app.get('/api/admin/topups', requireAdmin, (req, res) => {
  db.all(
    `SELECT t.*, u.name as user_name FROM topups t JOIN users u ON u.id = t.user_id WHERE t.status = 'pending' ORDER BY t.id ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json(rows);
    }
  );
});

app.post('/api/admin/topups/:id/approve', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  db.get('SELECT * FROM topups WHERE id = ?', [id], async (err, t) => {
    if (err || !t) return res.status(404).json({ error: 'Topup not found' });
    if (t.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    const now = new Date().toISOString();
    db.run('UPDATE topups SET status="approved", updated_at=? WHERE id=?', [now, id], async function (e) {
      if (e) return res.status(500).json({ error: 'DB error' });
      const bal = await getWallet(t.user_id);
      await setWallet(t.user_id, bal + t.amount);
      io.to(`user_${t.user_id}`).emit('topup:status', { id, status: 'approved' });
      res.json({ ok: true });
    });
  });
});

app.post('/api/admin/topups/:id/reject', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const reason = (req.body.reason || 'Not matched with payment').slice(0, 200);
  db.get('SELECT * FROM topups WHERE id = ?', [id], (err, t) => {
    if (err || !t) return res.status(404).json({ error: 'Topup not found' });
    if (t.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    const now = new Date().toISOString();
    db.run('UPDATE topups SET status="rejected", reason=?, updated_at=? WHERE id=?', [reason, now, id], function (e) {
      if (e) return res.status(500).json({ error: 'DB error' });
      io.to(`user_${t.user_id}`).emit('topup:status', { id, status: 'rejected', reason });
      res.json({ ok: true });
    });
  });
});

// --- Chat control ---
app.get('/api/chat/status', requireUser, (req, res) => {
  db.get('SELECT * FROM chats WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.session.userId], async (err, chat) => {
    const balance = await getWallet(req.session.userId);
    if (!chat) return res.json({ active: false, balance });
    res.json({ active: !!chat.active, chatId: chat.id, balance });
  });
});

app.post('/api/chat/start', requireUser, async (req, res) => {
  const bal = await getWallet(req.session.userId);
  if (bal < RATE_PER_MIN) return res.status(400).json({ error: `Need at least Rs ${RATE_PER_MIN} to start` });
  // create new chat session if none active
  db.get('SELECT * FROM chats WHERE user_id=? AND active=1', [req.session.userId], (err, row) => {
    if (row) return res.json({ ok: true, chatId: row.id });
    const now = new Date().toISOString();
    db.run('INSERT INTO chats(user_id, active, started_at) VALUES (?,?,?)', [req.session.userId, 1, now], function (e) {
      if (e) return res.status(500).json({ error: 'DB error' });
      const chatId = this.lastID;
      startBilling(req.session.userId, chatId);
      io.to('admins').emit('chat:started', { userId: req.session.userId, name: req.session.userName, chatId });
      res.json({ ok: true, chatId });
    });
  });
});

app.post('/api/chat/stop', requireUser, (req, res) => {
  db.get('SELECT * FROM chats WHERE user_id=? AND active=1', [req.session.userId], async (err, chat) => {
    if (!chat) return res.json({ ok: true });
    await stopChatByServer(req.session.userId, chat.id, 'Stopped by client');
    res.json({ ok: true });
  });
});

app.post('/api/chat/clear', requireUser, (req, res) => {
  db.get('SELECT * FROM chats WHERE user_id=? ORDER BY id DESC LIMIT 1', [req.session.userId], (err, chat) => {
    if (!chat) return res.json({ ok: true });
    db.run('DELETE FROM messages WHERE chat_id = ?', [chat.id], function (e) {
      if (e) return res.status(500).json({ error: 'DB error' });
      io.to(`user_${req.session.userId}`).emit('chat:cleared', {});
      io.to('admins').emit('chat:cleared', { userId: req.session.userId, chatId: chat.id });
      res.json({ ok: true });
    });
  });
});

// Admin clear chat for a user
app.post('/api/admin/chat/:userId/clear', requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  db.get('SELECT * FROM chats WHERE user_id=? ORDER BY id DESC LIMIT 1', [userId], (err, chat) => {
    if (!chat) return res.json({ ok: true });
    db.run('DELETE FROM messages WHERE chat_id = ?', [chat.id], function (e) {
      if (e) return res.status(500).json({ error: 'DB error' });
      io.to(`user_${userId}`).emit('chat:cleared', {});
      res.json({ ok: true });
    });
  });
});

// --- Sockets ---
io.on('connection', (socket) => {
  // Attach to rooms by declared identity
  socket.on('identify', ({ role, userId }) => {
    if (role === 'admin') {
      socket.join('admins');
    } else if (role === 'client' && userId) {
      socket.join(`user_${userId}`);
    }
  });

  // Client sends message
  socket.on('client:message', ({ userId, text }) => {
    if (!userId || !text) return;
    // Ensure an active chat exists
    db.get('SELECT * FROM chats WHERE user_id=? AND active=1', [userId], (err, chat) => {
      if (!chat) return socket.emit('chat:error', { error: 'Chat not active' });
      const now = new Date().toISOString();
      db.run('INSERT INTO messages(chat_id, sender, text, created_at) VALUES (?,?,?,?)', [chat.id, 'client', text, now]);
      io.to('admins').emit('chat:message', { userId, sender: 'client', text, at: now });
      io.to(`user_${userId}`).emit('chat:message', { userId, sender: 'client', text, at: now });
    });
  });

  // Admin replies to a user
  socket.on('admin:message', ({ userId, text }) => {
    if (!text || !userId) return;
    const uid = Number(userId);
    db.get('SELECT * FROM chats WHERE user_id=? ORDER BY id DESC LIMIT 1', [uid], (err, chat) => {
      if (!chat) return;
      const now = new Date().toISOString();
      db.run('INSERT INTO messages(chat_id, sender, text, created_at) VALUES (?,?,?,?)', [chat.id, 'admin', text, now]);
      io.to(`user_${uid}`).emit('chat:message', { userId: uid, sender: 'admin', text, at: now });
      io.to('admins').emit('chat:message', { userId: uid, sender: 'admin', text, at: now });
    });
  });
});

// --- Client HTML ---
function clientHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME} – Client</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
</head>
<body class="bg-gray-50 text-gray-900">
  <div class="max-w-3xl mx-auto p-4 space-y-4">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">${APP_NAME}</h1>
      <div id="userBox" class="text-sm"></div>
    </header>

    <section id="auth" class="bg-white rounded-2xl shadow p-4">
      <h2 class="font-semibold mb-2">Start – Enter your name</h2>
      <div class="flex gap-2">
        <input id="name" class="border rounded px-3 py-2 flex-1" placeholder="Your name" />
        <button id="registerBtn" class="px-4 py-2 rounded bg-black text-white">Continue</button>
      </div>
      <p class="text-xs text-gray-500 mt-2">No OTP here – simple name login for demo.</p>
    </section>

    <section id="wallet" class="bg-white rounded-2xl shadow p-4 hidden">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold">Wallet</h2>
        <div>Balance: Rs <span id="balance">0</span></div>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <img id="qr" src="/api/upi-qr.png" alt="UPI QR" class="w-48 h-48 rounded-xl border" />
          <p class="text-xs text-gray-600 mt-2">Scan & pay to <b>${UPI_ID}</b>. Min recharge Rs ${MIN_RECHARGE}. After paying, submit details below for admin approval.</p>
        </div>
        <form id="topupForm" class="space-y-2">
          <div>
            <label class="text-sm">Amount (Rs)</label>
            <input name="amount" type="number" min="${MIN_RECHARGE}" class="w-full border rounded px-3 py-2" required />
          </div>
          <div>
            <label class="text-sm">UPI Ref/UTR</label>
            <input name="ref" class="w-full border rounded px-3 py-2" placeholder="e.g., 1234567890" required />
          </div>
          <div>
            <label class="text-sm">Note (optional)</label>
            <input name="note" class="w-full border rounded px-3 py-2" placeholder="Any note for admin" />
          </div>
          <button class="px-4 py-2 rounded bg-black text-white">Submit for Approval</button>
          <p id="topupMsg" class="text-sm"></p>
        </form>
      </div>

      <div class="mt-4">
        <h3 class="font-semibold mb-1">My Top-ups</h3>
        <div id="topups" class="text-sm"></div>
      </div>
    </section>

    <section id="chat" class="bg-white rounded-2xl shadow p-4 hidden">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold">Chat with Astrologer</h2>
        <div class="text-sm">Rs ${RATE_PER_MIN}/min • <span id="chatStatus" class="font-medium">Stopped</span> • <span id="timer" class="font-mono"></span></div>
      </div>
      <div class="flex gap-2 mb-2">
        <button id="startBtn" class="px-3 py-2 rounded bg-green-600 text-white">Start Chat</button>
        <button id="stopBtn" class="px-3 py-2 rounded bg-gray-700 text-white">Stop</button>
        <button id="clearBtn" class="px-3 py-2 rounded bg-red-600 text-white">Clear Chat</button>
      </div>
      <div id="messages" class="h-64 overflow-y-auto border rounded p-2 bg-gray-50"></div>
      <div class="mt-2 flex gap-2">
        <input id="msg" class="border rounded px-3 py-2 flex-1" placeholder="Type your message" />
        <button id="send" class="px-4 py-2 rounded bg-black text-white">Send</button>
      </div>
    </section>

    <section id="about" class="bg-white rounded-2xl shadow p-4">
      <h2 class="text-xl font-bold mb-2">About</h2>
      <p class="text-sm leading-relaxed">Namaste! I am <b>Shivam Tiwari</b>, a trained Vedic astrologer with 6 years of dedicated experience and deep knowledge of classical astrology. I specialize in Kundli analysis, relationship compatibility, and planetary remedies, combining ancient scriptural wisdom with practical, real-life solutions. My consultations are aimed at bringing clarity, harmony, and positive transformation in people’s lives. I offer guidance in horoscope analysis, match-making, career, finance, health, and life event timing (Muhurta). My remedies are simple yet effective, ensuring that anyone can adopt them with ease. Over the years, I have helped numerous individuals resolve challenges and make confident life decisions.</p>
      <p class="text-sm mt-2"><b>My Expertise In Vedic Astrology</b><br/>
      Kundli Analysis & Horoscope Interpretation • Relationship & Compatibility Matching • Planetary Remedies & Mantra Guidance • Career, Finance & Health Predictions • Muhurat (Auspicious Timing) • Prashna Kundali (Horary Astrology).</p>
    </section>
  </div>

  <script>
    const socket = io();

    let currentUser = null;
    let seconds = 0;
    let secTimer = null;

    function el(id){ return document.getElementById(id); }
    function fmt(n){ return n.toString().padStart(2,'0'); }
    function showTimer(){
      const m = Math.floor(seconds/60);
      const s = seconds%60;
      el('timer').textContent = m+':'+fmt(s);
    }
    function startSecondTimer(){
      clearInterval(secTimer);
      seconds = 0;
      showTimer();
      secTimer = setInterval(()=>{ seconds++; showTimer(); }, 1000);
    }
    function stopSecondTimer(){
      clearInterval(secTimer);
    }

    function appendMessage(sender, text, at){
      const wrap = el('messages');
      const row = document.createElement('div');
      row.className = sender === 'admin' ? 'text-right' : 'text-left';
      const bubble = document.createElement('div');
      bubble.className = 'inline-block my-1 px-3 py-2 rounded-2xl ' + (sender==='admin'?'bg-indigo-100':'bg-gray-200');
      bubble.textContent = '[' + (new Date(at).toLocaleTimeString()) + '] ' + sender + ': ' + text;
      row.appendChild(bubble);
      wrap.appendChild(row);
      wrap.scrollTop = wrap.scrollHeight;
    }

    async function getMe(){
      const r = await fetch('/api/me');
      const data = await r.json();
      if (data.user){
        currentUser = data.user; updateUI();
      }
    }
    function updateUI(){
      el('auth').classList.toggle('hidden', !!currentUser);
      el('wallet').classList.toggle('hidden', !currentUser);
      el('chat').classList.toggle('hidden', !currentUser);
      if (currentUser){
        el('userBox').innerHTML = 'Hello, <b>' + currentUser.name + '</b>' + ' • <button id="logoutBtn" class="underline">Logout</button>';
        el('balance').textContent = currentUser.balance;
        socket.emit('identify', { role: 'client', userId: currentUser.id });
        refreshTopups();
        refreshChatStatus();
        document.querySelector('#userBox #logoutBtn').onclick = async () => {
          await fetch('/api/logout', { method: 'POST' }); location.reload();
        };
      }
    }

    async function refreshTopups(){
      const r = await fetch('/api/topups/mine');
      const rows = await r.json();
      el('topups').innerHTML = rows.map(t => `<div class="p-2 border rounded mb-1">#${t.id} • Rs ${t.amount} • <b>${t.status}</b>${t.status==='rejected' ? ' – ' + (t.reason||'') : ''}<br/><span class="text-xs text-gray-500">Ref: ${t.ref}</span></div>`).join('');
    }

    async function refreshChatStatus(){
      const r = await fetch('/api/chat/status');
      const st = await r.json();
      el('balance').textContent = st.balance;
      el('chatStatus').textContent = st.active ? 'Running' : 'Stopped';
      if (st.active) startSecondTimer(); else stopSecondTimer();
    }

    // Register
    el('registerBtn').onclick = async () => {
      const name = el('name').value.trim();
      if (!name) { alert('Enter your name'); return; }
      const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
      const data = await r.json();
      if (data.id){ currentUser = { id: data.id, name: data.name, balance: 0 }; updateUI(); }
    };

    // Topup
    el('topupForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      const r = await fetch('/api/topups', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await r.json();
      if (data.error) { el('topupMsg').textContent = data.error; el('topupMsg').className='text-red-600'; }
      else { el('topupMsg').textContent = 'Submitted. Waiting for admin approval.'; el('topupMsg').className='text-green-700'; refreshTopups(); }
    };

    // Chat start/stop/clear
    el('startBtn').onclick = async () => {
      const r = await fetch('/api/chat/start', { method:'POST' });
      const d = await r.json();
      if (d.error) alert(d.error);
      else { el('chatStatus').textContent = 'Running'; startSecondTimer(); }
      refreshChatStatus();
    };
    el('stopBtn').onclick = async () => {
      await fetch('/api/chat/stop', { method:'POST' });
      el('chatStatus').textContent = 'Stopped';
      stopSecondTimer();
      refreshChatStatus();
    };
    el('clearBtn').onclick = async () => {
      await fetch('/api/chat/clear', { method:'POST' });
      el('messages').innerHTML = '';
    };

    // Send message
    el('send').onclick = () => {
      const t = el('msg').value.trim(); if (!t || !currentUser) return;
      socket.emit('client:message', { userId: currentUser.id, text: t });
      el('msg').value = '';
    };

    // Socket listeners
    socket.on('wallet:update', ({ balance }) => { el('balance').textContent = balance; });
    socket.on('chat:tick', () => { refreshChatStatus(); });
    socket.on('chat:stopped', ({ reason }) => { el('chatStatus').textContent = 'Stopped'; stopSecondTimer(); appendMessage('system', 'Chat stopped: ' + reason, new Date()); });
    socket.on('topup:status', ({ status, reason }) => { refreshTopups(); if (status==='approved') { refreshChatStatus(); } else if (status==='rejected') { alert('Top-up rejected: ' + (reason||'') ); } });
    socket.on('chat:message', ({ sender, text, at }) => { appendMessage(sender, text, at); });
    socket.on('chat:cleared', () => { el('messages').innerHTML = ''; });

    // Init
    getMe();
  </script>
</body>
</html>`;
}

// --- Admin HTML ---
function adminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME} – Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="/socket.io/socket.io.js"></script>
</head>
<body class="bg-gray-50 text-gray-900">
  <div class="max-w-5xl mx-auto p-4 space-y-4">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">${APP_NAME} Admin</h1>
      <div id="adminBox" class="text-sm"></div>
    </header>

    <section id="login" class="bg-white rounded-2xl shadow p-4">
      <h2 class="font-semibold mb-2">Admin Login</h2>
      <div class="flex gap-2">
        <input id="pin" type="password" class="border rounded px-3 py-2" placeholder="Enter PIN" />
        <button id="loginBtn" class="px-4 py-2 rounded bg-black text-white">Login</button>
      </div>
    </section>

    <section id="panel" class="bg-white rounded-2xl shadow p-4 hidden">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold">Dashboard</h2>
        <button id="logoutBtn" class="px-3 py-2 rounded bg-gray-800 text-white">Logout</button>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="space-y-2">
          <h3 class="font-semibold">Pending Top-ups</h3>
          <div id="pending" class="text-sm"></div>
        </div>
        <div class="space-y-2">
          <h3 class="font-semibold">Live Chat</h3>
          <div class="flex gap-2">
            <input id="targetUser" class="border rounded px-3 py-2 flex-1" placeholder="User ID" />
            <button id="clearUserBtn" class="px-3 py-2 rounded bg-red-600 text-white">Clear Chat</button>
          </div>
          <div id="adminMessages" class="h-64 overflow-y-auto border rounded p-2 bg-gray-50"></div>
          <div class="mt-2 flex gap-2">
            <input id="adminMsg" class="border rounded px-3 py-2 flex-1" placeholder="Type reply" />
            <button id="sendAdmin" class="px-4 py-2 rounded bg-black text-white">Send</button>
          </div>
        </div>
      </div>
    </section>
  </div>

  <script>
    const socket = io();
    socket.emit('identify', { role: 'admin' });

    function el(id){ return document.getElementById(id); }
    function addAdminMsg(text){
      const wrap = el('adminMessages');
      const row = document.createElement('div');
      row.className = 'my-1';
      const bubble = document.createElement('div');
      bubble.className = 'inline-block px-3 py-2 rounded-2xl bg-amber-100';
      bubble.textContent = text;
      row.appendChild(bubble); wrap.appendChild(row); wrap.scrollTop = wrap.scrollHeight;
    }

    async function checkAdmin(){
      const r = await fetch('/api/admin/me');
      const d = await r.json();
      if (d.isAdmin){
        el('login').classList.add('hidden');
        el('panel').classList.remove('hidden');
        el('adminBox').innerHTML = 'Logged in • Admin';
        loadPending();
      }
    }

    async function loadPending(){
      const r = await fetch('/api/admin/topups');
      const rows = await r.json();
      el('pending').innerHTML = rows.map(t => `
        <div class="p-2 border rounded mb-2">
          <div>#${t.id} • User ${t.user_id} (${t.user_name}) • Rs ${t.amount}</div>
          <div class="text-xs text-gray-500">Ref: ${t.ref}</div>
          <div class="flex gap-2 mt-2">
            <button class="px-2 py-1 rounded bg-green-600 text-white" onclick="approve(${t.id})">Approve</button>
            <button class="px-2 py-1 rounded bg-red-600 text-white" onclick="reject(${t.id})">Reject</button>
          </div>
        </div>`).join('') || '<div class="text-gray-500">No pending top-ups</div>';
    }

    window.approve = async (id) => { await fetch('/api/admin/topups/'+id+'/approve', { method:'POST' }); loadPending(); };
    window.reject = async (id) => {
      const reason = prompt('Reason for rejection?');
      await fetch('/api/admin/topups/'+id+'/reject', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ reason }) });
      loadPending();
    };

    el('loginBtn').onclick = async () => {
      const pin = el('pin').value; if (!pin) return;
      const r = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pin }) });
      if (r.ok) checkAdmin(); else alert('Invalid PIN');
    };
    el('logoutBtn').onclick = async () => { await fetch('/api/admin/logout', { method:'POST' }); location.reload(); };

    el('sendAdmin').onclick = () => {
      const uid = Number(el('targetUser').value);
      const text = el('adminMsg').value.trim();
      if (!uid || !text) return;
      socket.emit('admin:message', { userId: uid, text });
      el('adminMsg').value = '';
    };

    el('clearUserBtn').onclick = async () => {
      const uid = Number(el('targetUser').value);
      if (!uid) return;
      await fetch('/api/admin/chat/'+uid+'/clear', { method:'POST' });
      addAdminMsg('Cleared chat for user ' + uid);
    };

    socket.on('topup:new', () => { loadPending(); });
    socket.on('chat:started', ({ userId, name, chatId }) => { addAdminMsg('Chat started by user #' + userId + ' (' + name + ')'); });
    socket.on('chat:stopped', ({ userId }) => { addAdminMsg('Chat stopped for user #' + userId); });
    socket.on('chat:message', ({ userId, sender, text, at }) => { addAdminMsg('[' + new Date(at).toLocaleTimeString() + '] #' + userId + ' ' + sender + ': ' + text); });

    checkAdmin();
  </script>
</body>
</html>`;
}

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`${APP_NAME} running on http://localhost:${PORT}`);
});
