export interface PublicProject {
  id: string;
  name: string;
}

export interface PublicWatch {
  key: string;
  organization: string;
  projectId: string;
  projectName: string;
  repoId: string;
  repoName: string;
  prId: number;
  url: string;
  title: string;
  origin: 'auto' | 'manual' | string;
  eventTypes: string[] | null;
  status: string | null;
  isDraft: boolean | null;
  addedAt: number;
}

export interface PublicNotification {
  id: string;
  key: string;
  category: string;
  title: string;
  body: string;
  prTitle: string;
  repoName: string;
  projectName: string;
  prId: number;
  url: string;
  prUrl: string;
  actorName: string | null;
  createdAt: number;
  read: boolean;
  readAt: number;
}

export interface PublicSettings {
  organization: string | null;
  identity: { id: string; displayName: string } | null;
  selectedProjects: PublicProject[];
  autoWatchMine: boolean;
  pollMinutes: number;
  eventTypes: Record<string, boolean>;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  paused: boolean;
  ignoreSelf: boolean;
}

export interface PublicUpdate {
  checkedAt: number;
  version: string | null;
  url: string | null;
  available: boolean;
}

export interface PublicState {
  connected: boolean;
  settings: PublicSettings;
  projects: PublicProject[];
  watches: PublicWatch[];
  excludedCount: number;
  notifications: PublicNotification[];
  unreadCount: number;
  lastSyncAt: number | null;
  syncNotBefore: number;
  errors: { global: string | null; items: Record<string, string> };
  update?: PublicUpdate;
  desktopPermission?: boolean;
  demo?: boolean;
}

export interface BridgeResponse {
  ok: boolean;
  error?: string;
  state?: PublicState;
  pending?: {
    identity: { id: string; displayName: string };
    projects: PublicProject[];
    organization: string;
  };
  existed?: boolean;
  key?: string;
  sync?: {
    skipped: string | null;
    added?: unknown[];
    errors?: { global: string | null; items: Record<string, string> };
  };
  settings?: PublicSettings;
  unreadCount?: number;
  update?: PublicUpdate | null;
}

export interface Bridge {
  kind: 'extension' | 'demo' | 'unavailable';
  dispatch(msg: Record<string, unknown>): Promise<BridgeResponse>;
}

export const CATEGORY_KEYS = [
  'comments',
  'threads',
  'reviews',
  'reviewers',
  'commits',
  'lifecycle',
  'checks',
  'policies',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_META: Record<CategoryKey, { label: string; plural: string; description: string; color: string; tone: string }> = {
  comments: { label: 'Comment', plural: 'Comments', description: 'New and edited comments', color: 'hsl(var(--cat-comments))', tone: '--cat-comments' },
  threads: { label: 'Thread', plural: 'Threads', description: 'Threads resolved or reopened', color: 'hsl(var(--cat-threads))', tone: '--cat-threads' },
  reviews: { label: 'Review', plural: 'Reviews', description: 'Approvals and vote changes', color: 'hsl(var(--cat-reviews))', tone: '--cat-reviews' },
  reviewers: { label: 'Reviewers', plural: 'Reviewers', description: 'Reviewers added or removed', color: 'hsl(var(--cat-reviewers))', tone: '--cat-reviewers' },
  commits: { label: 'Commits', plural: 'Commits', description: 'New pushes to the branch', color: 'hsl(var(--cat-commits))', tone: '--cat-commits' },
  lifecycle: { label: 'Status', plural: 'Status', description: 'Draft, completed or abandoned', color: 'hsl(var(--cat-lifecycle))', tone: '--cat-lifecycle' },
  checks: { label: 'Checks', plural: 'Checks', description: 'Build and status checks', color: 'hsl(var(--cat-checks))', tone: '--cat-checks' },
  policies: { label: 'Policies', plural: 'Policies', description: 'Branch policy evaluations', color: 'hsl(var(--cat-policies))', tone: '--cat-policies' },
};

export function categoryKey(category: string): CategoryKey {
  return (category in CATEGORY_META ? category : 'comments') as CategoryKey;
}

export function tint(tone: string, alpha: number): string {
  return `hsl(var(${tone}) / ${alpha})`;
}

export type PrState = 'active' | 'draft' | 'completed' | 'abandoned' | 'unknown';

export function prState(w: Pick<PublicWatch, 'status' | 'isDraft'>): PrState {
  if (w.status === 'completed') return 'completed';
  if (w.status === 'abandoned') return 'abandoned';
  if (w.isDraft === true) return 'draft';
  if (w.status === 'active') return 'active';
  return 'unknown';
}

export const PR_STATE_LABEL: Record<PrState, string> = {
  active: 'Active',
  draft: 'Draft',
  completed: 'Completed',
  abandoned: 'Abandoned',
  unknown: 'Unknown',
};

export function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

export function nameHue(name: string | null | undefined): number {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function timeAgo(ts: number | null | undefined): string {
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

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

export function prStatusLabel(w: Pick<PublicWatch, 'status' | 'isDraft'>): string {
  const parts: string[] = [];
  if (w.status === 'completed') parts.push('Completed');
  else if (w.status === 'abandoned') parts.push('Abandoned');
  else if (w.status === 'active') parts.push('Active');
  if (w.isDraft === true) parts.push('Draft');
  return parts.join(' · ');
}

export function effectiveEventTypes(w: PublicWatch, settings: PublicSettings): Record<CategoryKey, boolean> {
  const out = {} as Record<CategoryKey, boolean>;
  const override = w.eventTypes ? new Set(w.eventTypes) : null;
  for (const k of CATEGORY_KEYS) {
    out[k] = override ? override.has(k) : settings.eventTypes[k] !== false;
  }
  return out;
}
