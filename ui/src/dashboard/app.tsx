import { useCallback, useEffect, useState } from 'react';
import { BellRing, Download, Eye, Inbox, Settings } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { NotifierProvider, useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import { ThemeToggle } from '@/src/components/theme-toggle';
import { BrandMark } from '@/src/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { ConnectView } from './views/connect';
import { ActivityView } from './views/activity';
import { WatchingView } from './views/watching';
import { SettingsView } from './views/settings';

type View = 'activity' | 'watching' | 'settings' | 'connect';

const NAV: { key: Exclude<View, 'connect'>; label: string; icon: typeof Inbox }[] = [
  { key: 'activity', label: 'Activity', icon: Inbox },
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
        toast.error('Polling is paused. Resume it in Settings for automatic checks.');
      } else if (sync?.skipped === 'backoff') {
        toast.error('Azure DevOps asked us to slow down. The next check is already scheduled.');
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
          toast.success(added ? `${added} new notification${added > 1 ? 's' : ''}.` : 'Sync complete. Nothing new.');
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
      <div className="min-h-screen">
        <header className="b-nav sticky top-0 z-10 bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-4 px-4 sm:px-5">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="ml-auto h-8 w-8 rounded-full" />
          </div>
        </header>
        <div className="b-feed">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
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
      toast.error('Permission was not granted. Check Chrome’s notification settings for this extension.');
    }
    await refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="b-nav sticky top-0 z-10 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-4 px-4 sm:gap-6 sm:px-5">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="hidden text-[15px] font-semibold sm:inline">Azure DevOps Notifier</span>
          </div>
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-[14.5px]" aria-label="Main">
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors',
                  effectiveView === key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />{label}
                {key === 'activity' && state.unreadCount > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground">{state.unreadCount}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {state.update?.available && state.update.url && (
              <a
                href={state.update.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Version ${state.update.version} is available on GitHub`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <Download className="h-3.5 w-3.5" />
                v{state.update.version}
              </a>
            )}
            {connected && (
              <span className="hidden text-[13px] text-muted-foreground lg:block">{org} · {ident?.displayName || 'connected'}</span>
            )}
            {connected && (
              <Button variant="outline" size="sm" className="h-8" onClick={onSync} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      {demo && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          <span className="font-medium text-amber-700 dark:text-amber-400">
            Demo data · not connected · fixture data only, no network calls or credentials.
          </span>
          <Button variant="ghost" size="sm" onClick={() => { window.location.href = window.location.pathname; }}>
            Exit demo
          </Button>
        </div>
      )}
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
            Desktop alerts are on but Chrome hasn’t granted the notifications permission. Your OS notification settings may also apply.
          </span>
          {canRequestDesktopPermission() && (
            <Button variant="outline" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={allowDesktop}>
              Allow desktop alerts
            </Button>
          )}
        </div>
      )}
      <main className="min-w-0 flex-1">
        <div className={cn(effectiveView !== 'connect' && 'hidden')}>
          <div className="mx-auto max-w-xl px-4 py-8">
            <ConnectView onConnected={() => setView('activity')} />
          </div>
        </div>
        <div className={cn(effectiveView !== 'activity' && 'hidden')}>
          <ActivityView />
        </div>
        <div className={cn(effectiveView !== 'watching' && 'hidden')}>
          <div className="b-feed">
            <WatchingView />
          </div>
        </div>
        <div className={cn(effectiveView !== 'settings' && 'hidden')}>
          <div className="b-feed">
            <SettingsView />
          </div>
        </div>
      </main>
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
