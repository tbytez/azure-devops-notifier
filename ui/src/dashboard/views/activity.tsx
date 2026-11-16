import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, CheckCheck, Eye, Inbox, Search, SearchX, X } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import {
  CATEGORY_KEYS,
  CATEGORY_META,
  categoryKey,
  fmtDateTime,
  greeting,
  prState,
  timeAgo,
  tint,
  type CategoryKey,
  type PublicNotification,
  type PublicWatch,
} from '@/src/lib/types';
import { ActorAvatar } from '@/src/components/avatar';
import { CategoryBadge, CategoryDot } from '@/src/components/category';
import { PrStatePill } from '@/src/components/pr-state';
import { Segmented } from '@/src/components/segmented';
import { Callout, EmptyState, Kbd } from '@/src/components/status';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function openLabel(n: PublicNotification) {
  return n.category === 'comments' || n.category === 'threads' ? 'Open discussion' : 'Open pull request';
}

function groupLabel(ts: number): 'today' | 'yesterday' | 'older' {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return 'today';
  if (ts >= start.getTime() - 86400000) return 'yesterday';
  return 'older';
}

function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
}

function FeedItem({
  n,
  watch,
  index,
  selected,
  active,
  rowRef,
  onToggle,
  onFocusRow,
  onRead,
}: {
  n: PublicNotification;
  watch?: PublicWatch;
  index: number;
  selected: boolean;
  active: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onToggle: () => void;
  onFocusRow: () => void;
  onRead: (id: string) => void;
}) {
  const cat = CATEGORY_META[categoryKey(n.category)];
  const state = watch ? prState(watch) : null;
  const open = () => { if (!n.read) onRead(n.id); };

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      aria-expanded={selected}
      data-selected={selected}
      data-active={active}
      onClick={onToggle}
      onFocus={onFocusRow}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
      }}
      className="feed-row enter cursor-pointer outline-none focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring)/0.5)]"
      style={{ animationDelay: `${Math.min(index * 28, 280)}ms` }}
    >
      <div className="flex gap-3.5 px-3 py-3.5 sm:px-4">
        <div className="pt-0.5">
          <ActorAvatar name={n.actorName} category={n.category} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className={cn('shrink-0 text-[15.5px] leading-6', n.read ? 'font-medium text-foreground/85' : 'font-semibold text-foreground')}>
                  {n.title}
                </span>
                {n.actorName && (
                  <span className="truncate text-[14px] text-muted-foreground">· {n.actorName}</span>
                )}
              </div>
              {n.body && !selected && (
                <p className={cn('mt-0.5 line-clamp-1 text-[14px] leading-5', n.read ? 'text-muted-foreground' : 'text-foreground/80')}>
                  {n.body}
                </p>
              )}
              <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="mono shrink-0 rounded-[5px] bg-foreground/[0.055] px-1.5 py-px text-[11.5px] font-medium text-foreground/75">
                  #{n.prId}
                </span>
                <span className="truncate">{n.prTitle || 'Pull request'}</span>
                <span className="hidden shrink-0 text-subtle sm:inline">· {n.repoName}</span>
              </div>
            </div>

            <div className="relative flex shrink-0 flex-col items-end gap-2 pt-1">
              <span className="feed-time tabular text-[12.5px] text-subtle transition-opacity" title={fmtDateTime(n.createdAt)}>
                {timeAgo(n.createdAt)}
              </span>
              {!n.read && <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]" aria-label="Unread" />}
              <div className="feed-actions absolute -top-1 right-0 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-sm ring-1 ring-border" onClick={(e) => e.stopPropagation()}>
                {!n.read && (
                  <Button variant="ghost" size="iconSm" className="h-7 w-7" onClick={() => onRead(n.id)} aria-label="Mark as read" title="Mark as read (E)">
                    <Check />
                  </Button>
                )}
                {n.url && (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={open}
                    className={cn(buttonVariants({ variant: 'ghost', size: 'iconSm' }), 'h-7 w-7')}
                    aria-label={`${openLabel(n)} in Azure DevOps`}
                    title={`${openLabel(n)} (O)`}
                  >
                    <ArrowUpRight />
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="expand" data-open={selected}>
            <div className="expand-inner" onClick={(e) => e.stopPropagation()}>
              <div className="pb-1 pt-3">
                {n.body && (
                  <blockquote
                    className="rounded-r-lg border-l-[3px] px-4 py-3 text-[15px] leading-relaxed text-foreground"
                    style={{ borderColor: cat.color, background: tint(cat.tone, 0.06) }}
                  >
                    {n.body}
                  </blockquote>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Type</dt>
                    <dd className="mt-1"><CategoryBadge category={n.category} /></dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Pull request</dt>
                    <dd className="mt-1 flex items-center gap-1.5">
                      <span className="mono text-[12.5px] font-medium">#{n.prId}</span>
                      {state && <PrStatePill state={state} />}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Repository</dt>
                    <dd className="mt-1 truncate text-foreground">{n.repoName} <span className="text-muted-foreground">· {n.projectName}</span></dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">When</dt>
                    <dd className="tabular mt-1 truncate text-foreground">{fmtDateTime(n.createdAt)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {n.url && (
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={open}
                      className={buttonVariants({ size: 'sm' })}
                      aria-label={`${openLabel(n)} for pull request ${n.prId} in Azure DevOps`}
                    >
                      {openLabel(n)} <ArrowUpRight />
                    </a>
                  )}
                  {!n.read && (
                    <Button size="sm" variant="outline" onClick={() => onRead(n.id)}>
                      <Check /> Mark as read
                    </Button>
                  )}
                  <span className="ml-auto hidden items-center gap-1.5 text-[12px] text-subtle md:flex">
                    <Kbd>O</Kbd> open <Kbd>E</Kbd> mark read <Kbd>Esc</Kbd> close
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActivityView({
  active,
  onNavigate,
}: {
  active: boolean;
  onNavigate: (view: 'watching' | 'settings') => void;
}) {
  const { state, dispatch, refresh } = useNotifier();
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState<CategoryKey | ''>('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const autoSelected = useRef(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const notifications = useMemo(() => state?.notifications || [], [state?.notifications]);

  useEffect(() => {
    if (autoSelected.current || !notifications.length) return;
    autoSelected.current = true;
    if (window.matchMedia('(min-width: 861px)').matches) {
      setSelectedId(notifications[0].id);
      setCursorId(notifications[0].id);
    }
  }, [notifications]);

  const readScoped = useMemo(
    () => (readFilter === 'unread' ? notifications.filter((n) => !n.read) : notifications),
    [notifications, readFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return readScoped.filter((n) => {
      if (category && n.category !== category) return false;
      if (q) {
        const hay = [n.title, n.body, n.prTitle, n.repoName, n.projectName, n.actorName, `#${n.prId}`]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [readScoped, category, search]);

  const visible = useMemo(() => filtered.slice(0, 200), [filtered]);

  const groups = useMemo(() => {
    const byLabel: Record<string, PublicNotification[]> = { today: [], yesterday: [], older: [] };
    for (const n of visible) byLabel[groupLabel(n.createdAt)].push(n);
    return [
      { label: 'Today', items: byLabel.today },
      { label: 'Yesterday', items: byLabel.yesterday },
      { label: 'Earlier', items: byLabel.older },
    ];
  }, [visible]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryKey, number>();
    for (const n of readScoped) {
      const k = categoryKey(n.category);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return CATEGORY_KEYS.filter((k) => counts.has(k)).map((k) => ({ key: k, count: counts.get(k) || 0 }));
  }, [readScoped]);

  const unread = notifications.filter((n) => !n.read).length;
  const unreadPrs = new Set(notifications.filter((n) => !n.read).map((n) => n.key || String(n.prId))).size;

  const watchByKey = useMemo(
    () => new Map((state?.watches || []).map((w) => [w.key, w])),
    [state?.watches],
  );

  const markRead = useCallback(async (id: string) => {
    const res = await dispatch({ type: 'MARK_READ', ids: [id] });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not mark as read.');
      return;
    }
    await refresh();
  }, [dispatch, refresh]);

  const markAll = async () => {
    const res = await dispatch({ type: 'MARK_ALL_READ' });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not mark all as read.');
      return;
    }
    await refresh();
    toast.success('All caught up.');
  };

  const clearFilters = () => {
    setSearch('');
    setCategory('');
    setReadFilter('all');
  };

  const moveCursor = useCallback((delta: number) => {
    if (!visible.length) return;
    const idx = visible.findIndex((n) => n.id === cursorId);
    const next = visible[Math.max(0, Math.min(visible.length - 1, idx < 0 ? 0 : idx + delta))];
    setCursorId(next.id);
    if (selectedId) setSelectedId(next.id);
    const el = rowRefs.current.get(next.id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [visible, cursorId, selectedId]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const current = visible.find((n) => n.id === cursorId);
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault(); moveCursor(1); break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault(); moveCursor(-1); break;
        case '/':
          e.preventDefault(); searchRef.current?.focus(); break;
        case 'Escape':
          setSelectedId(null); break;
        case 'o':
          if (current?.url) {
            window.open(current.url, '_blank', 'noopener,noreferrer');
            if (!current.read) void markRead(current.id);
          }
          break;
        case 'e':
          if (current && !current.read) void markRead(current.id);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, visible, cursorId, moveCursor, markRead]);

  const hasFilters = readFilter !== 'all' || category !== '' || search.trim() !== '';
  const firstName = (state?.settings.identity?.displayName || '').split(/\s+/)[0];
  const itemErrorCount = Object.keys(state?.errors?.items || {}).length;
  let rowIndex = 0;

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{greeting()}{firstName ? `, ${firstName}` : ''}</div>
          <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.025em] sm:text-[34px]">Activity</h1>
          <p className="mt-2.5 text-[14.5px] text-muted-foreground">
            {unread > 0 ? (
              <>
                <span className="font-semibold text-foreground">{unread} unread</span> across {unreadPrs} pull request{unreadPrs === 1 ? '' : 's'}
              </>
            ) : (
              'You are all caught up'
            )}
            <span className="text-subtle"> · {state?.watches.length || 0} watching</span>
          </p>
        </div>
        <Button variant="outline" onClick={markAll} disabled={unread === 0}>
          <CheckCheck /> Mark all read
        </Button>
      </div>

      <div className="sticky top-[60px] z-20 -mx-3 mt-7 bg-background/85 px-3 pb-3 pt-3 backdrop-blur-xl sm:-mx-4 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, comments, people, #PR…"
              className="h-10 pl-9 pr-16 text-[14.5px]"
              aria-label="Search notifications"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>/</Kbd></span>
            )}
          </div>
          <Segmented
            label="Read filter"
            value={readFilter}
            onChange={setReadFilter}
            options={[
              { value: 'all', label: 'All', count: notifications.length },
              { value: 'unread', label: 'Unread', count: unread },
            ]}
          />
        </div>
        {categoryCounts.length > 1 && (
          <div className="scrollbar-none -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter by activity type">
            <button type="button" className="chip" data-active={category === ''} onClick={() => setCategory('')}>
              All types
            </button>
            {categoryCounts.map(({ key, count }) => (
              <button
                key={key}
                type="button"
                className="chip"
                data-active={category === key}
                aria-pressed={category === key}
                onClick={() => setCategory(category === key ? '' : key)}
              >
                <CategoryDot category={key} />
                {CATEGORY_META[key].plural}
                <span className="tabular text-[11.5px] text-subtle">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2">
        {groups.map((g) => g.items.length > 0 && (
          <section key={g.label} className="mt-5 first:mt-2" aria-label={g.label}>
            <div className="mb-1.5 flex items-center gap-3 px-1">
              <span className="eyebrow">{g.label}</span>
              <span className="tabular text-[12px] text-subtle">{g.items.length}</span>
              <span className="h-px flex-1 bg-border/70" />
            </div>
            <div>
              {g.items.map((n) => (
                <FeedItem
                  key={n.id}
                  n={n}
                  index={rowIndex++}
                  watch={watchByKey.get(n.key)}
                  selected={selectedId === n.id}
                  active={cursorId === n.id}
                  rowRef={(el) => { if (el) rowRefs.current.set(n.id, el); else rowRefs.current.delete(n.id); }}
                  onFocusRow={() => setCursorId(n.id)}
                  onToggle={() => {
                    setCursorId(n.id);
                    setSelectedId(selectedId === n.id ? null : n.id);
                  }}
                  onRead={markRead}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {filtered.length === 0 && (
        notifications.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title="Your inbox is ready"
            action={<Button variant="outline" onClick={() => onNavigate('watching')}><Eye /> See watched pull requests</Button>}
          >
            The first check records a quiet baseline. New comments, reviews, pushes and checks will land here.
          </EmptyState>
        ) : readFilter === 'unread' && !search && !category ? (
          <EmptyState
            icon={<CheckCheck className="h-7 w-7" />}
            title="Inbox zero"
            action={<Button variant="outline" onClick={() => setReadFilter('all')}>Show all activity</Button>}
          >
            You have read everything. Nice work.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<SearchX className="h-7 w-7" />}
            title="Nothing matches"
            action={hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined}
          >
            Try a different search or remove a filter.
          </EmptyState>
        )
      )}

      {filtered.length > 200 && (
        <p className="mt-6 text-center text-[12.5px] text-subtle">Showing the 200 most recent of {filtered.length} notifications.</p>
      )}

      {itemErrorCount > 0 && (
        <Callout
          tone="warning"
          className="mt-8"
          title={`${itemErrorCount} pull request${itemErrorCount > 1 ? 's' : ''} could not be checked`}
          action={<Button variant="outline" size="sm" onClick={() => onNavigate('watching')}>Review</Button>}
        >
          Their latest activity may be missing until the next successful check.
        </Callout>
      )}

      {visible.length > 0 && (
        <div className="mt-10 hidden items-center justify-center gap-4 text-[12px] text-subtle md:flex">
          <span className="flex items-center gap-1.5"><Kbd>J</Kbd><Kbd>K</Kbd> navigate</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> expand</span>
          <span className="flex items-center gap-1.5"><Kbd>O</Kbd> open</span>
          <span className="flex items-center gap-1.5"><Kbd>E</Kbd> mark read</span>
          <span className="flex items-center gap-1.5"><Kbd>/</Kbd> search</span>
        </div>
      )}
    </div>
  );
}
