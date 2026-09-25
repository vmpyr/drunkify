import type { DrinkCategory } from '@drunkify/content';
import { useId } from 'react';

import { DrinkIcon } from './icons.js';

function CoasterFace({ label, category }: { label: string; category: DrinkCategory }) {
  const pathId = useId();
  return (
    <>
      <svg className="ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <path id={pathId} d="M 14,50 A 36,36 0 0,0 86,50" />
        </defs>
        <circle className="c-ring" cx="50" cy="50" r="45" />
        <text className="c-label">
          <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
            {label}
          </textPath>
        </text>
      </svg>
      <DrinkIcon category={category} />
    </>
  );
}

export function Coaster({
  category,
  label,
  onClick,
  disabled,
}: {
  category: DrinkCategory;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="coaster"
      aria-label={`Log ${label}`}
      onClick={onClick}
      disabled={disabled}
    >
      <CoasterFace label={label} category={category} />
    </button>
  );
}

/** The one bold thing on auth screens (DS §6.13): a beer coaster that says Drunkify. */
export function HeroCoaster({ className = '' }: { className?: string }) {
  return (
    <div className={`hero ${className}`} aria-hidden="true">
      <span className="coaster">
        <CoasterFace label="Drunkify" category="beer" />
      </span>
    </div>
  );
}
