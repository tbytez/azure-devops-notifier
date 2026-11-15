import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getBridge, isDemoMode, dispatch as rawDispatch } from './bridge';
import type { Bridge, BridgeResponse, PublicState } from './types';

interface StoreValue {
  bridge: Bridge | null;
  state: PublicState | null;
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  demo: boolean;
  refresh: () => Promise<void>;
  dispatch: (msg: Record<string, unknown>) => Promise<BridgeResponse>;
}

const StoreContext = createContext<StoreValue | null>(null);

const GENERIC_ERROR = 'Could not complete the action. Try again.';

export function NotifierProvider({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [state, setState] = useState<PublicState | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const softTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const demo = isDemoMode();

  const refresh = useCallback(async () => {
    try {
      const res = await rawDispatch({ type: 'GET_STATE' });
      if (!res?.ok || !res.state) {
        setError(res?.error || 'Could not load state.');
        return;
      }
      setState(res.state);
      setError(null);
    } catch (e) {
      setError((e as Error)?.message || 'Could not load state.');
    } finally {
      setLoading(false);
    }
  }, []);

  const dispatch = useCallback(async (msg: Record<string, unknown>): Promise<BridgeResponse> => {
    try {
      return await rawDispatch(msg);
    } catch {
      return { ok: false, error: GENERIC_ERROR };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await getBridge();
        if (cancelled) return;
        setBridge(b);
        if (b.kind === 'unavailable') {
          setUnavailable(true);
          setLoading(false);
          return;
        }
        await refresh();
      } catch (e) {
        if (cancelled) return;
        setError((e as Error)?.message || 'Could not initialize.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    if (!bridge || bridge.kind === 'unavailable') return;
    const schedule = () => {
      if (softTimer.current) clearTimeout(softTimer.current);
      softTimer.current = setTimeout(() => {
        softTimer.current = null;
        refresh().catch(() => {});
      }, 400);
    };
    window.addEventListener('focus', schedule);
    let removeStorageListener: (() => void) | null = null;
    if (bridge.kind === 'extension') {
      const chromeApi = globalThis.chrome;
      const listener = (changes: unknown, area: string) => {
        if (area !== 'local') return;
        const c = changes as Record<string, unknown> | null;
        if (!c || !('azdoNotifier.v1' in c)) return;
        schedule();
      };
      chromeApi?.storage?.onChanged?.addListener?.(listener);
      removeStorageListener = () => chromeApi?.storage?.onChanged?.removeListener?.(listener);
    }
    return () => {
      window.removeEventListener('focus', schedule);
      removeStorageListener?.();
      if (softTimer.current) clearTimeout(softTimer.current);
    };
  }, [bridge, refresh]);

  const value = useMemo<StoreValue>(() => ({
    bridge,
    state,
    loading,
    unavailable,
    error,
    demo,
    refresh,
    dispatch,
  }), [bridge, state, loading, unavailable, error, demo, refresh, dispatch]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useNotifier(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useNotifier must be used inside NotifierProvider');
  return ctx;
}
