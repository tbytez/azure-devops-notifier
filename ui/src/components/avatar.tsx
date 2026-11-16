import { CATEGORY_META, categoryKey, initials, nameHue } from '@/src/lib/types';
import { cn } from '@/lib/utils';
import { CATEGORY_ICONS, CategoryIcon } from './category';

export function Avatar({ name, size = 36, className }: { name: string | null | undefined; size?: number; className?: string }) {
  return (
    <span
      className={cn('avatar inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        ['--av-h' as string]: nameHue(name),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function ActorAvatar({ name, category, size = 38 }: { name: string | null | undefined; category: string; size?: number }) {
  if (!name) {
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <CategoryIcon category={category} size="lg" className="!h-full !w-full !rounded-full" />
      </span>
    );
  }
  const key = categoryKey(category);
  const Icon = CATEGORY_ICONS[key];
  const badge = Math.max(16, Math.round(size * 0.44));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Avatar name={name} size={size} />
      <span
        className="avatar-badge absolute flex items-center justify-center rounded-full"
        style={{ width: badge, height: badge, right: -3, bottom: -3, background: CATEGORY_META[key].color }}
        aria-hidden
      >
        <Icon style={{ width: badge * 0.56, height: badge * 0.56 }} strokeWidth={2.6} />
      </span>
    </span>
  );
}
