import { useMemo, useState } from 'react';
import { ArrowUpRight, Eye, EyeOff, Link2, Plus, RotateCcw, SlidersHorizontal, User } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import {
  CATEGORY_KEYS,
  effectiveEventTypes,
  prState,
  type CategoryKey,
  type PublicWatch,
} from '@/src/lib/types';
import { CategoryDots, CategoryTile } from '@/src/components/category';
import { PrStateIcon, PrStatePill } from '@/src/components/pr-state';
import { Segmented } from '@/src/components/segmented';
import { Callout, EmptyState } from '@/src/components/status';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

function WatchRow({
  w,
  index,
  scopedError,
  onPrefs,
  onUnwatch,
}: {
  w: PublicWatch;
  index: number;
  scopedError?: string;
  onPrefs: () => void;
  onUnwatch: () => void;
}) {
  const { state } = useNotifier();
  const pr = prState(w);
  const enabled = effectiveEventTypes(w, state!.settings);
  const onCount = CATEGORY_KEYS.filter((k) => enabled[k]).length;
  return (
    <div className="enter group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-accent/35 sm:flex-row sm:items-center sm:px-5" style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}>
      <div className="flex min-w-0 flex-1 gap-3.5">
        <PrStateIcon state={pr} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            {w.url ? (
              <a
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[15px] font-semibold leading-6 tracking-[-0.005em] text-foreground underline-offset-4 hover:underline"
              >
                {w.title || '(untitled pull request)'}
              </a>
            ) : (
              <span className="truncate text-[15px] font-semibold leading-6">{w.title || '(untitled pull request)'}</span>
            )}
            <span className="mono shrink-0 text-[12.5px] text-subtle">#{w.prId}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground">
            <PrStatePill state={pr} />
            <span className="truncate">{w.repoName} <span className="text-subtle">· {w.projectName}</span></span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4',
                w.origin === 'auto' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.06] text-muted-foreground',
              )}
            >
              {w.origin === 'auto' ? <User className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
              {w.origin === 'auto' ? 'Yours' : 'Added'}
            </span>
            <button
              type="button"
              onClick={onPrefs}
              className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-[12px] text-subtle transition-colors hover:bg-accent hover:text-foreground"
              title="Change activity types"
            >
              <CategoryDots enabled={enabled} />
              {w.eventTypes ? `Custom · ${onCount}/${CATEGORY_KEYS.length}` : 'All defaults'}
            </button>
          </div>
          {scopedError && (
            <Callout tone="error" className="mt-3 py-2 text-[12.5px]">{scopedError}</Callout>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 self-end sm:self-center sm:opacity-70 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button variant="ghost" size="sm" onClick={onPrefs} aria-label={`Activity preferences for pull request ${w.prId}`}>
          <SlidersHorizontal /> <span className="sm:hidden lg:inline">Preferences</span>
        </Button>
        {w.url && (
          <a
            href={w.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'iconSm' })}
            aria-label={`Open pull request ${w.prId} in Azure DevOps`}
            title="Open in Azure DevOps"
          >
            <ArrowUpRight />
          </a>
        )}
        <Button
          variant="ghost"
          size="iconSm"
          onClick={onUnwatch}
          className="hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Stop watching pull request ${w.prId}`}
          title="Stop watching"
        >
          <EyeOff />
        </Button>
      </div>
    </div>
  );
}

function PrefsForm({
  watch,
  onClose,
  onSaved,
}: {
  watch: PublicWatch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { state, dispatch } = useNotifier();
  const [selected, setSelected] = useState<Set<CategoryKey>>(() => {
    const eff = effectiveEventTypes(watch, state!.settings);
    return new Set(CATEGORY_KEYS.filter((k) => eff[k]));
  });
  const [saving, setSaving] = useState(false);

  const toggle = (k: CategoryKey, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(k); else next.delete(k);
      return next;
    });
  };

  const save = async (eventTypes: string[] | null) => {
    setSaving(true);
    try {
      const res = await dispatch({ type: 'UPDATE_WATCH', key: watch.key, eventTypes });
      if (!res?.ok) {
        toast.error(res?.error || 'Save failed.');
        return;
      }
      toast.success(eventTypes === null ? 'Now following your global defaults.' : 'Watch preferences saved.');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const allOn = selected.size === CATEGORY_KEYS.length;

  return (
    <>
      <DialogHeader className="space-y-3">
        <div className="flex items-start gap-3 pr-6">
          <PrStateIcon state={prState(watch)} />
          <div className="min-w-0">
            <DialogTitle className="text-[17px] leading-snug tracking-[-0.01em]">{watch.title || `Pull request #${watch.prId}`}</DialogTitle>
            <div className="mt-0.5 text-[13px] text-muted-foreground"><span className="mono">#{watch.prId}</span> · {watch.repoName} · {watch.projectName}</div>
          </div>
        </div>
        <DialogDescription>
          Pick the activity that should notify you for this pull request. {watch.eventTypes ? 'This watch has custom preferences.' : 'It currently follows your global defaults.'}
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center justify-between">
        <span className="tabular text-[12.5px] text-subtle">{selected.size} of {CATEGORY_KEYS.length} selected</span>
        <button
          type="button"
          className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => setSelected(allOn ? new Set() : new Set(CATEGORY_KEYS))}
        >
          {allOn ? 'Select none' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CATEGORY_KEYS.map((k) => (
          <CategoryTile key={k} category={k} checked={selected.has(k)} onChange={(c) => toggle(k, c)} />
        ))}
      </div>
      <DialogFooter className="mt-1 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
        <Button variant="ghost" onClick={() => save(null)} disabled={saving || !watch.eventTypes} className="sm:-ml-2">
          <RotateCcw /> Use global defaults
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1 sm:flex-none">Cancel</Button>
          <Button onClick={() => save([...selected])} disabled={saving} className="flex-1 sm:flex-none">{saving ? 'Saving…' : 'Save preferences'}</Button>
        </div>
      </DialogFooter>
    </>
  );
}

function PrefsDialog({
  watch,
  open,
  onOpenChange,
  onSaved,
}: {
  watch: PublicWatch | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px]">
        {watch && open && (
          <PrefsForm
            key={watch.key}
            watch={watch}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WatchingView() {
  const { state, dispatch, refresh } = useNotifier();
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<'all' | 'auto' | 'manual'>('all');
  const [prefsWatch, setPrefsWatch] = useState<PublicWatch | null>(null);
  const [unwatchTarget, setUnwatchTarget] = useState<PublicWatch | null>(null);

  const watches = useMemo(() => state?.watches || [], [state?.watches]);
  const itemErrors = state?.errors?.items || {};
  const mine = watches.filter((w) => w.origin === 'auto').length;
  const shown = filter === 'all' ? watches : watches.filter((w) => (filter === 'auto' ? w.origin === 'auto' : w.origin !== 'auto'));

  const addWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const res = await dispatch({ type: 'WATCH_PR', url: url.trim() });
      if (!res?.ok) {
        setFormError(res?.error || 'Could not watch that pull request.');
        return;
      }
      setUrl('');
      toast.success(res.existed ? 'Already watching that pull request.' : 'Now watching that pull request.');
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const confirmUnwatch = async () => {
    if (!unwatchTarget) return;
    const res = await dispatch({ type: 'UNWATCH_PR', key: unwatchTarget.key });
    setUnwatchTarget(null);
    if (!res?.ok) {
      toast.error(res?.error || 'Could not unwatch.');
      return;
    }
    toast.success('Stopped watching. History stays in your inbox.');
    await refresh();
  };

  return (
    <div className="page">
      <div>
        <div className="eyebrow">Following</div>
        <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.025em] sm:text-[34px]">Watching</h1>
        <p className="mt-2.5 text-[14.5px] text-muted-foreground">
          <span className="font-semibold text-foreground">{watches.length} pull request{watches.length === 1 ? '' : 's'}</span>
          <span className="text-subtle"> · {mine} yours, {watches.length - mine} added by link</span>
        </p>
      </div>

      <form onSubmit={addWatch} className="surface mt-7 p-4 sm:p-5">
        <label htmlFor="watch-url" className="text-[14px] font-semibold">Watch any pull request</label>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Paste a link from Azure DevOps. You will get the same alerts as for your own PRs.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              id="watch-url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setFormError(''); }}
              placeholder="https://dev.azure.com/org/project/_git/repo/pullrequest/123"
              className="mono h-11 pl-9 text-[13px]"
              disabled={submitting}
              aria-invalid={Boolean(formError)}
            />
          </div>
          <Button type="submit" size="lg" disabled={submitting || !url.trim()} className="sm:w-32">
            <Plus /> {submitting ? 'Adding…' : 'Watch'}
          </Button>
        </div>
        {formError && <Callout tone="error" className="mt-3">{formError}</Callout>}
      </form>

      {watches.length > 0 && (
        <div className="mt-8 flex items-center justify-between gap-3">
          <Segmented
            label="Filter watches"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: watches.length },
              { value: 'auto', label: 'Yours', count: mine },
              { value: 'manual', label: 'Added', count: watches.length - mine },
            ]}
          />
        </div>
      )}

      {shown.length > 0 && (
        <div className="surface hairline mt-3 overflow-hidden">
          {shown.map((w, i) => (
            <WatchRow
              key={w.key}
              w={w}
              index={i}
              scopedError={itemErrors[w.key]}
              onPrefs={() => setPrefsWatch(w)}
              onUnwatch={() => setUnwatchTarget(w)}
            />
          ))}
        </div>
      )}

      {watches.length === 0 && (
        <EmptyState icon={<Eye className="h-7 w-7" />} title="Nothing watched yet" className="mt-4">
          Turn on automatic watching in Settings, or paste a pull request link above to start following it.
        </EmptyState>
      )}
      {watches.length > 0 && shown.length === 0 && (
        <EmptyState icon={<Eye className="h-7 w-7" />} title={filter === 'auto' ? 'None of your own PRs yet' : 'No pull requests added by link'} className="mt-4">
          {filter === 'auto' ? 'Pull requests you create in selected projects appear here automatically.' : 'Paste a pull request link above to follow it.'}
        </EmptyState>
      )}

      <PrefsDialog
        watch={prefsWatch}
        open={prefsWatch !== null}
        onOpenChange={(o) => { if (!o) setPrefsWatch(null); }}
        onSaved={() => refresh()}
      />

      <AlertDialog open={unwatchTarget !== null} onOpenChange={(o) => { if (!o) setUnwatchTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop watching #{unwatchTarget?.prId}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will stop receiving notifications for “{unwatchTarget?.title || 'this pull request'}”. Its history stays in your inbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep watching</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnwatch} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Stop watching</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
