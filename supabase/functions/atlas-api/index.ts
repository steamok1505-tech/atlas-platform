import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = Deno.env.get('ATLAS_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const SECRET_KEY = Deno.env.get('ATLAS_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'atlas-pdfs';
const PAYOUT_METHODS = ['Binance Pay ID', 'USDT (TRC20)', 'USDT (BEP20)', 'USDT (ERC20)', 'BTC', 'ETH'] as const;
const publicClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const adminClient = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
const clean = (value: unknown, max = 2000) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const money = (cents: number) => Number((cents / 100).toFixed(2));
const safeFileName = (value: unknown) => clean(value, 180).replace(/[\\/\r\n"]/g, '_') || 'document.pdf';
const getProfile = async (id: string) => {
  const { data, error } = await adminClient.from('profiles').select('id,name,email,role,created_at').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(403, 'Your Atlas profile is not ready. Please contact support.');
  return data;
};
const requireUser = async (req: Request, role?: 'admin' | 'worker') => {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new ApiError(401, 'Please sign in to continue.');
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, 'Your session has expired. Please sign in again.');
  const profile = await getProfile(data.user.id);
  if (role && profile.role !== role) throw new ApiError(403, 'You do not have permission to access this resource.');
  return profile;
};
const bodyJson = async (req: Request) => {
  try { return await req.json(); } catch { throw new ApiError(400, 'Invalid JSON request.'); }
};
const validateStoredPdf = async (storagePath: string) => {
  const { data, error } = await adminClient.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new ApiError(400, 'Uploaded PDF could not be found in private storage.');
  if (data.size > 25 * 1024 * 1024 || new TextDecoder().decode(await data.slice(0, 5).arrayBuffer()) !== '%PDF-') throw new ApiError(400, 'The uploaded file does not appear to be a valid PDF.');
};
const countRows = async (table: string, query?: (q: any) => any) => {
  let q = adminClient.from(table).select('id', { count: 'exact', head: true });
  if (query) q = query(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
};
async function earnings(workerId: string) {
  const { data: approved, error: e1 } = await adminClient.from('submissions').select('id').eq('worker_id', workerId).eq('status', 'approved');
  if (e1) throw e1;
  const { data: withdrawals, error: e2 } = await adminClient.from('withdrawals').select('gross_cents,status').eq('worker_id', workerId).in('status', ['pending', 'paid']);
  if (e2) throw e2;
  const totalCents = (approved || []).length * 800;
  const used = (withdrawals || []).reduce((sum, w) => sum + Number(w.gross_cents || 0), 0);
  return { approvedCount: (approved || []).length, totalEarned: money(totalCents), reservedOrPaid: money(used), available: money(Math.max(0, totalCents - used)) };
}
async function signedPdf(path: string, name: string) {
  const { data, error } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 60, { download: safeFileName(name) });
  if (error || !data?.signedUrl) throw new ApiError(404, 'PDF file not found.');
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: data.signedUrl } });
}
async function route(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const fnIndex = segments.indexOf('atlas-api');
  const path = '/' + segments.slice(fnIndex >= 0 ? fnIndex + 1 : segments.length).join('/');
  const method = req.method.toUpperCase();

  if (method === 'GET' && path === '/api/health') return json({ ok: true, service: 'Atlas Supabase API' });

  if (method === 'POST' && path === '/api/auth/register') {
    const body = await bodyJson(req);
    const name = clean(body.name, 100);
    const email = clean(body.email, 180).toLowerCase();
    const password = String(body.password || '');
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) throw new ApiError(400, 'Enter a name, valid email, and password of at least 10 characters.');
    const { data, error } = await publicClient.auth.signUp({ email, password, options: { data: { name } } });
    if (error) throw new ApiError(400, error.message);
    if (!data.user) throw new ApiError(400, 'Could not create your account.');
    if (!data.session) return json({ error: 'Account created. Please confirm your email, then sign in.' }, 202);
    const profile = await getProfile(data.user.id);
    return json({ user: profile, session: data.session }, 201);
  }
  if (method === 'POST' && path === '/api/auth/login') {
    const body = await bodyJson(req);
    const email = clean(body.email, 180).toLowerCase();
    const password = String(body.password || '');
    const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) throw new ApiError(401, 'Email or password is incorrect. If you just registered, confirm your email first.');
    const profile = await getProfile(data.user.id);
    return json({ user: profile, session: data.session });
  }
  if (method === 'POST' && path === '/api/auth/logout') return json({ ok: true });

  if (method === 'POST' && path === '/api/chat/visitor') {
    const body = await bodyJson(req);
    const visitorId = clean(body.visitorId, 100);
    const name = clean(body.name, 100) || 'Website visitor';
    const email = clean(body.email, 180);
    const message = clean(body.message, 2000);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(visitorId) || !message) throw new ApiError(400, 'A valid visitor session and message are required.');
    const { error } = await adminClient.from('messages').insert({ thread_type: 'visitor', thread_key: visitorId, sender_role: 'visitor', sender_name: name, sender_email: email, body: message });
    if (error) throw error;
    return json({ ok: true }, 201);
  }
  if (method === 'GET' && path === '/api/chat/visitor') {
    const visitorId = clean(url.searchParams.get('visitorId'), 100);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(visitorId)) throw new ApiError(400, 'Invalid visitor session.');
    const { data, error } = await adminClient.from('messages').select('id,sender_role,sender_name,body,created_at').eq('thread_type', 'visitor').eq('thread_key', visitorId).order('id').limit(200);
    if (error) throw error;
    return json({ messages: data || [] });
  }

  if (method === 'GET' && path === '/api/me') {
    const user = await requireUser(req);
    return json({ user });
  }

  const user = await requireUser(req);
  if (method === 'GET' && path === '/api/tasks') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const { data: tasks, error } = await adminClient.from('tasks').select('id,title,description,due_date,created_at').eq('active', true).order('created_at', { ascending: false });
    if (error) throw error;
    const { data: submissions, error: se } = await adminClient.from('submissions').select('task_id,status,submitted_at').eq('worker_id', user.id).order('submitted_at', { ascending: false });
    if (se) throw se;
    const statusByTask = new Map<string, string>();
    for (const s of submissions || []) if (!statusByTask.has(s.task_id)) statusByTask.set(s.task_id, s.status);
    return json({ tasks: (tasks || []).map(t => ({ ...t, my_status: statusByTask.get(t.id) || null })) });
  }
  let match = path.match(/^\/api\/tasks\/([^/]+)\/file$/);
  if (method === 'GET' && match) {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const { data: task, error } = await adminClient.from('tasks').select('storage_path,original_name,active').eq('id', match[1]).maybeSingle();
    if (error) throw error;
    if (!task || !task.active) throw new ApiError(404, 'This task is not available.');
    return await signedPdf(task.storage_path, task.original_name);
  }
  match = path.match(/^\/api\/tasks\/([^/]+)\/submit$/);
  if (method === 'POST' && match) {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const body = await bodyJson(req);
    const storagePath = clean(body.storagePath, 500);
    const originalName = safeFileName(body.original_name);
    if (!storagePath.startsWith(`submissions/${user.id}/`) || !storagePath.endsWith('.pdf')) throw new ApiError(400, 'Invalid uploaded PDF path.');
    await validateStoredPdf(storagePath);
    const { data: task, error: te } = await adminClient.from('tasks').select('id,active').eq('id', match[1]).maybeSingle();
    if (te) throw te;
    if (!task || !task.active) throw new ApiError(404, 'This task is not available.');
    const { data: existing, error: ee } = await adminClient.from('submissions').select('id').eq('task_id', task.id).eq('worker_id', user.id).in('status', ['pending', 'approved']).maybeSingle();
    if (ee && !String(ee.message).includes('multiple')) throw ee;
    if (existing) throw new ApiError(409, 'You already have a pending or approved submission for this task.');
    const { data, error } = await adminClient.from('submissions').insert({ task_id: task.id, worker_id: user.id, original_name: originalName, storage_path: storagePath, status: 'pending' }).select('id,status').single();
    if (error) { if (error.code === '23505') throw new ApiError(409, 'You already have a pending or approved submission for this task.'); throw error; }
    return json({ submissionId: data.id, status: data.status, message: 'Your PDF has been submitted for review.' }, 201);
  }
  if (method === 'GET' && path === '/api/worker/submissions') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const { data, error } = await adminClient.from('submissions').select('id,task_id,status,admin_note,submitted_at,reviewed_at,original_name').eq('worker_id', user.id).order('submitted_at', { ascending: false });
    if (error) throw error;
    const taskIds = [...new Set((data || []).map(s => s.task_id))];
    const { data: tasks, error: te } = taskIds.length ? await adminClient.from('tasks').select('id,title').in('id', taskIds) : { data: [], error: null };
    if (te) throw te;
    const titles = new Map((tasks || []).map(t => [t.id, t.title]));
    return json({ submissions: (data || []).map(s => ({ ...s, task_title: titles.get(s.task_id) || 'Task' })) });
  }
  if (method === 'GET' && path === '/api/worker/earnings') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    return json(await earnings(user.id));
  }
  if (method === 'GET' && path === '/api/worker/withdrawals') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const { data, error } = await adminClient.from('withdrawals').select('id,gross_cents,fee_cents,net_cents,status,admin_note,requested_at,processed_at,payout_method,payout_address').eq('worker_id', user.id).order('requested_at', { ascending: false });
    if (error) throw error;
    return json({ withdrawals: (data || []).map(w => ({ ...w, gross: money(w.gross_cents), fee: money(w.fee_cents), net: money(w.net_cents) })) });
  }
  if (method === 'POST' && path === '/api/worker/withdrawals') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const body = await bodyJson(req); const gross = Number(body.grossUsd);
    const payoutMethod = clean(body.payoutMethod, 40);
    const payoutAddress = clean(body.payoutAddress, 180);
    if (!Number.isInteger(gross) || gross < 50 || gross % 50 !== 0) throw new ApiError(400, 'Withdrawal requests must be $50 or a multiple of $50.');
    if (!PAYOUT_METHODS.includes(payoutMethod as typeof PAYOUT_METHODS[number])) throw new ApiError(400, 'Choose a supported Binance payout method or network.');
    if (payoutAddress.length < 5 || payoutAddress.length > 180) throw new ApiError(400, 'Enter a payout destination between 5 and 180 characters.');
    const { data, error } = await adminClient.rpc('atlas_request_withdrawal', { p_worker_id: user.id, p_gross_cents: gross * 100, p_payout_method: payoutMethod, p_payout_address: payoutAddress });
    if (error) { if (String(error.message).includes('available balance')) { const bal = await earnings(user.id); throw new ApiError(400, `Your available balance is $${bal.available.toFixed(2)}.`); } throw error; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new ApiError(500, 'Withdrawal request could not be created.');
    return json({ id: row.id, gross: money(row.gross_cents), fee: money(row.fee_cents), net: money(row.net_cents), status: row.status }, 201);
  }
  if (method === 'GET' && path === '/api/worker/chat') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const { data, error } = await adminClient.from('messages').select('id,sender_role,sender_name,body,created_at').eq('thread_type', 'worker').eq('thread_key', user.id).order('id').limit(300);
    if (error) throw error;
    return json({ messages: data || [] });
  }
  if (method === 'POST' && path === '/api/worker/chat') {
    if (user.role !== 'worker') throw new ApiError(403, 'Worker access required.');
    const body = await bodyJson(req); const message = clean(body.message, 2000);
    if (!message) throw new ApiError(400, 'Write a message first.');
    const { error } = await adminClient.from('messages').insert({ thread_type: 'worker', thread_key: user.id, sender_role: 'worker', sender_name: user.name, sender_email: user.email, body: message });
    if (error) throw error;
    return json({ ok: true }, 201);
  }

  if (user.role !== 'admin') throw new ApiError(403, 'Administrator access required.');
  if (method === 'GET' && path === '/api/admin/dashboard') {
    const [workers, activeTasks, pendingSubmissions, pendingWithdrawals] = await Promise.all([
      countRows('profiles', q => q.eq('role', 'worker')),
      countRows('tasks', q => q.eq('active', true)),
      countRows('submissions', q => q.eq('status', 'pending')),
      countRows('withdrawals', q => q.eq('status', 'pending')),
    ]);
    return json({ workers, activeTasks, pendingSubmissions, pendingWithdrawals });
  }
  if (method === 'GET' && path === '/api/admin/tasks') {
    const { data: tasks, error } = await adminClient.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const { data: subs, error: se } = await adminClient.from('submissions').select('task_id'); if (se) throw se;
    const counts = new Map<string, number>(); for (const s of subs || []) counts.set(s.task_id, (counts.get(s.task_id) || 0) + 1);
    return json({ tasks: (tasks || []).map(t => ({ ...t, submission_count: counts.get(t.id) || 0 })) });
  }
  match = path.match(/^\/api\/admin\/tasks\/([^/]+)\/file$/);
  if (method === 'GET' && match) {
    const { data, error } = await adminClient.from('tasks').select('storage_path,original_name').eq('id', match[1]).maybeSingle();
    if (error) throw error; if (!data) throw new ApiError(404, 'Task not found.');
    return await signedPdf(data.storage_path, data.original_name);
  }
  if (method === 'POST' && path === '/api/admin/tasks') {
    const body = await bodyJson(req); const title = clean(body.title, 180); const description = clean(body.description, 2000); const dueDate = clean(body.dueDate, 30) || null;
    const storagePath = clean(body.storagePath, 500); const originalName = safeFileName(body.original_name);
    if (title.length < 3) throw new ApiError(400, 'Task title must be at least 3 characters.');
    if (!storagePath.startsWith('tasks/') || !storagePath.endsWith('.pdf')) throw new ApiError(400, 'Invalid source PDF path.');
    await validateStoredPdf(storagePath);
    const { data, error } = await adminClient.from('tasks').insert({ title, description, original_name: originalName, storage_path: storagePath, due_date: dueDate, created_by: user.id }).select('id').single();
    if (error) throw error;
    return json({ id: data.id, message: 'Task created.' }, 201);
  }
  match = path.match(/^\/api\/admin\/tasks\/([^/]+)$/);
  if (method === 'PATCH' && match) {
    const body = await bodyJson(req); if (typeof body.active !== 'boolean') throw new ApiError(400, 'Provide active: true or false.');
    const { data, error } = await adminClient.from('tasks').update({ active: body.active }).eq('id', match[1]).select('id').maybeSingle();
    if (error) throw error; if (!data) throw new ApiError(404, 'Task not found.');
    return json({ ok: true });
  }
  if (method === 'GET' && path === '/api/admin/submissions') {
    const status = url.searchParams.get('status');
    let q = adminClient.from('submissions').select('*').order('submitted_at', { ascending: false });
    if (['pending', 'approved', 'rejected'].includes(status || '')) q = q.eq('status', status);
    const { data: subs, error } = await q; if (error) throw error;
    const taskIds = [...new Set((subs || []).map(s => s.task_id))]; const workerIds = [...new Set((subs || []).map(s => s.worker_id))];
    const [{ data: tasks, error: te }, { data: workers, error: we }] = await Promise.all([
      taskIds.length ? adminClient.from('tasks').select('id,title').in('id', taskIds) : Promise.resolve({ data: [], error: null } as any),
      workerIds.length ? adminClient.from('profiles').select('id,name,email').in('id', workerIds) : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (te) throw te; if (we) throw we;
    const taskMap = new Map<string, string>((tasks || []).map((t: any) => [t.id, t.title] as [string, string])); const workerMap = new Map<string, any>((workers || []).map((w: any) => [w.id, w] as [string, any]));
    return json({ submissions: (subs || []).map(s => ({ ...s, task_title: taskMap.get(s.task_id) || 'Task', worker_id: s.worker_id, worker_name: workerMap.get(s.worker_id)?.name || 'Worker', worker_email: workerMap.get(s.worker_id)?.email || '' })) });
  }
  match = path.match(/^\/api\/admin\/submissions\/([^/]+)\/file$/);
  if (method === 'GET' && match) {
    const { data, error } = await adminClient.from('submissions').select('storage_path,original_name').eq('id', match[1]).maybeSingle();
    if (error) throw error; if (!data) throw new ApiError(404, 'Submission not found.');
    return await signedPdf(data.storage_path, data.original_name);
  }
  match = path.match(/^\/api\/admin\/submissions\/([^/]+)\/review$/);
  if (method === 'POST' && match) {
    const body = await bodyJson(req); const status = body.status; const note = clean(body.note, 1000);
    if (!['approved', 'rejected'].includes(status)) throw new ApiError(400, 'Status must be approved or rejected.');
    const { data, error } = await adminClient.from('submissions').update({ status, admin_note: note, reviewed_at: new Date().toISOString() }).eq('id', match[1]).eq('status', 'pending').select('id').maybeSingle();
    if (error) { if (error.code === '23505') throw new ApiError(409, 'This worker already has an approved submission for this task.'); throw error; }
    if (!data) throw new ApiError(409, 'This submission has already been reviewed or does not exist.');
    return json({ ok: true, status, earned: status === 'approved' ? 8 : 0 });
  }
  if (method === 'GET' && path === '/api/admin/workers') {
    const { data: workers, error } = await adminClient.from('profiles').select('id,name,email,created_at').eq('role', 'worker').order('created_at', { ascending: false });
    if (error) throw error;
    const { data: subs, error: se } = await adminClient.from('submissions').select('worker_id,status'); if (se) throw se;
    const stats = new Map<string, { approved_count: number; pending_count: number }>();
    for (const s of subs || []) { const v = stats.get(s.worker_id) || { approved_count: 0, pending_count: 0 }; if (s.status === 'approved') v.approved_count++; if (s.status === 'pending') v.pending_count++; stats.set(s.worker_id, v); }
    return json({ workers: (workers || []).map(w => ({ ...w, ...(stats.get(w.id) || { approved_count: 0, pending_count: 0 }), earned: money(((stats.get(w.id)?.approved_count || 0) * 800)) })) });
  }
  if (method === 'GET' && path === '/api/admin/demo-profiles') {
    const { data: profiles, error } = await adminClient.from('demo_profiles').select('id,name,email,created_at,is_demo').order('id', { ascending: true });
    if (error) throw error;
    return json({ profiles: profiles || [] });
  }
  if (method === 'GET' && path === '/api/admin/withdrawals') {
    const { data: withdrawals, error } = await adminClient.from('withdrawals').select('*').order('requested_at', { ascending: false }); if (error) throw error;
    const ids = [...new Set((withdrawals || []).map(w => w.worker_id))];
    const { data: workers, error: we } = ids.length ? await adminClient.from('profiles').select('id,name,email').in('id', ids) : { data: [], error: null };
    if (we) throw we; const wm = new Map<string, any>((workers || []).map((w: any) => [w.id, w] as [string, any]));
    return json({ withdrawals: (withdrawals || []).map(w => ({ ...w, gross: money(w.gross_cents), fee: money(w.fee_cents), net: money(w.net_cents), worker_name: wm.get(w.worker_id)?.name || 'Worker', worker_email: wm.get(w.worker_id)?.email || '' })) });
  }
  match = path.match(/^\/api\/admin\/withdrawals\/([^/]+)\/process$/);
  if (method === 'POST' && match) {
    const body = await bodyJson(req); const status = body.status; const note = clean(body.note, 1000);
    if (!['paid', 'rejected'].includes(status)) throw new ApiError(400, 'Status must be paid or rejected.');
    const { data, error } = await adminClient.from('withdrawals').update({ status, admin_note: note, processed_at: new Date().toISOString() }).eq('id', match[1]).eq('status', 'pending').select('id').maybeSingle();
    if (error) throw error; if (!data) throw new ApiError(409, 'This withdrawal has already been processed or does not exist.');
    return json({ ok: true, status, message: status === 'paid' ? 'Marked paid. Complete the transfer externally before using this action.' : 'Withdrawal rejected; reserved balance has been released.' });
  }
  if (method === 'GET' && path === '/api/admin/chat/threads') {
    const [{ data: all, error }, { data: demos, error: de }] = await Promise.all([
      adminClient.from('messages').select('*').order('id', { ascending: false }).limit(3000),
      adminClient.from('demo_profiles').select('id,name,email,created_at,is_demo').order('id', { ascending: true }),
    ]);
    if (error) throw error; if (de) throw de;
    const latest = new Map<string, any>(); const visitorFirst = new Map<string, any>();
    for (const m of all || []) { const k = `${m.thread_type}:${m.thread_key}`; if (!latest.has(k)) latest.set(k, m); if (m.thread_type === 'visitor') visitorFirst.set(k, m); }
    const demoMap = new Map<string, any>((demos || []).map((d: any) => [d.id, d] as [string, any]));
    for (const d of demos || []) {
      const k = `demo:${d.id}`;
      if (!latest.has(k)) latest.set(k, { thread_type: 'demo', thread_key: d.id, sender_role: 'worker', sender_name: d.name, sender_email: d.email, body: 'DEMO ONLY — sample conversation (no real worker).', created_at: d.created_at, id: 0 });
    }
    const threadRows = [...latest.values()]; const workerIds = [...new Set(threadRows.filter(m => m.thread_type === 'worker').map(m => m.thread_key))];
    const { data: workers, error: we } = workerIds.length ? await adminClient.from('profiles').select('id,name,email').in('id', workerIds) : { data: [], error: null }; if (we) throw we;
    const wm = new Map<string, any>((workers || []).map((w: any) => [w.id, w] as [string, any]));
    const threads = threadRows.map(t => {
      const k = `${t.thread_type}:${t.thread_key}`; const w = wm.get(t.thread_key); const first = visitorFirst.get(k); const demo = demoMap.get(t.thread_key);
      return { ...t,
        display_name: t.thread_type === 'worker' ? (w?.name || `Worker ${t.thread_key.slice(0, 8)}`) : t.thread_type === 'demo' ? (demo?.name || 'DEMO PROFILE') : (first?.sender_name || 'Website visitor'),
        display_email: t.thread_type === 'worker' ? (w?.email || '') : t.thread_type === 'demo' ? (demo?.email || '') : (first?.sender_email || '')
      };
    });
    threads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return json({ threads });
  }
  if (method === 'GET' && path === '/api/admin/chat/messages') {
    const type = url.searchParams.get('type'); const key = clean(url.searchParams.get('key'), 100);
    if (!['worker', 'visitor', 'demo'].includes(type || '') || !key) throw new ApiError(400, 'Select a valid conversation.');
    if (type === 'demo') { const { data: profile, error: pe } = await adminClient.from('demo_profiles').select('id').eq('id', key).maybeSingle(); if (pe) throw pe; if (!profile) throw new ApiError(404, 'Demo profile not found.'); }
    const { data, error } = await adminClient.from('messages').select('id,sender_role,sender_name,sender_email,body,created_at').eq('thread_type', type).eq('thread_key', key).order('id').limit(300);
    if (error) throw error; return json({ messages: data || [] });
  }
  if (method === 'POST' && path === '/api/admin/chat/reply') {
    const body = await bodyJson(req); const type = body.type; const key = clean(body.key, 100); const message = clean(body.message, 2000);
    if (!['worker', 'visitor', 'demo'].includes(type) || !key || !message) throw new ApiError(400, 'Select a conversation and write a message.');
    if (type === 'worker') { const { data: worker, error } = await adminClient.from('profiles').select('id').eq('id', key).eq('role', 'worker').maybeSingle(); if (error) throw error; if (!worker) throw new ApiError(404, 'Worker not found.'); }
    if (type === 'demo') { const { data: profile, error } = await adminClient.from('demo_profiles').select('id').eq('id', key).maybeSingle(); if (error) throw error; if (!profile) throw new ApiError(404, 'Demo profile not found.'); }
    const senderName = type === 'demo' ? 'Atlas Support (Demo)' : type === 'visitor' ? 'Atlas Support' : 'Atlas Admin';
    const { error } = await adminClient.from('messages').insert({ thread_type: type, thread_key: key, sender_role: 'admin', sender_name: senderName, body: message });
    if (error) throw error; return json({ ok: true }, 201);
  }
  throw new ApiError(404, 'Endpoint not found.');
}

Deno.serve(async (req: Request) => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) return json({ error: 'Supabase function secrets are not configured. Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.' }, 500);
  try { return await route(req); }
  catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 500) console.error('Atlas API error:', error);
    return json({ error: status === 500 ? 'Unexpected server error. Check Supabase Function logs.' : (error as Error).message }, status);
  }
});
