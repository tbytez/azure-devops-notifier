import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import {
  CATEGORY_KEYS,
  CATEGORY_META,
  fmtDateTime,
  prStatusLabel,
  timeAgo,
  type CategoryKey,
  type PublicNotification,
  type PublicWatch,
} from '@/src/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function catMeta(category: string) {
  return CATEGORY_META[category as CategoryKey] || CATEGORY_META.comments;
}

function openLabel(n: PublicNotification) {
  return n.category === 'comments' || n.category === 'threads' ? 'Open discussion' : 'Open pull request';
}

function FeedItem({
  n,
  watch,
  selected,
  onSelect,
  onRead,
}: {
  n: PublicNotification;
  watch?: PublicWatch;
  selected: boolean;
  onSelect: () => void;
  onRead: (id: string) => void;
}) {
  const cat = catMeta(n.category);
  const status = watch ? prStatusLabel(watch) : '';
  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={cn('b-item', !n.read && 'unread', selected && 'selected')}
    >
      <div className="flex items-baseline gap-2">
        <span className="b-cat-dot" style={{ background: cat.color }} />
        <span className="b-item-title text-[15.5px] font-medium leading-snug">{n.title}</span>
        <span className="ml-auto shrink-0 text-[12.5px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
      </div>
      <div className="mt-0.5 text-[13.5px] text-muted-foreground">
        #{n.prId} {n.repoName} · {n.projectName} · {n.prTitle}{n.actorName ? ` · ${n.actorName}` : ''}
      </div>
      {selected && (
        <div className="mt-3 rounded-lg border bg-card/60 p-4 sm:p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
            <span className="font-medium text-foreground">{cat.label}</span>
            {n.actorName && <span>· by {n.actorName}</span>}
            <span>· {fmtDateTime(n.createdAt)}</span>
            {!n.read && <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-semibold text-primary">Unread</span>}
          </div>
          {n.body && <p className="mt-2 text-[15px] leading-relaxed">{n.body}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>PR #{n.prId}{status ? ` · ${status}` : ''}</span>
            <span>{n.repoName} · {n.projectName}</span>
            {n.url && (
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { if (!n.read) onRead(n.id); }}
                className="font-medium text-primary hover:underline"
                aria-label={`${openLabel(n)} for pull request ${n.prId} in Azure DevOps`}
              >
                {openLabel(n)} ↗
              </a>
            )}
            {!n.read && (
              <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onRead(n.id)}>
                Mark read
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function groupLabel(ts: number): 'today' | 'yesterday' | 'older' {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return 'today';
  if (ts >= start.getTime() - 86400000) return 'yesterday';
  return 'older';
}

export function ActivityView() {
  const { state, dispatch, refresh } = useNotifier();
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const autoSelected = useRef(false);

  const notifications = state?.notifications || [];

  useEffect(() => {
    if (autoSelected.current || !notifications.length) return;
    autoSelected.current = true;
    if (window.matchMedia('(min-width: 861px)').matches) {
      setSelectedId(notifications[0].id);
    }
  }, [notifications]);

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

  const groups = useMemo(() => {
    const byLabel: Record<string, PublicNotification[]> = { today: [], yesterday: [], older: [] };
    for (const n of filtered.slice(0, 200)) byLabel[groupLabel(n.createdAt)].push(n);
    return [
      { label: 'Today', items: byLabel.today },
      { label: 'Yesterday', items: byLabel.yesterday },
      { label: 'Earlier', items: byLabel.older },
    ];
  }, [filtered]);

  const unread = notifications.filter((n) => !n.read).length;

  const watchByKey = useMemo(
    () => new Map((state?.watches || []).map((w) => [w.key, w])),
    [state?.watches],
  );

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
    <div className="b-feed">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Activity</h1>
        <span className="text-[13.5px] text-muted-foreground">
          {unread} unread · checked {state?.lastSyncAt ? timeAgo(state.lastSyncAt) : 'never'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activity…"
              className="h-9 w-52 pl-8 text-[14px]"
              aria-label="Search notifications"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-[13px]"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {CATEGORY_KEYS.map((k: CategoryKey) => (
              <option key={k} value={k}>{CATEGORY_META[k].label}</option>
            ))}
          </select>
          <div className="flex gap-1 rounded-lg border p-0.5 text-[13px]" role="group" aria-label="Read filter">
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setReadFilter(f)}
                className={cn(
                  'rounded-md px-2.5 py-1 capitalize',
                  readFilter === f ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={markAll} disabled={unread === 0}>
            Mark all read
          </Button>
        </div>
      </div>

      {groups.map((g) => g.items.length > 0 && (
        <section key={g.label}>
          <div className="b-day">{g.label}</div>
          {g.items.map((n) => (
            <FeedItem
              key={n.id}
              n={n}
              watch={watchByKey.get(n.key)}
              selected={selectedId === n.id}
              onSelect={() => setSelectedId(selectedId === n.id ? null : n.id)}
              onRead={markRead}
            />
          ))}
        </section>
      ))}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Bell className="h-8 w-8 text-muted-foreground/50" />
          <p className="font-medium">{hasFilters ? 'No matching notifications' : 'No notifications yet'}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {hasFilters
              ? 'Try clearing the search or filters.'
              : 'The first successful check baselines quietly. New activity appears here afterwards.'}
          </p>
        </div>
      )}
      {filtered.length > 200 && (
        <p className="text-center text-xs text-muted-foreground">Showing the 200 most recent of {filtered.length} notifications.</p>
      )}
      {Object.keys(state?.errors?.items || {}).length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-1">{Object.keys(state?.errors?.items || {}).length}</Badge>
          pull request{Object.keys(state?.errors?.items || {}).length > 1 ? 's' : ''} could not be checked. See Watching for details.
        </p>
      )}
    </div>
  );
}
