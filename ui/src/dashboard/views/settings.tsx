import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Download,
  FolderGit2,
  LayoutGrid,
  Play,
  Radar,
  RefreshCw,
  UserRound,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import {
  CATEGORY_KEYS,
  timeAgo,
  type CategoryKey,
  type PublicSettings,
} from '@/src/lib/types';
import { Avatar } from '@/src/components/avatar';
import { CategoryTile } from '@/src/components/category';
import { Segmented } from '@/src/components/segmented';
import { Callout, LiveDot, liveLabel, liveState } from '@/src/components/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface Draft {
  selectedProjects: Set<string>;
  autoWatchMine: boolean;
  ignoreSelf: boolean;
  pollMinutes: number;
  paused: boolean;
  desktopEnabled: boolean;
  soundEnabled: boolean;
  eventTypes: Record<CategoryKey, boolean>;
}

function draftFromSettings(s: PublicSettings): Draft {
  return {
    selectedProjects: new Set((s.selectedProjects || []).map((p) => p.id)),
    autoWatchMine: s.autoWatchMine,
    ignoreSelf: s.ignoreSelf,
    pollMinutes: s.pollMinutes,
    paused: s.paused,
    desktopEnabled: s.desktopEnabled,
    soundEnabled: s.soundEnabled === true,
    eventTypes: Object.fromEntries(CATEGORY_KEYS.map((k) => [k, s.eventTypes[k] !== false])) as Record<CategoryKey, boolean>,
  };
}

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'discovery', label: 'Discovery & polling', icon: Radar },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'activity', label: 'Activity types', icon: LayoutGrid },
  { id: 'updates', label: 'Updates', icon: Download },
];

function currentVersion(): string {
  try {
    return globalThis.chrome?.runtime?.getManifest?.()?.version || __APP_VERSION__;
  } catch {
    return __APP_VERSION__;
  }
}

function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} data-section={id} className="scroll-mt-28">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description && <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
  htmlFor,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <label htmlFor={htmlFor} className="block text-[14.5px] font-medium leading-5">{title}</label>
          {description && <p className="mt-0.5 text-[13px] leading-[1.45] text-muted-foreground">{description}</p>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsView() {
  const { state, dispatch, refresh } = useNotifier();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [soundTesting, setSoundTesting] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const accountKeyRef = useRef('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const s = state?.settings;
    if (!s) return;
    const accountKey = `${s.organization || ''}|${s.identity?.id || ''}`;
    const accountChanged = accountKeyRef.current !== '' && accountKeyRef.current !== accountKey;
    accountKeyRef.current = accountKey;
    if (!draft || !dirty || accountChanged) {
      setDraft(draftFromSettings(s));
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.settings]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = (top?.target as HTMLElement | undefined)?.dataset.section;
        if (id) setActiveSection(id);
      },
      { rootMargin: '-110px 0px -55% 0px' },
    );
    root.querySelectorAll('[data-section]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [draft !== null]);

  if (!state || !draft) return null;

  const settings = state.settings;
  const showDesktopNote = draft.desktopEnabled && state.desktopPermission === false && !isDemoMode();

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
    setError('');
  };

  const toggleProject = (id: string, checked: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.selectedProjects);
      if (checked) next.add(id); else next.delete(id);
      return { ...d, selectedProjects: next };
    });
    setDirty(true);
  };

  const toggleCategory = (k: CategoryKey, checked: boolean) => {
    setDraft((d) => (d ? { ...d, eventTypes: { ...d.eventTypes, [k]: checked } } : d));
    setDirty(true);
  };

  const onDesktopToggle = async (checked: boolean) => {
    update('desktopEnabled', checked);
    if (checked && state.desktopPermission === false && !isDemoMode() && canRequestDesktopPermission()) {
      const granted = await requestDesktopPermission();
      if (granted) {
        toast.success('Desktop notifications allowed.');
        await refresh();
      } else {
        toast.error('Desktop notification permission was denied. Alerts stay off until allowed.');
      }
    }
  };

  const allowDesktop = async () => {
    const granted = await requestDesktopPermission();
    if (granted) {
      toast.success('Desktop notifications allowed.');
    } else {
      toast.error('Permission was not granted. Check Chrome’s notification settings for this extension.');
    }
    await refresh();
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await dispatch({
        type: 'SAVE_SETTINGS',
        settings: {
          selectedProjects: [...draft.selectedProjects],
          autoWatchMine: draft.autoWatchMine,
          ignoreSelf: draft.ignoreSelf,
          pollMinutes: draft.pollMinutes,
          paused: draft.paused,
          desktopEnabled: draft.desktopEnabled,
          soundEnabled: draft.soundEnabled,
          eventTypes: draft.eventTypes,
        },
      });
      if (!res?.ok) {
        setError(res?.error || 'Could not save settings.');
        return;
      }
      setDirty(false);
      toast.success('Settings saved.');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(draftFromSettings(settings));
    setDirty(false);
    setError('');
  };

  const testSound = async () => {
    setSoundTesting(true);
    setSoundError('');
    try {
      const res = await dispatch({ type: 'TEST_SOUND' });
      if (res?.ok) {
        toast.success('Test sound started');
      } else {
        setSoundError(res?.error || 'Sound could not be played.');
      }
    } finally {
      setSoundTesting(false);
    }
  };

  const checkUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const res = await dispatch({ type: 'CHECK_UPDATES' });
      if (!res?.ok) {
        toast.error(res?.error || 'Update check failed.');
      } else if (res.update?.available && res.update?.version) {
        toast.success(`Version ${res.update.version} is available.`);
      } else {
        toast.success('You are on the latest version.');
      }
      await refresh();
    } finally {
      setCheckingUpdate(false);
    }
  };

  const disconnect = async () => {
    setConfirmDisconnect(false);
    const res = await dispatch({ type: 'DISCONNECT' });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not disconnect.');
      return;
    }
    await refresh();
  };

  const reconnect = async () => {
    const res = await dispatch({ type: 'DISCONNECT' });
    if (!res?.ok) {
      toast.error(res?.error || 'Could not disconnect.');
      return;
    }
    await refresh();
  };

  const jumpTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const projects = state.projects || [];
  const projectErrors = projects
    .map((p) => ({ p, err: state.errors?.items?.[`project:${p.id}`] }))
    .filter((x) => x.err);
  const allProjects = projects.length > 0 && draft.selectedProjects.size === projects.length;
  const enabledTypes = CATEGORY_KEYS.filter((k) => draft.eventTypes[k]).length;
  const version = currentVersion();

  return (
    <div className="page max-w-[1040px]" ref={rootRef}>
      <div>
        <div className="eyebrow">Preferences</div>
        <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.025em] sm:text-[34px]">Settings</h1>
        <p className="mt-2.5 text-[14.5px] text-muted-foreground">Choose what you hear about and how often the extension checks in.</p>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Settings sections">
          <ul className="sticky top-[92px] space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => jumpTo(id)}
                  aria-current={activeSection === id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium transition-colors',
                    activeSection === id ? 'bg-surface text-foreground shadow-sm ring-1 ring-border/80' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <Icon className={cn('h-4 w-4', activeSection === id ? 'text-primary' : 'text-subtle')} />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          <Section id="account" title="Account" description="The organization and identity this extension uses for Azure DevOps.">
            <div className="surface p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <Avatar name={settings.identity?.displayName} size={46} />
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold">{settings.identity?.displayName || 'Not signed in'}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                      <span className="mono">dev.azure.com/{settings.organization || 'none'}</span>
                      <span className="inline-flex items-center gap-1.5 text-[12.5px]">
                        <LiveDot state={liveState(state)} /> {liveLabel(state)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={reconnect}><RefreshCw /> Reconnect</Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDisconnect(true)}>
                    Disconnect
                  </Button>
                </div>
              </div>
              <p className="mt-4 border-t border-border/70 pt-3 text-[12.5px] text-subtle">
                Disconnecting keeps your watches and history on this device but stops polling until you reconnect.
              </p>
            </div>
          </Section>

          <Section
            id="projects"
            title="Projects"
            description="Pull requests you create or are asked to review in these projects are discovered automatically. Existing watches continue until you unwatch them."
          >
            <div className="surface overflow-hidden">
              {projects.length > 0 && (
                <div className="flex items-center justify-between border-b border-border/70 bg-sunken/50 px-4 py-2.5 sm:px-5">
                  <span className="tabular text-[12.5px] text-muted-foreground">{draft.selectedProjects.size} of {projects.length} selected</span>
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      setDraft((d) => (d ? { ...d, selectedProjects: allProjects ? new Set() : new Set(projects.map((p) => p.id)) } : d));
                      setDirty(true);
                    }}
                  >
                    {allProjects ? 'Select none' : 'Select all'}
                  </button>
                </div>
              )}
              <div className="hairline">
                {projects.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/35 sm:px-5">
                    <Checkbox
                      checked={draft.selectedProjects.has(p.id)}
                      onCheckedChange={(c) => toggleProject(p.id, c === true)}
                    />
                    <FolderGit2 className="h-4 w-4 text-subtle" />
                    <span className="text-[14.5px] font-medium">{p.name}</span>
                  </label>
                ))}
              </div>
              {projects.length === 0 && <p className="px-5 py-6 text-[14px] text-muted-foreground">No projects available.</p>}
            </div>
            {projectErrors.length > 0 && (
              <div className="mt-3 space-y-2">
                {projectErrors.map(({ p, err }) => (
                  <Callout key={p.id} tone="error" title={p.name}>{err}</Callout>
                ))}
              </div>
            )}
          </Section>

          <Section
            id="discovery"
            title="Discovery & polling"
            description="Polling only runs while Chrome is open. Only changes observed between checks are reported, so very short-lived activity may be missed."
          >
            <div className="surface hairline">
              <Row
                htmlFor="s-auto"
                title="Automatically watch my PRs and review requests"
                description="Follow PRs you create or are asked to review in the selected projects."
                control={<Switch id="s-auto" checked={draft.autoWatchMine} onCheckedChange={(v) => update('autoWatchMine', v)} />}
              />
              <Row
                htmlFor="s-ignore"
                title="Ignore my own activity"
                description="Skip notifications for comments, votes and pushes you make yourself."
                control={<Switch id="s-ignore" checked={draft.ignoreSelf} onCheckedChange={(v) => update('ignoreSelf', v)} />}
              />
              <Row title="Check every" description="Shorter intervals feel more real-time and use a little more network.">
                <div className="mt-3">
                  <Segmented
                    label="Polling interval"
                    value={String(draft.pollMinutes)}
                    onChange={(v) => update('pollMinutes', Number(v))}
                    options={[1, 2, 5, 10].map((m) => ({ value: String(m), label: `${m} min` }))}
                  />
                </div>
              </Row>
              <Row
                htmlFor="s-paused"
                title="Pause polling"
                description="Stop automatic checks. Sync now still works."
                control={<Switch id="s-paused" checked={draft.paused} onCheckedChange={(v) => update('paused', v)} />}
              />
            </div>
          </Section>

          <Section id="alerts" title="Alerts" description="How new activity gets your attention. Everything also appears in your inbox and toolbar badge.">
            <div className="surface hairline">
              <Row
                htmlFor="s-desktop"
                title="Desktop notifications"
                description="Show a system notification for each new activity, even when this page is closed."
                control={<Switch id="s-desktop" checked={draft.desktopEnabled} onCheckedChange={onDesktopToggle} />}
              >
                {showDesktopNote && (
                  <Callout
                    tone="warning"
                    className="mt-3"
                    title="Chrome needs permission"
                    action={!isDemoMode() ? <Button size="sm" onClick={allowDesktop}>Allow</Button> : undefined}
                  >
                    Desktop alerts need Chrome’s optional “notifications” permission. Your OS settings may also apply.
                  </Callout>
                )}
              </Row>
              <Row
                htmlFor="s-sound"
                title="Notification sound"
                description="A soft bell, once per batch of new activity. The first sync stays quiet."
                control={<Switch id="s-sound" checked={draft.soundEnabled} onCheckedChange={(v) => update('soundEnabled', v)} />}
              >
                <div className="mt-3 flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={testSound} disabled={soundTesting}>
                    {soundTesting ? <Volume2 className="animate-pulse" /> : <Play />} {soundTesting ? 'Playing…' : 'Play test sound'}
                  </Button>
                  {soundError && <span className="text-[12.5px] text-destructive" role="alert">{soundError}</span>}
                </div>
              </Row>
            </div>
          </Section>

          <Section
            id="activity"
            title="Activity types"
            description={<>Global defaults for every watch. Individual pull requests can override these from Watching. <span className="tabular text-subtle">{enabledTypes} of {CATEGORY_KEYS.length} on.</span></>}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CATEGORY_KEYS.map((k) => (
                <CategoryTile key={k} category={k} checked={draft.eventTypes[k]} onChange={(c) => toggleCategory(k, c)} />
              ))}
            </div>
          </Section>

          <Section
            id="updates"
            title="Updates"
            description="Chrome does not auto-update unpacked extensions, so this checks GitHub Releases every 12 hours."
          >
            <div className="surface p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', state.update?.available ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05] text-muted-foreground')}>
                    <Download className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold">
                      {state.update?.available && state.update.version ? `Version ${state.update.version} is available` : 'You are up to date'}
                    </div>
                    <div className="tabular mt-0.5 text-[13px] text-muted-foreground">
                      Installed v{version}
                      {state.update?.checkedAt ? ` · checked ${timeAgo(state.update.checkedAt)}` : ' · not checked yet'}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={checkUpdates} disabled={checkingUpdate}>
                    <RefreshCw className={cn(checkingUpdate && 'animate-spin')} /> {checkingUpdate ? 'Checking…' : 'Check now'}
                  </Button>
                  {state.update?.available && state.update.url && (
                    <a href={state.update.url} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" tabIndex={-1}><Download /> Get v{state.update.version}</Button>
                    </a>
                  )}
                </div>
              </div>
              <p className="mt-4 border-t border-border/70 pt-3 text-[12.5px] leading-relaxed text-subtle">
                To update, extract the new ZIP over your existing extension folder, then click Reload on chrome://extensions. Your setup carries over.
              </p>
            </div>
          </Section>
        </div>
      </div>

      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 transition-all duration-300',
          dirty ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        )}
        aria-hidden={!dirty}
      >
        <div className="pointer-events-auto flex w-full max-w-[560px] items-center gap-3 rounded-2xl border bg-popover/95 py-2.5 pl-4 pr-2.5 shadow-lg backdrop-blur-xl">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-warning/60" />
            <span className="relative h-2 w-2 rounded-full bg-warning" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
            {error ? <span className="text-destructive" role="alert">{error}</span> : 'You have unsaved changes'}
          </span>
          <Button variant="ghost" size="sm" onClick={discard} disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>Discard</Button>
          <Button size="sm" onClick={save} disabled={saving || !dirty} tabIndex={dirty ? 0 : -1}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect from {settings.organization}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your watches and history stay on this device, but polling stops until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
