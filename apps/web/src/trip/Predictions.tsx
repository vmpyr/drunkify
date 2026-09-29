import { predictionDefaults, tripLengthDays } from '@drunkify/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { memberColour, tp } from '../app/content.js';
import { send, usePredictionMe, usePredictionStatus } from '../app/queries.js';
import { initial } from '../components/Avatar.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { formError } from '../screens/auth.js';
import { useTripCtx } from './TripLayout.js';

function Stepper({
  value,
  step,
  onChange,
  unit,
  label,
}: {
  value: number;
  step: number;
  onChange: (value: number) => void;
  unit: string;
  label: string;
}) {
  return (
    <div className="qtyrow">
      <div className="step">
        <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(Math.max(0, value - step))}>
          −
        </button>
        <output aria-live="polite" aria-label={label}>
          {value}
        </output>
        <button type="button" aria-label={`More ${label}`} onClick={() => onChange(value + step)}>
          +
        </button>
      </div>
      <span className="pmuted">{unit}</span>
    </div>
  );
}

/** Six questions on one screen, all answered with taps (DS §6.9). */
export function Predictions() {
  const { trip, pack, members } = useTripCtx();
  const navigate = useNavigate();
  const me = usePredictionMe(trip.id);
  const status = usePredictionStatus(trip.id, me.data?.state === 'locked');
  const days = tripLengthDays(trip.startDate, trip.endDate);
  const active = members.filter((member) => !member.disabled);
  const defaults = predictionDefaults(days, active.length);
  const [mine, setMine] = useState(defaults.q1);
  const [group, setGroup] = useState(defaults.q2);
  const [top, setTop] = useState<string | null>(null);
  const [least, setLeast] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [critic, setCritic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startMs = Date.parse(`${trip.startDate}T00:00:00Z`);
  const dayOptions = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    label: new Date(startMs + index * 86_400_000).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }),
  }));

  const complete = top && least && day !== null && critic;

  const submit = async () => {
    if (!complete) return;
    setBusy(true);
    try {
      await send('PUT', `/trips/${trip.id}/predictions/me`, {
        myTotalStd: mine,
        groupTotalStd: group,
        topMemberId: top,
        leastMemberId: least,
        topDay: day,
        criticMemberId: critic,
      });
      await me.refetch();
    } catch (error) {
      toast(formError(error));
    } finally {
      setBusy(false);
    }
  };

  if (me.data?.state === 'locked') {
    return (
      <>
        <div style={{ margin: 'auto 0', textAlign: 'center' }}>
          <span className="badge lockbadge">
            <Icon name="lock" />
          </span>
          <h1 className="ph" style={{ marginTop: 20 }}>
            {tp(pack, 'predictions.lockedTitle')}
          </h1>
          {status.data ? (
            <p className="pmuted" style={{ marginTop: 22 }}>
              {tp(pack, 'predictions.lockedCount', { n: status.data.submitted, total: status.data.total })}
            </p>
          ) : null}
        </div>
        <button type="button" className="logbtn" style={{ marginBottom: 22 }} onClick={() => navigate(`/t/${trip.id}/log`)}>
          {tp(pack, 'predictions.lockedCta')}
        </button>
      </>
    );
  }

  if (me.data?.state === 'missed') {
    return (
      <>
        <div className="blk" style={{ marginTop: 14 }}>
          <h4>{tp(pack, 'predictions.missedTitle')}</h4>
        </div>
        <button type="button" className="logbtn" style={{ margin: 'auto 0 22px' }} onClick={() => navigate(`/t/${trip.id}/log`)}>
          {tp(pack, 'nav.log')}
        </button>
      </>
    );
  }

  const nameOf = (userId: string | null) => active.find((member) => member.userId === userId)?.name ?? '';
  const picker = (value: string | null, onPick: (id: string) => void, label: string) => (
    <div className="pick" role="radiogroup" aria-label={label}>
      {active.map((member) => (
        <button
          type="button"
          key={member.userId}
          role="radio"
          aria-checked={value === member.userId}
          aria-label={member.name}
          style={{ background: memberColour(member.colorIndex) }}
          onClick={() => onPick(member.userId)}
        >
          {initial(member.name)}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <h1 className="ph">{tp(pack, 'predictions.title')}</h1>
      <div className="pq">
        <div className="ql">
          {tp(pack, 'predictions.q1')} <span>{tp(pack, 'predictions.q1Unit')}</span>
        </div>
        <Stepper
          value={mine}
          step={1}
          onChange={setMine}
          label={tp(pack, 'predictions.q1')}
          unit={`about ${Math.round(mine / Math.max(days, 1))} a day`}
        />
      </div>
      <div className="pq">
        <div className="ql">
          {tp(pack, 'predictions.q2')} <span>{tp(pack, 'predictions.q2Unit')}</span>
        </div>
        <Stepper
          value={group}
          step={5}
          onChange={setGroup}
          label={tp(pack, 'predictions.q2')}
          unit={active.length === 2 ? 'both of you' : `all ${active.length} of you`}
        />
      </div>
      <div className="pq">
        <div className="ql">
          {tp(pack, 'predictions.q3')} <span>{nameOf(top)}</span>
        </div>
        {picker(top, setTop, tp(pack, 'predictions.q3'))}
      </div>
      <div className="pq">
        <div className="ql">
          {tp(pack, 'predictions.q4')} <span>{nameOf(least)}</span>
        </div>
        {picker(least, setLeast, tp(pack, 'predictions.q4'))}
      </div>
      <div className="pq">
        <div className="ql">{tp(pack, 'predictions.q5')}</div>
        <div className="chips scrolls" role="radiogroup" aria-label={tp(pack, 'predictions.q5')}>
          {dayOptions.map((option) => (
            <button
              type="button"
              key={option.day}
              role="radio"
              aria-checked={day === option.day}
              className={`chip ${day === option.day ? 'on' : ''}`}
              onClick={() => setDay(option.day)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pq">
        <div className="ql">
          {tp(pack, 'predictions.q6')} <span>{nameOf(critic)}</span>
        </div>
        {picker(critic, setCritic, tp(pack, 'predictions.q6'))}
      </div>
      <div style={{ flex: 1, minHeight: 22 }} />
      <button
        type="button"
        className="logbtn"
        style={{ margin: '0 0 22px' }}
        disabled={!complete || busy}
        onClick={() => void submit()}
      >
        {tp(pack, 'predictions.submit')}
      </button>
    </>
  );
}
