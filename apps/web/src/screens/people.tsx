import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { a, memberColour, shortDate } from '../app/content.js';
import { queryClient, send, useInvites, useMe, useTrips, v1 } from '../app/queries.js';
import type { Invite, Person, Trip, User } from '../app/types.js';
import { initial } from '../components/Avatar.js';
import { AuthField, EMAIL_RE, PrimaryButton } from '../components/Field.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { BackButton, BottomSheet, CloseButton, ConfirmDialog, SheetHead } from '../components/Sheet.js';
import { formError } from './auth.js';
import { LinkResult } from './links.js';

const DAY = 86_400_000;

interface LinkState {
  title: string;
  url: string;
  shareMessage: string;
  qrLabel: string;
  startWithQr?: boolean;
}

function inviteLink(
  me: User,
  invite: Pick<Invite, 'name' | 'tripName' | 'expiresAt'>,
  url: string,
  startWithQr = false,
): LinkState {
  return {
    title: invite.name
      ? a('inviteSheet.resultTitle', { name: invite.name })
      : a('inviteSheet.resultTitleUnnamed'),
    url,
    shareMessage: invite.tripName
      ? a('inviteSheet.shareMessageTrip', { inviter: me.name, trip: invite.tripName, url })
      : a('inviteSheet.shareMessage', { inviter: me.name, url }),
    qrLabel: `QR code for ${invite.name ? `${invite.name}’s` : 'the'} invite link`,
    startWithQr,
  };
}

/** Invite someone: who and where, then the link (DS §6.13). */
export function InviteSheet({
  open,
  onClose,
  defaultTripId,
}: {
  open: boolean;
  onClose: () => void;
  defaultTripId?: string | null;
}) {
  const me = useMe();
  const trips = useTrips(open);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [tripId, setTripId] = useState<string | null>(defaultTripId ?? null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [link, setLink] = useState<LinkState | null>(null);

  const reset = () => {
    setName('');
    setEmail('');
    setEmailErr(null);
    setFormErr(null);
    setLink(null);
    setTripId(defaultTripId ?? null);
  };
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openTrips = (trips.data ?? []).filter((trip) => trip.phase !== 'ceremony');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setEmailErr(a('errors.badEmail'));
      return;
    }
    setBusy(true);
    setFormErr(null);
    try {
      const result = await send<{ invite: Invite; url: string }>('POST', '/invites', {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim(), sendEmail: true } : {}),
        ...(tripId ? { tripId } : {}),
      });
      const tripName = openTrips.find((trip) => trip.id === tripId)?.name ?? null;
      setLink(inviteLink(me.data!, { ...result.invite, tripName }, result.url));
      if (email.trim()) toast(a('inviteSheet.emailSent', { email: email.trim() }));
      void queryClient.invalidateQueries({ queryKey: ['invites'] });
    } catch (error) {
      setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} label={a('inviteSheet.title')}>
      {link ? (
        <LinkResult {...link} onClose={onClose} onAnother={reset} />
      ) : (
        <form onSubmit={submit} noValidate>
          <SheetHead title={a('inviteSheet.title')} onClose={onClose} />
          <h3 className="wz-q">{a('inviteSheet.question')}</h3>
          <AuthField
            label="Name"
            value={name}
            onChange={setName}
            placeholder={a('inviteSheet.namePlaceholder')}
            autoComplete="off"
          />
          <AuthField
            label={a('inviteSheet.emailLabel')}
            type="email"
            inputMode="email"
            value={email}
            onChange={(value) => {
              setEmail(value);
              setEmailErr(null);
            }}
            placeholder={a('fields.emailPlaceholder')}
            autoComplete="off"
            error={emailErr}
          />
          <div className="fld" style={{ marginTop: 16 }}>
            <div className="fld-l" id="inv-trip">
              {a('inviteSheet.tripLabel')}
            </div>
            <div className="chips" role="radiogroup" aria-labelledby="inv-trip">
              {openTrips.map((trip) => (
                <button
                  key={trip.id}
                  type="button"
                  role="radio"
                  aria-checked={tripId === trip.id}
                  className={`chip ${tripId === trip.id ? 'on' : ''}`}
                  onClick={() => setTripId(trip.id)}
                >
                  {trip.name}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={tripId === null}
                className={`chip ${tripId === null ? 'on' : ''}`}
                onClick={() => setTripId(null)}
              >
                {a('inviteSheet.noTrip')}
              </button>
            </div>
          </div>
          {formErr ? (
            <div className="ferr" role="alert">
              {formErr}
            </div>
          ) : null}
          <PrimaryButton busy={busy} style={{ marginTop: 22 }}>
            {a('inviteSheet.cta')}
          </PrimaryButton>
        </form>
      )}
    </BottomSheet>
  );
}

/* ---------------------------------------------------------------- People screen */

export function People() {
  const navigate = useNavigate();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const invites = useInvites(isAdmin);
  const people = useQuery({
    queryKey: ['people'],
    queryFn: async () => (await v1<{ items: Person[] }>('/people')).items,
    enabled: isAdmin,
  });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionFor, setActionFor] = useState<Invite | null>(null);
  const [link, setLink] = useState<LinkState | null>(null);
  const [member, setMember] = useState<{ person: Person; colour: string } | null>(null);

  useEffect(() => {
    if (me.data && !isAdmin) navigate('/', { replace: true });
  }, [me.data, isAdmin, navigate]);

  const now = Date.now();
  const openInvites = (invites.data ?? []).filter(
    (invite) => invite.state === 'pending' || invite.state === 'expired',
  );
  // The server lists members only; the design shows the admin first, tagged "you".
  const listed = (people.data ?? []).filter((person) => !person.disabledAt && person.id !== me.data?.id);
  const members: Person[] =
    me.data && people.isSuccess ? [{ ...me.data, trips: [] }, ...listed] : listed;

  const reissue = async (invite: Invite, qr: boolean) => {
    setActionFor(null);
    try {
      const result = await send<{ invite: Invite; url: string }>('POST', `/invites/${invite.id}/reissue`);
      setLink(inviteLink(me.data!, { ...invite, ...result.invite, tripName: invite.tripName }, result.url, qr));
      void invites.refetch();
    } catch (error) {
      toast(formError(error));
    }
  };
  const revoke = async (invite: Invite) => {
    setActionFor(null);
    try {
      await send('POST', `/invites/${invite.id}/revoke`);
      toast(a('people.actions.revoked'));
      void invites.refetch();
    } catch (error) {
      toast(formError(error));
    }
  };

  return (
    <main className="scr" style={{ paddingBottom: 32 }}>
      <div className="au-top">
        <BackButton onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))} />
        <span />
      </div>
      <h1 className="ph">{a('people.title')}</h1>
      <button type="button" className="again" onClick={() => setInviteOpen(true)}>
        <Icon name="user-plus" />
        {a('people.invite')}
      </button>

      <div className="sech">
        <h3>{a('people.pendingHeading', { n: openInvites.length })}</h3>
      </div>
      {openInvites.length === 0 && invites.isSuccess ? <p className="pmuted">{a('people.emptyInvites')}</p> : null}
      {openInvites.map((invite) => {
        const expired = invite.state === 'expired' || invite.expiresAt < now;
        const days = Math.max(1, Math.ceil((invite.expiresAt - now) / DAY));
        const label = invite.name ?? a('people.unnamed');
        return (
          <div className="prow" key={invite.id}>
            <span className="pav inv">{invite.name ? initial(invite.name) : '?'}</span>
            <div className="m">
              <b>{label}</b>
              <span>
                {expired
                  ? a('people.expiredSub', { date: shortDate(invite.expiresAt) })
                  : invite.tripName
                    ? a('people.pendingSub', { trip: invite.tripName, days })
                    : a('people.pendingSubNoTrip', { days })}
              </span>
            </div>
            <button
              type="button"
              className="iconbtn bare"
              aria-label={`Invite options for ${label}`}
              onClick={() => setActionFor(invite)}
            >
              <Icon name="more" />
            </button>
          </div>
        );
      })}

      <div className="sech">
        <h3>{a('people.membersHeading', { n: members.length })}</h3>
      </div>
      {members.map((person, index) => {
        const isMe = person.id === me.data?.id;
        const colour = memberColour(person.colorIndex ?? index);
        const content = (
          <>
            <span className="pav" style={{ background: colour }}>
              {initial(person.name)}
            </span>
            <div className="m">
              <b>
                {person.name}
                {person.role === 'admin' ? <span className="tag">{a('people.adminTag')}</span> : null}
                {isMe ? <small> {a('people.you')}</small> : null}
              </b>
              <span>{person.email}</span>
            </div>
          </>
        );
        return isMe ? (
          <div className="prow" key={person.id}>
            {content}
          </div>
        ) : (
          <button type="button" className="prow" key={person.id} onClick={() => setMember({ person, colour })}>
            {content}
            <Icon name="down" className="fwd" />
          </button>
        );
      })}

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <BottomSheet open={actionFor !== null} onClose={() => setActionFor(null)} label="Invite options">
        {actionFor ? (
          <>
            <SheetHead title={actionFor.name ?? a('people.unnamed')} onClose={() => setActionFor(null)} />
            <button type="button" className="srow" onClick={() => void reissue(actionFor, false)}>
              <Icon name="share" />
              <div className="v">
                <b>{a('people.actions.shareNew')}</b>
              </div>
            </button>
            <button type="button" className="srow" onClick={() => void reissue(actionFor, true)}>
              <Icon name="qr" />
              <div className="v">
                <b>{a('people.actions.showQr')}</b>
              </div>
            </button>
            <button type="button" className="srow danger" onClick={() => void revoke(actionFor)}>
              <Icon name="x" />
              <div className="v">
                <b>{a('people.actions.revoke')}</b>
              </div>
            </button>
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet open={link !== null} onClose={() => setLink(null)} label="Invite link">
        {link ? <LinkResult {...link} onClose={() => setLink(null)} /> : null}
      </BottomSheet>

      <MemberSheet
        member={member}
        onClose={() => setMember(null)}
        onChanged={() => void people.refetch()}
      />
    </main>
  );
}

function MemberSheet({
  member,
  onClose,
  onChanged,
}: {
  member: { person: Person; colour: string } | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const person = member?.person;
  const trips = useTrips(Boolean(person));
  const detail = useQuery({
    queryKey: ['people', person?.id],
    queryFn: () =>
      v1<{ user: User; trips: Trip[]; invitedBy: { name: string } | null; joinedAt: number }>(
        `/people/${person!.id}`,
      ),
    enabled: Boolean(person),
  });
  const [view, setView] = useState<'main' | 'trips'>('main');
  const [link, setLink] = useState<LinkState | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setView('main');
    setLink(null);
  }, [person?.id]);

  const addToTrip = async (trip: Trip) => {
    try {
      await send('POST', `/people/${person!.id}/trips`, { tripId: trip.id });
      toast(a('people.actions.addedToTrip', { name: person!.name, trip: trip.name }));
      setView('main');
      void detail.refetch();
      onChanged();
    } catch (error) {
      toast(formError(error));
    }
  };
  const resetLink = async () => {
    try {
      const { url } = await send<{ url: string }>('POST', `/people/${person!.id}/reset-link`);
      setLink({
        title: a('inviteSheet.resetTitle', { name: person!.name }),
        url,
        shareMessage: a('inviteSheet.resetShareMessage', { url }),
        qrLabel: `QR code for ${person!.name}’s reset link`,
      });
    } catch (error) {
      toast(formError(error));
    }
  };
  const remove = async () => {
    setConfirm(false);
    try {
      await send('DELETE', `/people/${person!.id}`);
      toast(a('people.removeConfirm.done', { name: person!.name }));
      onClose();
      onChanged();
    } catch (error) {
      toast(formError(error));
    }
  };

  const memberTrips = detail.data?.trips ?? person?.trips ?? [];
  const joinedAt = detail.data?.joinedAt;
  const inviter = detail.data?.invitedBy?.name;

  return (
    <>
      <BottomSheet open={Boolean(person)} onClose={onClose} label={person?.name ?? 'Member'}>
        {person && member ? (
          link ? (
            <LinkResult {...link} onClose={onClose} />
          ) : view === 'trips' ? (
            <>
              <SheetHead
                title={a('people.actions.addToTrip')}
                onClose={onClose}
                left={<BackButton onClick={() => setView('main')} />}
              />
              {(trips.data ?? [])
                .filter((trip) => trip.phase !== 'ceremony')
                .map((trip) => {
                  const already = memberTrips.some((item) => item.id === trip.id);
                  return (
                    <button
                      type="button"
                      key={trip.id}
                      className="srow"
                      disabled={already}
                      onClick={() => void addToTrip(trip)}
                    >
                      <div className="v">
                        <b>{trip.name}</b>
                      </div>
                      {already ? <Icon name="check" className="chk" /> : null}
                    </button>
                  );
                })}
            </>
          ) : (
            <>
              <div className="mhead">
                <span className="pav" style={{ background: member.colour }}>
                  {initial(person.name)}
                </span>
                <h3>{person.name}</h3>
                <CloseButton onClick={onClose} />
              </div>
              <p className="mline" style={{ marginTop: 10 }}>
                {person.email}
              </p>
              {joinedAt ? (
                <p className="mline">
                  {a('people.memberSheet.joined', { date: shortDate(joinedAt) })}
                  {inviter ? ` ${a('people.memberSheet.invitedBy', { inviter })}.` : ''}
                </p>
              ) : null}
              {memberTrips.length > 0 ? (
                <p className="mline">
                  {a('people.memberSheet.trips', { trips: memberTrips.map((trip) => trip.name).join(', ') })}
                </p>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <button type="button" className="srow" onClick={() => setView('trips')}>
                  <Icon name="glass" />
                  <div className="v">
                    <b>{a('people.actions.addToTrip')}</b>
                  </div>
                  <Icon name="down" className="fwd" />
                </button>
                <button type="button" className="srow" onClick={() => void resetLink()}>
                  <Icon name="key" />
                  <div className="v">
                    <b>{a('people.actions.resetLink')}</b>
                  </div>
                  <Icon name="down" className="fwd" />
                </button>
                <button type="button" className="srow danger" onClick={() => setConfirm(true)}>
                  <Icon name="x" />
                  <div className="v">
                    <b>{a('people.actions.remove')}</b>
                  </div>
                </button>
              </div>
            </>
          )
        ) : null}
      </BottomSheet>
      <ConfirmDialog
        open={confirm}
        title={a('people.removeConfirm.title', { name: person?.name ?? '' })}
        body={a('people.removeConfirm.body')}
        confirm={a('people.removeConfirm.cta')}
        cancel={a('people.removeConfirm.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
