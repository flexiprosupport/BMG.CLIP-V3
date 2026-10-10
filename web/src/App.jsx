import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Icons } from "./components/Icons.jsx";
import Create from "./pages/Create.jsx";
import Library from "./pages/Library.jsx";
import Settings from "./pages/Settings.jsx";
import Processing from "./pages/Processing.jsx";
import { useProcessing } from "./useProcessing.js";

const NAV = [
  { id: "create", label: "Create", icon: Icons.create },
  { id: "library", label: "Library", icon: Icons.library },
  { id: "processing", label: "Processing", icon: Icons.processing },
  { id: "settings", label: "Settings", icon: Icons.settings },
];

const TITLES = {
  create: { h: "Create clips", sub: "Turn any video into captioned vertical shorts" },
  library: { h: "Library", sub: "Every clip you've generated" },
  processing: { h: "Processing", sub: "Background jobs, batches & live progress" },
  settings: { h: "Settings", sub: "Compute device & environment" },
};

const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];

// First-run (and every relaunch, briefly) splash while the whisper model
// loads. On a fresh install this can take a few minutes to download — this
// screen is the fix for that looking "stuck": real progress instead of a
// refused connection or a blank tab.
function ModelSplash({ status, onRetry }) {
  const pct = status.progress != null ? Math.round(status.progress * 100) : null;
  const failed = status.status === "error";
  return (
    <div className="model-splash">
      <div className="model-splash-mark"><img src="/assets/BMG.CLIP-V3-main-logo.png" alt="BMG.CLIP-V3" /></div>
      <div className="model-splash-title">BMG.CLIP-V3</div>
      {failed ? (
        <>
          <div className="model-splash-msg" style={{ color: "var(--danger)" }}>Could not start the AI engine.</div>
          <div className="model-splash-detail">{status.message}</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>Retry</button>
        </>
      ) : (
        <>
          <div className="model-splash-msg">{status.message || "Starting up…"}</div>
          <div className="track model-splash-track">
            <div className={"fill" + (pct == null ? " indeterminate" : "")} style={pct == null ? {} : { width: pct + "%" }} />
          </div>
          {status.status === "downloading" && (
            <div className="model-splash-detail">One-time download — this machine won't need it again.</div>
          )}
        </>
      )}
    </div>
  );
}

// Segmented light/dark switch. Writes the choice to <html data-theme> and
// remembers it across reloads. "dark" is the CSS default, so we clear the attr.
function ThemeSwitch({ theme, setTheme, fixed }) {
  return (
    <div className={"theme-switch" + (fixed ? " theme-switch-fixed" : "")} role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} className={theme === t.id ? "active" : ""}
          onClick={() => setTheme(t.id)} title={`${t.label} theme`}>{t.label}</button>
      ))}
    </div>
  );
}

export default function App() {
  const processing=useProcessing();
  const [libraryFocus,setLibraryFocus]=useState(null);
  const [page, setPage] = useState("create");
  const [step, setStep] = useState(1);
  const [device, setDevice] = useState(null);
  const [online, setOnline] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("cf-theme") || "dark"; } catch { return "dark"; }
  });
  const [modelStatus, setModelStatus] = useState({ status: "idle", message: "", progress: null });
  const [retryTrigger, setRetryTrigger] = useState(0);

  const handleRetry = async () => {
    setModelStatus({ status: "downloading", message: "Retrying AI model load...", progress: 0 });
    try {
      await api.retryModel();
    } catch {}
    setRetryTrigger((v) => v + 1);
  };

  // Poll until the whisper model is ready (or fails) — fast while it's
  // loading/downloading, then stops (no need to keep polling afterward).
  useEffect(() => {
    let alive = true;
    let timer;
    async function tick() {
      try {
        const s = await api.modelStatus();
        if (!alive) return;
        setModelStatus(s);
        if (s.status === "ready" || s.status === "error") return;
      } catch { /* server still coming up — keep trying */ }
      if (alive) timer = setTimeout(tick, 1000);
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [retryTrigger]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { localStorage.setItem("cf-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      api.health()
        .then((d) => { if (alive) { setOnline(true); setDevice(d.device); } })
        .catch(() => { if (alive) setOnline(false); });
    ping();
    const t = setInterval(ping, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // The Create landing (step 1) is a clean, full-screen page: the sidebar + topbar
  // are HIDDEN (via the .is-landing class), not unmounted. <Create> stays mounted
  // across landing→editor so its source/url/upload state survives.
  const chromeless = page === "create" && step === 1;
  const t = TITLES[page];

  const go = (id) => { setPage(id); if (id === "create") setStep(1); setNavOpen(false); };


  return (
    <div className={"shell" + (chromeless ? " is-landing" : "") + (navOpen ? " nav-open" : "")}>
      {/* On the chromeless landing the topbar is hidden, so float the switcher. */}
      {chromeless && <ThemeSwitch theme={theme} setTheme={setTheme} fixed />}

      <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className="sidebar">
        <div className="brand">
          <span className="logo"><img src="/assets/BMG.CLIP-V3-icon.png" alt="BMG.CLIP-V3 icon" /></span>
          <span className="brand-text">BMG.CLIP-V3<span className="brand-by">by BMG</span></span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={"nav-item" + (page === n.id ? " active" : "")}
              onClick={() => go(n.id)}
            >
              <n.icon /> {n.label}
              {n.id==="processing"&&(processing.counts.queued||processing.counts.running||processing.counts.cancelling)>0&&<span className="processing-count">{(processing.counts.queued||0)+(processing.counts.running||0)+(processing.counts.cancelling||0)}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          100% local pipeline<br />yt-dlp · faster-whisper · ffmpeg
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="topbar-titles">
            <h1>{t.h}</h1>
            <div className="sub">{t.sub}</div>
          </div>
          <div className="topbar-right">
            <button className="btn btn-ghost processing-indicator" onClick={()=>go("processing")}>{processing.counts.running||0} processing · {processing.counts.queued||0} queued</button>
            <ThemeSwitch theme={theme} setTheme={setTheme} />
            <span className={"badge " + (online ? "ok" : online === false ? "warn" : "")}>
              <span className="dot" />
              {online == null ? "Connecting…" : online ? `Backend · ${(device || "ready").toUpperCase()}` : "Backend offline"}
            </span>
          </div>
        </header>

        <div className="content">
          {/* Orbs are ALWAYS in the tree (hidden via CSS off the landing) so that
              <Create> never changes sibling-index. */}
          <div className="landing-orbs" aria-hidden="true">
            <span className="orb orb-1" />
            <span className="orb orb-2" />
            <span className="orb orb-3" />
            <span className="orb orb-4" />
            <span className="orb orb-5" />
          </div>
          {modelStatus.status!=="ready"&&<div className="queue-model-banner" role="status">{modelStatus.message||"Preparing local AI engine…"} {modelStatus.status==="error"&&<button className="btn btn-ghost" onClick={handleRetry}>Retry engine</button>}</div>}
          <div hidden={page!=="create"}><Create key="create" step={step} setStep={setStep} onSubmitted={()=>setPage(current=>current==="create"?"processing":current)} onProcessing={()=>go("processing")} /></div>
          {page === "library" && <Library focusClipId={libraryFocus} processingRevision={processing.jobs.reduce((n,j)=>n+j.generated_clips,0)} />}
          {page === "processing"&&<Processing processing={processing} onLibrary={id=>{setLibraryFocus(id);go("library")}}/>}
          {page === "settings" && <Settings />}
        </div>
      </div>
      {chromeless&&<button className="btn btn-ghost landing-processing" onClick={()=>go("processing")}><Icons.processing/> Processing · {(processing.counts.queued||0)+(processing.counts.running||0)}</button>}
      {processing.notice&&<div className="processing-notice" role="status">{processing.notice.text}<button onClick={()=>{setLibraryFocus(null);go("library");processing.dismissNotice()}}>Open Library</button><button aria-label="Dismiss notification" onClick={processing.dismissNotice}>✕</button></div>}
    </div>
  );
}
