import { memberColour } from '../app/content.js';

export function initial(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}

export function Avatar({
  name,
  colorIndex,
  className = '',
}: {
  name: string;
  colorIndex: number | undefined;
  className?: string;
}) {
  return (
    <span className={`av ${className}`} style={{ background: memberColour(colorIndex) }} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

export function AvatarStack({
  members,
  max = 6,
  label,
}: {
  members: Array<{ userId: string; name: string; colorIndex: number }>;
  max?: number;
  label?: string;
}) {
  return (
    <div className="avs" role="img" aria-label={label ?? members.map((m) => m.name).join(', ')}>
      {members.slice(0, max).map((member) => (
        <Avatar key={member.userId} name={member.name} colorIndex={member.colorIndex} />
      ))}
    </div>
  );
}
