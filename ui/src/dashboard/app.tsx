import { useCallback, useEffect, useState } from 'react';
import { Activity, BellRing, Eye, Settings } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { NotifierProvider, useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import { ThemeToggle } from '@/src/components/theme-toggle';
import { BrandMark } from '@/src/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/src/lib/types';
import { ConnectView } from './views/connect';
import { ActivityView } from './views/activity';
import { WatchingView } from './views/watching';
import { SettingsView } from './views/settings';

type View = 'activity' | 'watching' | 'settings' | 'connect';

const NAV: { key: Exclude<View, 'connect'>; label: string; icon: typeof Activity }[] = [
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'watching', label: 'Watching', icon: Eye },
  { key: 'settings', label: 'Settings', icon: Settings },
];

function viewFromUrl(): View {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'watching' || v === 'settings' || v === 'activity') return v;
  } catch {}
  return 'activity';
}

function Shell() {
  const { state, loading, unavailable, error, demo, refresh, dispatch } = useNotifier();
  const [view, setViewState] = useState<View>(() => viewFromUrl());
  const [syncing, setSyncing] = useState(false);

  const connected = Boolean(state?.connected);
  const effectiveView: View = connected ? view : 'connect';

  const setView = useCallback((v: View) => {
    setViewState(v);
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('view', v === 'connect' ? 'activity' : v);
      window.history.replaceState(null, '', `?${params.toString()}`);
    } catch {}
  }, []);

  useEffect(() => {
    if (connected && view === 'connect') setView('activity');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await dispatch({ type: 'SYNC_NOW' });
      const sync = res?.sync;
      if (!res?.ok) {
        toast.error(res?.error || 'Sync failed.');
      } else if (sync?.skipped === 'paused') {
        toast.error('Polling is paused — resume it in Settings for automatic checks.');
      } else if (sync?.skipped === 'backoff') {
        toast.error('Azure DevOps asked us to slow down — the next check is already scheduled.');
      } else if (sync?.skipped === 'disconnected') {
        toast.error('Not connected to Azure DevOps.');
      } else if (sync?.skipped) {
        toast.error(`Sync skipped (${sync.skipped}).`);
      } else {
        const gerr = sync?.errors?.global;
        const itemErrs = Object.keys(sync?.errors?.items || {}).length;
        const added = sync?.added?.length || 0;
        if (gerr || itemErrs) {
          toast.error(gerr || `${itemErrs} pull request${itemErrs > 1 ? 's' : ''} could not be checked.`);
        } else {
          toast.success(added ? `${added} new notification${added > 1 ? 's' : ''}.` : 'Sync complete — nothing new.');
        }
      }
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  if (unavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-3 text-center">
          <BrandMark className="mx-auto h-8 w-8" />
          <h1 className="text-lg font-semibold">Azure DevOps Notifier</h1>
          <p className="text-sm text-muted-foreground">
            This dashboard only works inside the installed Chrome extension. For a preview, open it with <code>?demo=1</code> on a local server.
          </p>
        </div>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-3 text-center">
          <BrandMark className="mx-auto h-8 w-8" />
          <h1 className="text-lg font-semibold">Azure DevOps Notifier</h1>
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          <Button variant="outline" size="sm" onClick={() => { void refresh(); }}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !state) {
    return (
      <div className="flex min-h-screen">
        <aside className="hidden w-[220px] shrink-0 flex-col border-r bg-card p-4 md:flex">
          <Skeleton className="mb-6 h-8 w-32" />
          <Skeleton className="mb-2 h-9 w-full" />
          <Skeleton className="mb-2 h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </aside>
        <main className="flex-1 p-6">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </main>
      </div>
    );
  }

  const org = state.settings.organization;
  const ident = state.settings.identity;
  const needDesktopBanner =
    connected && state.settings.desktopEnabled && state.desktopPermission === false && !demo && !isDemoMode();

  const allowDesktop = async () => {
    const granted = await requestDesktopPermission();
    if (granted) {
      toast.success('Desktop notifications allowed.');
    } else {
      toast.error('Permission was not granted — check Chrome’s notification settings for this extension.');
    }
    await refresh();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b bg-card md:w-[220px] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <BrandMark />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">Azure DevOps</div>
            <div className="truncate text-[11px] text-muted-foreground leading-tight">Notifier</div>
          </div>
          <div className="ml-auto md:hidden">
            <ThemeToggle />
          </div>
        </div>
        {connected && (
          <div className="hidden border-b px-4 py-3 md:block">
            <div className="truncate text-sm font-medium">{org}</div>
            <div className="truncate text-xs text-muted-foreground">{ident?.displayName || 'connected'}</div>
          </div>
        )}
        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col" aria-label="Main">
          {NAV.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                effectiveView === key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto hidden border-t px-4 py-3 text-[11px] text-muted-foreground md:block">
          Runs locally in Chrome. No server, no telemetry.
          <br />
          Your PAT stays on this device.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {demo && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              Demo data · not connected — fixture data only, no network calls or credentials.
            </span>
            <Button variant="ghost" size="sm" onClick={() => { window.location.href = window.location.pathname; }}>
              Exit demo
            </Button>
          </div>
        )}
        <header className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {effectiveView === 'activity' && 'Activity'}
              {effectiveView === 'watching' && 'Watching'}
              {effectiveView === 'settings' && 'Settings'}
              {effectiveView === 'connect' && 'Connect your organization'}
            </h1>
            {connected && (
              <p className="truncate text-xs text-muted-foreground">
                {org} · {ident?.displayName || ''}
                {state.lastSyncAt ? ` · checked ${timeAgo(state.lastSyncAt)}` : ''}
              </p>
            )}
          </div>
          {connected && state.unreadCount > 0 && (
            <Badge variant="secondary">{state.unreadCount} unread</Badge>
          )}
          {connected && (
            <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
        </header>
        {state.errors?.global && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-red-600 dark:text-red-400 md:px-6" role="alert">
            {state.errors.global}
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-red-600 dark:text-red-400 md:px-6" role="alert">
            <span>{error}</span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { void refresh(); }}>
              Retry
            </Button>
          </div>
        )}
        {needDesktopBanner && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm md:px-6">
            <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-amber-800 dark:text-amber-300">
              Desktop alerts are on but Chrome hasn’t granted the notifications permission — your OS notification settings may also apply.
            </span>
            {canRequestDesktopPermission() && (
              <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={allowDesktop}>
                Allow desktop alerts
              </Button>
            )}
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className={cn(effectiveView !== 'connect' && 'hidden')}>
            <ConnectView onConnected={() => setView('activity')} />
          </div>
          <div className={cn(effectiveView !== 'activity' && 'hidden')}>
            <ActivityView />
          </div>
          <div className={cn(effectiveView !== 'watching' && 'hidden')}>
            <WatchingView />
          </div>
          <div className={cn(effectiveView !== 'settings' && 'hidden')}>
            <SettingsView />
          </div>
        </main>
      </div>
    </div>
  );
}

export function DashboardApp() {
  return (
    <NotifierProvider>
      <Shell />
      <Toaster position="bottom-right" />
    </NotifierProvider>
  );
}
