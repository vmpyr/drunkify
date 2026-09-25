import { useId, useState, type ButtonHTMLAttributes, type Ref } from 'react';

import { a } from '../app/content.js';

export function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  hint,
  error,
  placeholder,
  autoComplete,
  inputRef,
  autoFocus,
  inputMode,
}: {
  label: string;
  type?: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | null | undefined;
  placeholder?: string;
  autoComplete?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  inputMode?: 'email' | 'text';
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const describedBy = error || hint ? `${id}-h` : undefined;
  return (
    <div className={`af ${error ? 'err' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="afb">
        <input
          id={id}
          ref={inputRef}
          className={`afi ${isPassword ? 'pw' : ''}`}
          type={isPassword && shown ? 'text' : type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={type === 'text' ? 'words' : 'none'}
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        {isPassword ? (
          <button
            type="button"
            className="afs"
            aria-pressed={shown}
            aria-label={shown ? 'Hide password' : 'Show password'}
            onClick={() => setShown((value) => !value)}
          >
            {shown ? a('fields.hide') : a('fields.show')}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="afh e" id={describedBy}>
          {error}
        </div>
      ) : hint ? (
        <div className="afh" id={describedBy}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function PrimaryButton({
  children,
  busy,
  busyLabel,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string }) {
  return (
    <button
      type="submit"
      {...rest}
      className={`pbtn ${className}`}
      disabled={busy || rest.disabled}
      aria-busy={busy}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
