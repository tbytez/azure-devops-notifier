export const CATEGORY_META = {
  comments: { label: 'Comment', color: '#0284c7' },
  threads: { label: 'Thread', color: '#7c3aed' },
  reviews: { label: 'Review', color: '#d97706' },
  reviewers: { label: 'Reviewers', color: '#db2777' },
  commits: { label: 'Commits', color: '#059669' },
  lifecycle: { label: 'Lifecycle', color: '#4f46e5' },
  checks: { label: 'Checks', color: '#ea580c' },
  policies: { label: 'Policies', color: '#0d9488' },
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_META);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function fmtDateTime(ts) {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

export function categoryBadge(category) {
  const meta = CATEGORY_META[category] || { label: category, color: '#64748b' };
  return h('span', { class: 'cat-badge' },
    h('span', { class: 'cat-dot', style: `background:${meta.color}` }),
    h('span', { class: 'cat-label', text: meta.label }));
}

export function prStatusLabel(watch) {
  if (!watch) return '';
  const parts = [];
  if (watch.status === 'completed') parts.push('Completed');
  else if (watch.status === 'abandoned') parts.push('Abandoned');
  else if (watch.status === 'active') parts.push('Active');
  if (watch.isDraft === true) parts.push('Draft');
  return parts.join(' · ');
}

export function showToast(message, isError = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.className = `toast${isError ? ' toast-error' : ''} toast-visible`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    t.className = 'toast';
  }, 3200);
}

export async function callBridge(bridge, msg) {
  const res = await bridge.dispatch(msg);
  return res;
}
