import { getBridge as getRawBridge, isDemoMode as isDemo } from '../../../src/ui/bridge.js';
import type { Bridge, BridgeResponse } from './types';

let cached: Promise<Bridge> | null = null;

export function getBridge(): Promise<Bridge> {
  if (!cached) {
    cached = getRawBridge() as Promise<Bridge>;
  }
  return cached;
}

export function isDemoMode(): boolean {
  return isDemo();
}

export async function dispatch(msg: Record<string, unknown>): Promise<BridgeResponse> {
  const bridge = await getBridge();
  return bridge.dispatch(msg);
}
