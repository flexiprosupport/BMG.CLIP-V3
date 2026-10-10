export default function BackgroundBlurControl({ enabled, strength, onEnabled, onStrength, id = "background-blur" }) {
  const setStrength = (value) => {
    if (value === "") return;
    const number = Number(value);
    if (Number.isFinite(number)) onStrength(Math.max(0, Math.min(100, number)));
  };
  return (
    <fieldset className="background-blur-control">
      <legend>Background blur</legend>
      <div className="toggle" role="group" aria-label="Background blur">
        <button type="button" className={!enabled ? "active" : ""} aria-pressed={!enabled}
          onClick={() => onEnabled(false)}>Off</button>
        <button type="button" className={enabled ? "active" : ""} aria-pressed={enabled}
          onClick={() => onEnabled(true)}>Blur background</button>
      </div>
      <div className="blur-intensity-row">
        <label className="fieldlabel" htmlFor={`${id}-strength`}>Blur intensity — {strength}%</label>
        <input type="number" min="0" max="100" step="1" value={strength} disabled={!enabled}
          aria-label="Background blur intensity (percent)" onChange={(e) => setStrength(e.target.value)} />
      </div>
      <input id={`${id}-strength`} className="range" type="range" min="0" max="100" step="1"
        value={strength} disabled={!enabled} onChange={(e) => setStrength(e.target.value)} />
      <div className="note">{enabled
        ? "The video stays sharp; only the background behind it is blurred. Preview updates when the video is ready."
        : "Choose Blur background to enable the intensity slider. Your other editing settings stay unchanged."}</div>
    </fieldset>
  );
}
