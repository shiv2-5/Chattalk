// ------- Config -------
const ADMIN_PIN = '2580';
const RATE_PER_10_RUPEES_MIN = 5; // every ₹10 adds 5 minutes

// ------- State (frontend only) -------
const state = {
  adminUnlocked: false,
  approved: false,
  session: {
    active: false,
    secondsRemaining: 0,
    timerId: null,
  },
  messages: [], // {from: 'client'|'admin', text, ts}
  txns: [], // {upi, amount, utr, ts}
  rating: null, // {stars, feedback}
};

// ------- Helpers -------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (s) => {
  const m = Math.floor(s / 60), r = s % 60;
  return `${pad(m)}:${pad(r)}`;
};
const now = () => new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

function saveLocal() {
  localStorage.setItem('ct_state', JSON.stringify({
    approved: state.approved,
    session: state.session.active ? { secondsRemaining: state.session.secondsRemaining } : { secondsRemaining: 0 },
    messages: state.messages,
    txns: state.txns,
    rating: state.rating,
  }));
}
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem('ct_state') || '{}');
    state.approved = !!s.approved;
    state.messages = s.messages || [];
    state.txns = s.txns || [];
    const secs = s.session?.secondsRemaining || 0;
    if (secs > 0) {
      state.session.secondsRemaining = secs;
      // don't auto-start; require Start Chat
    }
  } catch(e){}
}

// ------- UI Bind -------
function renderChat() {
  const win = $('chatWindow');
  win.innerHTML = '';
  state.messages.forEach(m => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.from === 'client' ? 'row-client' : 'row-admin'}`;
    const bubble = document.createElement('div');
    bubble.className = `msg ${m.from}`;
    bubble.textContent = m.text;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = m.ts;
    row.appendChild(bubble);
    row.appendChild(meta);
    win.appendChild(row);
  });
  win.scrollTop = win.scrollHeight;
}

function renderTxns() {
  const list = $('txnList');
  if (!state.txns.length) { list.innerHTML = '<p class="text-slate-500">No transactions yet.</p>'; return; }
  list.innerHTML = state.txns.map(t => `
    <div class="border border-slate-200 rounded-xl p-2 flex items-center justify-between">
      <div>
        <div class="font-medium">₹${t.amount} • ${t.upi}</div>
        <div class="text-xs text-slate-500">UTR: ${t.utr} • ${new Date(t.ts).toLocaleString()}</div>
      </div>
      <span class="badge">${state.approved ? 'Approved' : 'Pending'}</span>
    </div>
  `).join('');
}

function setWalletUI() {
  $('walletStatus').textContent = state.approved ? 'Unlocked' : 'Locked';
  $('btnStart').disabled = !state.approved || state.session.active || state.session.secondsRemaining <= 0;
  $('btnEnd').disabled = !state.session.active;
  $('chatInput').disabled = !state.session.active;
  $('btnSend').disabled = !state.session.active;
  $('timeRemaining').textContent = fmtTime(state.session.secondsRemaining || 0);
  $('chatSessionState').textContent = state.session.active ? 'Session: Live' : (state.approved ? 'Session: Ready' : 'Session: Not started');
}

function startTimer() {
  if (state.session.timerId) clearInterval(state.session.timerId);
  state.session.timerId = setInterval(() => {
    state.session.secondsRemaining--;
    $('timeRemaining').textContent = fmtTime(state.session.secondsRemaining);
    if (state.session.secondsRemaining <= 0) {
      clearInterval(state.session.timerId);
      endSession(true);
    }
    saveLocal();
  }, 1000);
}

function showModal(id) {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  $(id).classList.remove('hidden');
}
function hideModal(id) {
  $(id).classList.add('hidden');
}
function confirmDialog(title, text, onYes) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  showModal('confirmModal');
  const ok = $('confirmOk'), cancel = $('confirmCancel');
  const cleanup = () => {
    ok.replaceWith(ok.cloneNode(true));
    cancel.replaceWith(cancel.cloneNode(true));
  };
  $('confirmOk').addEventListener('click', () => { hideModal('confirmModal'); onYes(); cleanup(); });
  $('confirmCancel').addEventListener('click', () => { hideModal('confirmModal'); cleanup(); });
}

function pushMsg(from, text) {
  if (!text) return;
  state.messages.push({ from, text, ts: now() });
  renderChat();
  saveLocal();
}

function grantTimeByAmount(amount) {
  const blocks = Math.floor(amount / 10);
  const mins = blocks * RATE_PER_10_RUPEES_MIN;
  state.session.secondsRemaining += mins * 60;
}

// ------- Events -------
window.addEventListener('DOMContentLoaded', () => {
  $('year').textContent = new Date().getFullYear();

  // Tabs
  const clientBtn = $('tabClient'), adminBtn = $('tabAdmin');
  clientBtn.addEventListener('click', () => {
    clientBtn.classList.add('active'); adminBtn.classList.remove('active');
    $('panelClient').classList.remove('hidden'); $('panelAdmin').classList.add('hidden');
  });
  adminBtn.addEventListener('click', () => {
    adminBtn.classList.add('active'); clientBtn.classList.remove('active');
    $('panelAdmin').classList.remove('hidden'); $('panelClient').classList.add('hidden');
  });

  // Load persisted
  loadLocal();
  renderChat();
  renderTxns();
  setWalletUI();

  // Submit payment
  $('btnSubmitTxn').addEventListener('click', () => {
    const upi = $('upiId').value.trim();
    const amount = parseInt($('amount').value, 10);
    const utr = $('utr').value.trim();
    if (!upi || !amount || amount < 10 || !utr) {
      alert('Please enter UPI, amount (>=₹10), and UTR.');
      return;
    }
    state.txns.push({ upi, amount, utr, ts: Date.now() });
    renderTxns();
    saveLocal();
    alert('Submitted! Please wait for admin approval.');
  });

  // Show QR
  $('btnShowQR').addEventListener('click', () => showModal('qrModal'));
  $('closeQR').addEventListener('click', () => hideModal('qrModal'));

  // Start chat
  $('btnStart').addEventListener('click', () => {
    if (state.session.secondsRemaining <= 0) return alert('No time available. Please recharge.');
    state.session.active = true;
    startTimer();
    setWalletUI();
    pushMsg('admin', 'Welcome! Your session has started. How can I help you today?');
  });

  // End session
  function endAndPromptRating(reasonText) {
    state.session.active = false;
    if (state.session.timerId) clearInterval(state.session.timerId);
    setWalletUI();
    pushMsg('admin', reasonText);
    // Open rating dialog
    openRating();
  }

  window.endSession = (auto=false) => {
    const reason = auto ? 'Your session has ended as time ran out. Thank you!' : 'Your session was ended by the client. Thank you!';
    endAndPromptRating(reason);
  };

  $('btnEnd').addEventListener('click', () => {
    confirmDialog('End Session', 'Are you sure you want to end the session now?', () => endSession(false));
  });

  // Clear chat
  $('btnClear').addEventListener('click', () => {
    confirmDialog('Clear Chat', 'This will remove all messages on this device.', () => {
      state.messages = [];
      renderChat();
      saveLocal();
    });
  });

  // Send message (client)
  $('btnSend').addEventListener('click', () => {
    const t = $('chatInput').value.trim();
    if (!t) return;
    if (t.length > 500) { alert('Message too long (max 500 chars).'); return; }
    pushMsg('client', t);
    $('chatInput').value = '';
  });

  // Download chat
  $('downloadChat').addEventListener('click', (e) => {
    e.preventDefault();
    const content = state.messages.map(m => `[${m.ts}] ${m.from.toUpperCase()}: ${m.text}`).join('\n');
    const blob = new Blob([content], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'chat.txt'; a.click();
    URL.revokeObjectURL(url);
  });

  // Admin unlock
  $('btnUnlockAdmin').addEventListener('click', () => {
    const pin = $('adminPin').value;
    if (pin === ADMIN_PIN) {
      state.adminUnlocked = true;
      alert('Admin unlocked.');
      $('btnApprove').disabled = false;
      $('adminMsg').disabled = false;
      $('btnAdminSend').disabled = false;
    } else {
      alert('Wrong PIN.');
    }
  });

  // Approve latest
  $('btnApprove').addEventListener('click', () => {
    if (!state.txns.length) return alert('No transactions to approve.');
    const latest = state.txns[state.txns.length - 1];
    state.approved = true;
    grantTimeByAmount(parseInt(latest.amount, 10));
    renderTxns();
    setWalletUI();
    saveLocal();
    alert('Approved. Wallet unlocked.');
  });

  // Admin send
  $('btnAdminSend').addEventListener('click', () => {
    const t = $('adminMsg').value.trim();
    if (!t) return;
    pushMsg('admin', t);
    $('adminMsg').value = '';
  });

  // Stars in rating
  const stars = $('stars');
  for (let i=1;i<=5;i++){
    const b = document.createElement('button');
    b.setAttribute('data-star', i);
    b.className = 'btn-ghost';
    b.textContent = '★';
    b.addEventListener('click', () => {
      [...stars.children].forEach((c,idx) => c.style.filter = idx < i ? 'none' : 'grayscale(1)');
      stars.setAttribute('data-value', i);
    });
    stars.appendChild(b);
  }

  $('skipRating').addEventListener('click', () => {
    hideModal('ratingModal');
    alert('Thanks! You can recharge to start a new session.');
  });

  $('submitRating').addEventListener('click', () => {
    const val = parseInt(stars.getAttribute('data-value') || '0', 10);
    const fb = $('feedback').value.trim();
    state.rating = { stars: val || null, feedback: fb || null, ts: Date.now() };
    saveLocal();
    hideModal('ratingModal');
    alert('Thank you for your feedback!');
  });

  // Guard: If time exists but not active, enable Start
  setWalletUI();
});

function openRating(){
  showModal('ratingModal');
}
