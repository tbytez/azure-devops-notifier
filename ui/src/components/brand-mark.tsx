import brandMark from '../../../assets/icons/icon-128.png';
import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={brandMark}
      width={28}
      height={28}
      alt=""
      aria-hidden="true"
      className={cn('h-7 w-7 shrink-0', className)}
    />
  );
}
