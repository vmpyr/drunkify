import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { ApiError } from '../app/api.js';
import { a, durationWords, tripDates } from '../app/content.js';
import { SIGNED_OUT_FLAG, send, useMe, useTrips, v1 } from '../app/queries.js';
import { afterSignIn, signOut, Splash } from '../app/session.js';
import type { LinkProblemKind, User } from '../app/types.js';
import { HeroCoaster } from '../components/Coaster.js';
import { AuthField, EMAIL_RE, PrimaryButton } from '../components/Field.js';
import { toast } from '../components/overlayStore.js';
import { BackButton, BottomSheet, CloseButton } from '../components/Sheet.js';

/** Form-level error copy (DS §6.13: one vague message, never which field was wrong). */
export function formError(error: unknown): string {
  if (error instanceof TypeError) return a('errors.offline');
  if (error instanceof ApiError) {
    if (error.code === 'bad_credentials') return a('errors.badCredentials');
    if (error.code === 'common_password') return a('errors.commonPassword');
    if (error.status === 429) {
      const seconds = Number(error.details.retryAfter ?? 60);
      return a('errors.rateLimited', { time: durationWords(seconds) });
    }
  }
  return a('errors.generic');
}

function passwordError(value: string): string | null {
  if (!value) return a('errors.emptyPassword');
  if (value.length < 8) return a('errors.shortPassword');
  return null;
}

function emailError(value: string): string | null {
  if (!value.trim()) return a('errors.emptyEmail');
  if (!EMAIL_RE.test(value.trim())) return a('errors.badEmail');
  return null;
}

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  return {
    kb: open,
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  };
}

/* ---------------------------------------------------------------- sign in */

export function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [forgotOpen, setForgotOpen] = useState(false);
  const kb = useKeyboardOpen();
  const [signedOut] = useState(() => {
    try {
      const flag = sessionStorage.getItem(SIGNED_OUT_FLAG);
      sessionStorage.removeItem(SIGNED_OUT_FLAG);
      return flag === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  if (me.data) return <Navigate to={from ?? '/'} replace />;

  const locked = lockedUntil > now;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      email: emailError(email),
      password: password ? null : a('errors.emptyPassword'),
    };
    setErrors(next);
    if (next.email || next.password || locked) return;
    setBusy(true);
    setFormErr(null);
    try {
      const { user } = await send<{ user: User }>('POST', '/auth/sign-in', {
        email: email.trim(),
        password,
      });
      const home = await afterSignIn(user);
      navigate(user.mustChangePassword ? '/setup' : (from ?? home), { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setLockedUntil(Date.now() + Number(error.details.retryAfter ?? 60) * 1000);
        setNow(Date.now());
      }
      setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  const lockMsg = locked
    ? a('errors.rateLimited', { time: durationWords((lockedUntil - now) / 1000) })
    : null;

  return (
    <main className="scr au">
      <HeroCoaster className={kb.kb ? 'kb' : ''} />
      <form style={{ marginTop: 'auto' }} onSubmit={submit} noValidate onFocus={kb.onFocus} onBlur={kb.onBlur}>
        {signedOut ? <div className="banner" role="status">{a('signIn.signedOutBanner')}</div> : null}
        <h1 className="au-t">{a('signIn.title')}</h1>
        <AuthField
          label={a('fields.email')}
          type="email"
          inputMode="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setErrors((prev) => ({ ...prev, email: null }));
          }}
          placeholder={a('fields.emailPlaceholder')}
          autoComplete="username"
          error={errors.email}
        />
        <AuthField
          label={a('fields.password')}
          type="password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setErrors((prev) => ({ ...prev, password: null }));
          }}
          autoComplete="current-password"
          error={errors.password}
        />
        {formErr || lockMsg ? (
          <div className="ferr" role="alert">
            {lockMsg ?? formErr}
          </div>
        ) : null}
        <PrimaryButton busy={busy} busyLabel={a('signIn.ctaBusy')} disabled={locked}>
          {a('signIn.cta')}
        </PrimaryButton>
        <button type="button" className="tbtn" onClick={() => setForgotOpen(true)}>
          {a('signIn.forgot')}
        </button>
      </form>
      <ForgotSheet open={forgotOpen} initialEmail={email} onClose={() => setForgotOpen(false)} />
    </main>
  );
}

function ForgotSheet({
  open,
  initialEmail,
  onClose,
}: {
  open: boolean;
  initialEmail: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setSent(false);
      setError(null);
      setFormErr(null);
    }
  }, [open, initialEmail]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const err = emailError(email);
    setError(err);
    if (err) return;
    setBusy(true);
    setFormErr(null);
    try {
      await send('POST', '/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (e) {
      setFormErr(formError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} label={a('signIn.forgotSheet.title')}>
      <div className="sh-head">
        <h3>{sent ? a('signIn.forgotSheet.sentTitle') : a('signIn.forgotSheet.title')}</h3>
        <CloseButton onClick={onClose} />
      </div>
      {sent ? (
        <>
          <p className="au-b" style={{ marginTop: 10 }}>
            {a('signIn.forgotSheet.sentBody')}
          </p>
          <button type="button" className="pbtn" onClick={onClose}>
            Got it
          </button>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <AuthField
            label={a('fields.email')}
            type="email"
            inputMode="email"
            value={email}
            onChange={setEmail}
            placeholder={a('fields.emailPlaceholder')}
            autoComplete="username"
            error={error}
          />
          {formErr ? (
            <div className="ferr" role="alert">
              {formErr}
            </div>
          ) : null}
          <PrimaryButton busy={busy}>{a('signIn.forgotSheet.cta')}</PrimaryButton>
        </form>
      )}
    </BottomSheet>
  );
}

/* ---------------------------------------------------------------- admin setup */

export function Setup() {
  const me = useMe();
  const navigate = useNavigate();
  const [name, setName] = useState(me.data?.name ?? '');
  const [email, setEmail] = useState(me.data?.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data && !me.data.mustChangePassword) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      name: name.trim() ? null : a('errors.emptyName'),
      email: emailError(email),
      password: passwordError(password),
    };
    setErrors(next);
    if (next.name || next.email || next.password) return;
    setBusy(true);
    setFormErr(null);
    try {
      const { user } = await send<{ user: User }>('POST', '/auth/finish-setup', {
        name: name.trim(),
        email: email.trim(),
        newPassword: password,
      });
      navigate(await afterSignIn(user), { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'same_password') {
        setErrors((prev) => ({ ...prev, password: a('setup.samePassword') }));
      } else if (error instanceof ApiError && error.code === 'common_password') {
        setErrors((prev) => ({ ...prev, password: a('errors.commonPassword') }));
      } else if (error instanceof ApiError && error.code === 'email_taken') {
        setErrors((prev) => ({ ...prev, email: a('invite.emailTaken') }));
      } else setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="scr au">
      <div className="au-top">
        <HeroCoaster className="sm" />
        <button
          type="button"
          className="tbtn inline"
          onClick={() => void signOut().then(() => navigate('/sign-in', { replace: true }))}
        >
          {a('setup.signOut')}
        </button>
      </div>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <h1 className="au-t" style={{ marginTop: 14 }}>
          {a('setup.title')}
        </h1>
        <AuthField
          label={a('fields.name')}
          value={name}
          onChange={setName}
          autoComplete="name"
          error={errors.name}
        />
        <AuthField
          label={a('fields.email')}
          type="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          error={errors.email}
        />
        <AuthField
          label={a('fields.newPassword')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={errors.password}
        />
        {formErr ? (
          <div className="ferr" role="alert">
            {formErr}
          </div>
        ) : null}
        <div style={{ marginTop: 'auto' }}>
          <PrimaryButton busy={busy}>{a('setup.cta')}</PrimaryButton>
        </div>
      </form>
    </main>
  );
}

/* ---------------------------------------------------------------- invites */

type InviteLookup =
  | {
      invite: {
        name: string | null;
        tripName: string | null;
        tripDates: string | null;
        memberCount: number | null;
        inviterName: string;
        expiresAt?: number;
        tripStartDate?: string;
        tripEndDate?: string;
      };
    }
  | { kind: LinkProblemKind; inviterName?: string };

function useInviteLookup(token: string) {
  return useQuery({
    queryKey: ['invite', token],
    queryFn: () => v1<InviteLookup>(`/invites/lookup/${encodeURIComponent(token)}`),
    retry: false,
    staleTime: Infinity,
  });
}

function problemPath(kind: LinkProblemKind, inviter?: string) {
  const params = new URLSearchParams({ kind });
  if (inviter) params.set('inviter', inviter);
  return `/link-problem?${params}`;
}

export function InviteLanding() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const lookup = useInviteLookup(token);
  const me = useMe();
  const trips = useTrips(Boolean(me.data));
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  if (lookup.isPending || me.isPending) return <Splash />;
  if (lookup.isError) return <Navigate to={problemPath('invalid')} replace />;
  const data = lookup.data;
  if ('kind' in data) return <Navigate to={problemPath(data.kind, data.inviterName)} replace />;
  const invite = data.invite;
  const tripName = invite.tripName;
  const tripLine = [
    invite.tripDates ??
      (invite.tripStartDate && invite.tripEndDate
        ? tripDates(invite.tripStartDate, invite.tripEndDate)
        : null),
    invite.memberCount ? a('invite.tripMembers', { n: invite.memberCount }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const joinAsMember = async () => {
    setBusy(true);
    setFormErr(null);
    try {
      const result = await send<{ trip: { id: string } | null }>('POST', '/invites/accept-as-member', {
        token,
      });
      await trips.refetch();
      toast(tripName ? a('invite.welcomeToast', { trip: tripName }) : a('invite.welcomeToastNoTrip'));
      navigate(result.trip ? `/t/${result.trip.id}/log` : '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.details.kind) {
        navigate(problemPath(error.details.kind as LinkProblemKind, invite.inviterName), {
          replace: true,
        });
      } else setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  const signedIn = me.data;
  // A trip invite can be claimed by an existing account; an app-only invite is for someone new.
  const canJoinAsMember = signedIn && tripName;

  return (
    <main className="scr au">
      <HeroCoaster />
      <div style={{ marginTop: 'auto' }}>
        {invite.name && !signedIn ? (
          <p className="au-b" style={{ margin: '0 0 2px' }}>
            {a('invite.greeting', { name: invite.name })}
          </p>
        ) : null}
        <h1 className="au-t">{a('invite.title', { inviter: invite.inviterName })}</h1>
        {tripName ? (
          <div className="tripc">
            <div className="v">
              <b>{tripName}</b>
              {tripLine ? <span>{tripLine}</span> : null}
            </div>
          </div>
        ) : null}
        {signedIn ? (
          <>
            <p className="au-b" style={{ marginTop: 12 }}>
              {canJoinAsMember ? a('invite.signedInAs', { name: signedIn.name }) : a('invite.alreadyMember')}
            </p>
            {formErr ? (
              <div className="ferr" role="alert">
                {formErr}
              </div>
            ) : null}
            {canJoinAsMember ? (
              <PrimaryButton type="button" busy={busy} onClick={() => void joinAsMember()}>
                {a('invite.joinAs', { trip: tripName, name: signedIn.name })}
              </PrimaryButton>
            ) : (
              <button type="button" className="pbtn" onClick={() => navigate('/', { replace: true })}>
                {a('invite.alreadyMemberCta')}
              </button>
            )}
            <button
              type="button"
              className="tbtn"
              onClick={() => void signOut().then(() => navigate(`/i/${token}`, { replace: true }))}
            >
              {a('invite.notYou')}
            </button>
          </>
        ) : (
          <>
            <Link className="pbtn" to={`/i/${token}/create`} state={{ invite }}>
              {a('invite.cta')}
            </Link>
            <Link className="tbtn" style={{ display: 'grid', placeItems: 'center' }} to="/sign-in" state={{ from: `/i/${token}` }}>
              {a('invite.haveAccount')}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export function CreateAccount() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const lookup = useInviteLookup(token);
  const invite = lookup.data && 'invite' in lookup.data ? lookup.data.invite : null;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [emailTaken, setEmailTaken] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kb = useKeyboardOpen();

  useEffect(() => {
    if (invite?.name) setName((current) => current || invite.name || '');
  }, [invite?.name]);

  if (lookup.isPending) return <Splash />;
  if (lookup.data && 'kind' in lookup.data) {
    return <Navigate to={problemPath(lookup.data.kind, lookup.data.inviterName)} replace />;
  }
  if (lookup.isError) return <Navigate to={problemPath('invalid')} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = {
      name: name.trim() ? null : a('errors.emptyName'),
      email: emailError(email),
      password: passwordError(password),
    };
    setErrors(next);
    setEmailTaken(false);
    if (next.name || next.email || next.password) return;
    setBusy(true);
    setFormErr(null);
    try {
      const result = await send<{ user: User; trip: { id: string } | null }>('POST', '/invites/accept', {
        token,
        name: name.trim(),
        email: email.trim(),
        password,
      });
      const home = await afterSignIn(result.user);
      toast(
        invite?.tripName
          ? a('invite.welcomeToast', { trip: invite.tripName })
          : a('invite.welcomeToastNoTrip'),
      );
      navigate(result.trip ? `/t/${result.trip.id}/log` : home, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email_taken') setEmailTaken(true);
      else if (error instanceof ApiError && error.code === 'common_password') {
        setErrors((prev) => ({ ...prev, password: a('errors.commonPassword') }));
      } else if (error instanceof ApiError && error.details.kind) {
        navigate(problemPath(error.details.kind as LinkProblemKind, invite?.inviterName), {
          replace: true,
        });
      } else setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="scr au">
      <div className="au-top">
        <BackButton onClick={() => navigate(`/i/${token}`)} />
        <HeroCoaster className="sm" />
        <span className="sp44" />
      </div>
      <form
        onSubmit={submit}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
        onFocus={kb.onFocus}
        onBlur={kb.onBlur}
      >
        <h1 className="au-t" style={{ marginTop: 14 }}>
          {a('invite.createTitle')}
        </h1>
        <AuthField
          label={a('fields.name')}
          value={name}
          onChange={setName}
          placeholder={a('fields.namePlaceholder')}
          autoComplete="name"
          error={errors.name}
        />
        <AuthField
          label={a('fields.email')}
          type="email"
          inputMode="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setEmailTaken(false);
          }}
          placeholder={a('fields.emailPlaceholder')}
          autoComplete="username"
          error={errors.email ?? (emailTaken ? a('invite.emailTaken') : null)}
        />
        {emailTaken ? (
          <Link className="tbtn" style={{ display: 'grid', placeItems: 'start', paddingLeft: 0 }} to="/sign-in" state={{ from: `/i/${token}` }}>
            {a('invite.emailTakenAction')}
          </Link>
        ) : null}
        <AuthField
          label={a('fields.password')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={errors.password}
        />
        {formErr ? (
          <div className="ferr" role="alert">
            {formErr}
          </div>
        ) : null}
        <div style={{ marginTop: 'auto' }}>
          <PrimaryButton busy={busy}>
            {invite?.tripName ? a('invite.createCtaTrip', { trip: invite.tripName }) : a('invite.createCta')}
          </PrimaryButton>
        </div>
      </form>
    </main>
  );
}

/* ---------------------------------------------------------------- link problems + reset */

export function LinkProblem() {
  const [params] = useSearchParams();
  const kindParam = params.get('kind') as LinkProblemKind | null;
  const kind: LinkProblemKind =
    kindParam && ['invalid', 'expired', 'used', 'revoked', 'resetExpired'].includes(kindParam)
      ? kindParam
      : 'invalid';
  return (
    <main className="scr au">
      <HeroCoaster className="dim" />
      <div style={{ marginTop: 'auto' }}>
        <h1 className="au-t">{a(`linkProblem.${kind}.title`)}</h1>
        <Link className="pbtn sec" style={{ marginTop: 24 }} to="/sign-in">
          {a('linkProblem.signIn')}
        </Link>
      </div>
    </main>
  );
}

export function ResetPassword() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const lookup = useQuery({
    queryKey: ['reset', token],
    queryFn: () =>
      v1<{ email: string } | { kind: LinkProblemKind }>(
        `/auth/reset-password/${encodeURIComponent(token)}`,
      ),
    retry: false,
    staleTime: Infinity,
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lookup.isPending) return <Splash />;
  if (lookup.isError) return <Navigate to={problemPath('invalid')} replace />;
  if ('kind' in lookup.data) {
    const kind = lookup.data.kind === 'expired' ? 'resetExpired' : lookup.data.kind;
    return <Navigate to={problemPath(kind)} replace />;
  }
  const email = lookup.data.email;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const err = passwordError(password);
    setError(err);
    if (err) return;
    setBusy(true);
    setFormErr(null);
    try {
      const { user } = await send<{ user: User }>('POST', '/auth/reset-password', {
        token,
        newPassword: password,
      });
      toast(a('reset.done'));
      navigate(await afterSignIn(user), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'common_password') setError(a('errors.commonPassword'));
      else if (e instanceof ApiError && e.details.kind) {
        navigate(problemPath(e.details.kind as LinkProblemKind), { replace: true });
      } else setFormErr(formError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="scr au">
      <HeroCoaster />
      <form style={{ marginTop: 'auto' }} onSubmit={submit} noValidate>
        <h1 className="au-t">{a('reset.title')}</h1>
        <p className="au-b">{a('reset.body', { email })}</p>
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <AuthField
          label={a('fields.newPassword')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          error={error}
          autoFocus
        />
        {formErr ? (
          <div className="ferr" role="alert">
            {formErr}
          </div>
        ) : null}
        <PrimaryButton busy={busy}>{a('reset.cta')}</PrimaryButton>
      </form>
    </main>
  );
}
