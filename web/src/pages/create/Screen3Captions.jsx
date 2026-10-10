import { useState } from "react";
import { captionLineStyle, effectiveCfg } from "../../caption.js";
import Customizer from "../../components/Customizer.jsx";
import PhonePreview from "../../components/PhonePreview.jsx";
import Transcript from "../../components/Transcript.jsx";
import { Icons } from "../../components/Icons.jsx";
import BackgroundBlurControl from "../../components/BackgroundBlurControl.jsx";
import NativeCaptionCanvas from "../../components/NativeCaptionCanvas.jsx";

function Chip({ label, cfg, overrides, active, trending, custom, onClick, onDelete }) {
  const words = (label || "Aa").split(/\s+/).slice(0, 2);
  const style = captionLineStyle(cfg, { fontPx: 16, scale: 0.16 });
  const hl = (cfg.animation === "highlight" || cfg.karaoke) ? words.length - 1 : -1;
  return (
    <button type="button" className={"chip" + (active ? " active" : "")} onClick={onClick}>
      {custom ? <span className="tag custom">Custom</span> : trending ? <span className="tag">Trending</span> :
        ["Premium","Multiline"].includes(cfg.category) ? <span className="tag">{cfg.category}</span> : null}
      {custom && <span className="chip-del" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</span>}
      <span className="stage">{cfg.engine === "canvas" ? <NativeCaptionCanvas cfg={cfg} overrides={overrides} thumbnail /> : <span className="sample" style={style}>
        {words.map((w, i) => <span key={i} style={{ color: i === hl ? (cfg.highlight_color || "#FFD400") : undefined }}>{w} </span>)}
      </span>}</span>
      <span className="name">{label}</span>
    </button>
  );
}

function SaveBlock({ s, open, setOpen }) {
  const [name, setName] = useState("");
  const commit = () => { if (s.saveCurrentPreset(name)) { setOpen(false); setName(""); } };
  if (!open) return null;
  return (
    <div className="save-form">
      <input type="text" placeholder="Name your style…" value={name} maxLength={40} autoFocus
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setOpen(false); }} />
      <button className="btn btn-primary" onClick={commit}>Save</button>
      <button className="btn" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}

// Caption-library entry points are hidden outside the editing workflow only.
// Inside the editor, retain the complete original preset gallery, saved styles,
// customization controls and transcript.
export default function Screen3Captions({
  studio, language, onFontUpload, media, prepView, sourceReady,
  transcript, curTime, seekTo, videoRef, aspect, fit, backgroundBlur, setBackgroundBlur,
  blurStrength, setBlurStrength, barText, barTextColor, barTextAnim, signature, setSig,
  onBack, onNext,
}) {
  const [tab, setTab] = useState("themes");
  const [saveOpen, setSaveOpen] = useState(false);
  const s = studio;
  const filter = s.galleryFilter || "all";
  const visible = s.presets.filter(p => filter === "all" || (filter === "Multicolour" ? p.multicolour : p.category === filter || filter === "Original" && !p.engine));
  const trending = visible.filter((p) => p.trending);
  const standard = visible.filter((p) => !p.trending);
  const activeSavedPreset = s.userPresets.find((up) => up.id === s.activeKey);

  return (
    <div className="wizard-screen">
      <div className="w3-grid">
        <div className="card w3-left">
          <div className="card-h"><h2>Edit captions</h2><span className="note">{s.presets.length} styles — including Premium &amp; Multiline</span></div>
          <div className="studio-tabs">
            <button className={"studio-tab" + (tab === "themes" ? " active" : "")} onClick={() => setTab("themes")}><Icons.library /><span className="studio-tab-lbl">Themes</span></button>
            <button className={"studio-tab" + (tab === "style" ? " active" : "")} onClick={() => setTab("style")}><Icons.create /><span className="studio-tab-lbl">Customize</span></button>
            <button className={"studio-tab" + (tab === "presets" ? " active" : "")} onClick={() => setTab("presets")}><Icons.download /><span className="studio-tab-lbl">My presets</span></button>
            <button className={"studio-tab" + (tab === "transcript" ? " active" : "")} onClick={() => setTab("transcript")}><Icons.bolt /><span className="studio-tab-lbl">Transcript</span></button>
          </div>

          {tab === "themes" && (
            <div className="studio-pane">
              <div className="style-head">
                <label className="eyebrow">Caption styles</label>
                <select aria-label="Filter caption styles" value={filter} onChange={e => s.setGalleryFilter(e.target.value)}>
                  {["all","Premium","Multiline","Multicolour","Original"].map(group =>
                    <option key={group} value={group}>{group === "all" ? "All styles" : group}</option>)}
                </select>
              </div>
              <div className="chips">
                {trending.map((p) => <Chip key={p.id} label={p.label} trending cfg={p} active={s.activeKey === p.id} onClick={() => s.selectPreset(p.id)} />)}
                {standard.map((p) => <Chip key={p.id} label={p.label} cfg={p} active={s.activeKey === p.id} onClick={() => s.selectPreset(p.id)} />)}
              </div>
            </div>
          )}

          {tab === "style" && (
            <div className="studio-pane">
              <div className="style-head">
                <span className="eyebrow">Customize</span>
                <div className="style-actions">
                  {s.userPresets.length > 0 && (
                    <>
                      <select aria-label="Load a saved caption style" value={activeSavedPreset?.id || ""}
                        onChange={(e) => {
                          const selected = s.userPresets.find((up) => up.id === e.target.value);
                          if (selected) s.selectUserPreset(selected);
                        }}>
                        <option value="">Saved styles</option>
                        {s.userPresets.map((up) => <option key={up.id} value={up.id}>{up.label}</option>)}
                      </select>
                      {activeSavedPreset && <button type="button" className="save-btn" title="Delete saved style"
                        aria-label={"Delete saved style " + activeSavedPreset.label}
                        onClick={() => s.removeUserPreset(activeSavedPreset.id)}>Remove</button>}
                    </>
                  )}
                  <button className="save-btn" onClick={() => setSaveOpen((v) => !v)}><Icons.download /> Save current</button>
                </div>
              </div>
              <SaveBlock s={s} open={saveOpen} setOpen={setSaveOpen} />
              <Customizer studio={s} onFontUpload={onFontUpload} />
            </div>
          )}

          {tab === "presets" && (
            <div className="studio-pane">
              <div className="style-head">
                <span className="eyebrow">My styles</span>
                <button className="save-btn" onClick={() => setSaveOpen((v) => !v)}><Icons.download /> Save current</button>
              </div>
              <SaveBlock s={s} open={saveOpen} setOpen={setSaveOpen} />
              <div className="chips">
                {s.userPresets.map((up) => (
                  <Chip key={up.id} label={up.label} custom active={s.activeKey === up.id}
                    cfg={effectiveCfg(s.presets, up.base, up.overrides)}
                    overrides={up.overrides}
                    onClick={() => s.selectUserPreset(up)} onDelete={() => s.removeUserPreset(up.id)} />
                ))}
                {!s.userPresets.length && (
                  <div className="empty" style={{ gridColumn: "1/-1", padding: 24 }}>No saved styles yet — tune a look in <b>Customize</b> and hit “Save current”.</div>
                )}
              </div>
            </div>
          )}

          {tab === "transcript" && (
            <div className="studio-pane">
              <Transcript state={transcript} onSeek={seekTo} currentTime={curTime} />
            </div>
          )}
        </div>

        <div className="w3-right">
          <PhonePreview cfg={studio.cfg} cinematic={studio.cinematic} language={language} media={media}
            preparing={!media && sourceReady} aspect={aspect} fit={fit} backgroundBlur={backgroundBlur} blurStrength={blurStrength} barText={barText}
            barTextColor={barTextColor} barTextAnim={barTextAnim}
            signature={signature} setSig={setSig} videoRef={videoRef}
            overrides={studio.overrides} setOverride={studio.setOverride} />
          <div className="note" style={{ marginTop: 10, textAlign: "center" }}>Drag the caption on the preview to place it anywhere in the frame.</div>
          <BackgroundBlurControl id="caption-background-blur" enabled={backgroundBlur} strength={blurStrength}
            onEnabled={setBackgroundBlur} onStrength={setBlurStrength} />
          <div className={"prep prep-" + (prepView.phase || "idle")}>
            <div className="prep-row">
              <span className="prep-msg">
                {["downloading", "transcribing", "downloaded", "idle"].includes(prepView.phase) && <span className="spinner" />}
                {prepView.phase === "ready" && <span className="prep-ok">✓</span>}
                {prepView.phase === "error" && <span className="prep-ok" style={{ color: "var(--danger)" }}>!</span>}
                {prepView.message || "Preparing video…"}
              </span>
              {prepView.pct != null && <span className="prep-pct">{prepView.pct}%</span>}
            </div>
            <div className="track"><div className={"fill" + (prepView.pct == null ? " indeterminate" : "")} style={prepView.pct == null ? {} : { width: prepView.pct + "%" }} /></div>
          </div>
        </div>
      </div>

      <div className="wizard-nav">
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={onNext}>Next →</button>
      </div>
    </div>
  );
}
