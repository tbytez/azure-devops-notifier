import { getBridge, isDemoMode } from './bridge.js';
import { h, CATEGORY_META, timeAgo, showToast } from './shared.js';

const $ = (id) => document.getElementById(id);
let bridge = null;
let state = null;

function dashboardUrl(view) {
  const params = new URLSearchParams();
  if (isDemoMode()) params.set('demo', '1');
  if (view) params.set('view', view);
  return `dashboard.html${params.toString() ? `?${params}` : ''}`;
}

function openDashboard(view) {
  window.open(dashboardUrl(view), '_blank', 'noopener,noreferrer');
}

async function reload() {
  const res = await bridge.dispatch({ type: 'GET_STATE' });
  if (!res?.ok) return;
  state = res.state;
  render();
}

function render() {
  const connected = state?.connected;
  $('pop-disconnected').classList.toggle('hidden', connected);
  $('pop-main').classList.toggle('hidden', !connected);
  $('pop-org').textContent = connected ? state.settings.organization : '';
  if (isDemoMode()) $('pop-demo').classList.remove('hidden');

  if (!connected) return;

  const unread = state.notifications.filter((n) => !n.read);
  const pill = $('pop-unread');
  pill.textContent = String(unread.length);
  pill.classList.toggle('hidden', unread.length === 0);

  $('pop-watching').textContent = `${state.watches.length} watching`;
  $('pop-checked').textContent = state.lastSyncAt ? `· checked ${timeAgo(state.lastSyncAt)}` : '· never checked';
  $('pop-pause').textContent = state.settings.paused ? 'Resume polling' : 'Pause polling';

  const err = state.errors?.global;
  $('pop-error').classList.toggle('hidden', !err);
  if (err) $('pop-error').textContent = err;

  const list = $('pop-list');
  list.textContent = '';
  const items = unread.slice(0, 8);
  $('pop-empty').classList.toggle('hidden', items.length > 0);
  for (const n of items) {
    const meta = CATEGORY_META[n.category] || { label: n.category, color: '#64748b' };
    const a = h('a', {
      class: 'pop-item',
      href: n.url || dashboardUrl(),
      target: '_blank',
      rel: 'noopener noreferrer',
    },
      h('span', { class: 'cat-dot', style: `background:${meta.color}` }),
      h('div', { class: 'pop-item-main' },
        h('div', { class: 'pop-item-title', text: n.title }),
        h('div', { class: 'pop-item-sub muted', text: `${n.prTitle || `PR #${n.prId}`} · ${timeAgo(n.createdAt)}` })));
    a.addEventListener('click', async () => {
      await bridge.dispatch({ type: 'MARK_READ', ids: [n.id] });
      window.close?.();
    });
    list.append(a);
  }
}

async function init() {
  bridge = await getBridge();
  $('pop-setup').addEventListener('click', () => openDashboard());
  $('pop-dashboard').addEventListener('click', () => openDashboard());
  $('pop-settings').addEventListener('click', () => openDashboard('settings'));
  $('pop-sync').addEventListener('click', async () => {
    $('pop-sync').disabled = true;
    const res = await bridge.dispatch({ type: 'SYNC_NOW' });
    $('pop-sync').disabled = false;
    if (!res?.ok) {
      showToast(res?.error || 'Sync failed.', true);
    } else {
      const sync = res.sync || {};
      if (sync.skipped) {
        showToast(sync.skipped === 'backoff' ? 'Rate limited. Next check is already scheduled.' : `Sync skipped (${sync.skipped}).`, true);
      } else if (sync.errors?.global || Object.keys(sync.errors?.items || {}).length) {
        showToast(sync.errors?.global || 'Some pull requests could not be checked.', true);
      }
    }
    await reload();
  });
  $('pop-pause').addEventListener('click', async () => {
    const res = await bridge.dispatch({
      type: 'SAVE_SETTINGS',
      settings: { paused: !state.settings.paused },
    });
    if (!res?.ok) showToast(res?.error || 'Could not update.', true);
    await reload();
  });
  await reload();
}

if (typeof document !== 'undefined') {
  init().catch(() => {});
}
