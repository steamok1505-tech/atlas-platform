(() => {
  const SESSION_KEY = 'atlasAuthSession';
  const base = () => String(window.ATLAS_API_URL || '').replace(/\/$/, '');
  const supabaseUrl = () => String(window.ATLAS_SUPABASE_URL || '').replace(/\/$/, '');
  const publishableKey = () => String(window.ATLAS_SUPABASE_PUBLISHABLE_KEY || '');
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
  function setSession(session) { if (session?.access_token) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); }
  function authHeaders() { const s = getSession(); const headers = { apikey: publishableKey() }; if (s?.access_token) headers.Authorization = `Bearer ${s.access_token}`; return headers; }
  async function refreshSession() {
    const s = getSession(); if (!s?.refresh_token) return false;
    const key = publishableKey();
    const response = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) { setSession(null); return false; }
    setSession(data); return true;
  }
  async function request(path, options = {}, retried = false) {
    const headers = { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(), ...(options.headers || {}) };
    const response = await fetch(`${base()}${path}`, { ...options, headers });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (response.status === 401 && !retried && !path.includes('/api/auth/login') && !path.includes('/api/auth/register')) {
      if (await refreshSession()) return request(path, options, true);
    }
    if (!response.ok || (data && data.error)) throw new Error((data && data.error) || `Request failed (${response.status}).`);
    if (data?.session?.access_token) setSession(data.session);
    if (path === '/api/auth/logout') setSession(null);
    return data;
  }
  async function uploadPdf(file, path) {
    if (!(file instanceof File) || file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file only.');
    if (file.size > 25 * 1024 * 1024) throw new Error('PDF files must be 25 MB or smaller.');
    const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (signature !== '%PDF-') throw new Error('The selected file does not appear to be a valid PDF.');
    const doUpload = async () => {
      const s = getSession(); if (!s?.access_token) throw new Error('Please sign in again before uploading.');
      const key = publishableKey();
      if (!key || key.includes('PASTE_YOUR')) throw new Error('Add your full Supabase publishable key in config.js first.');
      const safePath = String(path).split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${supabaseUrl()}/storage/v1/object/atlas-pdfs/${safePath}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: file
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.message || data.error || 'PDF upload failed.'), { status: response.status });
      return path;
    };
    try { return await doUpload(); }
    catch (err) { if (err.status === 401 && await refreshSession()) return await doUpload(); throw err; }
  }
  window.AtlasApi = { request, authHeaders, getSession, setSession, refreshSession };
  window.AtlasStorage = { uploadPdf };
})();
