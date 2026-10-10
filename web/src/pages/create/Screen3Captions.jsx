import { useState } from "react";
import Customizer from "../../components/Customizer.jsx";
import PhonePreview from "../../components/PhonePreview.jsx";
import Transcript from "../../components/Transcript.jsx";
import { Icons } from "../../components/Icons.jsx";


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

// Screen 3 — Caption editor. Transcription starts in the background on Screen 2;
// the Customize pane holds editing controls and saved styles, with the transcript
// available in its own tab.
export default function Screen3Captions({
  studio, language, onFontUpload, media, prepView, sourceReady,
  transcript, curTime, seekTo, videoRef, aspect, fit, blurStrength, barText, barTextColor, barTextAnim, signature, setSig,
  onBack, onNext,
}) {
  const [tab, setTab] = useState("style");
  const [saveOpen, setSaveOpen] = useState(false);
  const s = studio;
  const activeSavedPreset = s.userPresets.find((up) => up.id === s.activeKey);

  return (
    <div className="wizard-screen">
      <div className="w3-grid">
        <div className="card w3-left">
          <div className="card-h"><h2>Edit captions</h2></div>
          <div className="studio-tabs">
            <button className={"studio-tab" + (tab === "style" ? " active" : "")} onClick={() => setTab("style")}><Icons.create /><span className="studio-tab-lbl">Customize</span></button>
            <button className={"studio-tab" + (tab === "transcript" ? " active" : "")} onClick={() => setTab("transcript")}><Icons.bolt /><span className="studio-tab-lbl">Transcript</span></button>
          </div>

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

          {tab === "transcript" && (
            <div className="studio-pane">
              <Transcript state={transcript} onSeek={seekTo} currentTime={curTime} />
            </div>
          )}
        </div>

        <div className="w3-right">
          <PhonePreview cfg={studio.cfg} cinematic={studio.cinematic} language={language} media={media}
            preparing={!media && sourceReady} aspect={aspect} fit={fit} blurStrength={blurStrength} barText={barText}
            barTextColor={barTextColor} barTextAnim={barTextAnim}
            signature={signature} setSig={setSig} videoRef={videoRef}
            overrides={studio.overrides} setOverride={studio.setOverride} />
          <div className="note" style={{ marginTop: 10, textAlign: "center" }}>Drag the caption on the preview to place it anywhere in the frame.</div>
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
