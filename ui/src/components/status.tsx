import { AlertTriangle, Info, OctagonAlert } from 'lucide-react';

import type { PublicState } from '@/src/lib/types';
import { timeAgo } from '@/src/lib/types';
import { cn } from '@/lib/utils';

export type LiveState = 'live' | 'paused' | 'error';

export function liveState(state: PublicState | null | undefined): LiveState {
  if (!state) return 'paused';
  if (state.errors?.global) return 'error';
  if (state.settings.paused) return 'paused';
  return 'live';
}

export function liveLabel(state: PublicState | null | undefined): string {
  const s = liveState(state);
  if (s === 'paused') return 'Paused';
  if (s === 'error') return 'Needs attention';
  return state?.lastSyncAt ? `Checked ${timeAgo(state.lastSyncAt)}` : 'Waiting for first check';
}

export function LiveDot({ state }: { state: LiveState }) {
  return <span className="live-dot" data-state={state} aria-hidden />;
}

export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: 'info' | 'warning' | 'error';
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? OctagonAlert : tone === 'warning' ? AlertTriangle : Info;
  const color = tone === 'error' ? '--destructive' : tone === 'warning' ? '--warning' : '--primary';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13.5px]', className)}
      style={{ background: `hsl(var(${color}) / 0.07)`, borderColor: `hsl(var(${color}) / 0.25)` }}
    >
      <span className="mt-[1px] shrink-0" style={{ color: `hsl(var(${color}))` }}>
        {icon ?? <Icon className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1 leading-5">
        {title && <div className="font-semibold text-foreground">{title}</div>}
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-[-14px] rounded-full border border-dashed border-border-strong/70" />
        <span className="absolute inset-0 rounded-2xl bg-surface shadow-md ring-1 ring-border" />
        <span className="relative text-primary">{icon}</span>
      </div>
      <p className="text-[16px] font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[14px] leading-relaxed text-muted-foreground">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
