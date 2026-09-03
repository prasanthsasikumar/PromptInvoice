/* Sign-in with a work email (magic link) and a shared per-domain workspace, backed by Supabase.
   When js/config.js has no credentials this module reports "not configured" and the app
   stays in local mode. */
(function (root) {
  'use strict';

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  const TABLES = { profiles: 'pi_profiles', clients: 'pi_clients', invoices: 'pi_invoices' };

  let client = null;
  let user = null;
  let company = null;
  let handlers = {};
  let sdkPromise = null;

  function config() { return root.PI_CONFIG || {}; }
  function configured() { return !!(config().supabaseUrl && config().supabaseAnonKey); }

  function loadSdk() {
    if (root.supabase && root.supabase.createClient) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the sign-in library. Check your connection.')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  async function fetchAll() {
    const out = {};
    for (const kind of Object.keys(TABLES)) {
      const res = await client.from(TABLES[kind]).select('id, data').eq('company_id', company.id);
      if (res.error) throw new Error(res.error.message);
      out[kind] = res.data.map(function (r) { return r.data; });
    }
    return out;
  }

  const backend = {
    upsert: async function (kind, record) {
      const res = await client.from(TABLES[kind]).upsert(
        { company_id: company.id, id: record.id, data: record, updated_at: new Date().toISOString() },
        { onConflict: 'company_id,id' }
      );
      if (res.error) throw new Error(res.error.message);
    },
    remove: async function (kind, id) {
      const res = await client.from(TABLES[kind]).delete().eq('company_id', company.id).eq('id', id);
      if (res.error) throw new Error(res.error.message);
    },
    renameCompany: async function (name) {
      const res = await client.from('pi_companies').update({ name: name }).eq('id', company.id);
      if (res.error) throw new Error(res.error.message);
      company.name = name;
    },
  };

  async function handleSession(session) {
    const u = session && session.user;
    if (!u) {
      if (user) { user = null; company = null; if (handlers.onSignOut) handlers.onSignOut(); }
      return;
    }
    if (user && user.id === u.id) return; // already handled
    user = u;
    const rpc = await client.rpc('pi_ensure_company');
    if (rpc.error) throw new Error(rpc.error.message);
    company = rpc.data;
    const data = await fetchAll();
    if (handlers.onSignIn) handlers.onSignIn({ user: user, company: company, data: data, backend: backend });
  }

  async function init(h) {
    handlers = h || {};
    if (!configured()) return false;
    await loadSdk();
    client = root.supabase.createClient(config().supabaseUrl, config().supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange(function (event, session) {
      // Defer: the Supabase client must not be awaited inside this callback.
      setTimeout(function () {
        handleSession(session).catch(function (e) { if (handlers.onError) handlers.onError(e); });
      }, 0);
    });
    const s = await client.auth.getSession();
    await handleSession(s.data.session);
    return true;
  }

  async function signIn(email) {
    if (!client) throw new Error('Sign-in is not configured on this site.');
    const redirect = location.origin + location.pathname;
    const res = await client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirect } });
    if (res.error) throw new Error(res.error.message);
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    user = null; company = null;
    if (handlers.onSignOut) handlers.onSignOut();
  }

  root.Auth = {
    configured: configured,
    init: init,
    signIn: signIn,
    signOut: signOut,
    user: function () { return user; },
    company: function () { return company; },
    backend: backend,
  };
})(window);
