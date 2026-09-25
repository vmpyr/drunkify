import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../app/api.js';
import { a } from '../app/content.js';
import { queryClient, send, useMe } from '../app/queries.js';
import { applyDisplay, signOut, Splash } from '../app/session.js';
import type { DisplayPref, User } from '../app/types.js';
import { AuthField, EMAIL_RE, PrimaryButton } from '../components/Field.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { BackButton, BottomSheet, ConfirmDialog, SheetHead } from '../components/Sheet.js';
import { formError } from './auth.js';

const DISPLAY: DisplayPref[] = ['system', 'dark', 'light'];

export function Account() {
  const navigate = useNavigate();
  const me = useMe();
  const [editing, setEditing] = useState<'name' | 'email' | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!me.data) return <Splash />;
  const user = me.data;

  const setUser = (next: User) => queryClient.setQueryData(['me'], next);
  const start = (field: 'name' | 'email') => {
    setEditing(field);
    setErr(null);
    setName(user.name);
    setEmail(user.email);
    setPassword('');
  };

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setErr(a('errors.emptyName'));
    setBusy(true);
    try {
      const { user: next } = await send<{ user: User }>('PATCH', '/me', { name: name.trim() });
      setUser(next);
      setEditing(null);
      toast(a('account.saved'));
      void queryClient.invalidateQueries({ queryKey: ['trip'] });
    } catch (error) {
      setErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  const saveEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setErr(a('errors.badEmail'));
    if (!password) return setErr(a('account.emailNeedsPassword'));
    setBusy(true);
    try {
      const { user: next } = await send<{ user: User }>('POST', '/auth/change-email', {
        currentPassword: password,
        newEmail: email.trim(),
      });
      setUser(next);
      setEditing(null);
      toast(a('account.saved'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email_taken') setErr(a('invite.emailTaken'));
      else setErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  const setDisplay = async (pref: DisplayPref) => {
    applyDisplay(pref);
    setUser({ ...user, displayThemePref: pref });
    try {
      const { user: next } = await send<{ user: User }>('PATCH', '/me', { displayThemePref: pref });
      setUser(next);
    } catch {
      // The local setting already applied; the server copy catches up next time.
    }
  };

  return (
    <main className="scr au">
      <div className="au-top">
        <BackButton onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))} />
        <span />
      </div>
      <h1 className="ph">{a('account.title')}</h1>
      <div className="details" style={{ marginTop: 14 }}>
        <div className="drow">
          {editing === 'name' ? (
            <form onSubmit={saveName}>
              <span className="fld-l" style={{ margin: 0 }}>
                {a('fields.name')}
              </span>
              <input
                className="inp"
                value={name}
                autoFocus
                aria-label={a('fields.name')}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
              {err ? <div className="afh e">{err}</div> : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn sec" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={busy}>
                  Save
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="v">
                <span>{a('fields.name')}</span>
                <b>{user.name}</b>
              </div>
              <button type="button" className="mini" onClick={() => start('name')}>
                Change
              </button>
            </>
          )}
        </div>
        <div className="drow">
          {editing === 'email' ? (
            <form onSubmit={saveEmail}>
              <span className="fld-l" style={{ margin: 0 }}>
                {a('fields.email')}
              </span>
              <input
                className="inp"
                type="email"
                inputMode="email"
                value={email}
                autoFocus
                aria-label={a('fields.email')}
                autoComplete="username"
                onChange={(event) => setEmail(event.target.value)}
              />
              <span className="afh">{a('account.emailNeedsPassword')}</span>
              <input
                className="inp"
                type="password"
                value={password}
                placeholder={a('fields.currentPassword')}
                aria-label={a('fields.currentPassword')}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
              {err ? <div className="afh e">{err}</div> : null}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn sec" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={busy}>
                  Save
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="v">
                <span>{a('fields.email')}</span>
                <b style={{ overflowWrap: 'anywhere' }}>{user.email}</b>
              </div>
              <button type="button" className="mini" onClick={() => start('email')}>
                Change
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          className="drow"
          style={{ width: '100%', background: 'none', border: 0, borderTop: '1px solid var(--line)', textAlign: 'left', font: 'inherit' }}
          onClick={() => setPwOpen(true)}
        >
          <div className="v">
            <b>{a('account.changePassword')}</b>
          </div>
          <Icon name="down" className="fwd" />
        </button>
      </div>

      <div className="fld" style={{ marginTop: 20 }}>
        <div className="fld-l" id="display-l">
          {a('account.display')}
        </div>
        <div className="seg2 three" style={{ marginTop: 0 }} role="radiogroup" aria-labelledby="display-l">
          {DISPLAY.map((pref) => (
            <button
              key={pref}
              type="button"
              role="radio"
              aria-checked={user.displayThemePref === pref}
              onClick={() => void setDisplay(pref)}
            >
              {a(`account.displayOptions.${pref}`)}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="tbtn ink" style={{ marginTop: 'auto' }} onClick={() => setConfirmOut(true)}>
        {a('account.signOut')}
      </button>

      <ChangePasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
      <ConfirmDialog
        open={confirmOut}
        title={a('account.signOutConfirm.title')}
        confirm={a('account.signOutConfirm.cta')}
        cancel={a('account.signOutConfirm.cancel')}
        onConfirm={() => void signOut().then(() => navigate('/sign-in', { replace: true }))}
        onCancel={() => setConfirmOut(false)}
      />
    </main>
  );
}

function ChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string | null; next?: string | null }>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = {
      current: current ? null : a('errors.emptyPassword'),
      next: !next ? a('errors.emptyPassword') : next.length < 8 ? a('errors.shortPassword') : null,
    };
    setErrors(nextErrors);
    if (nextErrors.current || nextErrors.next) return;
    setBusy(true);
    setFormErr(null);
    try {
      await send('POST', '/auth/change-password', { currentPassword: current, newPassword: next });
      toast(a('reset.done'));
      setCurrent('');
      setNext('');
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'common_password') {
        setErrors({ next: a('errors.commonPassword') });
      } else if (error instanceof ApiError && error.code === 'same_password') {
        setErrors({ next: a('setup.samePassword') });
      } else setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} label={a('account.changePassword')}>
      <form onSubmit={submit} noValidate>
        <SheetHead title={a('account.changePassword')} onClose={onClose} />
        <AuthField
          label={a('fields.currentPassword')}
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          error={errors.current}
        />
        <AuthField
          label={a('fields.newPassword')}
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          error={errors.next}
        />
        {formErr ? (
          <div className="ferr" role="alert">
            {formErr}
          </div>
        ) : null}
        <PrimaryButton busy={busy}>{a('account.changePassword')}</PrimaryButton>
      </form>
    </BottomSheet>
  );
}
