import { useState } from 'react';
import { ArrowLeft, ArrowRight, BellRing, Check, ChevronDown, Eye, FolderGit2, KeyRound, Lock, SlidersHorizontal } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import { isDemoMode } from '@/src/lib/bridge';
import { canRequestDesktopPermission, requestDesktopPermission } from '@/src/lib/notifications';
import { ActorAvatar } from '@/src/components/avatar';
import { Callout } from '@/src/components/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import type { PublicProject } from '@/src/lib/types';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'connecting' | 'selecting' | 'confirming';

const PREVIEW = [
  { name: 'Priya Natarajan', category: 'comments', title: 'New comment', body: 'Can we add a fallback for guests?', pr: '#101 Add sign-in with Microsoft', time: '2m' },
  { name: 'Marcus Webb', category: 'reviews', title: 'Approved', body: 'Looks great, ship it.', pr: '#203 Rate limit the public endpoint', time: '9m' },
  { name: null, category: 'checks', title: 'Build succeeded', body: 'pr-checks/build passed in 4m 12s', pr: '#203 Rate limit the public endpoint', time: '14m' },
];

function NotificationPreview() {
  return (
    <div className="relative mt-10 hidden h-[272px] select-none sm:block" aria-hidden>
      {PREVIEW.map((n, i) => (
        <div
          key={n.title}
          className="absolute flex w-[min(380px,92%)] gap-3 rounded-2xl border bg-surface/95 p-3.5 shadow-lg backdrop-blur [--avatar-ring:hsl(var(--surface))]"
          style={{
            top: i * 88,
            left: i === 1 ? 40 : i === 2 ? 12 : 0,
            zIndex: 3 - i,
            opacity: 1 - i * 0.1,
            animation: `${i % 2 ? 'float-b' : 'float-a'} ${6 + i}s ease-in-out ${i * 0.6}s infinite`,
          }}
        >
          <ActorAvatar name={n.name} category={n.category} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[14px] font-semibold">{n.title}</span>
              {n.name && <span className="truncate text-[12.5px] text-muted-foreground">· {n.name}</span>}
              <span className="ml-auto text-[11.5px] text-subtle">{n.time}</span>
            </div>
            <div className="truncate text-[13px] text-foreground/80">{n.body}</div>
            <div className="mt-0.5 truncate text-[12px] text-subtle">{n.pr}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  const items = ['Connect', 'Choose projects'];
  return (
    <ol className="flex items-center gap-2 text-[12.5px] font-medium" aria-label="Setup progress">
      {items.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
            {i > 0 && <span className={cn('h-px w-6', done || current ? 'bg-primary/50' : 'bg-border')} />}
            <span
              className={cn(
                'flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11.5px] font-semibold transition-colors',
                done ? 'bg-primary text-primary-foreground' : current ? 'bg-primary/[0.12] text-primary ring-1 ring-primary/40' : 'bg-foreground/[0.06] text-subtle',
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
            </span>
            <span className={current ? 'text-foreground' : 'text-subtle'}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ConnectView({ onConnected }: { onConnected: () => void }) {
  const { state, dispatch, refresh } = useNotifier();
  const [phase, setPhase] = useState<Phase>('idle');
  const [org, setOrg] = useState(state?.settings.organization || '');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ identity: { id: string; displayName: string }; projects: PublicProject[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [desktopOn, setDesktopOn] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const startConnect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!org.trim() || !token) return;
    setError('');
    setPhase('connecting');
    let res;
    try {
      res = await dispatch({ type: 'CONNECT', organization: org, token });
    } catch (err) {
      res = { ok: false, error: (err as Error)?.message || 'Connection failed.' };
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

  const choosing = phase === 'selecting' || phase === 'confirming';
  const projects = pending?.projects || [];
  const allSelected = projects.length > 0 && selected.size === projects.length;

  return (
    <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-4 py-10 sm:px-6 lg:min-h-[calc(100vh-180px)] lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-14">
      <div className="max-lg:text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[12.5px] font-semibold text-primary ring-1 ring-inset ring-primary/20">
          <BellRing className="h-3.5 w-3.5" /> For Azure DevOps Services
        </span>
        <h1 className="mt-5 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">
          Pull request activity,{' '}
          <span className="text-primary">the moment it happens.</span>
        </h1>
        <p className="mt-4 max-w-[460px] text-[16px] leading-relaxed text-muted-foreground max-lg:mx-auto">
          Get notified about comments, reviews, pushes and checks on your pull requests, or any PR you choose to follow.
        </p>
        <NotificationPreview />
        <ul className="mt-8 grid gap-4 text-left sm:grid-cols-3 lg:max-w-[540px]">
          {[
            { icon: Eye, title: 'Auto-follow', text: 'Your PRs and review requests' },
            { icon: SlidersHorizontal, title: 'Only what matters', text: 'Pick activity per PR' },
            { icon: Lock, title: 'Private', text: 'No servers or telemetry' },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-primary shadow-sm ring-1 ring-border">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold leading-5">{title}</span>
                <span className="block text-[12.5px] leading-4 text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="surface w-full p-6 shadow-lg sm:p-8">
        <Steps step={choosing ? 2 : 1} />

        {!choosing ? (
          <form onSubmit={startConnect} className="mt-6">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Connect your organization</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">Use a read-only Personal Access Token. It takes about a minute.</p>

            <div className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="conn-org" className="text-[13.5px]">Organization</Label>
                <div className="flex h-11 items-center overflow-hidden rounded-lg border border-input bg-surface shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/0.16)] hover:border-border-strong">
                  <span className="mono select-none border-r border-border/80 bg-sunken/60 px-3 text-[13px] leading-[42px] text-subtle">dev.azure.com/</span>
                  <input
                    id="conn-org"
                    value={org}
                    onChange={(e) => setOrg(e.target.value)}
                    placeholder="contoso"
                    autoComplete="organization"
                    spellCheck={false}
                    disabled={phase === 'connecting'}
                    className="mono h-full min-w-0 flex-1 bg-transparent px-3 text-[14px] outline-none placeholder:text-subtle disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="conn-token" className="text-[13.5px]">Personal Access Token</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                  <Input
                    id="conn-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste your token"
                    autoComplete="off"
                    disabled={phase === 'connecting'}
                    className="h-11 pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border bg-sunken/50">
              <button
                type="button"
                onClick={() => setHelpOpen((o) => !o)}
                aria-expanded={helpOpen}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13.5px] font-medium"
              >
                How to create a token
                <ChevronDown className={cn('h-4 w-4 text-subtle transition-transform duration-200', helpOpen && 'rotate-180')} />
              </button>
              <div className="expand" data-open={helpOpen}>
                <div className="expand-inner">
                  <ol className="list-decimal space-y-1.5 px-3.5 pb-3.5 pl-8 text-[13px] leading-relaxed text-muted-foreground">
                    <li>Open <span className="mono text-[12px] text-foreground">dev.azure.com/{org.trim() || '{org}'}/_usersSettings/tokens</span></li>
                    <li>Select <span className="font-medium text-foreground">New Token</span> and set an expiry.</li>
                    <li>
                      Grant only these scopes:
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="rounded-md bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground ring-1 ring-border">Code · Read</span>
                        <span className="rounded-md bg-surface px-2 py-0.5 text-[12px] font-medium text-foreground ring-1 ring-border">Project and Team · Read</span>
                      </span>
                    </li>
                  </ol>
                </div>
              </div>
            </div>

            {error && <Callout tone="error" className="mt-4">{error}</Callout>}

            <Button type="submit" size="lg" className="mt-6 w-full" disabled={phase === 'connecting' || !org.trim() || !token}>
              {phase === 'connecting' ? 'Connecting…' : <>Continue <ArrowRight /></>}
            </Button>
            <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-subtle">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Your token is stored only in this browser’s local extension storage and is sent only to dev.azure.com. Revoke it any time.
            </p>
          </form>
        ) : (
          <div className="mt-6">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Choose projects</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{pending?.identity.displayName}</span>. PRs you create or are asked to review in these projects are followed automatically.
            </p>

            <div className="mt-5 overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between border-b bg-sunken/50 px-3.5 py-2">
                <span className="tabular text-[12.5px] text-muted-foreground">{selected.size} of {projects.length} selected</span>
                <button
                  type="button"
                  className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(projects.map((p) => p.id)))}
                >
                  {allSelected ? 'Select none' : 'Select all'}
                </button>
              </div>
              <div className="hairline max-h-[240px] overflow-y-auto">
                {projects.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent/40">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={(c) => toggleProject(p.id, c === true)} />
                    <FolderGit2 className="h-4 w-4 text-subtle" />
                    <span className="text-[14px] font-medium">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="mt-2 text-[12.5px] text-subtle">You can leave all unchecked and follow PRs by link instead.</p>

            <label htmlFor="conn-desktop" className="mt-5 flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-surface px-3.5 py-3">
              <span>
                <span className="block text-[14px] font-medium">Desktop notifications</span>
                <span className="block text-[12.5px] text-muted-foreground">Chrome will ask for permission</span>
              </span>
              <Switch id="conn-desktop" checked={desktopOn} onCheckedChange={setDesktopOn} />
            </label>

            <Callout tone="warning" className="mt-4">
              Connecting a different organization or account replaces your saved watches and history.
            </Callout>
            {error && <Callout tone="error" className="mt-3">{error}</Callout>}

            <div className="mt-6 flex gap-2">
              <Button variant="outline" size="lg" onClick={cancelConnect} disabled={phase === 'confirming'}>
                <ArrowLeft /> Back
              </Button>
              <Button size="lg" className="flex-1" onClick={confirmConnect} disabled={phase === 'confirming'}>
                {phase === 'confirming' ? 'Starting…' : <>Start watching <ArrowRight /></>}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
