import { getBridge, isDemoMode } from './bridge.js';
import { requestDesktopPermission } from './notifications.js';
import { h, CATEGORY_META, CATEGORY_KEYS, timeAgo, fmtDateTime, categoryBadge, prStatusLabel, showToast } from './shared.js';

const $ = (id) => document.getElementById(id);

let bridge = null;
let state = null;
let view = 'activity';
let filters = { read: 'all', category: '', search: '' };
let settingsDirty = false;
let openWatchPrefsKey = null;
let softReloadTimer = null;
let connectPhase = 'idle';

function setView(v) {
  if (!state?.connected && v !== 'connect') v = 'connect';
  view = v;
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.view === v);
  }
  for (const sec of document.querySelectorAll('.view')) sec.classList.add('hidden');
  const el = $(`view-${v}`);
  if (el) el.classList.remove('hidden');
  if (v === 'activity') renderActivity();
  if (v === 'watching') renderWatching();
  if (v === 'settings') renderSettings();
  if (v === 'connect') renderConnect();
}

function showGlobalError(msg) {
  const el = $('global-error');
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function updateHeader() {
  const badge = $('conn-badge');
  if (state?.connected) {
    badge.textContent = `${state.settings.organization} · ${state.settings.identity?.displayName || 'connected'}`;
    badge.className = 'conn-badge conn-ok';
  } else {
    badge.textContent = 'Not connected';
    badge.className = 'conn-badge conn-off';
  }
  $('sync-info').textContent = state?.lastSyncAt ? `Checked ${timeAgo(state.lastSyncAt)}` : '';
}

function refreshChrome() {
  updateHeader();
  const err = state?.errors?.global || null;
  showGlobalError(err);
  const items = state?.errors?.items || {};
  const itemErrs = Object.entries(items);
  if (itemErrs.length && !err) {
    showGlobalError(`${itemErrs.length} item${itemErrs.length > 1 ? 's' : ''} need attention (see Watching/Activity).`);
  }
}

function renderCurrent() {
  if (!state?.connected) {
    setView('connect');
    return;
  }
  if (view === 'connect') {
    view = 'activity';
    const params = new URLSearchParams(location.search);
    params.set('view', 'activity');
    history.replaceState(null, '', `?${params.toString()}`);
  }
  setView(view);
}

async function reload(opts = {}) {
  const res = await bridge.dispatch({ type: 'GET_STATE' });
  if (!res?.ok) {
    showToast(res?.error || 'Failed to load state.', true);
    return;
  }
  state = res.state;
  refreshChrome();
  if (opts.initial) route();
  else renderCurrent();
}

async function softReload() {
  const res = await bridge.dispatch({ type: 'GET_STATE' });
  if (!res?.ok) return;
  state = res.state;
  refreshChrome();
  if (!state?.connected) {
    setView('connect');
    return;
  }
  if (view === 'settings' && settingsDirty) return;
  if (view === 'watching' && openWatchPrefsKey) return;
  renderCurrent();
}

function scheduleSoftReload() {
  clearTimeout(softReloadTimer);
  softReloadTimer = setTimeout(() => {
    softReloadTimer = null;
    softReload().catch(() => {});
  }, 400);
}

function route() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('view');
  if (!state?.connected) {
    setView('connect');
    return;
  }
  if (requested === 'settings') setView('settings');
  else if (requested === 'watching') setView('watching');
  else setView('activity');
}

function statCard(label, value, sub) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-value', text: String(value) }),
    h('div', { class: 'stat-label', text: label }),
    sub ? h('div', { class: 'stat-sub muted', text: sub }) : null);
}

function renderStats() {
  const row = $('stat-row');
  row.textContent = '';
  const unread = state.notifications.filter((n) => !n.read).length;
  row.append(
    statCard('Unread', unread, 'notifications'),
    statCard('Watching', state.watches.length, 'pull requests'),
    statCard('Last checked', state.lastSyncAt ? timeAgo(state.lastSyncAt) : 'never', state.lastSyncAt ? fmtDateTime(state.lastSyncAt) : 'awaiting first sync'),
  );
}

function filteredNotifications() {
  const q = filters.search.trim().toLowerCase();
  return (state.notifications || []).filter((n) => {
    if (filters.read === 'unread' && n.read) return false;
    if (filters.category && n.category !== filters.category) return false;
    if (q) {
      const hay = [n.title, n.body, n.prTitle, n.repoName, n.projectName, n.actorName, `#${n.prId}`].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderActivity() {
  renderStats();
  const catSel = $('filter-category');
  if (catSel.options.length <= 1) {
    for (const [k, meta] of Object.entries(CATEGORY_META)) {
      catSel.append(h('option', { value: k, text: meta.label }));
    }
  }
  catSel.value = filters.category;
  $('filter-search').value = filters.search;

  const list = $('activity-list');
  list.textContent = '';
  const items = filteredNotifications();
  $('activity-empty').classList.toggle('hidden', items.length > 0);
  for (const n of items.slice(0, 200)) {
    const card = h('article', { class: `notif${n.read ? '' : ' notif-unread'}`, dataset: { id: n.id } },
      h('div', { class: 'notif-main' },
        h('div', { class: 'notif-head' },
          categoryBadge(n.category),
          h('span', { class: 'notif-title', text: n.title }),
          n.actorName ? h('span', { class: 'notif-actor muted', text: `by ${n.actorName}` }) : null,
          h('span', { class: 'notif-time muted', text: timeAgo(n.createdAt) })),
        h('div', { class: 'notif-body', text: n.body }),
        h('div', { class: 'notif-pr muted' },
          h('span', { class: 'pr-id', text: `#${n.prId}` }),
          h('span', { text: `${n.repoName} · ${n.projectName}` }),
          n.prTitle ? h('span', { class: 'pr-title', text: ` — ${n.prTitle}` }) : null)),
      !n.read ? h('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        'aria-label': 'Mark as read',
        onclick: async (e) => {
          e.stopPropagation();
          await bridge.dispatch({ type: 'MARK_READ', ids: [n.id] });
          await reload();
        },
      }, 'Mark read') : null);
    card.addEventListener('click', async () => {
      if (n.url) {
        window.open(n.url, '_blank', 'noopener,noreferrer');
      }
      if (!n.read) {
        await bridge.dispatch({ type: 'MARK_READ', ids: [n.id] });
        await reload();
      }
    });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
    list.append(card);
  }
}

function renderConnect() {
  if (connectPhase !== 'idle') return;
  $('connect-step-1').classList.remove('hidden');
  $('connect-step-2').classList.add('hidden');
  $('connect-error').classList.add('hidden');
  if (state?.settings?.organization) $('conn-org').value = state.settings.organization;
  $('connect-desktop').checked = state?.settings?.desktopEnabled !== false;
}

async function startConnect() {
  const org = $('conn-org').value.trim();
  const token = $('conn-token').value;
  const errEl = $('connect-error');
  errEl.classList.add('hidden');
  $('connect-btn').disabled = true;
  connectPhase = 'connecting';
  let res;
  try {
    res = await bridge.dispatch({ type: 'CONNECT', organization: org, token });
  } catch (e) {
    res = { ok: false, error: e?.message || 'Connection failed.' };
  } finally {
    $('connect-btn').disabled = false;
  }
  if (!res?.ok) {
    connectPhase = 'idle';
    errEl.textContent = res?.error || 'Connection failed.';
    errEl.classList.remove('hidden');
    return;
  }
  $('conn-token').value = '';
  const pending = res.pending;
  $('connect-identity').textContent = `Signed in as ${pending.identity.displayName} — choose which projects to watch.`;
  const wrap = $('connect-projects');
  wrap.textContent = '';
  for (const p of pending.projects) {
    const cb = h('input', { type: 'checkbox', checked: true, value: p.id });
    wrap.append(h('label', { class: 'check-row' }, cb, h('span', { text: p.name })));
  }
  $('connect-step-1').classList.add('hidden');
  $('connect-step-2').classList.remove('hidden');
  connectPhase = 'selecting';
}

async function confirmConnect() {
  const ids = [...$('connect-projects').querySelectorAll('input:checked')].map((c) => c.value);
  const desktopOn = $('connect-desktop').checked;
  $('connect-confirm').disabled = true;
  connectPhase = 'confirming';
  const wantDesktop = desktopOn && state?.desktopPermission === false && !isDemoMode();
  const permPromise = wantDesktop ? requestDesktopPermission() : Promise.resolve(true);
  const permGranted = await permPromise;
  if (wantDesktop && state) state.desktopPermission = permGranted;
  let res;
  try {
    res = await bridge.dispatch({ type: 'CONFIRM_CONNECT', projectIds: ids, desktopEnabled: desktopOn });
  } catch (e) {
    res = { ok: false, error: e?.message || 'Could not finish connecting.' };
  } finally {
    $('connect-confirm').disabled = false;
  }
  if (!res?.ok) {
    connectPhase = 'idle';
    const errEl = $('connect-error');
    errEl.textContent = res?.error || 'Could not finish connecting.';
    errEl.classList.remove('hidden');
    $('connect-step-1').classList.remove('hidden');
    $('connect-step-2').classList.add('hidden');
    return;
  }
  connectPhase = 'idle';
  showToast('Connected. First sync will baseline quietly.');
  await reload();
}

function watchCard(w) {
  const status = prStatusLabel(w);
  const werr = state?.errors?.items?.[w.key];
  const card = h('article', { class: 'watch-card', dataset: { key: w.key } },
    h('div', { class: 'watch-main' },
      h('div', { class: 'watch-title-row' },
        h('span', { class: 'pr-id', text: `#${w.prId}` }),
        w.url
          ? h('a', { class: 'watch-title', href: w.url, target: '_blank', rel: 'noopener noreferrer', text: w.title || '(untitled pull request)' })
          : h('span', { class: 'watch-title', text: w.title || '(untitled pull request)' })),
      h('div', { class: 'watch-meta muted' },
        h('span', { text: `${w.repoName} · ${w.projectName}` }),
        status ? h('span', { class: 'status-chip', text: status }) : null),
      h('div', { class: 'watch-badges' },
        h('span', { class: `origin-badge origin-${w.origin}`, text: w.origin === 'auto' ? 'Yours' : 'Manual' }),
        w.eventTypes ? h('span', { class: 'override-badge', text: 'Custom activity' }) : null),
      werr ? h('div', { class: 'watch-scoped-error', role: 'status', text: werr }) : null),
    h('div', { class: 'watch-actions' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Preferences', onclick: () => toggleWatchPrefs(card, w) }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Unwatch', onclick: async () => {
        if (!confirm(`Stop watching PR #${w.prId}?`)) return;
        await bridge.dispatch({ type: 'UNWATCH_PR', key: w.key });
        await reload();
      } })));
  return card;
}

function effectiveCategories(w) {
  if (w.eventTypes) {
    const set = new Set(w.eventTypes);
    return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, set.has(k)]));
  }
  return { ...state.settings.eventTypes };
}

function toggleWatchPrefs(card, w) {
  const existing = card.querySelector('.watch-prefs');
  if (existing) {
    existing.remove();
    if (openWatchPrefsKey === w.key) openWatchPrefsKey = null;
    return;
  }
  openWatchPrefsKey = w.key;
  const eff = effectiveCategories(w);
  const box = h('div', { class: 'watch-prefs' });
  const grid = h('div', { class: 'cat-grid' });
  for (const key of CATEGORY_KEYS) {
    const meta = CATEGORY_META[key];
    const cb = h('input', { type: 'checkbox', checked: eff[key], dataset: { cat: key } });
    grid.append(h('label', { class: 'check-row check-row-sm' }, cb, h('span', { text: meta.label })));
  }
  box.append(grid);
  const actions = h('div', { class: 'form-row' },
    h('button', {
      class: 'btn btn-primary btn-sm', type: 'button', text: 'Save',
      onclick: async () => {
        const selected = [...grid.querySelectorAll('input:checked')].map((c) => c.dataset.cat);
        const res = await bridge.dispatch({ type: 'UPDATE_WATCH', key: w.key, eventTypes: selected });
        if (!res?.ok) { showToast(res?.error || 'Save failed.', true); return; }
        showToast('Watch preferences saved.');
        await reload();
      },
    }),
    h('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', text: 'Use global settings',
      onclick: async () => {
        const res = await bridge.dispatch({ type: 'UPDATE_WATCH', key: w.key, eventTypes: null });
        if (!res?.ok) { showToast(res?.error || 'Save failed.', true); return; }
        await reload();
      },
    }));
  box.append(actions);
  card.append(box);
}

function renderWatching() {
  const list = $('watch-list');
  list.textContent = '';
  const watches = state.watches || [];
  $('watch-empty').classList.toggle('hidden', watches.length > 0);
  for (const w of watches) list.append(watchCard(w));
  if (openWatchPrefsKey) {
    const w = watches.find((x) => x.key === openWatchPrefsKey);
    const card = w ? list.querySelector(`[data-key="${CSS.escape(w.key)}"]`) : null;
    if (w && card) toggleWatchPrefs(card, w);
    else openWatchPrefsKey = null;
  }
}

function renderSettings() {
  $('account-info').textContent = '';
  const org = state.settings.organization;
  const ident = state.settings.identity;
  $('account-info').append(
    h('p', {}, h('strong', { text: 'Organization: ' }), org || '—'),
    h('p', { class: 'muted' }, h('strong', { text: 'Signed in as: ' }), ident?.displayName || '—'));

  const picker = $('project-picker');
  picker.textContent = '';
  const selected = new Set((state.settings.selectedProjects || []).map((p) => p.id));
  for (const p of state.projects || []) {
    const cb = h('input', { type: 'checkbox', value: p.id, checked: selected.has(p.id) });
    picker.append(h('label', { class: 'check-row' }, cb, h('span', { text: p.name })));
  }
  if (!(state.projects || []).length) {
    picker.append(h('p', { class: 'muted small', text: 'No projects available.' }));
  }
  const projectErrs = (state.projects || [])
    .map((p) => ({ p, err: state.errors?.items?.[`project:${p.id}`] }))
    .filter((x) => x.err);
  if (projectErrs.length) {
    picker.append(h('div', { class: 'watch-scoped-error', role: 'status' },
      projectErrs.map((x) => h('div', { text: `${x.p.name}: ${x.err}` }))));
  }

  $('set-autowatch').checked = state.settings.autoWatchMine;
  $('set-ignoreself').checked = state.settings.ignoreSelf;
  $('set-interval').value = String(state.settings.pollMinutes);
  $('set-paused').checked = state.settings.paused;
  $('set-desktop').checked = state.settings.desktopEnabled;
  const needDesktopPerm = state.settings.desktopEnabled && state.desktopPermission === false && !isDemoMode();
  $('desktop-note').classList.toggle('hidden', !needDesktopPerm);
  $('desktop-allow').classList.toggle('hidden', !needDesktopPerm);

  const grid = $('global-categories');
  grid.textContent = '';
  for (const key of CATEGORY_KEYS) {
    const meta = CATEGORY_META[key];
    const cb = h('input', { type: 'checkbox', checked: state.settings.eventTypes[key] !== false, dataset: { cat: key } });
    grid.append(h('label', { class: 'check-row check-row-sm' }, cb, h('span', { style: `color:${meta.color}`, text: meta.label })));
  }
}

async function saveSettings() {
  const selectedProjects = [...$('project-picker').querySelectorAll('input:checked')].map((c) => c.value);
  const eventTypes = {};
  for (const cb of $('global-categories').querySelectorAll('input')) {
    eventTypes[cb.dataset.cat] = cb.checked;
  }
  const desktopEnabled = $('set-desktop').checked;
  const patch = {
    selectedProjects,
    autoWatchMine: $('set-autowatch').checked,
    pollMinutes: Number($('set-interval').value),
    paused: $('set-paused').checked,
    desktopEnabled,
    ignoreSelf: $('set-ignoreself').checked,
    eventTypes,
  };
  $('save-settings').disabled = true;
  try {
    const res = await bridge.dispatch({ type: 'SAVE_SETTINGS', settings: patch });
    if (!res?.ok) {
      $('settings-error').textContent = res?.error || 'Could not save settings.';
      $('settings-error').classList.remove('hidden');
      return;
    }
    $('settings-error').classList.add('hidden');
    settingsDirty = false;
    $('settings-ok').textContent = 'Settings saved.';
    $('settings-ok').classList.remove('hidden');
    setTimeout(() => $('settings-ok').classList.add('hidden'), 3000);
    await reload();
  } finally {
    $('save-settings').disabled = false;
  }
}

async function init() {
  bridge = await getBridge();
  if (bridge.kind === 'unavailable') {
    $('view-connect').classList.remove('hidden');
    $('connect-error').textContent = 'This dashboard only works inside the installed Chrome extension. For a preview, open dashboard.html?demo=1 on a local server.';
    $('connect-error').classList.remove('hidden');
    return;
  }
  if (isDemoMode()) {
    $('demo-banner').classList.remove('hidden');
  }
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      const params = new URLSearchParams(location.search);
      params.set('view', v);
      history.replaceState(null, '', `?${params.toString()}`);
      setView(v);
    });
  });
  $('connect-btn').addEventListener('click', startConnect);
  $('connect-confirm').addEventListener('click', confirmConnect);
  $('connect-cancel').addEventListener('click', async () => {
    connectPhase = 'idle';
    await bridge.dispatch({ type: 'CANCEL_CONNECT' });
    await reload();
  });
  $('watch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('watch-url').value.trim();
    const errEl = $('watch-error');
    errEl.classList.add('hidden');
    const submitBtn = $('watch-form').querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    let res;
    try {
      res = await bridge.dispatch({ type: 'WATCH_PR', url });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    if (!res?.ok) {
      errEl.textContent = res?.error || 'Could not watch that pull request.';
      errEl.classList.remove('hidden');
      return;
    }
    $('watch-url').value = '';
    showToast(res.existed ? 'Already watching that pull request.' : 'Now watching that pull request.');
    await reload();
  });
  $('mark-all').addEventListener('click', async () => {
    await bridge.dispatch({ type: 'MARK_ALL_READ' });
    await reload();
  });
  $('sync-now').addEventListener('click', async () => {
    $('sync-now').disabled = true;
    try {
      const res = await bridge.dispatch({ type: 'SYNC_NOW' });
      if (!res?.ok) {
        showToast(res?.error || 'Sync failed.', true);
      } else {
        const sync = res.sync || {};
        if (sync.skipped) {
          const msgs = {
            paused: 'Polling is paused — resume it in Settings for automatic checks.',
            backoff: 'Azure DevOps asked us to slow down — the next check is already scheduled.',
            disconnected: 'Not connected to Azure DevOps.',
          };
          showToast(msgs[sync.skipped] || `Sync skipped (${sync.skipped}).`, true);
        } else {
          const added = sync.added?.length || 0;
          const gerr = sync.errors?.global;
          const itemErrCount = Object.keys(sync.errors?.items || {}).length;
          if (gerr || itemErrCount) {
            showToast(gerr || `${itemErrCount} pull request${itemErrCount > 1 ? 's' : ''} could not be checked — see the error notes.`, true);
          } else {
            showToast(added ? `${added} new notification${added > 1 ? 's' : ''}.` : 'Sync complete — nothing new.');
          }
        }
      }
      await reload();
    } finally {
      $('sync-now').disabled = false;
    }
  });
  $('set-desktop').addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    if (state?.desktopPermission === false && !isDemoMode() && typeof globalThis.chrome !== 'undefined' && globalThis.chrome?.permissions?.request) {
      const granted = await requestDesktopPermission();
      if (granted) {
        state.desktopPermission = true;
        $('desktop-note').classList.add('hidden');
        $('desktop-allow').classList.add('hidden');
      } else {
        showToast('Desktop notification permission was denied — alerts stay off until allowed in Settings.', true);
      }
    }
  });
  $('desktop-allow')?.addEventListener('click', async () => {
    const granted = await requestDesktopPermission();
    if (granted) {
      state.desktopPermission = true;
      showToast('Desktop notifications allowed.');
    } else {
      showToast('Permission was not granted — check Chrome’s notification settings for this extension.', true);
    }
    if (view === 'settings') renderSettings();
  });
  $('save-settings').addEventListener('click', saveSettings);
  $('reconnect-btn').addEventListener('click', async () => {
    connectPhase = 'idle';
    await bridge.dispatch({ type: 'DISCONNECT' });
    await reload();
  });
  $('disconnect-btn').addEventListener('click', async () => {
    if (!confirm('Disconnect? Your watches and history stay on this device, but polling stops until you reconnect.')) return;
    connectPhase = 'idle';
    await bridge.dispatch({ type: 'DISCONNECT' });
    await reload();
  });
  $('filter-category').addEventListener('change', (e) => {
    filters.category = e.target.value;
    renderActivity();
  });
  $('filter-search').addEventListener('input', (e) => {
    filters.search = e.target.value;
    renderActivity();
  });
  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filters.read = btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === btn));
      renderActivity();
    });
  });
  $('reset-demo')?.addEventListener('click', async () => {
    await bridge.dispatch({ type: 'RESET_DEMO' });
    location.reload();
  });
  $('view-settings').addEventListener('input', () => { settingsDirty = true; });
  $('view-settings').addEventListener('change', () => { settingsDirty = true; });
  window.addEventListener('focus', scheduleSoftReload);
  if (bridge.kind === 'extension' && typeof globalThis.chrome !== 'undefined') {
    globalThis.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'local' || !changes || !('azdoNotifier.v1' in changes)) return;
      scheduleSoftReload();
    });
  }
  await reload({ initial: true });
}

if (typeof document !== 'undefined') {
  init().catch((e) => {
    showToast(e?.message || 'Failed to initialize.', true);
  });
}
