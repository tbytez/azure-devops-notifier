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

export const CATEGORY_META: Record<CategoryKey, { label: string; color: string; icon: string }> = {
  comments: { label: 'Comment', color: '#0284c7', icon: 'MessageSquare' },
  threads: { label: 'Thread', color: '#7c3aed', icon: 'MessageSquareMore' },
  reviews: { label: 'Review', color: '#d97706', icon: 'ThumbsUp' },
  reviewers: { label: 'Reviewers', color: '#db2777', icon: 'Users' },
  commits: { label: 'Commits', color: '#059669', icon: 'GitCommitHorizontal' },
  lifecycle: { label: 'Lifecycle', color: '#4f46e5', icon: 'GitPullRequest' },
  checks: { label: 'Checks', color: '#ea580c', icon: 'CircleCheck' },
  policies: { label: 'Policies', color: '#0d9488', icon: 'ShieldCheck' },
};

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
