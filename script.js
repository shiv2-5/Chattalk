let walletBalance = 0;
let recharges = [];
let chatActive = false;
let chatInterval = null;
let ratePerMin = 10;
let pendingId = 1;

function submitRecharge() {
  let amount = parseInt(document.getElementById('recharge-amount').value);
  let ref = document.getElementById('recharge-ref').value.trim();
  if (!amount || amount < 10 || !ref) {
    alert('Enter valid amount (min 10) and UPI Ref.');
    return;
  }
  recharges.push({id: pendingId++, amount, ref, status: 'pending'});
  alert('Recharge submitted. Waiting for admin approval.');
  document.getElementById('recharge-amount').value = '';
  document.getElementById('recharge-ref').value = '';
  renderRecharges();
}

function renderRecharges() {
  let container = document.getElementById('pending-recharges');
  container.innerHTML = '';
  recharges.forEach(r => {
    if (r.status === 'pending') {
      let div = document.createElement('div');
      div.innerHTML = 'ID:'+r.id+' | Amount: ₹'+r.amount+' | Ref: '+r.ref+
      ' <button onclick="approveRecharge('+r.id+')">Approve</button>'+
      ' <button onclick="rejectRecharge('+r.id+')">Reject</button>';
      container.appendChild(div);
    }
  });
}

function approveRecharge(id) {
  let r = recharges.find(x => x.id===id);
  if (r) {
    r.status = 'approved';
    walletBalance += r.amount;
    updateWallet();
    renderRecharges();
    document.getElementById('start-chat-btn').style.display = 'block';
    alert('Recharge approved and wallet updated.');
  }
}

function rejectRecharge(id) {
  let reason = prompt('Enter rejection reason:');
  let r = recharges.find(x => x.id===id);
  if (r) {
    r.status = 'rejected';
    renderRecharges();
    alert('Recharge rejected: '+reason);
  }
}

function updateWallet() {
  document.getElementById('wallet-balance').innerText = walletBalance;
}

function startChat() {
  if (walletBalance < ratePerMin) {
    alert('Insufficient balance. Please recharge.');
    return;
  }
  chatActive = true;
  document.getElementById('chat-section').style.display = 'block';
  document.getElementById('start-chat-btn').style.display = 'none';
  chatInterval = setInterval(() => {
    if (walletBalance >= ratePerMin) {
      walletBalance -= ratePerMin;
      updateWallet();
    } else {
      stopChat();
    }
  }, 60000); // deduct every minute
}

function stopChat() {
  chatActive = false;
  clearInterval(chatInterval);
  alert('Chat stopped due to low balance.');
  document.getElementById('start-chat-btn').style.display = 'block';
}

function sendMessage() {
  if (!chatActive) { alert('Start chat first'); return; }
  let msg = document.getElementById('client-message').value.trim();
  if (msg==='') return;
  let box = document.getElementById('chat-box');
  box.innerHTML += '<div><b>Client:</b> '+msg+'</div>';
  document.getElementById('client-message').value='';
}

function sendAdminMessage() {
  let msg = document.getElementById('admin-message').value.trim();
  if (msg==='') return;
  let clientBox = document.getElementById('chat-box');
  let adminBox = document.getElementById('admin-chat-box');
  clientBox.innerHTML += '<div><b>Astrologer:</b> '+msg+'</div>';
  adminBox.innerHTML += '<div><b>Astrologer:</b> '+msg+'</div>';
  document.getElementById('admin-message').value='';
}

function clearChat() {
  document.getElementById('chat-box').innerHTML='';
  document.getElementById('admin-chat-box').innerHTML='';
}

function adminLogin() {
  let pin = document.getElementById('admin-pin').value;
  if (pin==='2103') {
    document.getElementById('admin-section').style.display = 'block';
    document.getElementById('admin-login').style.display = 'none';
    renderRecharges();
  } else {
    alert('Wrong PIN');
  }
}
