import { describe, expect, it } from 'vitest';

import { rankMembers } from './rank.js';

describe('rankMembers', () => {
  it('uses value, quantity, join time, then user id without mutating the input', () => {
    const rows = [
      { userId: 'd', value: 10, qty: 2, joinedAt: 20, name: 'D' },
      { userId: 'c', value: 10, qty: 3, joinedAt: 20, name: 'C' },
      { userId: 'b', value: 10, qty: 3, joinedAt: 10, name: 'B' },
      { userId: 'a', value: 10, qty: 3, joinedAt: 10, name: 'A' },
      { userId: 'e', value: 9, qty: 100, joinedAt: 1, name: 'E' },
    ];

    expect(rankMembers(rows).map(({ userId, rank }) => ({ userId, rank }))).toEqual([
      { userId: 'a', rank: 1 },
      { userId: 'b', rank: 2 },
      { userId: 'c', rank: 3 },
      { userId: 'd', rank: 4 },
      { userId: 'e', rank: 5 },
    ]);
    expect(rows.map((row) => row.userId)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });
});
