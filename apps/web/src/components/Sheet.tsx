import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { Icon } from './icons.js';

const SHEET_MS = 280;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Mounts children while open plus the closing transition. */
function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), SHEET_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, shown };
}

function useModalBehaviour(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => {
      const node = ref.current;
      if (!node || node.contains(document.activeElement)) return;
      const target = node.querySelector<HTMLElement>('[autofocus]') ?? node;
      target.focus({ preventScroll: true });
    }, 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

export function BottomSheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const { mounted, shown } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useModalBehaviour(open, ref, onClose);
  if (!mounted) return null;

  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = { y: event.clientY, dy: 0 };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    ref.current?.classList.add('dragging');
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag.current || !ref.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.y);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onPointerUp = () => {
    if (!drag.current || !ref.current) return;
    const { dy } = drag.current;
    drag.current = null;
    ref.current.classList.remove('dragging');
    ref.current.style.transform = '';
    if (dy > 90) onClose();
  };

  return createPortal(
    <div className="layer" style={{ zIndex: 10 }}>
      <div className={`scrim ${shown ? 'on' : ''}`} onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={`sheet ${shown ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div
          className="handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none' }}
        />
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="iconbtn" aria-label={label} onClick={onClick}>
      <Icon name="x" />
    </button>
  );
}

export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="iconbtn back" aria-label={label} onClick={onClick}>
      <Icon name="down" />
    </button>
  );
}

/** Centred title + close, used by the account/people sheets. */
export function SheetHead({ title, onClose, left }: { title: ReactNode; onClose: () => void; left?: ReactNode }) {
  return (
    <div className="wz-top">
      {left ?? <span className="sp" />}
      <h3 className="ttl">{title}</h3>
      <CloseButton onClick={onClose} />
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  cancel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirm: string;
  cancel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { mounted, shown } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  useModalBehaviour(open, ref, onCancel);
  if (!mounted) return null;
  return createPortal(
    <div className="layer" style={{ zIndex: 15 }}>
      <div className={`scrim ${shown ? 'on' : ''}`} onClick={onCancel} aria-hidden="true" />
      <div
        ref={ref}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-t"
        aria-describedby={body ? 'dlg-b' : undefined}
        tabIndex={-1}
        style={{ opacity: shown ? 1 : 0, transition: 'opacity 200ms' }}
      >
        <h3 id="dlg-t">{title}</h3>
        {body ? (
          <p className="au-b" id="dlg-b">
            {body}
          </p>
        ) : null}
        <div className="brow" style={{ marginTop: 18 }}>
          <button type="button" className="btn sec" onClick={onCancel} autoFocus>
            {cancel}
          </button>
          <button type="button" className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
