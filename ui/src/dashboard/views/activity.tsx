import { useMemo, useState } from 'react';
import { Bell, ExternalLink, Search } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import {
  CATEGORY_KEYS,
  CATEGORY_META,
  fmtDateTime,
  timeAgo,
  type CategoryKey,
  type PublicNotification,
} from '@/src/lib/types';
import { CategoryBadge } from '@/src/components/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function NotifRow({ n, onRead }: { n: PublicNotification; onRead: (id: string) => void }) {
  return (
    <article className={cn('rounded-lg border p-3 transition-colors', !n.read && 'border-primary/30 bg-primary/[0.03]')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CategoryBadge category={n.category} />
            <span className={cn('text-sm font-medium', !n.read && 'font-semibold')}>{n.title}</span>
            {n.actorName && <span className="text-xs text-muted-foreground">by {n.actorName}</span>}
            <span className="ml-auto text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span>
          </div>
          {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">#{n.prId}</span>
            <span>{n.repoName} · {n.projectName}</span>
            {n.prTitle && <span className="truncate">— {n.prTitle}</span>}
            {n.url && (
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { if (!n.read) onRead(n.id); }}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
                aria-label={`Open pull request ${n.prId} in Azure DevOps`}
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        {!n.read && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onRead(n.id)}>
            Mark read
          </Button>
        )}
      </div>
    </article>
  );
}

export function ActivityView() {
  const { state, dispatch, refresh } = useNotifier();
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  const notifications = state?.notifications || [];
  const watches = state?.watches || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications.filter((n) => {
      if (readFilter === 'unread' && n.read) return false;
      if (category && n.category !== category) return false;
      if (q) {
        const hay = [n.title, n.body, n.prTitle, n.repoName, n.projectName, n.actorName, `#${n.prId}`]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notifications, readFilter, category, search]);

  const unread = notifications.filter((n) => !n.read).length;

  const markRead = async (id: string) => {
    const res = await dispatch({ type: 'MARK_READ', ids: [id] });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not mark as read.');
      return;
    }
    await refresh();
  };

  const markAll = async () => {
    const res = await dispatch({ type: 'MARK_ALL_READ' });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not mark all as read.');
      return;
    }
    await refresh();
    toast.success('All notifications marked as read.');
  };

  const hasFilters = readFilter !== 'all' || category !== '' || search.trim() !== '';

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Notifications from your watched pull requests.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Unread" value={unread} sub="notifications" />
        <StatCard label="Watching" value={watches.length} sub="pull requests" />
        <StatCard
          label="Last checked"
          value={state?.lastSyncAt ? timeAgo(state.lastSyncAt) : 'never'}
          sub={state?.lastSyncAt ? fmtDateTime(state.lastSyncAt) : 'awaiting first sync'}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Read filter">
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setReadFilter(f)}
                className={cn(
                  'rounded px-3 py-1 text-sm font-medium capitalize transition-colors',
                  readFilter === f ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, repos, people…"
              className="w-56 pl-8"
              aria-label="Search notifications"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {CATEGORY_KEYS.map((k: CategoryKey) => (
              <option key={k} value={k}>{CATEGORY_META[k].label}</option>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" onClick={markAll} disabled={unread === 0}>
              Mark all read
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {filtered.slice(0, 200).map((n) => (
          <NotifRow key={n.id} n={n} onRead={markRead} />
        ))}
        {filtered.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium">{hasFilters ? 'No matching notifications' : 'No notifications yet'}</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {hasFilters
                  ? 'Try clearing the search or filters.'
                  : 'The first successful check baselines quietly — new activity appears here afterwards.'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      {filtered.length > 200 && (
        <p className="text-center text-xs text-muted-foreground">Showing the 200 most recent of {filtered.length} notifications.</p>
      )}
      {Object.keys(state?.errors?.items || {}).length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1">{Object.keys(state?.errors?.items || {}).length}</Badge>
          pull request{Object.keys(state?.errors?.items || {}).length > 1 ? 's' : ''} could not be checked — see Watching for details.
        </p>
      )}
    </div>
  );
}
