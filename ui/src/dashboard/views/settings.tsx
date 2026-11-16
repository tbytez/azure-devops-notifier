import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import {
  CATEGORY_KEYS,
  CATEGORY_META,
  timeAgo,
  type CategoryKey,
  type PublicSettings,
} from '@/src/lib/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

export function SettingsView() {
  const { state, dispatch, refresh } = useNotifier();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [soundTesting, setSoundTesting] = useState(false);
  const [soundError, setSoundError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const accountKeyRef = useRef('');

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

  if (!state || !draft) return null;

  const settings = state.settings;
  const needDesktopPerm = settings.desktopEnabled && state.desktopPermission === false && !isDemoMode();
  const showDesktopNote = needDesktopPerm || (draft.desktopEnabled && state.desktopPermission === false && !isDemoMode());

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
    setSavedOk(false);
  };

  const toggleProject = (id: string, checked: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.selectedProjects);
      if (checked) next.add(id); else next.delete(id);
      return { ...d, selectedProjects: next };
    });
    setDirty(true);
    setSavedOk(false);
  };

  const toggleCategory = (k: CategoryKey, checked: boolean) => {
    setDraft((d) => (d ? { ...d, eventTypes: { ...d.eventTypes, [k]: checked } } : d));
    setDirty(true);
    setSavedOk(false);
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
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
      await refresh();
    } finally {
      setSaving(false);
    }
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

  const projectErrors = (state.projects || [])
    .map((p) => ({ p, err: state.errors?.items?.[`project:${p.id}`] }))
    .filter((x) => x.err);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Connected organization and identity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Organization: </span>
            <span className="font-medium">{settings.organization || 'none'}</span>
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">Signed in as: </span>
            <span className="font-medium">{settings.identity?.displayName || 'none'}</span>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={reconnect}>Reconnect</Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Disconnecting keeps your watches and history on this device but stops polling until you reconnect.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            Discover PRs you created in these projects. Existing watches continue until unwatched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(state.projects || []).map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={draft.selectedProjects.has(p.id)}
                onCheckedChange={(c) => toggleProject(p.id, c === true)}
              />
              <span>{p.name}</span>
            </label>
          ))}
          {(state.projects || []).length === 0 && (
            <p className="text-sm text-muted-foreground">No projects available.</p>
          )}
          {projectErrors.map(({ p, err }) => (
            <Alert key={p.id} variant="destructive" className="py-2">
              <AlertDescription className="text-xs">{p.name}: {err}</AlertDescription>
            </Alert>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discovery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>Automatically watch pull requests I create in the selected projects</span>
            <Switch checked={draft.autoWatchMine} onCheckedChange={(v) => update('autoWatchMine', v)} />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>Ignore activity I create myself</span>
            <Switch checked={draft.ignoreSelf} onCheckedChange={(v) => update('ignoreSelf', v)} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Polling</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="poll-interval" className="text-sm">Check for updates every</Label>
            <Select
              value={String(draft.pollMinutes)}
              onValueChange={(v) => update('pollMinutes', Number(v))}
            >
              <SelectTrigger id="poll-interval" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 minute</SelectItem>
                <SelectItem value="2">2 minutes</SelectItem>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="10">10 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span>Pause polling (manual “Sync now” still works)</span>
            <Switch checked={draft.paused} onCheckedChange={(v) => update('paused', v)} />
          </label>
          <p className="text-xs text-muted-foreground">
            Polling only runs while Chrome is open. Only changes observed between checks are reported, so activity between polls may be missed. Checks cover pull request statuses and policy evaluations, not every pipeline run.
          </p>
          <Separator />
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span>Show desktop notifications</span>
              <Switch checked={draft.desktopEnabled} onCheckedChange={onDesktopToggle} />
            </label>
            {showDesktopNote && (
              <Alert className="py-2">
                <AlertDescription className="flex flex-wrap items-center gap-2 text-xs">
                  <span>Desktop alerts need Chrome's optional “notifications” permission. Your OS notification settings may also apply.</span>
                  {!isDemoMode() && (
                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={allowDesktop}>
                      Allow desktop alerts
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <Separator />
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span>Play notification sound</span>
              <Switch checked={draft.soundEnabled} onCheckedChange={(v) => update('soundEnabled', v)} />
            </label>
            <p className="text-xs text-muted-foreground">
              One chime per batch of new activity. The first sync stays quiet.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={testSound} disabled={soundTesting}>
                {soundTesting ? 'Playing…' : 'Test sound'}
              </Button>
              {soundError && <span className="text-xs text-red-600 dark:text-red-400" role="alert">{soundError}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity types</CardTitle>
          <CardDescription>Global defaults. Individual watches can override these.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CATEGORY_KEYS.map((k) => {
              const meta = CATEGORY_META[k];
              return (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.eventTypes[k]}
                    onCheckedChange={(c) => toggleCategory(k, c === true)}
                  />
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                  />
                  <span className="text-foreground">{meta.label}</span>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extension updates</CardTitle>
          <CardDescription>
            Chrome does not auto-update unpacked extensions, so the extension checks GitHub Releases every 12 hours and shows a download link when a newer version exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={checkUpdates} disabled={checkingUpdate}>
              {checkingUpdate ? 'Checking…' : 'Check now'}
            </Button>
            {state.update?.available && state.update.url ? (
              <a
                href={state.update.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                v{state.update.version} available on GitHub
              </a>
            ) : state.update?.checkedAt ? (
              <span className="text-xs text-muted-foreground">Up to date · checked {timeAgo(state.update.checkedAt)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">Not checked yet.</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            To update, download the latest ZIP and extract it over your existing extension folder, then click Reload on chrome://extensions. Your setup carries over.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {savedOk && <span className="text-sm text-emerald-600 dark:text-emerald-400">Settings saved.</span>}
        {error && <span className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</span>}
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect?</AlertDialogTitle>
            <AlertDialogDescription>
              Your watches and history stay on this device, but polling stops until you reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
