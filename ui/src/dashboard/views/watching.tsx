import { useState } from 'react';
import { ExternalLink, Settings2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

import { useNotifier } from '@/src/lib/store';
import {
  CATEGORY_KEYS,
  CATEGORY_META,
  effectiveEventTypes,
  prStatusLabel,
  type CategoryKey,
  type PublicWatch,
} from '@/src/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

function WatchCard({
  w,
  scopedError,
  onPrefs,
  onUnwatch,
}: {
  w: PublicWatch;
  scopedError?: string;
  onPrefs: () => void;
  onUnwatch: () => void;
}) {
  const status = prStatusLabel(w);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">#{w.prId}</span>
            {w.url ? (
              <a
                href={w.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm font-medium text-primary hover:underline"
              >
                {w.title || '(untitled pull request)'}
              </a>
            ) : (
              <span className="truncate text-sm font-medium">{w.title || '(untitled pull request)'}</span>
            )}
            {w.url && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{w.repoName} · {w.projectName}</span>
            {status && <Badge variant="outline">{status}</Badge>}
            <Badge variant={w.origin === 'auto' ? 'default' : 'secondary'} className="text-[10px]">
              {w.origin === 'auto' ? 'Yours' : 'Manual'}
            </Badge>
            {w.eventTypes && <Badge variant="outline" className="text-[10px]">Custom activity</Badge>}
          </div>
          {scopedError && (
            <Alert variant="destructive" className="mt-2 py-2">
              <AlertDescription className="text-xs">{scopedError}</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="flex shrink-0 gap-1 max-sm:w-full max-sm:justify-end">
          <Button variant="ghost" size="sm" onClick={onPrefs}>
            <Settings2 className="mr-1 h-3.5 w-3.5" /> Preferences
          </Button>
          <Button variant="ghost" size="sm" onClick={onUnwatch}>
            Unwatch
          </Button>
        </div>
      </CardContent>
    </Card>
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
      toast.success('Watch preferences saved.');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Activity for #{watch.prId}</DialogTitle>
        <DialogDescription>
          Choose which activity types notify you for this pull request. Unchecked categories are ignored for this watch only.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2 py-2">
        {CATEGORY_KEYS.map((k) => {
          const meta = CATEGORY_META[k];
          return (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(k)}
                onCheckedChange={(c) => toggle(k, c === true)}
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
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="outline" onClick={() => save(null)} disabled={saving}>Use global settings</Button>
        <Button onClick={() => save([...selected])} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
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
      <DialogContent>
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
  const [prefsWatch, setPrefsWatch] = useState<PublicWatch | null>(null);
  const [unwatchTarget, setUnwatchTarget] = useState<PublicWatch | null>(null);

  const watches = state?.watches || [];
  const itemErrors = state?.errors?.items || {};

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
    await refresh();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pull requests you follow: yours automatically, plus any you add manually.
      </p>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={addWatch} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}"
              aria-label="Pull request URL"
              className="font-mono text-sm"
              disabled={submitting}
            />
            <Button type="submit" disabled={submitting || !url.trim()} className="sm:w-28">
              {submitting ? 'Adding…' : 'Watch'}
            </Button>
          </form>
          {formError && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {watches.map((w) => (
          <WatchCard
            key={w.key}
            w={w}
            scopedError={itemErrors[w.key]}
            onPrefs={() => setPrefsWatch(w)}
            onUnwatch={() => setUnwatchTarget(w)}
          />
        ))}
        {watches.length === 0 && (
          <Card>
            <CardContent className="p-10 text-center">
              <p className="font-medium">Nothing watched yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Enable auto-watch in Settings or paste a pull request URL above.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <PrefsDialog
        watch={prefsWatch}
        open={prefsWatch !== null}
        onOpenChange={(o) => { if (!o) setPrefsWatch(null); }}
        onSaved={() => refresh()}
      />

      <AlertDialog open={unwatchTarget !== null} onOpenChange={(o) => { if (!o) setUnwatchTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop watching PR #{unwatchTarget?.prId}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will stop receiving notifications for this pull request. Its history stays in your inbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnwatch}>Unwatch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
