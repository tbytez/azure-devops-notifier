import { useState } from 'react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { PublicProject } from '@/src/lib/types';

type Phase = 'idle' | 'connecting' | 'selecting' | 'confirming';

export function ConnectView({ onConnected }: { onConnected: () => void }) {
  const { state, dispatch, refresh } = useNotifier();
  const [phase, setPhase] = useState<Phase>('idle');
  const [org, setOrg] = useState(state?.settings.organization || '');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ identity: { id: string; displayName: string }; projects: PublicProject[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [desktopOn, setDesktopOn] = useState(true);

  const startConnect = async () => {
    setError('');
    setPhase('connecting');
    let res;
    try {
      res = await dispatch({ type: 'CONNECT', organization: org, token });
    } catch (e) {
      res = { ok: false, error: (e as Error)?.message || 'Connection failed.' };
    }
    if (!res?.ok || !res.pending) {
      setPhase('idle');
      setError(res?.error || 'Connection failed.');
      return;
    }
    setToken('');
    setPending(res.pending);
    setSelected(new Set(res.pending.projects.map((p) => p.id)));
    setDesktopOn(state?.settings.desktopEnabled !== false);
    setPhase('selecting');
  };

  const confirmConnect = async () => {
    setError('');
    setPhase('confirming');
    const wantDesktop = desktopOn && state?.desktopPermission === false && !isDemoMode();
    const permPromise = wantDesktop && canRequestDesktopPermission()
      ? requestDesktopPermission()
      : Promise.resolve(true);
    const permGranted = await permPromise;
    if (wantDesktop) await refresh();
    let res;
    try {
      res = await dispatch({ type: 'CONFIRM_CONNECT', projectIds: [...selected], desktopEnabled: desktopOn });
    } catch (e) {
      res = { ok: false, error: (e as Error)?.message || 'Could not finish connecting.' };
    }
    if (!res?.ok) {
      setPhase('idle');
      setPending(null);
      setError(res?.error || 'Could not finish connecting.');
      return;
    }
    setPhase('idle');
    setPending(null);
    if (desktopOn && wantDesktop && !permGranted) {
      toast.error('Chrome declined desktop notification permission. You can allow it later in Settings.');
    }
    toast.success('Connected. First sync will baseline quietly.');
    await refresh();
    onConnected();
  };

  const cancelConnect = async () => {
    setPhase('idle');
    setPending(null);
    setError('');
    await dispatch({ type: 'CANCEL_CONNECT' });
    await refresh();
  };

  const toggleProject = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{phase === 'selecting' || phase === 'confirming' ? 'Choose projects to watch' : 'Connect your organization'}</CardTitle>
          <CardDescription>
            {phase === 'selecting' || phase === 'confirming'
              ? `Signed in as ${pending?.identity.displayName || ''}. Pick which projects to watch.`
              : 'Azure DevOps Notifier watches pull requests on Azure DevOps Services (dev.azure.com) and notifies you about comments, reviews, checks and more. Azure DevOps Server (on-premises) is not supported.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase !== 'selecting' && phase !== 'confirming' ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="conn-org">Organization</Label>
                <Input
                  id="conn-org"
                  value={org}
                  onChange={(e) => setOrg(e.target.value)}
                  placeholder="e.g. contoso"
                  autoComplete="organization"
                  disabled={phase === 'connecting'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conn-token">Personal Access Token</Label>
                <Input
                  id="conn-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your PAT"
                  autoComplete="off"
                  disabled={phase === 'connecting'}
                />
                <p className="text-xs text-muted-foreground">
                  Create a PAT at dev.azure.com/{'{org}'}/_usersSettings/tokens with scopes: <strong>Code (Read)</strong> to read pull requests, threads, statuses; <strong>Project and Team (Read)</strong> to list projects for scope selection.
                </p>
                <p className="text-xs text-muted-foreground">
                  The token is stored only in this extension's local Chrome storage (not synced, not encrypted by the OS keychain) and is never sent anywhere except dev.azure.com. Set an expiry on the PAT and revoke it when no longer needed.
                </p>
              </div>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <Button onClick={startConnect} disabled={phase === 'connecting' || !org.trim() || !token}>
                {phase === 'connecting' ? 'Connecting…' : 'Connect'}
              </Button>
            </>
          ) : (
            <>
              <div className="grid gap-2 rounded-md border p-3">
                {(pending?.projects || []).map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={(c) => toggleProject(p.id, c === true)}
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={desktopOn} onCheckedChange={(c) => setDesktopOn(c === true)} />
                <span>Show desktop notifications (Chrome will ask for permission)</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Projects are for automatic discovery; you can leave all unchecked and watch PRs manually.
              </p>
              <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                <AlertDescription>
                  Connecting a different organization or account replaces your saved watches and history.
                </AlertDescription>
              </Alert>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <div className="flex gap-2">
                <Button onClick={confirmConnect} disabled={phase === 'confirming'}>
                  {phase === 'confirming' ? 'Starting…' : 'Start watching'}
                </Button>
                <Button variant="ghost" onClick={cancelConnect} disabled={phase === 'confirming'}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
