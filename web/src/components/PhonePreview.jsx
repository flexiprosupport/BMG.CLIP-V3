import { useEffect, useRef, useState } from "react";
import { captionLineStyle, captionSample, CINE_GRADE_CSS } from "../caption.js";
import NativeCaptionCanvas from "./NativeCaptionCanvas.jsx";

// Clip region inside the 19.5:9 iPhone screen (matches the burned canvas), as
// % of the SCREEN. 9:16 fills the width with thin bands; 16:9 is a centre strip;
// square is a centred 1:1 card.
// Same smoothstep easing as app/effects.py's _gradient_bands (the burned-in
// render), so the CSS preview traces the same soft falloff shape instead of a
// flat linear ramp that can read as a harder-edged band.
function smoothstep(f) { return f * f * (3 - 2 * f); }
function scrimGradient(strengthPct, side) {
  const m = Math.max(0, Math.min(1, (strengthPct || 0) / 100));
  const stops = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const eased = side === "top" ? 1 - smoothstep(f) : smoothstep(f);
    return `rgba(0,0,0,${(m * eased).toFixed(3)}) ${f * 100}%`;
  });
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

function regions(aspect, fit) {
  if (fit === "square") return { box: { left: "2.78%", top: "28.2%", width: "94.4%", height: "43.6%", borderRadius: "14px" }, top: 28.2, height: 43.6 };
  if (aspect === "16:9") return { box: { left: 0, right: 0, top: "37%", height: "26%" }, top: 37, height: 26 };
  return { box: { left: 0, right: 0, top: "8.97%", height: "82.05%" }, top: 8.97, height: 82.05 };
}

function CaptionLine({ cfg, language, fontPx, scale }) {
  const samp = captionSample(language);
  const anim = cfg.karaoke ? "karaoke" : (cfg.animation || "none");
  const [i, setI] = useState(0);
  useEffect(() => {
    if (anim === "none") { setI(0); return; }
    const n = samp.words.length;
    const t = setInterval(() => setI((x) => (x + 1) % n), anim === "one_word" ? 620 : 520);
    return () => clearInterval(t);
  }, [anim, samp.words.length]);

  const base = cfg.primary_color || "#fff";
  const hi = cfg.highlight_color || "#FFD400";
  const style = captionLineStyle(cfg, { fontPx, scale });
  return (
    <span className="cap-line" style={style}>
      {samp.words.map((w, k) => {
        let color, opacity = 1, transform = "none", display = "inline";
        if (anim === "highlight") color = k === i ? hi : base;
        else if (anim === "karaoke") color = k <= i ? hi : base;
        else if (anim === "word_reveal") { opacity = k <= i ? 1 : 0; transform = k <= i ? "scale(1)" : "scale(.7)"; }
        else if (anim === "one_word") display = k === i ? "inline" : "none";
        else if (cfg.animation === "highlight" && k === samp.hl) color = hi;
        return <span key={k} style={{ color, opacity, transform, display, transition: "color .18s, opacity .25s, transform .25s" }}>{w} </span>;
      })}
    </span>
  );
}

export default function PhonePreview({ cfg, overrides, cinematic, language, media, preparing, aspect, fit, backgroundBlur = false, blurStrength = 50, barText, barTextColor, barTextAnim, signature, setSig, setOverride, videoRef }) {
  const screenRef = useRef(null);
  const dragCleanupRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [screenW, setScreenW] = useState(224);
  const reg = regions(aspect, fit);
  const captionReg = fit === "square" ? regions("9:16", "crop") : reg;
  const blurPx = Math.max(0, Math.min(100, blurStrength)) * 0.48 * screenW / (fit !== "square" && aspect === "16:9" ? 1920 : 1080);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  // Measure the screen width so the signature's px size scales like the render.
  useEffect(() => {
    const el = screenRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setScreenW(el.clientWidth));
    ro.observe(el); setScreenW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  function sigDown(e) {
    if (!setSig) return;
    e.preventDefault(); e.stopPropagation();
    const move = (ev) => {
      const r = screenRef.current.getBoundingClientRect();
      const p = ev.touches ? ev.touches[0] : ev;
      const px = Math.max(0, Math.min(100, ((p.clientX - r.left) / r.width) * 100));
      const py = Math.max(0, Math.min(100, ((p.clientY - r.top) / r.height) * 100));
      setSig("pos_x", Math.round(px)); setSig("pos_y", Math.round(py));
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }

  // Caption point (x%, y%) within the SCREEN, kept inside the clip region.
  const free = cfg.pos_x != null && cfg.pos_y != null;
  const yFrac = free ? cfg.pos_y / 100 : ({ top: 0.12, center: 0.5, bottom: 0.88 }[cfg.position || "bottom"]);
  const x = free ? cfg.pos_x : 50;
  // Square mode (un-dragged): caption sits in the black band JUST BELOW the square,
  // top-anchored — matching the burned render (title above, caption hugging below).
  const squareBelow = fit === "square" && !free;
  const y = squareBelow ? (reg.top + reg.height + 2) : (captionReg.top + yFrac * captionReg.height);

  function onDown(e) {
    if (!setOverride || e.isPrimary === false || (e.button != null && e.button !== 0)) return;
    const initialRect = screenRef.current?.getBoundingClientRect();
    if (!initialRect) return;
    dragCleanupRef.current?.();
    e.preventDefault();
    setDragging(true);
    const pointerId = e.pointerId;
    const offsetX = ((e.clientX - initialRect.left) / initialRect.width) * 100 - x;
    const offsetY = ((e.clientY - initialRect.top) / initialRect.height) * 100 - y;
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const r = screenRef.current?.getBoundingClientRect();
      if (!r) return;
      let px = ((ev.clientX - r.left) / r.width) * 100 - offsetX;
      let py = (((ev.clientY - r.top) / r.height) * 100 - offsetY - captionReg.top) / captionReg.height * 100;
      px = Math.max(0, Math.min(100, px));
      py = Math.max(0, Math.min(100, py));
      setOverride("pos_x", Math.round(px * 10) / 10);
      setOverride("pos_y", Math.round(py * 10) / 10);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      dragCleanupRef.current = null;
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      setDragging(false);
      cleanup();
    };
    dragCleanupRef.current = cleanup;
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  }

  const c = cinematic;
  const mediaFilter = (() => {
    let f = CINE_GRADE_CSS[c.color_grade] || "";
    if (c.glow) { const g = 1 + (c.glow_strength || 0) / 100 * 0.12; f += ` brightness(${g.toFixed(3)}) contrast(1.03)`; }
    return f.trim();
  })();
  const barH = c.letterbox ? 5 + (c.letterbox_size || 50) / 100 * 9 : 0;
  const fontPx = Math.max(11, (cfg.font_size || 90) * (cfg.font_scale || 1) * (reg.height / 82.05) * 0.16);

  return (
    <div className="phone">
      <div ref={screenRef} className={"phone-screen" + (!media ? " empty" : "")}>
        <div className="island" />
        <div className="preview-pill"><span className="dot" />Preview</div>

        {media?.kind === "video" && fit === "square" && backgroundBlur && (
          <div className="square-blur-canvas">
            <video className="media-blur-backdrop" style={{ filter: "blur(" + blurPx + "px)" }}
              src={media.src} muted loop autoPlay playsInline aria-hidden="true" tabIndex={-1} />
          </div>
        )}

        {/* A link's embed fills the whole screen (just to confirm the source);
            once downloaded it becomes a real <video> in the clip region below. */}
        {media?.kind === "embed" && (
          <iframe className="embed-fill" src={media.src} allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        )}

        <div className="media-box" style={{ ...reg.box, filter: mediaFilter }}>
          {media?.kind === "video" && fit === "blur" && (
            <video className="media-blur-backdrop" style={{ filter: "blur(" + blurPx + "px)" }} src={media.src} muted loop autoPlay playsInline aria-hidden="true" tabIndex={-1} />
          )}
          {media?.kind === "video" && (
            <video ref={videoRef} className={fit === "blur" ? "media-blur-foreground" : undefined} src={media.src} muted loop autoPlay playsInline />
          )}
          {(!media || media.kind === "unknown") && (
            <div className="media-ph">
              {preparing
                ? <><span className="spinner" /> Preparing preview…</>
                : media?.kind === "unknown"
                  ? "Can't embed this link — it'll still render"
                  : "Add a video to preview"}
            </div>
          )}
          {/* Cinematic overlay (inside the clip region, under captions) */}
          {c.bottom_gradient && <div className="ov" style={{ left: 0, right: 0, bottom: 0, height: (c.bottom_gradient_height || 25) + "%", background: scrimGradient(c.bottom_gradient_strength, "bottom") }} />}
          {c.top_gradient && <div className="ov" style={{ left: 0, right: 0, top: 0, height: (c.top_gradient_height || 20) + "%", background: scrimGradient(c.top_gradient_strength, "top") }} />}
          {c.vignette && <div className="ov" style={{ inset: 0, background: `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,${((c.vignette_strength || 0) / 100 * 0.9).toFixed(3)}) 115%)` }} />}
          {c.letterbox && <>
            <div className="ov" style={{ left: 0, right: 0, top: 0, height: barH + "%", background: "#000" }} />
            <div className="ov" style={{ left: 0, right: 0, bottom: 0, height: barH + "%", background: "#000" }} />
          </>}
        </div>

        {fit === "square" && barText && (
          <div
            key={barText + barTextAnim}
            className={"frame-title" + (barTextAnim === "fade" ? " ft-fade" : barTextAnim === "slide" ? " ft-slide" : "")}
            style={{ top: "22%", whiteSpace: "pre-line", color: barTextColor || "#fff" }}
          >
            {barText}
          </div>
        )}

        {cfg.engine === "canvas" ? <div className={"native-caption-layer" + (dragging ? " dragging" : "")}
          onPointerDown={onDown} title="Drag to position captions" aria-label="Drag to position captions"
          style={{ position: "absolute", left: 0, width: "100%", top: captionReg.top + "%", height: captionReg.height + "%", cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}>
          <NativeCaptionCanvas cfg={cfg} overrides={overrides} language={language} landscape={fit !== "square" && aspect === "16:9"} />
        </div> : <div className={"cap-preview" + (dragging ? " dragging" : "")}
          style={{ left: x + "%", top: y + "%", transform: `translate(-50%, ${squareBelow ? "0" : "-50%"})`, right: "auto", bottom: "auto", maxWidth: "92%" }}>
          <span className="cap-line-wrap" onPointerDown={onDown} title="Drag to position captions" aria-label="Drag to position captions">
            <CaptionLine cfg={cfg} language={language} fontPx={fontPx} scale={0.16} />
          </span>
        </div>}

        {signature?.enabled && (signature.text || "").trim() && (
          <div className="sig-preview" onMouseDown={sigDown}
            style={{
              left: (signature.pos_x != null ? signature.pos_x : 50) + "%",
              top: (signature.pos_y != null ? signature.pos_y : 92) + "%",
              transform: `translate(${-(signature.pos_x != null ? signature.pos_x : 50)}%, ${-(signature.pos_y != null ? signature.pos_y : 92)}%)`,
              color: signature.color || "#fff",
              opacity: (signature.opacity != null ? signature.opacity : 75) / 100,
              fontSize: Math.max(7, (signature.size != null ? signature.size : 34) * screenW / 1080) + "px",
            }}>
            {signature.text}
          </div>
        )}
      </div>
    </div>
  );
}
