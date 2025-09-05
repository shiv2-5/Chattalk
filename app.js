
// Simple frontend-only chat + wallet logic.
// Per-message cost and auto-stop when balance low.

const walletAmountEl = document.getElementById('wallet-amount');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');
const messagesEl = document.getElementById('messages');
const statusEl = document.getElementById('status');
const rechargeBtn = document.getElementById('recharge-btn');
const modal = document.getElementById('modal');
const modalClose = document.getElementById('modal-close');
const modalPay = document.getElementById('modal-pay');
const rechargeAmountInput = document.getElementById('recharge-amount');
const qrImg = document.getElementById('qr-img');
const modalQr = document.getElementById('modal-qr');
const paidBtn = document.getElementById('paid-btn');
const perCost = Number(document.getElementById('per-cost').innerText);

let wallet = 0;
let chatActive = false;

// Initialize UI
function updateWalletUI(){
  walletAmountEl.innerText = wallet.toFixed(2);
  if(wallet >= perCost){
    enableChat();
  } else {
    disableChat();
  }
}
function enableChat(){
  chatActive = true;
  messageInput.disabled = false;
  sendBtn.disabled = false;
  statusEl.style.display = 'none';
}
function disableChat(){
  chatActive = false;
  messageInput.disabled = true;
  sendBtn.disabled = true;
  statusEl.innerText = 'Chat stopped. Please recharge to continue.';
  statusEl.style.display = 'block';
}

// Send message handler
function appendMessage(text, cls='bot'){
  const div = document.createElement('div');
  div.className = 'message ' + (cls === 'user' ? 'user' : 'bot');
  div.innerText = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
sendBtn.addEventListener('click', ()=>{
  const txt = messageInput.value.trim();
  if(!txt) return;
  // Check wallet
  if(wallet < perCost){
    disableChat();
    return;
  }
  // Deduct
  wallet = Number((wallet - perCost).toFixed(2));
  updateWalletUI();
  appendMessage(txt, 'user');
  messageInput.value = '';
  // Simulate astrologer reply
  setTimeout(()=> {
    appendMessage('Astrologer: Thank you. I see possibilities ahead — ask another question or recharge if needed.', 'bot');
  }, 800);

  // If after deduction wallet is less than cost, auto-stop chat
  if(wallet < perCost){
    setTimeout(()=> {
      disableChat();
    }, 400);
  }
});

// Recharge modal and QR generation
function genQrFor(amount){
  // Example UPI ID; replace with your real UPI
  const upi = encodeURIComponent('shivam@upi');
  const text = encodeURIComponent('upi://pay?pa=shivam@upi&pn=Shivam%20Tiwari&am=' + amount);
  // Google Chart QR (simple)
  const url = 'https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=' + text;
  return url;
}

function openModal(){
  modal.classList.remove('hidden');
  const amt = Number(rechargeAmountInput.value) || 10;
  modalQr.src = genQrFor(amt);
}
rechargeBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
modalPay.addEventListener('click', ()=>{
  const amt = Number(rechargeAmountInput.value) || 10;
  // Simulate payment confirmation
  wallet = Number((wallet + amt).toFixed(2));
  updateWalletUI();
  modal.classList.add('hidden');
});

// Page QR and simulate button
qrImg.src = genQrFor(10);
paidBtn.addEventListener('click', ()=>{
  // Simulate paying ₹10
  wallet = Number((wallet + 10).toFixed(2));
  updateWalletUI();
});

// initialize
updateWalletUI();
appendMessage('Welcome to ChatTalk! Recharge to begin a session.', 'bot');
