export type CeremonyStatus = 'not_started' | 'running' | 'ended';

export interface CeremonyState {
  status: CeremonyStatus;
  cardIndex: number;
  subStep: number;
  held: boolean;
  updatedAt: number;
}

export interface ReplayEvent {
  tOffsetMs: number;
  memberIndex: number;
  lat: number | null;
  lng: number | null;
  std: number;
}

export interface ReplayPayload {
  schemaVersion: 1;
  memberIndex: string[];
  totalPlaybackMs: number;
  events: ReplayEvent[];
  dayEndMarkers: Array<{
    tOffsetMs: number;
    tripDay: number;
    nightMvpIndex: number;
  }>;
  achievementPops: Array<{
    tOffsetMs: number;
    memberIndex: number;
    key: string;
  }>;
}

export interface WrappedCard {
  id: string;
  key?: string;
  vars?: Record<string, string | number | null>;
  data?: Record<string, unknown>;
  winners?: Array<{
    award: string;
    winners: Array<{ userId: string; venue?: string }>;
    isGhostSlot: boolean;
  }>;
}

export interface SquadWrappedPayload {
  schemaVersion: 1;
  tripId: string;
  cards: WrappedCard[];
}

export type CeremonyAction = 'next' | 'back' | 'hold';

export function bigScreenTripId(location: Pick<Location, 'pathname' | 'search'>): string | null {
  const match = /^\/t\/([^/]+)\/ceremony\/?$/.exec(location.pathname);
  if (!match || new URLSearchParams(location.search).get('display') !== 'big') return null;
  return decodeURIComponent(match[1]!);
}

export function actionForKey(key: string): CeremonyAction | null {
  if (key === 'ArrowLeft') return 'back';
  if (key === 'ArrowRight' || key === ' ' || key === 'Spacebar') return 'next';
  if (key.toLowerCase() === 'h') return 'hold';
  return null;
}

export function clampReplayProgress(elapsedMs: number, totalPlaybackMs: number): number {
  if (totalPlaybackMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / totalPlaybackMs));
}

export function replayAtProgress(replay: ReplayPayload, progress: number) {
  const elapsedMs = Math.max(0, replay.totalPlaybackMs * Math.min(1, progress));
  return {
    elapsedMs,
    events: replay.events.filter((event) => event.tOffsetMs <= elapsedMs),
    dayEndMarkers: replay.dayEndMarkers.filter((marker) => marker.tOffsetMs <= elapsedMs),
    achievementPops: replay.achievementPops.filter((pop) => pop.tOffsetMs <= elapsedMs),
  };
}

export function replayFromCard(card: WrappedCard | undefined): ReplayPayload | null {
  if (card?.id !== '06_replay') return null;
  const replay = card.data?.replay;
  if (!replay || typeof replay !== 'object') return null;
  return replay as ReplayPayload;
}

export const CARD_TITLES: Record<string, string> = {
  '01_group_total': 'The damage',
  '02_drunk_o_meter': 'Drunk-o-meter',
  '03_keg': 'One trip. One keg.',
  '04_cities_venues': 'Where it happened',
  '05_crowd_then_divisive': 'The people have spoken',
  '06_replay': 'Replay the trip',
  '07_side_boards': 'The side quests',
  '08_predictions': 'The oracle',
  '09_awards': 'Awards night',
  '10_main_board': 'Final standings',
  '11_credits': 'The credits',
};

export function cardTitle(card: WrappedCard | undefined): string {
  return card ? (CARD_TITLES[card.id] ?? card.id.replaceAll('_', ' ')) : 'Ceremony';
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number')
    return new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
  if (typeof value === 'string') return value.replaceAll('_', ' ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return JSON.stringify(value) ?? '—';
}
