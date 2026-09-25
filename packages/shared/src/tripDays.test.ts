import { describe, expect, it } from 'vitest';

import { dayIndex, dayLabel, tripLengthDays } from './tripDays.js';

describe('trip day helpers', () => {
  it('uses an inclusive trip length and a 06:00 local boundary', () => {
    expect(tripLengthDays('2026-09-25', '2026-10-02')).toBe(8);
    expect(dayIndex(Date.parse('2026-09-26T05:59:59Z'), '2026-09-25', 'UTC')).toBe(1);
    expect(dayIndex(Date.parse('2026-09-26T06:00:00Z'), '2026-09-25', 'UTC')).toBe(2);
    expect(
      dayLabel(
        Date.parse('2026-09-26T02:00:00Z'),
        Date.parse('2026-09-26T03:00:00Z'),
        '2026-09-25',
        'UTC',
      ),
    ).toBe('Tonight');
  });

  it('keeps both repeated fall-back hours in the same trip night', () => {
    const firstOneThirty = Date.parse('2026-11-01T05:30:00Z');
    const secondOneThirty = Date.parse('2026-11-01T06:30:00Z');

    expect(dayIndex(firstOneThirty, '2026-10-31', 'America/New_York')).toBe(1);
    expect(dayIndex(secondOneThirty, '2026-10-31', 'America/New_York')).toBe(1);
  });
});
