import { useEffect, useRef, useState } from "react";

// Real AES-256-GCM via WebCrypto, with the same 18-byte header layout as backhaul/security.py:
// magic "WP", version, type, link id, VLAN, direction, 64-bit sequence. The header is the
// associated data, so changing any header field or ciphertext bit breaks the tag.
const VLAN_SCADA = 10, LINK = 4;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0"));

function header(seq: number): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(18), v = new DataView(h.buffer);
  h[0] = 0x57; h[1] = 0x50; h[2] = 1; h[3] = 1;
  v.setUint16(4, LINK); v.setUint16(6, VLAN_SCADA); h[8] = 0;
  v.setBigUint64(10, BigInt(seq));
  return h;
}
function nonce(seq: number): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12), v = new DataView(n.buffer);
  v.setUint16(0, LINK); n[2] = 0; v.setBigUint64(4, BigInt(seq));
  return n;
}

type Status = { kind: "idle" | "ok" | "tag" | "replay"; text: string };
interface Frame { hdr: Uint8Array<ArrayBuffer>; body: Uint8Array<ArrayBuffer>; orig: Uint8Array<ArrayBuffer>; seq: number; plain: string; flipped?: number }

export function SecurityScene({ active }: { active: boolean }) {
  const key = useRef<CryptoKey | null>(null);
  const lastAccepted = useRef(0);
  const [seq, setSeq] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "Seal a reading to see the frame." });
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!crypto?.subtle) { setSupported(false); return; }
    crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
      .then((k) => { key.current = k; }).catch(() => setSupported(false));
  }, []);

  const verify = async (f: Frame) => {
    if (!key.current) return;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(f.seq), additionalData: f.hdr, tagLength: 128 }, key.current, f.body);
      if (f.seq <= lastAccepted.current) { setStatus({ kind: "replay", text: `Rejected: sequence ${f.seq} was already accepted (replay).` }); return; }
      lastAccepted.current = f.seq;
      setStatus({ kind: "ok", text: `Verified and delivered to VLAN ${VLAN_SCADA} (SCADA): ${new TextDecoder().decode(pt)}` });
    } catch {
      setStatus({ kind: "tag", text: "Rejected: authentication tag mismatch. The frame never reaches the SCADA network." });
    }
  };

  const seal = async () => {
    if (!key.current) return;
    const s = seq + 1; setSeq(s);
    const temp = (24 + Math.random() * 30).toFixed(1);
    const plain = JSON.stringify({ site: "Thermal Plant A", breaker: "52-T3", state: "closed", temp_c: Number(temp) });
    const hdr = header(s);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(s), additionalData: hdr, tagLength: 128 }, key.current, new TextEncoder().encode(plain)));
    const f = { hdr, body: ct, orig: ct, seq: s, plain };
    setFrame(f);
    await verify(f);
  };
  const tamper = async () => {
    if (!frame) return;
    const body = frame.orig.slice();
    const pos = Math.floor(Math.random() * (body.length - 16));
    body[pos] ^= 0x01;
    const f = { ...frame, body, flipped: pos };
    setFrame(f);
    await verify(f);
  };
  const replay = async () => { if (frame) { const f = { ...frame, body: frame.orig, flipped: undefined }; setFrame(f); await verify(f); } };

  const hdrFields = frame ? [
    ["magic", "57 50"], ["ver", "01"], ["type", "01 data"], ["link", "00 04"], ["vlan", "00 0a · 10"], ["dir", "00"], ["seq", String(frame.seq)],
  ] : [];
  const bytes = frame ? hex(frame.body) : [];
  const tagStart = bytes.length - 16;
  const col = status.kind === "ok" ? "var(--ok)" : status.kind === "idle" ? "var(--dim)" : "var(--crit)";

  return (
    <div style={{ position: "absolute", inset: 0, padding: "1rem", display: "flex", flexDirection: "column", gap: "0.9rem", overflow: "auto" }} aria-live="polite">
      {!supported && <p style={{ color: "var(--warn)" }}>This viewer has no WebCrypto, so the frame demo is unavailable here.</p>}
      <div className="controls">
        <button className="btn primary" onClick={seal} disabled={!supported || !active}>Seal next reading</button>
        <button className="btn danger" onClick={tamper} disabled={!frame}>Flip one bit in transit</button>
        <button className="btn" onClick={replay} disabled={!frame}>Replay this frame</button>
      </div>
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em" }}>HEADER · AUTHENTICATED, SENT IN CLEAR</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(frame ? hdrFields : [["magic", "··"], ["ver", "··"], ["type", "··"], ["link", "··"], ["vlan", "··"], ["dir", "··"], ["seq", "··"]]).map(([k, v]) => (
            <div key={k} style={{ border: "1px solid var(--rule)", padding: "4px 8px", minWidth: 64 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{k}</div>
              <div className="mono" style={{ fontSize: 13, color: k === "vlan" || k === "seq" ? "var(--signal)" : "var(--bone)" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em" }}>
          AES-256-GCM CIPHERTEXT {frame ? `· ${tagStart} bytes` : ""} <span style={{ color: "var(--dune)" }}>+ 16-BYTE TAG</span>
        </div>
        <div className="mono" style={{ display: "flex", flexWrap: "wrap", gap: "2px 6px", fontSize: 12.5, lineHeight: 1.5, minHeight: "4.5em" }}>
          {bytes.length === 0 && <span style={{ color: "var(--faint)" }}>no frame yet</span>}
          {bytes.map((b, i) => (
            <span key={`${frame?.seq}-${i}`} style={{
              color: i === frame?.flipped ? "var(--ground)" : i >= tagStart ? "var(--dune)" : "var(--dim)",
              background: i === frame?.flipped ? "var(--crit)" : "transparent",
              animation: `slide-in 300ms ${Math.min(i, 80) * 6}ms both`,
            }}>{b}</span>
          ))}
        </div>
      </div>
      <div style={{ borderLeft: `3px solid ${col}`, padding: "0.5rem 0.8rem", background: "var(--ground)" }}>
        <div className="mono" style={{ fontSize: 11, color: col, letterSpacing: "0.08em" }}>
          {status.kind === "ok" ? "HUB · ACCEPTED" : status.kind === "idle" ? "HUB · WAITING" : "HUB · REJECTED"}
        </div>
        <div style={{ fontSize: 14, color: "var(--bone)", wordBreak: "break-word" }}>{status.text}</div>
      </div>
      <div style={{ display: "grid", gap: 0, marginTop: "auto", borderTop: "1px solid var(--rule)" }}>
        {[
          ["Management", "TLS 1.2 with a self-generated certificate", "reported"],
          ["Network", "Traffic classes kept in separate subnets (VLAN id is inside the authenticated header)", "reported"],
          ["Access", "A remote radio must prove it holds the shared secret before it may join", "datasheet"],
          ["Air", "Every frame encrypted with AES and checked against its tag", "reported"],
        ].map(([k, v, s]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "6.5rem minmax(0,1fr) auto", gap: "0.8rem", alignItems: "baseline", padding: "0.45rem 0", borderBottom: "1px solid var(--rule)" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--signal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{k}</span>
            <span style={{ fontSize: 13.5, color: "var(--dim)" }}>{v}</span>
            <span className={`src ${s}`}>{s === "reported" ? "Reported" : "Datasheet"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
