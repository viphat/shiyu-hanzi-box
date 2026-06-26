import { compareTimestamps } from './clock';
import type { HybridTimestamp, Register } from './types';

export function mergeRegister<T>(
  a: Register<T> | undefined,
  b: Register<T> | undefined,
): Register<T> {
  if (!a) return b as Register<T>;
  if (!b) return a;
  return compareTimestamps(a.stamp, b.stamp) >= 0 ? a : b;
}

export function mergeRegisterMap(
  a: Record<string, Register<unknown>>,
  b: Record<string, Register<unknown>>,
): Record<string, Register<unknown>> {
  const out: Record<string, Register<unknown>> = { ...a };
  for (const key of Object.keys(b)) {
    out[key] = mergeRegister(out[key], b[key]);
  }
  return out;
}

export function mergeStampMap(
  a: Record<string, HybridTimestamp>,
  b: Record<string, HybridTimestamp>,
): Record<string, HybridTimestamp> {
  const out: Record<string, HybridTimestamp> = { ...a };
  for (const key of Object.keys(b)) {
    const existing = out[key];
    out[key] = !existing || compareTimestamps(b[key], existing) > 0 ? b[key] : existing;
  }
  return out;
}

export function isSuppressed(
  stamp: HybridTimestamp | undefined,
  tombstone: HybridTimestamp | undefined,
): boolean {
  if (!tombstone || !stamp) return false;
  return compareTimestamps(tombstone, stamp) >= 0;
}
