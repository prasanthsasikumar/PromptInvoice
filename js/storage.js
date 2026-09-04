/* Persistence for business profiles, clients and saved invoices.
   Local mode: everything in localStorage.
   Cloud mode (after sign-in): an in-memory cache of the shared workspace, with every
   write mirrored to the remote backend. Reads stay synchronous either way.
   The working draft is always local to this browser. */
(function (root) {
  'use strict';

  const KEYS = {
    profiles: 'pi.profiles',
    clients: 'pi.clients',
    invoices: 'pi.invoices',
    draft: 'pi.draft',
  };

  let remote = null;   // { upsert(kind, record), remove(kind, id) }
  let cache = null;    // { profiles: [], clients: [], invoices: [] } while remote is attached

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Storage write failed', e);
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function reportError(e) {
    console.error(e);
    if (typeof Store.onError === 'function') Store.onError(e);
  }

  function list(kind) {
    return cache ? cache[kind].slice() : read(KEYS[kind], []);
  }

  function upsert(kind, record) {
    if (!record.id) record.id = uid();
    if (cache) {
      const idx = cache[kind].findIndex(function (r) { return r.id === record.id; });
      if (idx >= 0) cache[kind][idx] = record; else cache[kind].push(record);
      remote.upsert(kind, record).catch(reportError);
    } else {
      const arr = read(KEYS[kind], []);
      const idx = arr.findIndex(function (r) { return r.id === record.id; });
      if (idx >= 0) arr[idx] = record; else arr.push(record);
      write(KEYS[kind], arr);
    }
    return record;
  }

  function remove(kind, id) {
    if (cache) {
      cache[kind] = cache[kind].filter(function (r) { return r.id !== id; });
      remote.remove(kind, id).catch(reportError);
    } else {
      write(KEYS[kind], read(KEYS[kind], []).filter(function (r) { return r.id !== id; }));
    }
  }

  const Store = {
    uid: uid,
    onError: null,

    profiles: function () { return list('profiles'); },
    saveProfile: function (p) { return upsert('profiles', p); },
    deleteProfile: function (id) { remove('profiles', id); },

    clients: function () { return list('clients'); },
    saveClient: function (c) { return upsert('clients', c); },
    deleteClient: function (id) { remove('clients', id); },

    invoices: function () {
      return list('invoices').sort(function (a, b) { return (b.savedAt || '').localeCompare(a.savedAt || ''); });
    },
    saveInvoice: function (inv) { inv.savedAt = new Date().toISOString(); return upsert('invoices', inv); },
    deleteInvoice: function (id) { remove('invoices', id); },


    draft: function () { return read(KEYS.draft, null); },
    saveDraft: function (d) { write(KEYS.draft, d); },

    /* ---- cloud workspace ---- */
    isRemote: function () { return !!cache; },
    attachRemote: function (backend, data) {
      remote = backend;
      cache = {
        profiles: (data && data.profiles) || [],
        clients: (data && data.clients) || [],
        invoices: (data && data.invoices) || [],
      };
    },
    detachRemote: function () { remote = null; cache = null; },

    /* Data kept in this browser's localStorage, regardless of mode. */
    localSnapshot: function () {
      return { profiles: read(KEYS.profiles, []), clients: read(KEYS.clients, []), invoices: read(KEYS.invoices, []) };
    },
    hasLocalData: function () {
      const s = Store.localSnapshot();
      return s.profiles.some(function (p) { return p.email || p.address || p.logo || p.paymentDetails; }) || s.clients.length > 0 || s.invoices.length > 0;
    },
    isEmpty: function () {
      return !list('profiles').length && !list('clients').length && !list('invoices').length;
    },

    exportAll: function () {
      return {
        app: 'PromptInvoice',
        version: 1,
        exportedAt: new Date().toISOString(),
        profiles: list('profiles'),
        clients: list('clients'),
        invoices: list('invoices'),
      };
    },

    /* Merge a backup (or a local snapshot) into the active store; existing ids are overwritten. */
    importAll: function (data) {
      if (!data || data.app !== 'PromptInvoice') throw new Error('Not a PromptInvoice backup file');
      (data.profiles || []).forEach(function (p) { upsert('profiles', p); });
      (data.clients || []).forEach(function (c) { upsert('clients', c); });
      (data.invoices || []).forEach(function (i) { upsert('invoices', i); });
      return {
        profiles: (data.profiles || []).length,
        clients: (data.clients || []).length,
        invoices: (data.invoices || []).length,
      };
    },
  };

  root.Store = Store;
})(window);
