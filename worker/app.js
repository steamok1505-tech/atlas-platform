(() => {
  const API = String(window.ATLAS_API_URL || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const state = { user: null, view: 'tasks', visitorId: getVisitorId() };
  const titles = { tasks: ['YOUR WORKSPACE','Available tasks'], submissions: ['TRACK YOUR WORK','My submissions'], earnings: ['YOUR BALANCE','Earnings & payout'], chat: ['WE’RE HERE TO HELP','Messages'] };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const dollars = (value) => `$${Number(value || 0).toFixed(2)}`;
  const dateText = (value) => value ? new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z')).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}) : '—';
  function getVisitorId() {
    let id = localStorage.getItem('atlasVisitorId');
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g,'') : `visitor_${Date.now()}_${Math.random().toString(36).slice(2)}`; localStorage.setItem('atlasVisitorId', id); }
    return id;
  }
  async function api(path, options = {}) { return window.AtlasApi.request(path, options); }
  function toast(message, error = false) {
    const el = $('toast'); if (!el) return;
    el.textContent = message; el.classList.remove('hidden','error'); if (error) el.classList.add('error');
    clearTimeout(toast._timer); toast._timer = setTimeout(() => el.classList.add('hidden'), 4500);
  }
  function authError(message) { $('auth-error').textContent = message; $('auth-error').classList.remove('hidden'); }
  function clearAuthError() { $('auth-error').textContent = ''; $('auth-error').classList.add('hidden'); }
  function setAuthMode(register) {
    $('login-form').classList.toggle('hidden', register); $('register-form').classList.toggle('hidden', !register);
    $('auth-eyebrow').textContent = register ? 'GET STARTED' : 'WELCOME BACK';
    $('auth-title').textContent = register ? 'Create your account' : 'Sign in to Atlas';
    $('auth-subtitle').textContent = register ? 'Set up your worker workspace in a minute.' : 'Pick up where you left off.';
    $('auth-switch').innerHTML = register ? 'Already have an account? <button type="button" class="text-button" id="show-login">Sign in</button>' : 'New to Atlas? <button type="button" class="text-button" id="show-register">Create an account</button>';
    clearAuthError();
  }
  function showWorkspace(user) {
    state.user = user;
    $('auth-view').classList.add('hidden'); $('app-view').classList.remove('hidden');
    $('user-name').textContent = user.name; $('user-email').textContent = user.email;
    $('user-avatar').textContent = (user.name || 'A').trim().charAt(0).toUpperCase(); $('top-avatar').textContent = (user.name || 'A').trim().charAt(0).toUpperCase();
    $('year').textContent = new Date().getFullYear();
    showView('tasks'); loadTasks(); loadEarnings();
  }
  function showAuth() { state.user = null; $('app-view').classList.add('hidden'); $('auth-view').classList.remove('hidden'); }
  function showView(view) {
    state.view = view;
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const section = $(`view-${view}`); if (section) section.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    $('page-eyebrow').textContent = titles[view][0]; $('page-title').textContent = titles[view][1];
    if (view === 'tasks') loadTasks(); if (view === 'submissions') loadSubmissions(); if (view === 'earnings') { loadEarnings(); loadWithdrawals(); }
    if (view === 'chat') loadWorkerChat();
  }
  function statusPill(status) {
    const safe = ['pending','approved','rejected','paid','active','inactive'].includes(status) ? status : 'pending';
    const label = safe === 'pending' ? 'In review' : safe.charAt(0).toUpperCase() + safe.slice(1);
    return `<span class="status-pill status-${safe}">${esc(label)}</span>`;
  }
  async function loadTasks() {
    const list = $('tasks-list'); list.innerHTML = '<div class="loading-card">Loading your tasks…</div>';
    try {
      const { tasks } = await api('/api/tasks');
      $('task-nav-count').textContent = tasks.length;
      if (!tasks.length) { list.innerHTML = '<div class="empty-state"><strong>No tasks available right now</strong>New source PDFs will appear here when the Atlas admin publishes them.</div>'; return; }
      list.innerHTML = tasks.map(task => {
        const locked = ['pending','approved'].includes(task.my_status);
        const taskStatus = task.my_status ? statusPill(task.my_status) : '<span class="status-pill status-active">Available</span>';
        const action = locked ? `<div class="task-actions">${taskStatus}<span class="microcopy">${task.my_status === 'approved' ? 'Earnings credited for this task.' : 'Wait for the review to finish.'}</span></div>` : `<form class="task-submit-form" data-task-id="${task.id}"><div class="task-actions"><button type="button" class="btn btn-outline" data-download="${task.id}">↓ Source PDF</button><label class="btn btn-soft upload-label">Choose PDF<input type="file" name="pdf" accept="application/pdf,.pdf" required></label></div><div class="task-actions"><button class="btn btn-primary btn-full" type="submit">${task.my_status === 'rejected' ? 'Resubmit PDF' : 'Submit completed PDF'} →</button></div><p class="microcopy" style="margin-top:9px">PDF only · Max 25 MB${task.my_status === 'rejected' ? ` · Previous review: rejected` : ''}</p></form>`;
        return `<article class="task-card"><div class="task-top"><div class="task-file-icon">▤</div>${taskStatus}</div><h3>${esc(task.title)}</h3><p>${esc(task.description || 'Write the source document by hand, scan it clearly, and submit a single PDF for review.')}</p><div class="task-meta"><span>Due ${esc(task.due_date ? dateText(task.due_date) : 'date not set')}</span><span class="task-pay">+$8.00</span></div>${action}</article>`;
      }).join('');
    } catch (err) { list.innerHTML = `<div class="empty-state"><strong>Could not load tasks</strong>${esc(err.message)}</div>`; if (err.message.includes('sign in')) showAuth(); }
  }
  async function downloadTask(id) {
    try {
      const response = await fetch(`${API}/api/tasks/${id}/file`, { headers: window.AtlasApi.authHeaders() });
      if (!response.ok) { const d = await response.json().catch(() => ({})); throw new Error(d.error || 'Could not download PDF.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `atlas-task-${id}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (err) { toast(err.message, true); }
  }
  async function loadSubmissions() {
    const list = $('submissions-list'); list.innerHTML = '<div class="loading-card">Loading submissions…</div>';
    try {
      const { submissions } = await api('/api/worker/submissions');
      if (!submissions.length) { list.innerHTML = '<div class="empty-state"><strong>No submissions yet</strong>Your submitted PDFs and review notes will appear here.</div>'; return; }
      list.innerHTML = `<table class="data-table"><thead><tr><th>Task</th><th>Submitted</th><th>Status</th><th>Review note</th><th>Reward</th></tr></thead><tbody>${submissions.map(s => `<tr><td><strong>${esc(s.task_title)}</strong><br><span class="muted-cell">${esc(s.original_name)}</span></td><td>${esc(dateText(s.submitted_at))}</td><td>${statusPill(s.status)}</td><td>${esc(s.admin_note || '—')}</td><td><strong>${s.status === 'approved' ? '$8.00' : '—'}</strong></td></tr>`).join('')}</tbody></table>`;
    } catch (err) { list.innerHTML = `<div class="empty-state"><strong>Could not load submissions</strong>${esc(err.message)}</div>`; }
  }
  async function loadEarnings() {
    try {
      const data = await api('/api/worker/earnings');
      $('total-earned').textContent = dollars(data.totalEarned); $('available-balance').textContent = dollars(data.available); $('approved-count').textContent = data.approvedCount;
      const select = $('withdraw-amount');
      [...select.options].forEach(option => { option.disabled = Number(option.value) > data.available; });
      if (Number(select.value) > data.available) select.value = '50'; updateFeePreview();
    } catch (err) { if (state.user) toast(err.message, true); }
  }
  async function loadWithdrawals() {
    const list = $('withdrawals-list'); list.innerHTML = '<div class="loading-card">Loading…</div>';
    try {
      const { withdrawals } = await api('/api/worker/withdrawals');
      if (!withdrawals.length) { list.innerHTML = '<div class="empty-state"><strong>No withdrawal requests</strong>Eligible requests will appear here.</div>'; return; }
      list.innerHTML = withdrawals.map(w => `<div class="history-row"><div><strong>${dollars(w.gross)} requested</strong><small>${esc(dateText(w.requested_at))} · Fee ${dollars(w.fee)}</small>${w.admin_note ? `<small>${esc(w.admin_note)}</small>` : ''}</div><div class="history-amount"><strong>${dollars(w.net)}</strong><small>${statusPill(w.status)}</small></div></div>`).join('');
    } catch (err) { list.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; }
  }
  function updateFeePreview() { const gross = Number($('withdraw-amount').value || 50); const fee = gross / 50 * 10; $('fee-gross').textContent = dollars(gross); $('fee-charge').textContent = `−${dollars(fee)}`; $('fee-net').textContent = dollars(gross - fee); }
  async function loadWorkerChat() {
    const box = $('worker-chat-messages'); box.innerHTML = '<div class="loading-card">Loading messages…</div>';
    try {
      const { messages } = await api('/api/worker/chat');
      box.innerHTML = messages.length ? messages.map(m => `<div class="message-bubble ${m.sender_role === 'worker' ? 'mine' : ''}">${esc(m.body)}<small>${esc(m.sender_name)} · ${esc(dateText(m.created_at))}</small></div>`).join('') : '<div class="empty-state"><strong>Start a conversation</strong>Messages you send here go to the Atlas admin inbox. Replies are labelled as Atlas Admin.</div>';
      box.scrollTop = box.scrollHeight;
    } catch (err) { box.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; }
  }
  async function loadVisitorChat() {
    try {
      const { messages } = await api(`/api/chat/visitor?visitorId=${encodeURIComponent(state.visitorId)}`);
      const box = $('visitor-chat-messages');
      if (!messages.length) { box.innerHTML = '<p class="chat-welcome">Hi there! Send us a message and our support team will reply here.</p>'; return; }
      box.innerHTML = messages.map(m => `<div class="message-bubble ${m.sender_role === 'visitor' ? 'mine' : ''}">${esc(m.body)}<small>${esc(m.sender_name)} · ${esc(dateText(m.created_at))}</small></div>`).join(''); box.scrollTop = box.scrollHeight;
    } catch (err) { $('visitor-chat-messages').innerHTML = `<p class="chat-welcome">${esc(err.message)}</p>`; }
  }
  function toggleSupport(open) {
    const body = $('support-body'); const shouldOpen = typeof open === 'boolean' ? open : body.classList.contains('hidden');
    body.classList.toggle('hidden', !shouldOpen); $('support-chevron').textContent = shouldOpen ? '⌄' : '⌃';
    if (shouldOpen) loadVisitorChat();
  }

  document.addEventListener('click', async (event) => {
    if (event.target.closest('#show-register')) setAuthMode(true);
    if (event.target.closest('#show-login')) setAuthMode(false);
    const nav = event.target.closest('[data-view]'); if (nav && nav.dataset.view) showView(nav.dataset.view);
    const dl = event.target.closest('[data-download]'); if (dl) downloadTask(dl.dataset.download);
    if (event.target.closest('#refresh-tasks')) loadTasks();
    if (event.target.closest('#refresh-submissions')) loadSubmissions();
    if (event.target.closest('#refresh-earnings')) { loadEarnings(); loadWithdrawals(); }
    if (event.target.closest('#refresh-worker-chat')) loadWorkerChat();
    if (event.target.closest('#logout-btn')) { try { await api('/api/auth/logout', {method:'POST'}); } catch {} showAuth(); setAuthMode(false); }
    if (event.target.closest('#support-toggle')) toggleSupport();
    if (event.target.closest('#close-support')) toggleSupport(false);
    if (event.target.closest('#open-support') || event.target.closest('#footer-support')) toggleSupport(true);
  });
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); clearAuthError(); const form = new FormData(event.currentTarget);
    try { const data = await api('/api/auth/login', { method:'POST', body:JSON.stringify({email:form.get('email'),password:form.get('password')}) }); if (data.user.role !== 'worker') { await api('/api/auth/logout',{method:'POST'}); throw new Error('This is an admin account. Please sign in through the Atlas Admin Panel.'); } showWorkspace(data.user); }
    catch (err) { authError(err.message); }
  });
  $('register-form').addEventListener('submit', async event => {
    event.preventDefault(); clearAuthError(); const form = new FormData(event.currentTarget);
    try { const data = await api('/api/auth/register', { method:'POST', body:JSON.stringify({name:form.get('name'),email:form.get('email'),password:form.get('password')}) }); if (!data.user) throw new Error('Account created. If email confirmation is enabled, confirm your email and then sign in.'); showWorkspace(data.user); }
    catch (err) { authError(err.message); }
  });
  $('tasks-list').addEventListener('submit', async event => {
    const formEl = event.target.closest('.task-submit-form'); if (!formEl) return; event.preventDefault();
    const input = formEl.querySelector('input[type=file]'); if (!input.files || !input.files[0]) { toast('Choose a completed PDF first.', true); return; }
    const button = formEl.querySelector('button[type=submit]'); const original = button.textContent; button.disabled = true; button.textContent = 'Uploading…';
    const file = input.files[0];
    try {
      const storagePath = `submissions/${state.user.id}/${crypto.randomUUID()}.pdf`;
      await window.AtlasStorage.uploadPdf(file, storagePath);
      await api(`/api/tasks/${formEl.dataset.taskId}/submit`, {method:'POST',body:JSON.stringify({storagePath, original_name:file.name})});
      toast('PDF submitted successfully. It is now awaiting review.'); await loadTasks(); await loadSubmissions();
    }
    catch (err) { toast(err.message, true); }
    finally { button.disabled = false; button.textContent = original; }
  });
  $('withdraw-amount').addEventListener('change', updateFeePreview);
  $('withdraw-form').addEventListener('submit', async event => {
    event.preventDefault(); const grossUsd = Number($('withdraw-amount').value);
    if (!confirm(`Request ${dollars(grossUsd)} gross? The estimated service fee is ${dollars(grossUsd / 50 * 10)}, so the estimated payout is ${dollars(grossUsd - grossUsd / 50 * 10)}.`)) return;
    try { await api('/api/worker/withdrawals', {method:'POST',body:JSON.stringify({grossUsd})}); toast('Withdrawal request submitted. Payment is not automatic; check its status in your history.'); loadEarnings(); loadWithdrawals(); }
    catch (err) { toast(err.message, true); }
  });
  $('worker-chat-form').addEventListener('submit', async event => {
    event.preventDefault(); const input = event.currentTarget.elements.message; const message = input.value.trim(); if (!message) return;
    try { await api('/api/worker/chat',{method:'POST',body:JSON.stringify({message})}); input.value=''; loadWorkerChat(); }
    catch (err) { toast(err.message,true); }
  });
  $('visitor-chat-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const message = form.elements.message.value.trim(); if (!message) return;
    try { await api('/api/chat/visitor',{method:'POST',body:JSON.stringify({visitorId:state.visitorId,name:form.elements.name.value,email:form.elements.email.value,message})}); form.elements.message.value=''; loadVisitorChat(); }
    catch (err) { toast(err.message,true); }
  });
  $('year').textContent = new Date().getFullYear();
  setAuthMode(false); updateFeePreview();
  api('/api/me').then(({user}) => { if (user.role === 'worker') showWorkspace(user); else { api('/api/auth/logout',{method:'POST'}).catch(()=>{}); showAuth(); } }).catch(() => showAuth());
  setInterval(() => { if (!$('support-body').classList.contains('hidden')) loadVisitorChat(); if (state.view === 'chat' && state.user) loadWorkerChat(); }, 12000);
})();
