/* PromptInvoice app: state, form binding, live preview, profiles/clients/history, AI drafting. */
(function () {
  'use strict';

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  const DOC_LABELS = {
    invoice: { title: 'INVOICE', number: 'Invoice number', numberShort: 'Invoice #', due: 'Due date', dueShort: 'Due' },
    quote: { title: 'QUOTE', number: 'Quote number', numberShort: 'Quote #', due: 'Valid until', dueShort: 'Valid until' },
    estimate: { title: 'ESTIMATE', number: 'Estimate number', numberShort: 'Estimate #', due: 'Valid until', dueShort: 'Valid until' },
    receipt: { title: 'RECEIPT', number: 'Receipt number', numberShort: 'Receipt #', due: 'Paid on', dueShort: 'Paid' },
  };

  const SEED_PROFILES = [
    { name: 'My business', prefix: 'INV', currency: 'USD', taxRate: 0, taxLabel: 'Tax', counter: 0, notes: 'Payment due within 14 days. Thank you for your business!' },
  ];

  let doc = null;          // current document
  let saveTimer = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function set(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = value;
  }
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.hidden = true; }, ms || 2200);
  }
  function trailingNumber(s) {
    const m = /(\d+)\s*$/.exec(s || '');
    return m ? parseInt(m[1], 10) : 0;
  }

  /* ---------- document model ---------- */
  function blankItem() { return { description: '', qty: 1, rate: '' }; }

  function newDoc(profile) {
    const today = Calc.todayISO();
    const p = profile || {};
    return {
      id: null,
      docType: 'invoice',
      number: Calc.nextInvoiceNumber(p.prefix, p.counter),
      issueDate: today,
      dueDate: Calc.addDays(today, 14),
      from: {
        profileId: p.id || null, name: p.name || '', email: p.email || '', phone: p.phone || '',
        address: p.address || '', taxId: p.taxId || '', prefix: p.prefix || '', logo: p.logo || '',
      },
      to: { clientId: null, name: '', email: '', address: '', reference: '' },
      items: [blankItem()],
      currency: p.currency || 'USD',
      taxRate: p.taxRate != null ? p.taxRate : 0,
      taxLabel: p.taxLabel || 'Tax',
      discountType: 'percent',
      discountValue: 0,
      shipping: 0,
      customFields: [],
      paymentDetails: p.paymentDetails || '',
      notes: p.notes || 'Payment due within 14 days. Thank you for your business!',
      theme: p.theme || '#166534',
    };
  }

  function currentProfile() {
    const id = $('#profile-select').value;
    return Store.profiles().find(function (p) { return p.id === id; }) || null;
  }

  /* ---------- rendering: form ---------- */
  function renderForm() {
    $$('[data-bind]').forEach(function (el) {
      const v = get(doc, el.dataset.bind);
      el.value = v === null || v === undefined ? '' : v;
    });
    $$('#doc-type button').forEach(function (b) { b.classList.toggle('active', b.dataset.doctype === doc.docType); });
    $$('#themes button').forEach(function (b) { b.classList.toggle('active', b.dataset.theme === doc.theme); });
    const labels = DOC_LABELS[doc.docType];
    $('#number-label').textContent = labels.number;
    $('#due-label').textContent = labels.due;
    renderLogo();
    renderItems();
    renderCustomFields();
    syncTermsSelect();
    if (doc.from.profileId) $('#profile-select').value = doc.from.profileId;
    $('#client-select').value = doc.to.clientId || '';
  }

  function renderLogo() {
    const img = $('#logo-thumb');
    const has = !!doc.from.logo;
    img.hidden = !has;
    $('#logo-remove').hidden = !has;
    if (has) img.src = doc.from.logo;
  }

  function renderItems() {
    const wrap = $('#items');
    const totals = Calc.computeTotals(doc);
    wrap.innerHTML = doc.items.map(function (it, i) {
      return '<div class="item-row" data-i="' + i + '">' +
        '<input type="text" data-f="description" aria-label="Description" placeholder="Description of service or product" value="' + esc(it.description) + '">' +
        '<input type="number" step="any" min="0" data-f="qty" aria-label="Quantity" value="' + esc(it.qty) + '">' +
        '<input type="number" step="any" min="0" data-f="rate" aria-label="Rate" placeholder="0.00" value="' + esc(it.rate) + '">' +
        '<span class="amount">' + esc(Calc.formatMoney(totals.lines[i], doc.currency)) + '</span>' +
        '<button type="button" class="remove" aria-label="Remove item">×</button>' +
        '</div>';
    }).join('');
  }

  function renderCustomFields() {
    const wrap = $('#custom-fields');
    wrap.innerHTML = doc.customFields.map(function (f, i) {
      return '<div class="field-row" data-i="' + i + '">' +
        '<input type="text" data-f="label" placeholder="Label (e.g. Project)" value="' + esc(f.label) + '">' +
        '<input type="text" data-f="value" placeholder="Value" value="' + esc(f.value) + '">' +
        '<button type="button" class="remove" aria-label="Remove field">×</button>' +
        '</div>';
    }).join('');
  }

  function syncTermsSelect() {
    const sel = $('#terms-select');
    if (!doc.issueDate || !doc.dueDate) { sel.value = ''; return; }
    const diff = Math.round((new Date(doc.dueDate) - new Date(doc.issueDate)) / 86400000);
    const opt = Array.prototype.find.call(sel.options, function (o) { return o.value !== '' && parseInt(o.value, 10) === diff; });
    sel.value = opt ? opt.value : '';
  }

  function renderProfileSelect() {
    const sel = $('#profile-select');
    const cur = sel.value;
    sel.innerHTML = Store.profiles().map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name || 'Untitled business') + '</option>';
    }).join('');
    if (cur && Array.prototype.some.call(sel.options, function (o) { return o.value === cur; })) sel.value = cur;
  }

  function renderClientSelect() {
    const sel = $('#client-select');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Saved clients…</option>' + Store.clients().map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name || 'Unnamed client') + '</option>';
    }).join('');
    sel.value = cur;
  }

  function renderCurrencySelect() {
    const sel = $('#currency-select');
    const popular = ['USD', 'EUR', 'GBP', 'NZD', 'AUD', 'CAD', 'SGD', 'INR', 'JPY'];
    const opts = function (list) {
      return list.map(function (c) { return '<option value="' + c.code + '">' + c.code + ' · ' + esc(c.name) + '</option>'; }).join('');
    };
    const pop = popular.map(function (code) { return Calc.currencyInfo(code); }).filter(Boolean);
    sel.innerHTML = '<optgroup label="Popular">' + opts(pop) + '</optgroup><optgroup label="All currencies">' + opts(CURRENCIES) + '</optgroup>';
  }

  /* ---------- rendering: preview ---------- */
  function renderPreview() {
    const t = Calc.computeTotals(doc);
    const cur = doc.currency;
    const L = DOC_LABELS[doc.docType];
    const money = function (n) { return esc(Calc.formatMoney(n, cur)); };
    const paper = $('#paper');
    paper.style.setProperty('--theme', doc.theme || '#166534');

    const fromMeta = [doc.from.address, doc.from.email, doc.from.phone, doc.from.taxId ? (doc.taxLabel && doc.taxLabel !== 'Tax' ? doc.taxLabel : 'Tax') + ' no. ' + doc.from.taxId : '']
      .filter(Boolean).join('\n');

    const kv = [
      [L.numberShort, doc.number],
      ['Issued', Calc.formatDate(doc.issueDate)],
      [L.dueShort, Calc.formatDate(doc.dueDate)],
      ['Reference', doc.to.reference],
    ].concat(doc.customFields.map(function (f) { return [f.label, f.value]; }))
      .filter(function (r) { return r[0] && r[1]; })
      .map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('');

    const items = doc.items.length ? doc.items : [blankItem()];
    const rows = items.map(function (it, i) {
      const has = it.description || Calc.parseNumber(it.rate);
      return '<tr>' +
        '<td class="desc' + (has ? '' : ' ph') + '">' + (it.description ? esc(it.description) : 'Item description') + '</td>' +
        '<td class="r">' + esc(Calc.parseNumber(it.qty)) + '</td>' +
        '<td class="r">' + money(Calc.parseNumber(it.rate)) + '</td>' +
        '<td class="r">' + money(t.lines[i] || 0) + '</td>' +
        '</tr>';
    }).join('');

    let totals = '<tr><td>Subtotal</td><td class="r">' + money(t.subtotal) + '</td></tr>';
    if (t.discount > 0) {
      const dl = doc.discountType === 'percent' ? 'Discount (' + esc(Calc.parseNumber(doc.discountValue)) + '%)' : 'Discount';
      totals += '<tr><td>' + dl + '</td><td class="r">-' + money(t.discount) + '</td></tr>';
    }
    if (t.taxRate > 0 || doc.taxRate !== '') {
      totals += '<tr><td>' + esc(doc.taxLabel || 'Tax') + ' (' + esc(t.taxRate) + '%)</td><td class="r">' + money(t.tax) + '</td></tr>';
    }
    if (t.shipping > 0) totals += '<tr><td>Shipping</td><td class="r">' + money(t.shipping) + '</td></tr>';
    totals += '<tr class="total"><td>' + (doc.docType === 'receipt' ? 'Total paid' : 'Total due') + '</td><td class="r">' + money(t.total) + '</td></tr>';

    const foot = [];
    if (doc.paymentDetails) foot.push('<div><div class="p-label">Payment details</div><div class="body">' + esc(doc.paymentDetails) + '</div></div>');
    if (doc.notes) foot.push('<div><div class="p-label">Notes</div><div class="body">' + esc(doc.notes) + '</div></div>');

    paper.innerHTML =
      '<div class="p-head">' +
        '<div class="p-from">' +
          (doc.from.logo ? '<img class="p-logo" src="' + esc(doc.from.logo) + '" alt="">' : '') +
          '<div class="p-name">' + (esc(doc.from.name) || 'Your Company') + '</div>' +
          '<div class="p-meta">' + (esc(fromMeta) || 'Your address\nyou@example.com') + '</div>' +
        '</div>' +
        '<div class="p-title-block"><div class="p-title">' + L.title + '</div><table class="p-kv">' + kv + '</table></div>' +
      '</div>' +
      '<div class="p-billto"><div class="p-label">Billed to</div>' +
        '<div class="p-client">' + (esc(doc.to.name) || 'Client Name') + '</div>' +
        '<div class="p-meta">' + (esc([doc.to.address, doc.to.email].filter(Boolean).join('\n')) || 'Client address') + '</div>' +
        (doc.docType === 'receipt' ? '<span class="p-paid">PAID</span>' : '') +
      '</div>' +
      '<table class="p-items"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="p-totals-wrap"><table class="p-totals">' + totals + '</table></div>' +
      (foot.length ? '<div class="p-foot">' + foot.join('') + '</div>' : '');
  }

  function renderSavedList() {
    const wrap = $('#saved-list');
    const list = Store.invoices();
    if (!list.length) { wrap.innerHTML = '<div class="saved-empty">No saved invoices yet. Click Save to keep one here.</div>'; return; }
    wrap.innerHTML = list.map(function (inv) {
      const t = Calc.computeTotals(inv);
      return '<div class="saved-item" data-id="' + esc(inv.id) + '">' +
        '<div><div class="t">' + esc(inv.number) + ' · ' + esc(inv.to.name || 'No client') + '</div>' +
        '<div class="s">' + esc((inv.from && inv.from.name) || '') + ' · ' + esc(Calc.formatDate(inv.issueDate)) + ' · ' + esc(inv.docType) + '</div></div>' +
        '<div class="amt">' + esc(Calc.formatMoney(t.total, inv.currency)) + '</div>' +
        '<div class="acts"><button type="button" class="icon-btn" data-act="load" title="Open">↗</button>' +
        '<button type="button" class="icon-btn" data-act="dup" title="Duplicate">⧉</button>' +
        '<button type="button" class="icon-btn" data-act="del" title="Delete">×</button></div>' +
        '</div>';
    }).join('');
  }

  function renderAll() { renderForm(); renderPreview(); }

  function changed() {
    renderPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; Store.saveDraft(doc); }, 250);
  }

  /* ---------- profiles ---------- */
  function applyProfile(p) {
    if (!p) return;
    doc.from = { profileId: p.id, name: p.name || '', email: p.email || '', phone: p.phone || '', address: p.address || '', taxId: p.taxId || '', prefix: p.prefix || '', logo: p.logo || '' };
    if (p.currency) doc.currency = p.currency;
    if (p.taxRate != null) doc.taxRate = p.taxRate;
    if (p.taxLabel) doc.taxLabel = p.taxLabel;
    if (p.paymentDetails != null) doc.paymentDetails = p.paymentDetails;
    if (p.theme) doc.theme = p.theme;
    if (!doc.id) doc.number = Calc.nextInvoiceNumber(p.prefix, p.counter);
  }

  function saveProfileFromForm() {
    const existing = currentProfile() || { id: null, counter: 0 };
    const p = Object.assign({}, existing, {
      name: doc.from.name, email: doc.from.email, phone: doc.from.phone, address: doc.from.address,
      taxId: doc.from.taxId, prefix: doc.from.prefix, logo: doc.from.logo,
      currency: doc.currency, taxRate: doc.taxRate, taxLabel: doc.taxLabel,
      paymentDetails: doc.paymentDetails, notes: doc.notes, theme: doc.theme,
    });
    Store.saveProfile(p);
    doc.from.profileId = p.id;
    renderProfileSelect();
    $('#profile-select').value = p.id;
    toast('Business details saved');
  }

  /* ---------- AI ---------- */
  function applyDraft(d) {
    if (d.docType) doc.docType = d.docType;
    if (d.client) {
      if (d.client.name) doc.to.name = d.client.name;
      if (d.client.email) doc.to.email = d.client.email;
      if (d.client.address) doc.to.address = d.client.address;
      const known = Store.clients().find(function (c) { return d.client.name && c.name.toLowerCase() === d.client.name.toLowerCase(); });
      if (known) {
        doc.to.clientId = known.id;
        if (!doc.to.email) doc.to.email = known.email || '';
        if (!doc.to.address) doc.to.address = known.address || '';
      }
    }
    if (Array.isArray(d.items) && d.items.length) {
      doc.items = d.items.map(function (it) { return { description: it.description || '', qty: it.qty == null ? 1 : it.qty, rate: it.rate == null ? '' : it.rate }; });
    }
    if (d.currency && Calc.currencyInfo(d.currency.toUpperCase())) doc.currency = d.currency.toUpperCase();
    if (d.taxRate != null) doc.taxRate = d.taxRate;
    if (d.taxLabel) doc.taxLabel = d.taxLabel;
    if (d.discountType) doc.discountType = d.discountType;
    if (d.discountValue != null) doc.discountValue = d.discountValue;
    if (d.shipping != null) doc.shipping = d.shipping;
    if (d.dueInDays != null) doc.dueDate = Calc.addDays(doc.issueDate, d.dueInDays);
    if (d.reference) doc.to.reference = d.reference;
    if (d.notes) doc.notes = d.notes;
  }

  async function generateFromPrompt() {
    const text = $('#ai-prompt').value.trim();
    const status = $('#ai-status');
    const btn = $('#ai-generate');
    if (!text) { status.textContent = 'Describe the work first.'; status.classList.add('error'); return; }
    btn.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Drafting…';
    try {
      const ctx = {
        fromName: doc.from.name, currency: doc.currency, taxRate: doc.taxRate, taxLabel: doc.taxLabel,
        today: doc.issueDate,
        clients: Store.clients().map(function (c) { return { name: c.name, email: c.email, address: c.address }; }),
      };
      const d = await AI.draft(text, ctx);
      applyDraft(d);
      renderAll();
      changed();
      status.textContent = 'Drafted. Review before sending.';
      toast('Invoice drafted');
    } catch (e) {
      status.textContent = e.message || 'Something went wrong.';
      status.classList.add('error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- backup ---------- */
  function exportBackup() {
    const data = Store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'promptinvoice-backup-' + Calc.todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const counts = Store.importAll(JSON.parse(reader.result));
        renderProfileSelect(); renderClientSelect(); renderSavedList();
        toast('Imported ' + counts.profiles + ' businesses, ' + counts.clients + ' clients, ' + counts.invoices + ' invoices');
      } catch (e) {
        toast('Import failed: ' + e.message, 4000);
      }
    };
    reader.readAsText(file);
  }

  /* ---------- save / load invoices ---------- */
  function saveInvoice() {
    Store.saveInvoice(doc);
    const p = currentProfile();
    if (p) {
      const n = trailingNumber(doc.number);
      if (n > (p.counter || 0)) { p.counter = n; Store.saveProfile(p); }
    }
    renderSavedList();
    toast('Saved ' + doc.number);
  }

  function loadInvoice(id, duplicate) {
    const inv = Store.invoices().find(function (i) { return i.id === id; });
    if (!inv) return;
    doc = JSON.parse(JSON.stringify(inv));
    if (duplicate) {
      doc.id = null;
      delete doc.savedAt;
      const p = currentProfile();
      doc.number = Calc.nextInvoiceNumber(doc.from.prefix, p ? p.counter : trailingNumber(doc.number));
      doc.issueDate = Calc.todayISO();
      doc.dueDate = Calc.addDays(doc.issueDate, 14);
    }
    renderAll();
    changed();
    document.getElementById('generate').scrollIntoView({ behavior: 'smooth' });
  }

  function startNew() {
    doc = newDoc(currentProfile());
    renderAll();
    changed();
    toast('New ' + doc.docType + ' started');
  }

  /* ---------- workspace (local vs cloud) ---------- */
  function ensureSeed() {
    if (!Store.profiles().length) SEED_PROFILES.forEach(function (p) { Store.saveProfile(Object.assign({}, p)); });
  }

  /* Re-read profiles/clients/invoices from the active store and reattach the draft to a valid profile. */
  function reloadWorkspace() {
    ensureSeed();
    renderProfileSelect();
    renderClientSelect();
    renderSavedList();
    const profiles = Store.profiles();
    if (!doc.from.profileId || !profiles.some(function (p) { return p.id === doc.from.profileId; })) {
      if (doc.id || (doc.to && doc.to.name) || doc.items.some(function (it) { return it.description; })) {
        doc.from.profileId = profiles[0].id;   // keep the in-progress document, attach it to the first business
      } else {
        doc = newDoc(profiles[0]);
      }
    }
    if (doc.to.clientId && !Store.clients().some(function (c) { return c.id === doc.to.clientId; })) doc.to.clientId = null;
    $('#profile-select').value = doc.from.profileId;
    renderAll();
    changed();
  }

  function renderAuthUI() {
    const user = Auth.user();
    const company = Auth.company();
    const note = $('#workspace-note');
    $('#open-auth').hidden = !!user || !Auth.configured();
    $('#auth-user').hidden = !user;
    document.body.classList.toggle('signed-in', !!user);   // signed in: skip the pitch, open on the form
    if (user) {
      $('#auth-email').textContent = user.email;
      const shared = company && company.key.indexOf('@') === -1;
      note.classList.add('cloud');
      note.innerHTML = 'Signed in as <strong>' + esc(user.email) + '</strong> · Workspace <strong>' + esc(company ? company.name : '') + '</strong>' +
        (shared ? ', shared with everyone at @' + esc(company.key) : ', private to you') + '.';
      $('#autosave-note').textContent = 'Businesses, clients and saved invoices sync to your workspace. The draft you are editing stays in this browser until you save it.';
    } else {
      note.classList.remove('cloud');
      if (Auth.configured()) {
        note.innerHTML = 'Working locally in this browser. <button type="button" class="link-btn" id="workspace-signin">Sign in with your work email</button> to share businesses, clients and invoices with your team.';
        $('#workspace-signin').addEventListener('click', openAuth);
      } else {
        note.textContent = 'Working locally in this browser. Use Export backup to move your data to another device.';
      }
      $('#autosave-note').textContent = 'Everything is saved automatically in your browser. Nothing leaves your device unless you sign in or use AI drafting.';
    }
  }

  function onSignIn(info) {
    Store.attachRemote(info.backend, info.data);
    if (Store.isEmpty() && Store.hasLocalData()) {
      if (confirm('Your workspace is empty. Copy the businesses, clients and invoices saved in this browser into it?')) {
        const counts = Store.importAll(Object.assign({ app: 'PromptInvoice' }, Store.localSnapshot()));
        toast('Copied ' + counts.profiles + ' businesses, ' + counts.clients + ' clients, ' + counts.invoices + ' invoices to your workspace', 3500);
      }
    }
    reloadWorkspace();
    renderAuthUI();
    toast('Signed in as ' + info.user.email);
  }

  function onSignOut() {
    Store.detachRemote();
    reloadWorkspace();
    renderAuthUI();
    toast('Signed out. Back to local mode');
  }

  function openAuth() {
    if (!Auth.configured()) { toast('Sign-in is not set up on this copy. See the README to enable it.', 3500); return; }
    $('#auth-form').hidden = false;
    $('#auth-sent').hidden = true;
    $('#auth-error').hidden = true;
    $('#auth-modal').hidden = false;
    $('#auth-email-input').focus();
  }
  function closeAuth() { $('#auth-modal').hidden = true; }

  async function sendSignInLink() {
    const email = $('#auth-email-input').value.trim();
    const err = $('#auth-error');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
    const btn = $('#auth-send');
    btn.disabled = true; err.hidden = true;
    try {
      await Auth.signIn(email);
      $('#auth-sent-email').textContent = email;
      $('#auth-form').hidden = true;
      $('#auth-sent').hidden = false;
    } catch (e) {
      err.textContent = e.message || 'Could not send the link.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- events ---------- */
  function bind() {
    // Generic bound inputs
    $$('[data-bind]').forEach(function (el) {
      el.addEventListener('input', function () {
        const path = el.dataset.bind;
        let v = el.value;
        if (el.type === 'number') v = v === '' ? '' : Calc.parseNumber(v);
        set(doc, path, v);
        if (path === 'currency') renderItems();
        if (path === 'issueDate' || path === 'dueDate') syncTermsSelect();
        if (path === 'taxLabel' || path === 'taxRate' || path === 'discountValue' || path === 'shipping') { /* preview only */ }
        changed();
      });
    });

    // Doc type
    $('#doc-type').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-doctype]');
      if (!b) return;
      doc.docType = b.dataset.doctype;
      renderForm(); changed();
    });

    // Themes
    $('#themes').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-theme]');
      if (!b) return;
      doc.theme = b.dataset.theme;
      $$('#themes button').forEach(function (x) { x.classList.toggle('active', x === b); });
      changed();
    });

    // Items
    $('#item-add').addEventListener('click', function () {
      doc.items.push(blankItem());
      renderItems(); changed();
      const rows = $$('#items .item-row');
      const last = rows[rows.length - 1];
      if (last) last.querySelector('input').focus();
    });
    $('#items').addEventListener('input', function (e) {
      const row = e.target.closest('.item-row'); if (!row) return;
      const i = +row.dataset.i, f = e.target.dataset.f;
      doc.items[i][f] = e.target.type === 'number' ? (e.target.value === '' ? '' : Calc.parseNumber(e.target.value)) : e.target.value;
      const t = Calc.computeTotals(doc);
      row.querySelector('.amount').textContent = Calc.formatMoney(t.lines[i], doc.currency);
      changed();
    });
    $('#items').addEventListener('click', function (e) {
      if (!e.target.classList.contains('remove')) return;
      const i = +e.target.closest('.item-row').dataset.i;
      doc.items.splice(i, 1);
      if (!doc.items.length) doc.items.push(blankItem());
      renderItems(); changed();
    });

    // Custom fields
    $('#field-add').addEventListener('click', function () {
      doc.customFields.push({ label: '', value: '' });
      renderCustomFields(); changed();
      const rows = $$('#custom-fields .field-row');
      rows[rows.length - 1].querySelector('input').focus();
    });
    $('#custom-fields').addEventListener('input', function (e) {
      const row = e.target.closest('.field-row'); if (!row) return;
      doc.customFields[+row.dataset.i][e.target.dataset.f] = e.target.value;
      changed();
    });
    $('#custom-fields').addEventListener('click', function (e) {
      if (!e.target.classList.contains('remove')) return;
      doc.customFields.splice(+e.target.closest('.field-row').dataset.i, 1);
      renderCustomFields(); changed();
    });

    // Terms
    $('#terms-select').addEventListener('change', function () {
      if (this.value === '') return;
      doc.dueDate = Calc.addDays(doc.issueDate || Calc.todayISO(), +this.value);
      $('[data-bind="dueDate"]').value = doc.dueDate;
      changed();
    });

    // Logo
    $('#logo-upload').addEventListener('click', function () { $('#logo-file').click(); });
    $('#logo-file').addEventListener('change', function () {
      const file = this.files[0]; if (!file) return;
      if (file.size > 1.5 * 1024 * 1024) { toast('Logo too large. Keep it under 1.5 MB', 3000); return; }
      const reader = new FileReader();
      reader.onload = function () { doc.from.logo = reader.result; renderLogo(); changed(); };
      reader.readAsDataURL(file);
      this.value = '';
    });
    $('#logo-remove').addEventListener('click', function () { doc.from.logo = ''; renderLogo(); changed(); });

    // Profiles
    $('#profile-select').addEventListener('change', function () { applyProfile(currentProfile()); renderAll(); changed(); });
    $('#profile-save').addEventListener('click', saveProfileFromForm);
    $('#profile-new').addEventListener('click', function () {
      const name = prompt('Name of the new business:');
      if (!name) return;
      const p = Store.saveProfile({ name: name.trim(), prefix: name.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() || 'INV', counter: 0, currency: doc.currency, taxRate: doc.taxRate, taxLabel: doc.taxLabel });
      renderProfileSelect();
      $('#profile-select').value = p.id;
      applyProfile(p); renderAll(); changed();
      toast('Business "' + p.name + '" created. Fill in the details and save');
    });
    $('#profile-delete').addEventListener('click', function () {
      const p = currentProfile(); if (!p) return;
      if (!confirm('Delete business "' + p.name + '"? Saved invoices are kept.')) return;
      Store.deleteProfile(p.id);
      renderProfileSelect();
      applyProfile(currentProfile()); renderAll(); changed();
    });

    // Clients
    $('#client-select').addEventListener('change', function () {
      const c = Store.clients().find(function (x) { return x.id === $('#client-select').value; });
      if (!c) return;
      doc.to = Object.assign({}, doc.to, { clientId: c.id, name: c.name || '', email: c.email || '', address: c.address || '' });
      renderForm(); changed();
    });
    $('#client-save').addEventListener('click', function () {
      if (!doc.to.name) { toast('Enter a client name first'); return; }
      const existing = Store.clients().find(function (c) { return c.id === doc.to.clientId; });
      const c = Store.saveClient(Object.assign({}, existing || {}, { name: doc.to.name, email: doc.to.email, address: doc.to.address }));
      doc.to.clientId = c.id;
      renderClientSelect();
      $('#client-select').value = c.id;
      changed();
      toast('Client saved');
    });
    $('#client-delete').addEventListener('click', function () {
      const id = $('#client-select').value; if (!id) return;
      const c = Store.clients().find(function (x) { return x.id === id; });
      if (!confirm('Remove "' + (c ? c.name : 'client') + '" from saved clients?')) return;
      Store.deleteClient(id);
      doc.to.clientId = null;
      renderClientSelect();
    });

    // Actions
    $('#download-pdf').addEventListener('click', function () { document.title = doc.number + ' - ' + (doc.to.name || 'invoice'); window.print(); });
    $('#print').addEventListener('click', function () { document.title = doc.number + ' - ' + (doc.to.name || 'invoice'); window.print(); });
    window.addEventListener('afterprint', function () { document.title = 'PromptInvoice: Free Invoice Generator'; });
    $('#save-invoice').addEventListener('click', saveInvoice);
    $('#new-invoice').addEventListener('click', startNew);

    $('#saved-list').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = b.closest('.saved-item').dataset.id;
      if (b.dataset.act === 'load') loadInvoice(id, false);
      if (b.dataset.act === 'dup') loadInvoice(id, true);
      if (b.dataset.act === 'del') { if (confirm('Delete this saved invoice?')) { Store.deleteInvoice(id); renderSavedList(); } }
    });

    // Backup
    $('#export-backup').addEventListener('click', exportBackup);
    $('#import-backup').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function () { if (this.files[0]) importBackup(this.files[0]); this.value = ''; });

    // AI
    $('#ai-generate').addEventListener('click', generateFromPrompt);
    $('#ai-prompt').addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generateFromPrompt(); }
    });

    // Sign-in
    $('#open-auth').addEventListener('click', openAuth);
    $('#workspace-signin') && $('#workspace-signin').addEventListener('click', openAuth);
    $('#auth-cancel').addEventListener('click', closeAuth);
    $('#auth-done').addEventListener('click', closeAuth);
    $('#auth-modal').addEventListener('click', function (e) { if (e.target === this) closeAuth(); });
    $('#auth-send').addEventListener('click', sendSignInLink);
    $('#auth-email-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendSignInLink(); });
    $('#sign-out').addEventListener('click', function () { Auth.signOut().catch(function (e) { toast(e.message, 3500); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAuth(); });

    // Flush the debounced draft when leaving the page
    window.addEventListener('beforeunload', function () { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; Store.saveDraft(doc); } });
  }

  /* ---------- init ---------- */
  function init() {
    ensureSeed();
    Store.onError = function (e) { toast('Sync failed: ' + (e.message || e), 4000); };
    renderCurrencySelect();
    renderProfileSelect();
    renderClientSelect();
    renderSavedList();

    const draft = Store.draft();
    if (draft && draft.from) {
      doc = draft;
      if (!doc.customFields) doc.customFields = [];
      const profiles = Store.profiles();
      if (doc.from.profileId && profiles.some(function (p) { return p.id === doc.from.profileId; })) {
        $('#profile-select').value = doc.from.profileId;
      } else {
        // Draft points at a business that no longer exists: attach it to the first one.
        doc.from.profileId = profiles[0].id;
        $('#profile-select').value = profiles[0].id;
      }
    } else {
      const first = Store.profiles()[0];
      $('#profile-select').value = first.id;
      doc = newDoc(first);
    }
    bind();
    renderAll();
    renderAuthUI();
    Auth.init({ onSignIn: onSignIn, onSignOut: onSignOut, onError: function (e) { toast('Sign-in problem: ' + e.message, 4000); } })
      .catch(function (e) { toast('Sign-in unavailable: ' + e.message, 4000); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
