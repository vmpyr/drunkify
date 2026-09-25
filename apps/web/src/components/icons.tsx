// Generated from packages/content/icons (design handoff). Colour roles follow DESIGN_SPEC §3.5:
// outline = currentColor (coasterInk on coasters), liquid/olive constants, bubbles/ice = surface colour.
import type { ReactElement } from 'react';

export type UiIconName =
  | 'board'
  | 'bolt'
  | 'check'
  | 'clock'
  | 'down'
  | 'gift'
  | 'glass'
  | 'hourglass'
  | 'key'
  | 'list'
  | 'lock'
  | 'more'
  | 'note'
  | 'pct'
  | 'pin'
  | 'play'
  | 'qr'
  | 'repeat'
  | 'share'
  | 'star'
  | 'tv'
  | 'user-plus'
  | 'x';

const UI_ICONS: Record<UiIconName, ReactElement> = {
  'board': <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  'bolt': <><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></>,
  'check': <><path d="M5 12.5l4.5 4.5L19 7"/></>,
  'clock': <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  'down': <><path d="M6 9l6 6 6-6"/></>,
  'gift': <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5"/></>,
  'glass': <><path d="M6 3h12l-1.5 17a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1z"/><path d="M6.6 9h10.8"/></>,
  'hourglass': <><path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/></>,
  'key': <><circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/></>,
  'list': <><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></>,
  'lock': <><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></>,
  'more': <><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></>,
  'note': <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></>,
  'pct': <><path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></>,
  'pin': <><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></>,
  'play': <><path d="M7 4l13 8-13 8z"/></>,
  'qr': <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><path d="M14 14h2.5v2.5M20.5 14v.01M14 20.5h.01M18 18h2.5v2.5h-4"/></>,
  'repeat': <><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></>,
  'share': <><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></>,
  'star': <><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></>,
  'tv': <><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  'user-plus': <><circle cx="9.5" cy="8" r="4"/><path d="M2.5 20.5a7 7 0 0 1 14 0M19 8v6M16 11h6"/></>,
  'x': <><path d="M6 6l12 12M18 6L6 18"/></>,
};

export function Icon({ name, className }: { name: UiIconName; className?: string }) {
  return (
    <svg className={className ? `ic ${className}` : 'ic'} viewBox="0 0 24 24" aria-hidden="true">
      {UI_ICONS[name]}
    </svg>
  );
}

export type DrinkIconName = 'beer' | 'cider' | 'cocktail' | 'other' | 'seltzer' | 'shot' | 'soft' | 'spirit' | 'wine';

const DRINK_ICONS: Record<DrinkIconName, ReactElement> = {
  beer: <><path className="d-lq" d="M16.1 16.6c1.9-1.3 3.6 1.3 5.5 0s3.6 1.3 5.5 0 3.5 1.3 5.1 0L30 39.3a2 2 0 0 1-2 1.7h-8a2 2 0 0 1-2-1.7z"/><circle className="d-bb" cx="21.5" cy="31" r="1.2"/><circle className="d-bb" cx="25.5" cy="25" r="1"/><circle className="d-bb" cx="26" cy="35" r="1"/><path className="d-ln" d="M13.5 8h21l-2.7 31.5A3 3 0 0 1 28.8 42h-9.6a3 3 0 0 1-3-2.5z"/><path className="d-ln" d="M15.6 16.6c1.9-1.3 3.6 1.3 5.5 0s3.6 1.3 5.5 0 3.6 1.3 5.8 0"/></>,
  cider: <><path className="d-lq" d="M24 17.5c-3-2.8-9.6-2.2-10.4 3.8-.9 6.6 2.9 15.7 7.1 15.7 1.6 0 2.2-.9 3.3-.9s1.7.9 3.3.9c4.2 0 8-9.1 7.1-15.7-.8-6-7.4-6.6-10.4-3.8z"/><path className="d-ln" d="M24 15c-3.4-3.2-11.2-2.6-12.1 4.4-1 7.7 3.4 18.6 8.3 18.6 2 0 2.6-1.1 3.8-1.1s1.8 1.1 3.8 1.1c4.9 0 9.3-10.9 8.3-18.6C35.2 12.4 27.4 11.8 24 15z"/><path className="d-ln" d="M24 15c0-3.5 1-6 3.2-7.5"/><path className="d-ln" d="M26.5 10.5c1.8-3.4 5.8-4 7.8-2.2-1.7 2.8-5.3 3.6-7.8 2.2z"/></>,
  cocktail: <><path className="d-lq" d="M13.8 13.5h20.4L24 24z"/><path className="d-ln" d="M9.5 10h29L24 26zM24 26v13M17 41h14"/><path className="d-ln" d="M35 5l-7.5 12"/><circle className="d-olive d-ln-stroke" cx="28.5" cy="14.5" r="2.8"/></>,
  other: <><rect className="d-lq" x="16" y="24" width="16" height="10"/><path className="d-ln" d="M20.5 5h7v7.5c0 2.2 4.5 3.3 4.5 8.5v18a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V21c0-5.2 4.5-6.3 4.5-8.5z"/><path className="d-ln" d="M16 24h16M16 34h16M20.5 9h7"/><path className="d-ln" d="M38 6v8M34 10h8"/></>,
  seltzer: <><rect className="d-lq" x="15" y="20" width="16" height="11"/><path className="d-ln" d="M15 12h16v27a3 3 0 0 1-3 3h-10a3 3 0 0 1-3-3z"/><path className="d-ln" d="M16.5 7h13l1.5 5H15zM15 20h16M15 31h16"/><circle className="d-ln" cx="37.5" cy="14" r="1.8"/><circle className="d-ln" cx="39" cy="22" r="1.3"/><circle className="d-ln" cx="36.5" cy="29" r="1.5"/></>,
  shot: <><path className="d-lq" d="M17.3 21h13.4l-1.2 13H18.5z"/><path className="d-ln" d="M15 15h18l-2.6 27H17.6zM17.9 34h12.2"/><path className="d-ln" d="M18.5 10l-1.5-4M24 9V4.5M29.5 10l1.5-4"/></>,
  soft: <><path className="d-lq" d="M14.6 21h18.8l-1.8 18.6a1.5 1.5 0 0 1-1.5 1.4H17.9a1.5 1.5 0 0 1-1.5-1.4z"/><circle className="d-bb" cx="20.5" cy="33" r="1.3"/><circle className="d-bb" cx="26" cy="27" r="1.1"/><circle className="d-bb" cx="27.5" cy="36" r="1"/><path className="d-ln" d="M12.5 14h23l-2.6 26a3 3 0 0 1-3 2.6H18.1a3 3 0 0 1-3-2.6z"/><path className="d-ln" d="M25 25l7-19h5"/></>,
  spirit: <><path className="d-lq" d="M13.8 26h20.4l-1.1 11.6a2.5 2.5 0 0 1-2.5 2.3H17.4a2.5 2.5 0 0 1-2.5-2.3z"/><path className="d-ln" d="M11.5 15h25l-2.3 23.2a3.5 3.5 0 0 1-3.5 3.3H17.3a3.5 3.5 0 0 1-3.5-3.3z"/><rect className="d-ice d-ln-stroke" x="16.5" y="20" width="8" height="8" rx="1.6" transform="rotate(-12 20.5 24)"/><rect className="d-ice d-ln-stroke" x="24.5" y="22.5" width="7.5" height="7.5" rx="1.6" transform="rotate(10 28 26)"/></>,
  wine: <><path className="d-lq" d="M16.3 15h15.4c-.5 5.6-2.6 9.4-7.7 9.4s-7.2-3.8-7.7-9.4z"/><path className="d-ln" d="M15.5 7h17c.4 10.5-2.2 18-8.5 18s-8.9-7.5-8.5-18z"/><path className="d-ln" d="M24 25v14M17 41h14"/></>,
};

export function DrinkIcon({ category, className }: { category: string; className?: string }) {
  const icon = DRINK_ICONS[category as DrinkIconName] ?? DRINK_ICONS.other;
  return (
    <svg className={className ? `dic ${className}` : 'dic'} viewBox="0 0 48 48" aria-hidden="true">
      {icon}
    </svg>
  );
}
