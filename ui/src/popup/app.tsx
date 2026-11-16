import { useState } from 'react';
import { ExternalLink, Settings, LayoutDashboard, Pause, Play, BellRing, Download } from 'lucide-react';
import { toast, Toaster } from '@/components/ui/sonner';

import { NotifierProvider, useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { ThemeToggle } from '@/src/components/theme-toggle';
import { BrandMark } from '@/src/components/brand-mark';
import { CategoryBadge } from '@/src/components/bits';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

function Header({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark />
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
        </div>
      </div>
      <span className="shrink-0">{right}</span>
    </div>
  );
}

function PopupBody() {
  const { state, loading, unavailable, error, demo, dispatch, refresh } = useNotifier();
  const [syncing, setSyncing] = useState(false);

  if (unavailable) {
    return (
      <div className="space-y-3 p-4">
        <Header title="Azure DevOps Notifier" right={<ThemeToggle />} />
        <p className="text-sm text-muted-foreground">
          This popup only works inside the installed Chrome extension.
        </p>
        <Button size="sm" onClick={() => window.open('dashboard.html?demo=1', '_blank')}>
          Open demo preview
        </Button>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="space-y-3 p-4">
        <Header title="Azure DevOps Notifier" right={<ThemeToggle />} />
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
        <Button size="sm" variant="outline" onClick={() => { void refresh(); }}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading || !state) {
    return <div className="p-4 text-sm text-muted-foreground" role="status">Loading…</div>;
  }

  const unread = (state.notifications || []).filter((n) => !n.read);
  const latest = unread.slice(0, 8);
  const needDesktopHint =
    state.connected && state.settings.desktopEnabled && state.desktopPermission === false && !isDemoMode();

  const markReadQuiet = (id: string) => {
    void dispatch({ type: 'MARK_READ', ids: [id] }).then((res) => {
      if (!res?.ok) toast.error(res?.error || 'Could not mark as read.');
      else void refresh();
    });
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
    const res = await dispatch({
      type: 'SAVE_SETTINGS',
      settings: { paused: !state.settings.paused },
    });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not update settings.');
      return;
    }
    await refresh();
  };

  if (!state.connected) {
    return (
      <div className="space-y-3 p-4">
        <Header title="Azure DevOps Notifier" right={<ThemeToggle />} />
        {demo && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            Demo data · not connected
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Connect an Azure DevOps organization to start getting pull request notifications.
        </p>
        <Button size="sm" className="w-full" onClick={() => openExtensionPage('dashboard')}>
          Set up
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <Header
        title={state.settings.organization || 'Azure DevOps'}
        sub={`${state.watches.length} watching${state.lastSyncAt ? ` · checked ${timeAgo(state.lastSyncAt)}` : ''}`}
        right={
          <span className="flex items-center gap-1.5">
            {unread.length > 0 && <Badge variant="secondary" className="text-[10px]">{unread.length}</Badge>}
            <ThemeToggle />
          </span>
        }
      />

      {demo && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          Demo data · not connected
        </p>
      )}

      {state.update?.available && state.update.url && (
        <a
          href={state.update.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-2 py-1.5 text-left text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Update available: v{state.update.version}</span>
        </a>
      )}

      {needDesktopHint && (
        <button
          type="button"
          onClick={() => openExtensionPage('settings')}
          className="flex w-full items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-left text-xs text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
        >
          <BellRing className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Desktop alerts need Chrome permission. Open Settings to allow.</span>
        </button>
      )}

      {state.errors?.global && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {state.errors.global}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => { void refresh(); }}>Retry</button>
        </p>
      )}

      <div className="max-h-[300px] space-y-1.5 overflow-y-auto">
        {latest.map((n) => {
          const inner = (
            <>
              <CategoryBadge category={n.category} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-xs font-medium', !n.read && 'font-semibold')}>{n.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  #{n.prId} {n.repoName} · {n.projectName} · {n.prTitle || ''}
                </span>
                <span className="block text-[10px] text-muted-foreground/70">{n.body}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                {n.url && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
              </span>
            </>
          );
          const cls = cn(
            'flex w-full items-start gap-2 rounded-md border p-2 text-left transition-colors hover:bg-accent/60',
            !n.read && 'border-primary/30 bg-primary/[0.03]',
          );
          if (n.url) {
            return (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { if (!n.read) markReadQuiet(n.id); }}
                className={cls}
              >
                {inner}
              </a>
            );
          }
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => { if (!n.read) markReadQuiet(n.id); }}
              className={cls}
            >
              {inner}
            </button>
          );
        })}
        {latest.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {unread.length === 0 && (state.notifications || []).length > 0
              ? "No unread notifications. You're all caught up."
              : 'No notifications yet. The first check baselines quietly.'}
          </p>
        )}
      </div>

      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" className="flex-1" onClick={onSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
        <Button variant="outline" size="sm" onClick={togglePause}>
          {state.settings.paused ? <><Play className="h-3.5 w-3.5" /><span className="ml-1">Resume</span></> : <><Pause className="h-3.5 w-3.5" /><span className="ml-1">Pause</span></>}
        </Button>
      </div>
      <div className="flex gap-1.5">
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => openExtensionPage('dashboard')}>
          <LayoutDashboard className="mr-1 h-3.5 w-3.5" /> Dashboard
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => openExtensionPage('settings')}>
          <Settings className="mr-1 h-3.5 w-3.5" /> Settings
        </Button>
      </div>
      <Toaster position="bottom-center" />
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
