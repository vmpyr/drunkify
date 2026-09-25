import { createPortal } from 'react-dom';

import { FACES } from '../app/content.js';
import { Icon } from './icons.js';
import { useOverlays } from './overlayStore.js';

/** Toast and achievement banner (DS §6.3, §6.4). Always mounted so the live regions exist. */
export function Overlays() {
  const { toast, banner, tabsVisible, hideToast } = useOverlays();
  return createPortal(
    <div className="layer" style={{ zIndex: 20 }}>
      <div
        className={`toast ${toast ? 'on' : ''} ${tabsVisible > 0 ? '' : 'no-tabs'}`}
        role="status"
        aria-live="polite"
      >
        {toast ? (
          <>
            <div className="tr">
              <b>{toast.title}</b>
              {toast.undo ? (
                <button
                  type="button"
                  className="undo"
                  onClick={() => {
                    hideToast();
                    toast.undo?.();
                  }}
                >
                  {toast.undoLabel ?? 'Undo'}
                </button>
              ) : null}
            </div>
            {toast.rate ? (
              <>
                <div className="q">{toast.rate.prompt}</div>
                <div className="faces">
                  {FACES.map((f, index) => (
                    <button
                      key={f}
                      type="button"
                      className="face"
                      aria-label={`Rate ${index + 1} of 5`}
                      onClick={() => toast.rate?.onRate(index + 1)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <div className={`ach ${banner ? 'on' : ''}`} role="status" aria-live="polite">
        {banner ? (
          <>
            <span className="badge">
              <Icon name="bolt" />
            </span>
            <div>
              <b>{banner.title}</b>
              <span>{banner.body}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
