import { useState } from 'react';
import { ArrowRight, BellRing, Check, CheckCheck, Download, Eye, LayoutDashboard, Lock, Pause, Play, RefreshCw, Settings, SlidersHorizontal } from 'lucide-react';
import { toast, Toaster } from '@/components/ui/sonner';

import { NotifierProvider, useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { ThemeToggle } from '@/src/components/theme-toggle';
import { BrandMark } from '@/src/components/brand-mark';
import { ActorAvatar } from '@/src/components/avatar';
import { Segmented } from '@/src/components/segmented';
import { LiveDot, liveLabel, liveState } from '@/src/components/status';
import { Button } from '@/components/ui/button';
import { timeAgo, type PublicNotification } from '@/src/lib/types';
import { cn } from '@/lib/utils';

function openExtensionPage(page: 'dashboard' | 'settings') {
  const params = new URLSearchParams();
  if (isDemoMode()) {
    params.set('demo', '1');
    if (page === 'settings') params.set('view', 'settings');
    window.open(`dashboard.html?${params.toString()}`, '_blank');
    return;
  }
  try {
    const url = globalThis.chrome?.runtime?.getURL?.(`ui-build/dashboard.html?view=${page === 'settings' ? 'settings' : 'activity'}`);
    if (url) window.open(url, '_blank');
  } catch {}
}

function PopupRow({ n, onRead }: { n: PublicNotification; onRead: (id: string) => void }) {
  const body = (
    <>
      <ActorAvatar name={n.actorName} category={n.category} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className={cn('shrink-0 text-[13.5px] leading-5', n.read ? 'font-medium text-foreground/80' : 'font-semibold')}>{n.title}</span>
          {n.actorName && <span className="truncate text-[12.5px] text-muted-foreground">· {n.actorName}</span>}
        </span>
        {n.body && <span className="block truncate text-[12.5px] leading-[18px] text-foreground/75">{n.body}</span>}
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11.5px] text-subtle">
          <span className="mono shrink-0 font-medium text-muted-foreground">#{n.prId}</span>
          <span className="truncate">{n.prTitle || n.repoName}</span>
        </span>
      </span>
      <span className="flex w-10 shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <span className="tabular text-[11px] text-subtle transition-opacity group-hover:opacity-0">{timeAgo(n.createdAt).replace(' ago', '')}</span>
        {!n.read && <span className="h-[7px] w-[7px] rounded-full bg-primary transition-opacity group-hover:opacity-0" aria-label="Unread" />}
      </span>
    </>
  );
  const cls = 'popup-row group relative flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/50';
  return (
    <div className="relative">
      {n.url ? (
        <a href={n.url} target="_blank" rel="noopener noreferrer" onClick={() => { if (!n.read) onRead(n.id); }} className={cls}>
          {body}
        </a>
      ) : (
        <button type="button" onClick={() => { if (!n.read) onRead(n.id); }} className={cls}>
          {body}
        </button>
      )}
      {!n.read && (
        <button
          type="button"
          onClick={() => onRead(n.id)}
          className="peer absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground focus-visible:opacity-100 [div:hover>&]:opacity-100"
          aria-label="Mark as read"
          title="Mark as read"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function Header({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark className="h-8 w-8 rounded-[9px] shadow-sm" />
        <div className="min-w-0">
          <span className="block truncate text-[14.5px] font-semibold leading-5 tracking-[-0.01em]">{title}</span>
          {sub && <div className="truncate text-[12px] leading-4 text-muted-foreground">{sub}</div>}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1">{right}</span>
    </div>
  );
}

function PopupBody() {
  const { state, loading, unavailable, error, demo, dispatch, refresh } = useNotifier();
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'unread' | 'recent'>('unread');

  if (unavailable) {
    return (
      <div className="space-y-4 p-4">
        <Header title="Azure DevOps Notifier" right={<ThemeToggle />} />
        <p className="text-[13.5px] text-muted-foreground">This popup only works inside the installed Chrome extension.</p>
        <Button size="sm" onClick={() => window.open('dashboard.html?demo=1', '_blank')}>Open demo preview</Button>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="space-y-4 p-4">
        <Header title="Azure DevOps Notifier" right={<ThemeToggle />} />
        <p className="text-[13.5px] text-destructive" role="alert">{error}</p>
        <Button size="sm" variant="outline" onClick={() => { void refresh(); }}><RefreshCw /> Retry</Button>
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 animate-pulse rounded-[9px] bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/70" />)}
      </div>
    );
  }

  const notifications = state.notifications || [];
  const unread = notifications.filter((n) => !n.read);
  const list = (tab === 'unread' ? unread : notifications).slice(0, 8);
  const needDesktopHint =
    state.connected && state.settings.desktopEnabled && state.desktopPermission === false && !isDemoMode();

  const markReadQuiet = (id: string) => {
    void dispatch({ type: 'MARK_READ', ids: [id] }).then((res) => {
      if (!res?.ok) toast.error(res?.error || 'Could not mark as read.');
      else void refresh();
    });
  };

  const markAll = async () => {
    const res = await dispatch({ type: 'MARK_ALL_READ' });
    if (!res?.ok) toast.error(res?.error || 'Could not mark all as read.');
    await refresh();
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await dispatch({ type: 'SYNC_NOW' });
      const sync = res?.sync;
      if (!res?.ok) toast.error(res?.error || 'Sync failed.');
      else if (sync?.skipped) toast.error(`Sync skipped (${sync.skipped}).`);
      else {
        const added = sync?.added?.length || 0;
        const gerr = sync?.errors?.global;
        const itemErrs = Object.keys(sync?.errors?.items || {}).length;
        if (gerr || itemErrs) toast.error(gerr || `${itemErrs} pull request${itemErrs > 1 ? 's' : ''} could not be checked.`);
        else toast.success(added ? `${added} new notification${added > 1 ? 's' : ''}.` : 'Sync complete. Nothing new.');
      }
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const togglePause = async () => {
    const res = await dispatch({ type: 'SAVE_SETTINGS', settings: { paused: !state.settings.paused } });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not update settings.');
      return;
    }
    await refresh();
  };

  if (!state.connected) {
    return (
      <div className="p-5">
        <div className="flex justify-end"><ThemeToggle /></div>
        <div className="-mt-4 flex flex-col items-center text-center">
          <BrandMark className="h-12 w-12 rounded-[14px] shadow-md" />
          <h1 className="mt-4 text-[19px] font-semibold tracking-[-0.015em]">Stay on top of your PRs</h1>
          <p className="mt-1.5 max-w-[300px] text-[13.5px] leading-relaxed text-muted-foreground">
            Comments, reviews, pushes and checks from Azure DevOps, right in your toolbar.
          </p>
        </div>
        {demo && (
          <p className="mt-4 rounded-lg bg-warning/[0.08] px-3 py-1.5 text-center text-[12px] font-medium text-warning ring-1 ring-inset ring-warning/25">Demo data · not connected</p>
        )}
        <ul className="mt-5 space-y-2.5">
          {[
            { icon: Eye, text: 'Your pull requests followed automatically' },
            { icon: SlidersHorizontal, text: 'Choose exactly which activity alerts you' },
            { icon: Lock, text: 'Local-only. No servers, no telemetry' },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[13.5px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" /></span>
              {text}
            </li>
          ))}
        </ul>
        <Button size="lg" className="mt-6 w-full" onClick={() => openExtensionPage('dashboard')}>
          Set up in a minute <ArrowRight />
        </Button>
      </div>
    );
  }

  const live = liveState(state);

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="space-y-3 px-4 pb-3 pt-4">
        <Header
          title={state.settings.organization || 'Azure DevOps'}
          sub={
            <span className="flex items-center gap-1.5">
              <LiveDot state={live} />
              {liveLabel(state)}
              <span className="text-subtle">· {state.watches.length} watching</span>
            </span>
          }
          right={<ThemeToggle />}
        />

        {demo && (
          <p className="rounded-lg bg-warning/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-warning ring-1 ring-inset ring-warning/25">Demo data · not connected</p>
        )}

        {state.update?.available && state.update.url && (
          <a
            href={state.update.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-2.5 rounded-xl bg-primary/[0.08] px-3 py-2 text-[12.5px] ring-1 ring-inset ring-primary/20 transition-colors hover:bg-primary/[0.12]"
          >
            <Download className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1"><span className="font-semibold text-primary">v{state.update.version} available</span> <span className="text-muted-foreground">on GitHub</span></span>
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
          </a>
        )}

        {needDesktopHint && (
          <button
            type="button"
            onClick={() => openExtensionPage('settings')}
            className="flex w-full items-center gap-2.5 rounded-xl bg-warning/[0.08] px-3 py-2 text-left text-[12.5px] ring-1 ring-inset ring-warning/25 transition-colors hover:bg-warning/[0.12]"
          >
            <BellRing className="h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="flex-1 text-foreground/85">Desktop alerts need Chrome permission</span>
            <span className="font-medium text-warning">Allow</span>
          </button>
        )}

        {state.errors?.global && (
          <p className="rounded-xl bg-destructive/[0.08] px-3 py-2 text-[12.5px] text-destructive ring-1 ring-inset ring-destructive/25" role="alert">
            {state.errors.global}
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-destructive/[0.08] px-3 py-2 text-[12.5px] text-destructive ring-1 ring-inset ring-destructive/25" role="alert">
            {error}
            <button type="button" className="ml-2 font-medium underline" onClick={() => { void refresh(); }}>Retry</button>
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <Segmented
            size="sm"
            label="Notification list"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'unread', label: 'Unread', count: unread.length },
              { value: 'recent', label: 'Recent' },
            ]}
          />
          {unread.length > 0 && (
            <button type="button" onClick={markAll} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-3 pb-3">
        {list.length > 0 ? (
          <div className="surface hairline overflow-hidden">
            {list.map((n) => <PopupRow key={n.id} n={n} onRead={markReadQuiet} />)}
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="relative mb-4 flex h-12 w-12 items-center justify-center">
              <span className="absolute inset-[-10px] rounded-full border border-dashed border-border-strong/70" />
              <span className="absolute inset-0 rounded-xl bg-surface shadow-md ring-1 ring-border" />
              <CheckCheck className="relative h-5 w-5 text-primary" />
            </div>
            <p className="text-[14.5px] font-semibold">{tab === 'unread' && notifications.length > 0 ? 'All caught up' : 'No activity yet'}</p>
            <p className="mt-1 max-w-[260px] text-[12.5px] leading-relaxed text-muted-foreground">
              {tab === 'unread' && notifications.length > 0
                ? 'Nothing new since you last looked.'
                : 'The first check baselines quietly. New activity will show up here.'}
            </p>
            {tab === 'unread' && notifications.length > 0 && (
              <button type="button" onClick={() => setTab('recent')} className="mt-3 text-[12.5px] font-medium text-primary underline-offset-4 hover:underline">
                Show recent activity
              </button>
            )}
          </div>
        )}
        {tab === 'unread' && unread.length > list.length && (
          <button type="button" onClick={() => openExtensionPage('dashboard')} className="mt-2 w-full rounded-lg py-1.5 text-center text-[12.5px] font-medium text-primary hover:bg-primary/[0.06]">
            {unread.length - list.length} more in the dashboard
          </button>
        )}
      </div>

      <div className="sticky bottom-0 flex items-center gap-1 border-t border-border/70 bg-background/90 px-2.5 py-2 backdrop-blur-xl">
        <Button variant="ghost" size="sm" onClick={onSync} disabled={syncing} className="text-foreground">
          <RefreshCw className={cn(syncing && 'animate-spin')} /> {syncing ? 'Checking…' : 'Sync'}
        </Button>
        <Button variant="ghost" size="sm" className="text-foreground" onClick={togglePause} title={state.settings.paused ? 'Resume automatic checks' : 'Pause automatic checks'}>
          {state.settings.paused ? <><Play /> Resume</> : <><Pause /> Pause</>}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="iconSm" onClick={() => openExtensionPage('settings')} aria-label="Settings" title="Settings">
          <Settings />
        </Button>
        <Button variant="outline" size="sm" onClick={() => openExtensionPage('dashboard')}>
          <LayoutDashboard /> Dashboard
        </Button>
      </div>
      <Toaster position="bottom-center" offset={56} />
    </div>
  );
}

function PopupApp() {
  return (
    <div className="popup-shell">
      <NotifierProvider>
        <PopupBody />
      </NotifierProvider>
    </div>
  );
}

export { PopupApp };
