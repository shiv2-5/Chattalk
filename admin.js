// admin.js - handles admin login, approve/reject, reply
const ADMIN_PIN = '2103';
function initAdmin(){
  document.getElementById('adminLogin').addEventListener('click', adminLogin);
  document.getElementById('adminSend').addEventListener('click', adminSendReply);
  setInterval(renderAdminPending,1500);
  setInterval(renderAdminMessages,1500);
}

function adminLogin(){
  const pin = (document.getElementById('adminPin').value||'').trim();
  if(pin !== ADMIN_PIN){ document.getElementById('adminNotice').innerText = 'Incorrect PIN'; return; }
  document.getElementById('adminPanel').classList.remove('hidden');
  document.getElementById('adminNotice').innerText = 'Admin unlocked';
  renderAdminPending();
  renderAdminMessages();
}

function renderAdminPending(){
  const pend = JSON.parse(localStorage.getItem('astro_v9_pending')||'[]');
  const container = document.getElementById('pendingTable'); if(!container) return;
  container.innerHTML='';
  if(pend.length===0){ container.innerHTML='<div class="muted">No pending payments</div>'; return; }
  pend.forEach(tx=>{
    const row = document.createElement('div'); row.className='row';
    const left = document.createElement('div'); left.innerHTML = `<strong>₹${tx.amount}</strong> UTR: ${tx.utr}`;
    const right = document.createElement('div');
    const approveBtn = document.createElement('button'); approveBtn.innerText='Approve'; approveBtn.onclick = ()=>{ adminApprove(tx.id); };
    const rejectBtn = document.createElement('button'); rejectBtn.innerText='Reject'; rejectBtn.onclick = ()=>{ adminReject(tx.id); };
    right.appendChild(approveBtn); right.appendChild(rejectBtn);
    row.appendChild(left); row.appendChild(right);
    container.appendChild(row);
  });
}

function adminApprove(id){
  const pend = JSON.parse(localStorage.getItem('astro_v9_pending')||'[]');
  const tx = pend.find(t=>t.id===id); if(!tx) return;
  tx.status='approved'; localStorage.setItem('astro_v9_pending', JSON.stringify(pend));
  alert('Approved '+tx.utr);
}

function adminReject(id){
  const reason = prompt('Enter rejection reason'); if(reason===null) return;
  const pend = JSON.parse(localStorage.getItem('astro_v9_pending')||'[]');
  const tx = pend.find(t=>t.id===id); if(!tx) return;
  tx.status='rejected'; tx.reason = reason; localStorage.setItem('astro_v9_pending', JSON.stringify(pend));
  // push system message to client
  const msgs = JSON.parse(localStorage.getItem('astro_v9_msgs')||'[]');
  msgs.push({by:'system', text:`Your transaction ${tx.utr} was rejected: ${reason}`, ts:Date.now()});
  localStorage.setItem('astro_v9_msgs', JSON.stringify(msgs));
  alert('Rejected and message sent');
}

function adminSendReply(){
  const text = (document.getElementById('adminMsg').value||'').trim(); if(!text) return;
  const msgs = JSON.parse(localStorage.getItem('astro_v9_msgs')||'[]');
  msgs.push({by:'astro', text, ts:Date.now()}); localStorage.setItem('astro_v9_msgs', JSON.stringify(msgs));
  document.getElementById('adminMsg').value=''; renderAdminMessages();
}

function renderAdminMessages(){
  const box = document.getElementById('adminChatBox'); if(!box) return;
  const msgs = JSON.parse(localStorage.getItem('astro_v9_msgs')||'[]');
  box.innerHTML='';
  msgs.forEach(m=>{
    const d = document.createElement('div');
    d.className = 'message ' + (m.by==='client' ? 'msg-client' : (m.by==='astro' ? 'msg-astro' : ''));
    d.innerText = (m.by==='client' ? 'Client: ' : (m.by==='astro' ? 'You: ' : 'System: ')) + m.text;
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}
