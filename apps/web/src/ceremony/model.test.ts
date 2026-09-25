import { describe, expect, it } from 'vitest';

import {
  actionForKey,
  bigScreenTripId,
  clampReplayProgress,
  replayAtProgress,
  replayFromCard,
  type ReplayPayload,
} from './model.js';

describe('big-screen ceremony helpers', () => {
  it('detects only the big-screen ceremony route', () => {
    expect(
      bigScreenTripId({
        pathname: '/t/8c00fb31-635d-48d5-bdeb-3da541938729/ceremony',
        search: '?display=big',
      }),
    ).toBe('8c00fb31-635d-48d5-bdeb-3da541938729');
    expect(bigScreenTripId({ pathname: '/t/trip/ceremony', search: '?display=phone' })).toBeNull();
    expect(bigScreenTripId({ pathname: '/', search: '?display=big' })).toBeNull();
  });

  it('maps presentation keys to ceremony actions', () => {
    expect(actionForKey('ArrowLeft')).toBe('back');
    expect(actionForKey('ArrowRight')).toBe('next');
    expect(actionForKey(' ')).toBe('next');
    expect(actionForKey('H')).toBe('hold');
    expect(actionForKey('Escape')).toBeNull();
  });

  it('clamps replay progress and reveals only elapsed card-six events', () => {
    const replay: ReplayPayload = {
      schemaVersion: 1,
      memberIndex: ['one'],
      totalPlaybackMs: 1_000,
      events: [
        { tOffsetMs: 100, memberIndex: 0, lat: null, lng: null, std: 1 },
        { tOffsetMs: 800, memberIndex: 0, lat: null, lng: null, std: 1 },
      ],
      dayEndMarkers: [{ tOffsetMs: 500, tripDay: 1, nightMvpIndex: 0 }],
      achievementPops: [{ tOffsetMs: 250, memberIndex: 0, key: 'first_blood' }],
    };

    expect(clampReplayProgress(-1, replay.totalPlaybackMs)).toBe(0);
    expect(clampReplayProgress(2_000, replay.totalPlaybackMs)).toBe(1);
    expect(replayAtProgress(replay, 0.5)).toMatchObject({
      events: [replay.events[0]],
      dayEndMarkers: replay.dayEndMarkers,
      achievementPops: replay.achievementPops,
    });
    expect(replayFromCard({ id: '05_crowd_then_divisive', data: { replay } })).toBeNull();
    expect(replayFromCard({ id: '06_replay', data: { replay } })).toBe(replay);
  });
});
