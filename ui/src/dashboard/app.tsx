import { useCallback, useEffect, useState } from 'react';
import { BellRing, Download, Eye, FlaskConical, Inbox, Lock, RefreshCw, Settings } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { NotifierProvider, useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import { ThemeToggle } from '@/src/components/theme-toggle';
import { BrandMark } from '@/src/components/brand-mark';
import { Avatar } from '@/src/components/avatar';
import { Callout, LiveDot, liveLabel, liveState } from '@/src/components/status';
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

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="surface enter w-full max-w-md p-8 text-center">
        <BrandMark className="mx-auto h-11 w-11 rounded-xl shadow-md" />
        <h1 className="mt-4 text-[19px] font-semibold tracking-[-0.01em]">Azure DevOps Notifier</h1>
        {children}
      </div>
    </div>
  );
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
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (connected && view === 'connect') setView('activity');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => {
    const unread = state?.unreadCount || 0;
    document.title = unread ? `(${unread}) Azure DevOps Notifier` : 'Azure DevOps Notifier';
  }, [state?.unreadCount]);

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
      <CenteredMessage>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          This dashboard only works inside the installed Chrome extension. For a preview, open it with <code className="mono rounded bg-muted px-1 py-0.5 text-[12.5px]">?demo=1</code> on a local server.
        </p>
      </CenteredMessage>
    );
  }

  if (error && !state) {
    return (
      <CenteredMessage>
        <p className="mt-2 text-[14px] text-destructive" role="alert">{error}</p>
        <Button variant="outline" className="mt-5" onClick={() => { void refresh(); }}>
          <RefreshCw /> Retry
        </Button>
      </CenteredMessage>
    );
  }

  if (loading || !state) {
    return (
      <div className="min-h-screen" role="status" aria-label="Loading">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-4 px-4 sm:px-6">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-9 w-64 rounded-xl" />
            <Skeleton className="ml-auto h-8 w-8 rounded-full" />
          </div>
        </header>
        <div className="page space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="mt-6 h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const org = state.settings.organization;
  const ident = state.settings.identity;
  const live = liveState(state);
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

  const banners = (
    <>
      {state.errors?.global && (
        <Callout tone="error" title="Azure DevOps could not be reached">{state.errors.global}</Callout>
      )}
      {error && (
        <Callout
          tone="error"
          title="Something went wrong"
          action={<Button variant="outline" size="sm" onClick={() => { void refresh(); }}>Retry</Button>}
        >
          {error}
        </Callout>
      )}
      {needDesktopBanner && (
        <Callout
          tone="warning"
          icon={<BellRing className="h-4 w-4" />}
          title="Desktop alerts are waiting for permission"
          action={canRequestDesktopPermission() ? <Button size="sm" onClick={allowDesktop}>Allow alerts</Button> : undefined}
        >
          Chrome hasn’t granted the notifications permission yet. Your OS notification settings may also apply.
        </Callout>
      )}
    </>
  );
  const hasBanners = Boolean(state.errors?.global || error || needDesktopBanner);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-3 px-3 sm:gap-5 sm:px-6">
          <button
            type="button"
            onClick={() => connected && setView('activity')}
            className="flex shrink-0 items-center gap-2.5 rounded-lg"
            aria-label="Azure DevOps Notifier home"
          >
            <BrandMark className="h-8 w-8 rounded-[9px] shadow-sm" />
            <span className="hidden text-[15px] font-semibold tracking-[-0.01em] md:inline">Azure DevOps Notifier</span>
          </button>

          {connected && (
            <nav
              className="flex min-w-0 items-center gap-0.5 rounded-xl bg-sunken p-[3px] ring-1 ring-inset ring-border/70"
              aria-label="Main"
            >
              {NAV.map(({ key, label, icon: Icon }) => {
                const active = effectiveView === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={label}
                    className={cn(
                      'relative flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 text-[14px] font-medium transition-all duration-150 sm:px-3',
                      active
                        ? 'bg-surface text-foreground shadow-sm ring-1 ring-border/80'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-[15px] w-[15px]" strokeWidth={2.1} />
                    <span className="hidden sm:inline">{label}</span>
                    {key === 'activity' && state.unreadCount > 0 && (
                      <span className="tabular min-w-[18px] rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-[18px] text-primary-foreground">
                        {state.unreadCount > 99 ? '99+' : state.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {state.update?.available && state.update.url && (
              <a
                href={state.update.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`Version ${state.update.version} is available on GitHub`}
                className="group inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-[12.5px] font-semibold text-primary ring-1 ring-inset ring-primary/25 transition-colors hover:bg-primary/15 sm:px-3"
              >
                <Download className="h-3.5 w-3.5 transition-transform group-hover:translate-y-[1px]" />
                <span className="hidden sm:inline">Update</span>
                <span className="tabular">v{state.update.version}</span>
              </a>
            )}
            {connected && (
              <button
                type="button"
                onClick={onSync}
                disabled={syncing}
                className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:opacity-80 sm:px-2.5"
                title="Check Azure DevOps now"
                aria-label={syncing ? 'Syncing' : `Sync now. ${liveLabel(state)}`}
              >
                <LiveDot state={live} />
                <span className="tabular hidden lg:inline">{syncing ? 'Checking…' : liveLabel(state)}</span>
                <RefreshCw className={cn('h-[15px] w-[15px]', syncing && 'animate-spin')} />
              </button>
            )}
            <ThemeToggle />
            {connected && (
              <button
                type="button"
                onClick={() => setView('settings')}
                className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-accent/70 xl:pr-3"
                title={`${ident?.displayName || 'Connected'} · ${org}`}
                aria-label="Account settings"
              >
                <Avatar name={ident?.displayName} size={30} className="ring-2 ring-background" />
                <span className="hidden text-left leading-tight xl:block">
                  <span className="block text-[13px] font-medium text-foreground">{ident?.displayName}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{org}</span>
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {demo && (
        <div className="border-b border-warning/20 bg-warning/[0.06]">
          <div className="mx-auto flex max-w-[1120px] items-center gap-2 px-4 py-1.5 text-[12.5px] sm:px-6">
            <FlaskConical className="h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="font-semibold text-foreground">Demo mode</span> · fixture data, no network calls or credentials
            </span>
            <button
              type="button"
              className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => { window.location.href = window.location.pathname; }}
            >
              Exit demo
            </button>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">
        {hasBanners && <div className="mx-auto max-w-[960px] space-y-2 px-4 pt-6 sm:px-6">{banners}</div>}
        <div className={cn('enter', effectiveView !== 'connect' && 'hidden')}>
          <ConnectView onConnected={() => setView('activity')} />
        </div>
        <div className={cn('enter', effectiveView !== 'activity' && 'hidden')}>
          <ActivityView active={effectiveView === 'activity'} onNavigate={setView} />
        </div>
        <div className={cn('enter', effectiveView !== 'watching' && 'hidden')}>
          <WatchingView />
        </div>
        <div className={cn('enter', effectiveView !== 'settings' && 'hidden')}>
          <SettingsView />
        </div>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-[12.5px] text-subtle sm:px-6">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Local-only. Your token and history never leave this browser.
          </span>
          <span className="tabular">v{__APP_VERSION__}</span>
        </div>
      </footer>
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
