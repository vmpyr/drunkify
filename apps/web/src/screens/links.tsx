import QRCode from 'qrcode';
import { useMemo, useState } from 'react';

import { a } from '../app/content.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { SheetHead } from '../components/Sheet.js';

/** Printed like a coaster so it still scans in the dark (DS §6.13 QR). */
export function QrCode({ url, label }: { url: string; label: string }) {
  const path = useMemo(() => {
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let d = '';
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (qr.modules.get(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return { d, n: size + 8 };
  }, [url]);
  return (
    <div className="qrc">
      <svg viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" role="img" aria-label={label}>
        <path d={path.d} />
      </svg>
    </div>
  );
}

function shortLink(url: string): string {
  const bare = url.replace(/^https?:\/\//, '');
  const cut = bare.lastIndexOf('/') + 1;
  const token = bare.slice(cut);
  return token.length > 14 ? `${bare.slice(0, cut)}${token.slice(0, 6)}…${token.slice(-4)}` : bare;
}

export async function shareOrCopy(_url: string, text: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
    }
  }
  await copy(text);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(a('inviteSheet.copied'));
  } catch {
    toast(a('errors.generic'));
  }
}

/** The link step shared by new invites, reissued invites and password reset links. */
export function LinkResult({
  title,
  url,
  shareMessage,
  qrLabel,
  startWithQr = false,
  onClose,
  onAnother,
}: {
  title: string;
  url: string;
  shareMessage: string;
  qrLabel: string;
  startWithQr?: boolean;
  onClose: () => void;
  onAnother?: () => void;
}) {
  const [qr, setQr] = useState(startWithQr);
  return (
    <>
      <SheetHead title={title} onClose={onClose} />
      {qr ? (
        <>
          <QrCode url={url} label={qrLabel} />
          <button type="button" className="btn sec full" style={{ marginTop: 12 }} onClick={() => setQr(false)}>
            {a('inviteSheet.qrBack')}
          </button>
        </>
      ) : (
        <>
          <div className="lnk" title={url}>
            {shortLink(url)}
          </div>
          <button type="button" className="pbtn" onClick={() => void shareOrCopy(url, shareMessage)}>
            <Icon name="share" />
            {a('inviteSheet.share')}
          </button>
          <div className="brow">
            <button type="button" className="btn sec" onClick={() => void copy(url)}>
              {a('inviteSheet.copy')}
            </button>
            <button type="button" className="btn sec" aria-label={a('inviteSheet.qrLabel')} onClick={() => setQr(true)}>
              <Icon name="qr" />
              {a('inviteSheet.qr')}
            </button>
          </div>
        </>
      )}
      {onAnother ? (
        <button type="button" className="tbtn" onClick={onAnother}>
          {a('inviteSheet.another')}
        </button>
      ) : null}
    </>
  );
}
