import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, type LucideIcon } from 'lucide-react';

import { PR_STATE_LABEL, type PrState } from '@/src/lib/types';
import { cn } from '@/lib/utils';

const ICONS: Record<PrState, LucideIcon> = {
  active: GitPullRequest,
  draft: GitPullRequestDraft,
  completed: GitMerge,
  abandoned: GitPullRequestClosed,
  unknown: GitPullRequest,
};

const TONE: Record<PrState, string> = {
  active: '--pr-active',
  draft: '--pr-draft',
  completed: '--pr-completed',
  abandoned: '--pr-abandoned',
  unknown: '--pr-draft',
};

export function PrStateIcon({ state, className }: { state: PrState; className?: string }) {
  const Icon = ICONS[state];
  const tone = TONE[state];
  return (
    <span
      className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', className)}
      style={{ background: `hsl(var(${tone}) / 0.12)`, color: `hsl(var(${tone}))` }}
      aria-hidden
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
    </span>
  );
}

export function PrStatePill({ state, className }: { state: PrState; className?: string }) {
  const tone = TONE[state];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4', className)}
      style={{ background: `hsl(var(${tone}) / 0.12)`, color: `hsl(var(${tone}))` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: `hsl(var(${tone}))` }} />
      {PR_STATE_LABEL[state]}
    </span>
  );
}
