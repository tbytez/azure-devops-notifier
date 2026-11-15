import {
  CircleCheck,
  GitCommitHorizontal,
  GitPullRequest,
  MessageSquare,
  MessageSquareMore,
  ShieldCheck,
  ThumbsUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { CATEGORY_META, type CategoryKey } from '@/src/lib/types';
import { cn } from '@/lib/utils';

const ICONS: Record<CategoryKey, LucideIcon> = {
  comments: MessageSquare,
  threads: MessageSquareMore,
  reviews: ThumbsUp,
  reviewers: Users,
  commits: GitCommitHorizontal,
  lifecycle: GitPullRequest,
  checks: CircleCheck,
  policies: ShieldCheck,
};

export function CategoryBadge({ category, className }: { category: string; className?: string }) {
  const key = (category in CATEGORY_META ? category : 'comments') as CategoryKey;
  const meta = CATEGORY_META[key];
  const Icon = ICONS[key] ?? MessageSquare;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none text-foreground',
        className,
      )}
      style={{ borderColor: `${meta.color}55`, backgroundColor: `${meta.color}0d` }}
    >
      <Icon className="h-3 w-3" style={{ color: meta.color }} aria-hidden />
      {meta.label}
    </span>
  );
}
