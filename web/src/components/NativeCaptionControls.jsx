import { templates } from "../../../caption_renderer/engine.mjs";
import { palettes } from "../../../caption_renderer/adapter.mjs";

const motions = [...new Set(templates.map(p => p.motion))];
export default function NativeCaptionControls({ studio }) {
  const { cfg, setOverride } = studio;
  if (cfg.engine !== "canvas") return null;
  const template = templates.find(p => "studio:" + p.id === cfg.id);
  const supportedMotions = template?.compositionId ? ["none","pop","fade-in"] : motions;
  return <div className="cz-field">
    <label className="cz-label">Style palette &amp; movement</label>
    <div className="cz-row2">
      <div className="cz-select">
        <select aria-label="Caption palette" value={cfg.native_palette || "original"} onChange={e => setOverride("native_palette", e.target.value)}>
          <option value="original">Original palette</option>
          {palettes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="cz-select">
        <select aria-label="Caption movement" value={cfg.native_motion ?? template?.motion ?? "none"} onChange={e => setOverride("native_motion", e.target.value)}>
          {supportedMotions.map(m => <option key={m} value={m}>{m.replaceAll("-", " ").replaceAll("_", " ")}</option>)}
        </select>
      </div>
    </div>
    <div className="cz-row2" style={{ marginTop: 8 }}>
      <div className="cz-select">
        <select aria-label="Caption pacing" value={cfg.native_pacing ?? template?.pacing ?? "chunk"} onChange={e => setOverride("native_pacing",e.target.value)}>
          <option value="chunk">Phrase at a time</option><option value="word">Word at a time</option>
        </select>
      </div>
      <label className="cz-label">Caption width
        <input aria-label="Caption width" type="range" min="20" max="100"
          value={cfg.native_max_width ?? Math.round((template?.maxWidth || .86)*100)}
          onChange={e => setOverride("native_max_width",Number(e.target.value))} />
      </label>
    </div>
  </div>;
}
