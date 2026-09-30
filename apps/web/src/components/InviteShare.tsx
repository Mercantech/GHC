import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CopyIcon } from "../icons";

export function InviteShare({
  inviteUrl,
  shortPath,
  compact = false,
}: {
  inviteUrl: string;
  shortPath?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(inviteUrl, {
      width: compact ? 160 : 220,
      margin: 1,
      color: { dark: "#0b1526", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteUrl, compact]);

  async function copy() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`invite-share${compact ? " is-compact" : ""}`}>
      <div className="invite-share-row">
        <code className="invite-share-path mono" title={inviteUrl}>
          {shortPath ?? inviteUrl}
        </code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
          <CopyIcon />
          {copied ? "Kopieret" : "Kopiér"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowQr((v) => !v)}
          aria-expanded={showQr}
        >
          {showQr ? "Skjul QR" : "Vis QR"}
        </button>
      </div>
      {showQr && (
        <div className="invite-share-qr">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR-kode for ${inviteUrl}`} width={compact ? 160 : 220} height={compact ? 160 : 220} />
          ) : (
            <p className="muted">Kunne ikke generere QR</p>
          )}
          <p className="invite-share-qr-hint">Scan for at åbne invite-linket</p>
        </div>
      )}
    </div>
  );
}
