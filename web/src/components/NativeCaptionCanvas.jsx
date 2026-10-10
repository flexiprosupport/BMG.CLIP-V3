import { useEffect, useRef, useState } from "react";
import { createCaptionRenderer, overridesFromConfig } from "../../../caption_renderer/adapter.mjs";
import { captionSample } from "../caption.js";

export default function NativeCaptionCanvas({ cfg, overrides, language = "en", landscape = false, thumbnail = false }) {
  const ref = useRef(null);
  const [error, setError] = useState("");
  const serialized = JSON.stringify(cfg);
  const overrideKey = JSON.stringify(overrides);
  useEffect(() => {
    let disposed = false, animation, busy = false;
    setError("");
    const canvas = ref.current;
    if (!canvas) return;
    const drawingCanvas = document.createElement("canvas");
    drawingCanvas.width = canvas.width; drawingCanvas.height = canvas.height;
    const sample = captionSample(language);
    const words = sample.words.map((word, i) => ({ word, start: i * .65, end: (i+1) * .65 }));
    const duration = words.length * .65 + .25;
    const actual = overrides ?? overridesFromConfig(cfg.id, cfg);
    const drawingOverrides = thumbnail ? { ...actual, pos_x: 50, pos_y: 50, font_scale: 1.4 } : actual;
    (async () => {
      const renderer = await createCaptionRenderer(drawingCanvas, { style: cfg.id, overrides: drawingOverrides, words, language, duration, fps: 15 });
      if (disposed) return;
      const start = performance.now();
      const tick = async now => {
        if (disposed) return;
        if (!busy) {
          busy = true;
          try {
            const changed = await renderer.draw(thumbnail ? .8 : ((now-start)/1000) % duration);
            if (changed && !disposed) {
              const context = canvas.getContext("2d");
              context.clearRect(0,0,canvas.width,canvas.height);
              context.drawImage(drawingCanvas,0,0);
            }
          }
          catch { if (!disposed) setError("Caption preview unavailable. Try another style or reload."); }
          finally { busy = false; }
        }
        if (!disposed && !thumbnail) animation = requestAnimationFrame(tick);
      };
      await tick(start);
    })().catch(() => { if (!disposed) setError("Caption preview unavailable. Try reloading."); });
    return () => { disposed = true; cancelAnimationFrame(animation); };
  }, [serialized, overrideKey, language, landscape, thumbnail]);
  return <>
    <canvas ref={ref} width={thumbnail ? 360 : landscape ? 1920 : 1080}
      height={thumbnail ? 270 : landscape ? 1080 : 1920}
      style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
      aria-label="Caption style preview" />
    {error && <span role="status" className="note">{error}</span>}
  </>;
}
