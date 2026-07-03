import { describe, expect, it } from 'vitest';
import { localDayKey, startOfDay } from '../lib/srs';

describe('startOfDay', () => {
  it('returns local midnight for a mid-day timestamp', () => {
    const t = new Date('2026-07-03T14:22:33').getTime();
    expect(startOfDay(t)).toBe(new Date('2026-07-03T00:00:00').getTime());
  });
});

describe('localDayKey', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    const t = new Date('2026-07-03T14:22:33').getTime();
    expect(localDayKey(t)).toBe('2026-07-03');
  });

  it('zero-pads month and day', () => {
    const t = new Date('2026-01-05T09:00:00').getTime();
    expect(localDayKey(t)).toBe('2026-01-05');
  });

  it('uses the local day, matching startOfDay', () => {
    const t = new Date('2026-07-03T23:59:59').getTime();
    expect(localDayKey(t)).toBe(localDayKey(startOfDay(t)));
  });
});
