// script.js - client & shared logic (localStorage based)
const BAL_KEY = 'astro_v9_balance';
const PENDING_KEY = 'astro_v9_pending';
const MSG_KEY = 'astro_v9_msgs';

const PER_MIN = 10;
const MIN_RECHARGE = 10;

function read(key, defaultValue){ try{ return JSON.parse(localStorage.getItem(key)); }catch(e){return defaultValue;} }
function write(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

if(!localStorage.getItem(PENDING_KEY)) write(PENDING_KEY, []);
if(!localStorage.getItem(MSG_KEY)) write(MSG_KEY, []);
if(!localStorage.getItem(BAL_KEY)) write(BAL_KEY, 0);

function qrDataUrl(){ return 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data='+encodeURIComponent('upi://pay?pa=st227335-1@okicici&pn=Shivam%20Tiwari&cu=INR'); }

/* CLIENT */
function initClient(){
  const qr = document.getElementById('qrImg'); if(qr) qr.src = qrDataUrl();
  renderClientBalance();
  renderPendingNotice();
  setInterval(()=>{ checkApproval(); renderMessagesClient(); renderClientBalance(); renderPendingNotice(); },1500);
  document.getElementById('submitPayment').addEventListener('click', clientSubmitPayment);
  document.getElementById('sendBtn').addEventListener('click', clientSend);
  document.getElementById('startChat').addEventListener('click', startChatClient);
  document.getElementById('stopChat').addEventListener('click', stopChatClient);
  document.getElementById('clearChat').addEventListener('click', clearChatClient);
  renderMessagesClient();
}

function renderClientBalance(){ const b = Number(localStorage.getItem(BAL_KEY)||0); document.getElementById('balance').innerText = b; }

function renderPendingNotice(){
  const pend = read(PENDING_KEY,[]);
  const notice = document.getElementById('pendingNotice');
  if(pend.length===0) notice.innerText = 'No pending payments';
  else notice.innerText = pend.map(p=>`Pending: ₹${p.amount} (UTR ${p.utr})`).join(' | ');
}

function clientSubmitPayment(){
  const amt = Number(document.getElementById('amount').value||0);
  const utr = (document.getElementById('utr').value||'').trim();
  if(isNaN(amt) || amt < MIN_RECHARGE){ alert('Minimum recharge ₹'+MIN_RECHARGE); return; }
  if(!utr){ alert('Enter UTR from your UPI app'); return; }
  const pend = read(PENDING_KEY,[]);
  const tx = { id:'tx_'+Date.now(), amount:amt, utr, status:'pending', when: Date.now() };
  pend.unshift(tx); write(PENDING_KEY, pend);
  alert('Submitted for approval. Admin will review.');
  document.getElementById('utr').value='';
}

function checkApproval(){
  const pend = read(PENDING_KEY,[]);
  const found = pend.find(p=>p.status==='approved' || p.status==='rejected');
  if(found){
    const remaining = pend.filter(p=>p.id!==found.id);
    write(PENDING_KEY, remaining);
    if(found.status==='approved'){
      const bal = Number(localStorage.getItem(BAL_KEY)||0);
      write(BAL_KEY, bal + Number(found.amount));
      alert('Your payment ₹'+found.amount+' approved. You can start chat.');
      document.getElementById('chatCard').style.display = 'block';
    } else {
      const msgs = read(MSG_KEY,[]);
      msgs.push({by:'system', text:`Your transaction ${found.utr} was rejected by admin. Reason: ${found.reason||'No reason'}`, ts:Date.now()});
      write(MSG_KEY, msgs);
      alert('Your payment was rejected by admin.');
      renderMessagesClient();
    }
  }
}

/* Chat client */
let chatTimer = null; let chatSeconds = 0;
function startChatClient(){
  const bal = Number(localStorage.getItem(BAL_KEY)||0);
  if(bal < PER_MIN){ alert('Need at least ₹'+MIN_RECHARGE); return; }
  document.getElementById('chatCard').style.display = 'block';
  document.getElementById('startChat').disabled = true;
  document.getElementById('stopChat').disabled = false;
  chatSeconds = 0;
  if(chatTimer) clearInterval(chatTimer);
  chatTimer = setInterval(()=>{
    chatSeconds++; updateTimer();
    if(chatSeconds % 60 === 0){
      const bal = Number(localStorage.getItem(BAL_KEY)||0);
      if(bal >= PER_MIN){ write(BAL_KEY, bal - PER_MIN); } else { stopChatClient(); alert('Balance finished.'); }
    }
  },1000);
}
function updateTimer(){ const mm = String(Math.floor(chatSeconds/60)).padStart(2,'0'); const ss = String(chatSeconds%60).padStart(2,'0'); document.getElementById('timer').innerText = mm+':'+ss; }
function stopChatClient(){ if(chatTimer) clearInterval(chatTimer); chatTimer=null; document.getElementById('startChat').disabled=false; document.getElementById('stopChat').disabled=true; }

function clientSend(){
  if(!chatTimer){ alert('Start chat to send messages'); return; }
  const text = (document.getElementById('clientMsg').value||'').trim();
  if(!text) return;
  const msgs = read(MSG_KEY,[]);
  msgs.push({by:'client', text, ts:Date.now()});
  write(MSG_KEY, msgs);
  document.getElementById('clientMsg').value='';
  renderMessagesClient();
}

function renderMessagesClient(){
  const box = document.getElementById('chatBox'); if(!box) return;
  const msgs = read(MSG_KEY,[]); box.innerHTML='';
  msgs.forEach(m=>{ const d=document.createElement('div'); d.className='message '+(m.by==='client'?'msg-client':(m.by==='astro'?'msg-astro':'')); d.innerText=m.text; box.appendChild(d); });
  box.scrollTop = box.scrollHeight;
}
function clearChatClient(){ write(MSG_KEY,[]); renderMessagesClient(); }
