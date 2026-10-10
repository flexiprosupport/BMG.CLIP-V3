import { Icons } from "../../components/Icons.jsx";

// Social handles shown on the landing — brand colour drives the hover glow/fill.
const SOCIALS = [{ label: "Telegram @bmg009", href: "https://t.me/bmg009", color: "#229ED9", icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.8 3.2 18.4 20c-.2 1.2-.9 1.5-1.9.9l-5.2-3.8-2.5 2.4c-.3.3-.5.5-1 .5l.4-5.3 9.6-8.7c.4-.4-.1-.6-.6-.3L5.3 13.2.2 11.6c-1.1-.3-1.1-1.1.2-1.6L20.2 2.4c.9-.3 1.7.2 1.6.8Z" /></svg> }];

// Screen 1 — Video Input. Only a URL paste or a file upload; nothing else to
// decide here. Choosing either lights up "Continue", which is the sole way
// forward (auto-advance to Screen 2 the moment a source is picked).
export default function Screen1Input({
  source, setSource, url, setUrl, upload, upPct, drag, setDrag, fileRef,
  doUpload, onClear, sourceReady, error, onContinue,
}) {
  const uploading = source === "upload" && upPct != null && !upload;
  const fileChosen = source === "upload" && (upload || upPct != null);

  return (
    <>
      <div className="landing">
        <div className="brand-hero">
          <span className="brand-mark"><img src="/assets/BMG.CLIP-V3-main-logo.png" alt="BMG.CLIP-V3" /></span>
          <span className="brand-word">BMG.CLIP-V3</span>
          <span className="brand-by-hero">by BMG</span>
        </div>
        <span className="eyebrow"><span className="eyebrow-dot" />100% local pipeline · no API keys</span>
        <h1 className="landing-title">Turn any video into <span className="grad">captioned shorts</span></h1>
        <p className="landing-sub">
          Paste a link or drop a file — BMG.CLIP-V3 finds the best moments, reframes them
          vertical, and burns on styled captions, right on your own machine.
        </p>

        <div
          className={"cmdbar" + (drag ? " drag" : "")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files[0]); }}
        >
          <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => doUpload(e.target.files[0])} />
          <button className="cmd-upload" onClick={() => fileRef.current?.click()} title="Upload a video file">
            <Icons.upload /><span>Upload</span>
          </button>

          {fileChosen ? (
            <div className="cmd-file">
              <span className="cmd-file-name">{uploading ? `Uploading… ${upPct}%` : `✓ ${upload?.filename}`}</span>
              <button className="cmd-clear" onClick={onClear} title="Remove">✕</button>
            </div>
          ) : (
            <input
              className="cmd-input"
              type="text"
              placeholder="Paste a YouTube or video link…"
              value={url}
              onChange={(e) => { setSource("url"); setUrl(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter" && sourceReady) onContinue(); }}
            />
          )}

          <button className="cmd-go" disabled={!sourceReady || uploading} onClick={onContinue}>
            <Icons.bolt /> {uploading ? "Uploading…" : "Continue"}
          </button>
        </div>

        {error && <div className="error landing-error">{error}</div>}

        <div className="landing-hints">
          {["Drag & drop a file onto the bar", "9:16, 16:9 & 1:1 square", "19 caption styles", "Manual reframe & keyframes"].map((h) => (
            <span className="hint-chip" key={h}><span className="hc-check"><Icons.check /></span>{h}</span>
          ))}
        </div>
      </div>

      <section className="landing-more">
        <div className="landing-section">
          <span className="eyebrow">How it works</span>
          <h2 className="landing-h2">From link to posted clip in 5 steps</h2>
          <div className="how-steps">
            {[
              ["Paste a link or upload", "YouTube, a downloaded file — anything with a video track."],
              ["Pick your settings", "Aspect ratio, GPU/CPU, caption language — that's all you decide up front."],
              ["Style your captions & effects", "Pick a preset or fully customise fonts, colours, glow, gradients."],
              ["Review every rendered clip", "All clips render automatically — reframe any that need a better crop."],
              ["Download & post", "Finished vertical/square/landscape clips, ready for Reels, Shorts, TikTok."],
            ].map(([t, d], i) => (
              <div className="how-step" key={t}>
                <span className="how-step-n">{i + 1}</span>
                <div><h3>{t}</h3><p>{d}</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-section">
          <span className="eyebrow">What you can do</span>
          <h2 className="landing-h2">Everything a short-form editor needs — done locally</h2>
          <div className="feature-grid">
            {[
              [<Icons.create />, "19+ caption styles", "Hormozi-style, karaoke, word-reveal & more — or build and save your own."],
              [<Icons.crop />, "Manual reframe & keyframes", "Drag the crop box across time so the important part of the shot is never cut off."],
              [<Icons.film />, "Cinematic effects", "Colour grades, glow, vignette, film grain, gradients & letterboxing."],
              [<Icons.bolt />, "Auto-picked best moments", "Topic-aware clip selection finds natural start/end points, not mid-sentence cuts."],
              [<Icons.download />, "Background music", "Auto-suggested mood tracks that duck under your voice automatically."],
              [<Icons.settings />, "100% local, GPU or CPU", "Runs on your own machine — no API keys, nothing uploaded anywhere."],
            ].map(([icon, t, d]) => (
              <div className="feature-card" key={t}>
                <span className="feature-ico">{icon}</span>
                <h3>{t}</h3><p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="landing-social">
        {SOCIALS.map((s) => (
          <a key={s.label} className="soc" href={s.href} target="_blank" rel="noreferrer"
            title={s.label} aria-label={s.label} style={{ "--soc": s.color }}>
            {s.icon}
          </a>
        ))}
      </footer>
    </>
  );
}
