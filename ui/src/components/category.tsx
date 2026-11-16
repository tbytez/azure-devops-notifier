import {
  Check,
  CircleCheck,
  GitCommitHorizontal,
  GitPullRequest,
  MessageSquare,
  MessagesSquare,
  ShieldCheck,
  ThumbsUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { CATEGORY_KEYS, CATEGORY_META, categoryKey, tint, type CategoryKey } from '@/src/lib/types';
import { cn } from '@/lib/utils';

export const CATEGORY_ICONS: Record<CategoryKey, LucideIcon> = {
  comments: MessageSquare,
  threads: MessagesSquare,
  reviews: ThumbsUp,
  reviewers: Users,
  commits: GitCommitHorizontal,
  lifecycle: GitPullRequest,
  checks: CircleCheck,
  policies: ShieldCheck,
};

export function CategoryIcon({ category, size = 'md', className }: { category: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const key = categoryKey(category);
  const meta = CATEGORY_META[key];
  const Icon = CATEGORY_ICONS[key];
  const box = size === 'sm' ? 'h-6 w-6 rounded-md' : size === 'lg' ? 'h-10 w-10 rounded-xl' : 'h-8 w-8 rounded-lg';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', box, className)}
      style={{ background: tint(meta.tone, 0.13), color: meta.color, boxShadow: `inset 0 0 0 1px ${tint(meta.tone, 0.18)}` }}
      aria-hidden
    >
      <Icon className={icon} strokeWidth={2.1} />
    </span>
  );
}

export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  const key = categoryKey(category);
  const meta = CATEGORY_META[key];
  const Icon = CATEGORY_ICONS[key];
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4', className)}
      style={{ background: tint(meta.tone, 0.12), color: meta.color }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} aria-hidden />
      {meta.label}
    </span>
  );
}

export function CategoryDot({ category, className }: { category: string; className?: string }) {
  const meta = CATEGORY_META[categoryKey(category)];
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: meta.color }} aria-hidden />;
}

export function CategoryDots({ enabled, className }: { enabled: Record<CategoryKey, boolean>; className?: string }) {
  const on = CATEGORY_KEYS.filter((k) => enabled[k]);
  return (
    <span
      className={cn('inline-flex items-center gap-[3px]', className)}
      role="img"
      aria-label={`Notifies for ${on.length} of ${CATEGORY_KEYS.length} activity types`}
      title={on.length ? on.map((k) => CATEGORY_META[k].plural).join(', ') : 'No activity types'}
    >
      {CATEGORY_KEYS.map((k) => (
        <span
          key={k}
          className="h-[7px] w-[7px] rounded-full"
          style={enabled[k] ? { background: CATEGORY_META[k].color } : { boxShadow: 'inset 0 0 0 1px hsl(var(--border-strong))' }}
        />
      ))}
    </span>
  );
}

export function CategoryTile({
  category,
  checked,
  onChange,
  compact = false,
}: {
  category: CategoryKey;
  checked: boolean;
  onChange: (checked: boolean) => void;
  compact?: boolean;
}) {
  const meta = CATEGORY_META[category];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl border text-left transition-all duration-150',
        compact ? 'p-2.5' : 'p-3',
        checked
          ? 'border-border bg-surface shadow-xs hover:border-border-strong'
          : 'border-dashed border-border-strong/70 bg-transparent hover:border-border-strong hover:bg-surface/60',
      )}
    >
      <span className={cn('transition-[filter,opacity] duration-150', !checked && 'opacity-50 grayscale')}>
        <CategoryIcon category={category} size={compact ? 'sm' : 'md'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14px] font-medium leading-5', !checked && 'text-muted-foreground')}>{meta.plural}</span>
        {!compact && <span className="block truncate text-[12.5px] leading-4 text-muted-foreground">{meta.description}</span>}
      </span>
      <span
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-all duration-150',
          checked ? 'bg-primary text-primary-foreground shadow-xs' : 'text-transparent ring-1 ring-inset ring-border-strong',
        )}
        aria-hidden
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    </button>
  );
}
