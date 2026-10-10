import { useEffect, useMemo, useRef, useState } from "react";
import { api, streamProgress } from "../api.js";
import { parseEmbed, cineActive } from "../caption.js";
import { useStudio } from "../useStudio.js";
import { usePrep } from "../usePrep.js";
import ReframeEditor from "../components/ReframeEditor.jsx";
import Screen1Input from "./create/Screen1Input.jsx";
import Screen2Settings from "./create/Screen2Settings.jsx";
import Screen3Captions from "./create/Screen3Captions.jsx";
import Screen4Effects from "./create/Screen4Effects.jsx";
import Screen5Music from "./create/Screen5Music.jsx";
import Screen6Review from "./create/Screen5Review.jsx";
import Screen7Export from "./create/Screen6Export.jsx";

// Screen numbers 1-7: Source, Settings, Captions, Effects, Music, Review, Export.
// (Component file names kept as Screen5Review.jsx/Screen6Export.jsx from an
// earlier layout — only the wizard's step NUMBERS shifted when Music became
// its own screen.)
const WIZARD_LABELS = ["Source", "Settings", "Captions", "Effects", "Music", "Review", "Export"];

function targetAspectNum(aspect, fit) {
  if (fit === "square") return 1;
  return aspect === "16:9" ? 16 / 9 : 9 / 16;
}

export default function Create({ step, setStep, onSubmitted, onProcessing }) {
  const [presets, setPresets] = useState([]);
  const [fonts, setFonts] = useState({ bundled: [], multilingual: [], user: [] });
  const [devices, setDevices] = useState(["auto"]);

  // Source
  const [source, setSource] = useState("url");
  const [url, setUrl] = useState("");
  const [extraUrls,setExtraUrls]=useState([]);
  const [videoOverrides,setVideoOverrides]=useState({});
  const submissionToken=useRef(null);
  const submissionSignature=useRef(null);
  const urls=[...new Set([url,...extraUrls].map(s=>s.trim()).filter(Boolean))];
  const isBatch=source==="url"&&extraUrls.length>0;
  const [upload, setUpload] = useState(null);
  const [upPct, setUpPct] = useState(null);
  const [objUrl, setObjUrl] = useState(null);
  const objUrlRef = useRef(null);
  const uploadEpoch = useRef(0);
  const [drag, setDrag] = useState(false);

  // Output
  const [aspect, setAspect] = useState("9:16");
  const [fit, setFit] = useState("crop");
  const [backgroundBlur, setBackgroundBlurState] = useState(false);
  const [blurStrength, setBlurStrength] = useState(50);
  const [barText, setBarText] = useState("");
  const [barTextColor, setBarTextColor] = useState("#FFFFFF");
  const [barTextAnim, setBarTextAnim] = useState("none");
  const [numClips, setNumClips] = useState(3);
  const [clipLen, setClipLen] = useState(null);   // target clip length in seconds; null = Auto (adaptive)
  const [language, setLanguage] = useState("auto");
  const [device, setDevice] = useState("auto");
  const [squareCorners, setSquareCorners] = useState("round");

  const outputAspect = fit === "square" ? "1:1" : aspect;
  function changeBackgroundBlur(enabled) {
    setBackgroundBlurState(enabled);
    setFit((current) => current === "square" ? "square" : enabled ? "blur" : "crop");
  }
  function setOutputAspect(v) {
    if (v === "1:1") setFit("square");
    else {
      setFit(backgroundBlur ? "blur" : "crop");
      setAspect(v);
    }
  }

  // Background music
  const [tracks, setTracks] = useState([]);
  const [musicTrack, setMusicTrack] = useState("");
  const [musicVolume, setMusicVolume] = useState(35);
  const [musicDuck, setMusicDuck] = useState(70);
  const [musicStart, setMusicStart] = useState(0);
  const [musicSuggest, setMusicSuggest] = useState(null);

  // Signature / watermark
  const [signature, setSignature] = useState({ enabled: false, text: "BMG.CLIP-V3", pos_x: 50, pos_y: 92, size: 34, color: "#FFFFFF", opacity: 75 });
  const setSig = (k, v) => setSignature((s) => ({ ...s, [k]: v }));

  // Generate
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState(null);
  const [clips, setClips] = useState([]);
  const [clipId, setClipId] = useState(null);
  const [error, setError] = useState("");
  const closeRef = useRef(null);
  const jobRef = useRef(null);
  const generationEpoch = useRef(0);
  const fileRef = useRef(null);
  const generatedRef = useRef(false);

  // Reframe
  const [reframeTarget, setReframeTarget] = useState(null); // the clip object being reframed
  const reframeCache = useRef({}); // clipId:index -> last keyframes edited this session

  const videoRef = useRef(null);
  const [curTime, setCurTime] = useState(0);
  const [vidDuration, setVidDuration] = useState(null);
  const [transcript, setTranscript] = useState({ ready: false, loading: false, segments: [], duration: null });

  const studio = useStudio(presets, fonts, language);
  const prep = usePrep(device, language);

  function startPrep() {
    if(isBatch)return;
    if (source === "url" && url.trim()) prep.startUrl(url.trim());
    else if (source === "upload" && upload?.upload_id) prep.startUpload(upload.upload_id);
  }

  // Background download/pre-transcribe kicks off the moment Screen 2 is
  // entered, so it's finished (or well underway) by the time Screen 3/5 need it.
  useEffect(() => {
    if (step >= 2) startPrep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step >= 2, source, upload?.upload_id, url]);

  useEffect(() => {
    api.captionStyles().then((p) => setPresets(p || [])).catch(() => {});
    api.fonts().then((f) => setFonts(f || { bundled: [], multilingual: [], user: [] })).catch(() => {});
    api.devices().then((d) => { setDevices(d.devices || ["auto"]); }).catch(() => {});
    api.music().then((m) => setTracks(m.tracks || [])).catch(() => {});
    return () => {
      uploadEpoch.current += 1;
      if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
      closeRef.current && closeRef.current();
    };
  }, []);

  const refreshMusic = () => api.music().then((m) => setTracks(m.tracks || [])).catch(() => {});
  async function onMusicUpload(file) { const t = await api.uploadMusic(file); await refreshMusic(); return t; }

  useEffect(() => {
    const all = [...(fonts.user || []), ...(fonts.multilingual || []), ...(fonts.bundled || [])];
    let css = "";
    all.forEach((f) => { css += `@font-face{font-family:'${f.family}';src:url('/fonts/${encodeURIComponent(f.file)}');font-display:swap;}`; });
    let el = document.getElementById("cf-fontfaces");
    if (!el) { el = document.createElement("style"); el.id = "cf-fontfaces"; document.head.appendChild(el); }
    el.textContent = css;
  }, [fonts]);

  const media = useMemo(() => {
    if (source === "upload") return objUrl ? { kind: "video", src: objUrl } : null;
    if (prep.downloadId) return { kind: "video", src: `/api/download/${prep.downloadId}/video` };
    return parseEmbed(url.trim());
  }, [source, objUrl, url, prep.downloadId]);

  const srcId = (source === "upload" ? upload?.upload_id : prep.downloadId) || null;
  useEffect(() => {
    if (!srcId) { setMusicSuggest(null); return; }
    let alive = true;
    api.musicSuggest(srcId, language === "auto" ? null : language)
      .then((m) => { if (alive && m && m.ready) setMusicSuggest(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, [srcId, language, prep.prep?.phase]);

  useEffect(() => {
    if (!srcId) { setTranscript({ ready: false, loading: false, segments: [], duration: null }); return; }
    let alive = true;
    setTranscript((t) => ({ ...t, loading: true }));
    api.transcript(srcId, language === "auto" ? null : language)
      .then((d) => { if (alive) setTranscript({ ready: !!d.ready, loading: false, segments: d.segments || [], duration: d.duration ?? null }); })
      .catch(() => { if (alive) setTranscript((t) => ({ ...t, loading: false })); });
    return () => { alive = false; };
  }, [srcId, language, prep.prep?.phase]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) { setVidDuration(null); return; }
    const onTime = () => setCurTime(v.currentTime);
    const onMeta = () => setVidDuration(isFinite(v.duration) ? v.duration : null);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1 && isFinite(v.duration)) setVidDuration(v.duration);
    return () => { v.removeEventListener("timeupdate", onTime); v.removeEventListener("loadedmetadata", onMeta); };
  }, [media]);

  function seekTo(t) {
    if (t == null || !isFinite(t)) return;
    const v = videoRef.current;
    if (v) { try { v.currentTime = Math.max(0, t); } catch { /* not seekable yet */ } }
    setCurTime(t);
  }

  async function doUpload(file) {
    const epoch = ++uploadEpoch.current;
    if (objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
    }
    if (!file) { setSource("url"); setUpload(null); setUpPct(null); setObjUrl(null); return; }
    setSource("upload"); setUpload(null); setUpPct(0); setError("");
    objUrlRef.current = URL.createObjectURL(file);
    setObjUrl(objUrlRef.current);
    try {
      const d = await api.upload(file, (pct) => { if (epoch === uploadEpoch.current) setUpPct(pct); });
      if (epoch !== uploadEpoch.current) return;
      setUpload({ upload_id: d.upload_id, filename: d.filename || file.name }); setUpPct(null);
    } catch (e) {
      if (epoch !== uploadEpoch.current) return;
      setError(e.message); setUpPct(null);
    }
  }

  async function onFontUpload(file) {
    const d = await api.uploadFont(file);
    const fresh = await api.fonts();
    setFonts(fresh);
    return d.family;
  }

  function changeLanguage(v) { setLanguage(v); studio.onLanguageChange(v); prep.relang(v); }

  const sourceReady = source === "upload" ? !!upload : urls.length>0&&urls.length<=50&&extraUrls.every(s=>s.trim());

  const prepView = useMemo(() => {
    if (source === "upload" && upPct != null && !upload) {
      return { phase: "downloading", pct: upPct, message: upPct >= 100 ? "Processing upload…" : "Uploading your video…" };
    }
    if(isBatch)return {phase:"ready",pct:null,message:`${urls.length} videos selected. Shared settings apply to all; processing starts only after Review.`};
    return prep.prep;
  }, [source, upPct, upload, prep.prep,isBatch,urls.length]);

  function buildSettings(){
    const payload = {
      aspect_ratio: aspect, fit_mode: fit,
      background_blur: backgroundBlur,
      blur_strength: blurStrength,
      bar_text: fit === "square" ? (barText.trim() || null) : null,
      bar_text_color: barTextColor, bar_text_anim: barTextAnim,
      num_clips: numClips, device, caption_style: studio.styleId,
      language: language === "auto" ? null : language,
      square_corners: squareCorners,
      clip_length:clipLen,caption_overrides:studio.overrides,
      cinematic:cineActive(studio.cinematic)?studio.cinematic:null,
      music_track:musicTrack||null,music_volume:musicVolume,music_duck:musicDuck,music_start:musicStart,
      signature:signature.enabled&&(signature.text||"").trim()?signature:null,
    };
    if (clipLen != null) payload.clip_length = clipLen;
    if (Object.keys(studio.overrides).length) payload.caption_overrides = studio.overrides;
    if (cineActive(studio.cinematic)) payload.cinematic = studio.cinematic;
    if (musicTrack) { payload.music_track = musicTrack; payload.music_volume = musicVolume; payload.music_duck = musicDuck; payload.music_start = musicStart; }
    if (signature.enabled && (signature.text || "").trim()) payload.signature = signature;
    return JSON.parse(JSON.stringify(payload));
  }

  async function continueSource(){
    setError("");
    try{
      if(source==="url"){
        const check=await api.validateLinks(urls);
        if(check.invalid.length){setError(check.invalid.map(v=>`${v.url}: ${v.error}`).join(" · "));return}
        setUrl(check.valid[0]||"");setExtraUrls(check.valid.slice(1));
      }
      startPrep();setStep(2);
    }catch(e){setError(e.message)}
  }

  function pasteUrls(text){
    const next=[...new Set(text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
    if(next.length>50){setError("Use at most 50 video links per batch.");return}
    setSource("url");setUrl(next[0]||"");setExtraUrls(next.slice(1));setVideoOverrides({});
  }

  async function generate() {
    if(busy)return;
    const epoch = ++generationEpoch.current;
    setError("");
    const payload=buildSettings();
    if (source === "upload") {
      if (!upload) { setError("Wait for the upload to finish."); return; }
      payload.upload_id = upload.upload_id; payload.upload_name = upload.filename;
    } else {
      if (!url.trim()) { setError("Paste a video URL."); return; }
      payload.video_url = url.trim();
      if (prep.downloadId) payload.download_id = prep.downloadId;
    }

    const signature=JSON.stringify({payload,urls:isBatch?urls:null,overrides:isBatch?videoOverrides:null});
    if(submissionSignature.current!==signature){submissionToken.current=null;submissionSignature.current=signature}
    submissionToken.current ||= crypto.randomUUID();
    payload.submission_id=submissionToken.current;
    setBusy(true);
    try {
      if(isBatch){
        const check=await api.validateLinks(urls);
        if(check.invalid.length)throw Error(check.invalid.map(v=>v.error).join(" · "));
        const receipt=await api.batch({title:`Batch · ${check.valid.length} videos`,jobs:check.valid.map((video_url,i)=>{
          const job={...payload,...videoOverrides[video_url],video_url,submission_id:`${submissionToken.current}:${i}`};
          delete job.upload_id;delete job.upload_name;delete job.download_id;return job;
        })});
        setBusy(false);submissionToken.current=null;restart();onSubmitted?.(receipt.jobs);return;
      }
      const { job_id,job } = await api.generate(payload);
      jobRef.current = job_id;
      setBusy(false);submissionToken.current=null;restart();onSubmitted?.([job]);
    } catch (e) { if (epoch === generationEpoch.current) { setBusy(false); setError(e.message); } }
  }

  function cancelGenerate() {
    generationEpoch.current += 1;
    if (jobRef.current) api.cancel(jobRef.current).catch(() => {});
    jobRef.current = null;
    closeRef.current && closeRef.current();
    setBusy(false);
    setSnap({ stage: "cancelled", status: "cancelled", progress: 0, message: "Cancelled. Go back and return to retry." });
    setError("");
    generatedRef.current = true;
  }

  function openReframe(clip) {
    setReframeTarget(clip);
  }
  function closeReframe() { setReframeTarget(null); }
  function onReframeSaved(index, newUrl, keyframes) {
    reframeCache.current[`${clipId}:${index}`] = keyframes;
    setClips((cs) => cs.map((c) => (c.index === index ? { ...c, url: newUrl } : c)));
    setReframeTarget(null);
  }

  function restart() {
    setStep(1);
    setSource("url"); setUrl(""); setUpload(null); setUpPct(null);
    setExtraUrls([]);setVideoOverrides({});
    if (objUrl) URL.revokeObjectURL(objUrl);
    setObjUrl(null);
    setClips([]); setSnap(null); setError(""); setClipId(null);
    generatedRef.current = false;
    prep.reset();
  }

  if (reframeTarget) {
    const key = `${clipId}:${reframeTarget.index}`;
    return (
      <ReframeEditor
        clipId={clipId}
        clip={reframeTarget}
        targetAspect={targetAspectNum(aspect, fit)}
        initialKeyframes={reframeCache.current[key]}
        onClose={closeReframe}
        onSaved={onReframeSaved}
      />
    );
  }

  const showStepper = step >= 2 && step <= 7;

  return (
    <>
      {step === 1 && (
        <Screen1Input
          source={source} setSource={setSource} url={url} setUrl={setUrl}
          upload={upload} upPct={upPct} drag={drag} setDrag={setDrag} fileRef={fileRef}
          doUpload={doUpload} onClear={() => doUpload(null)} sourceReady={sourceReady} error={error}
          onContinue={continueSource}
          onPasteUrls={pasteUrls}
          batchInput={source==="url"&&<div className="batch-input">
            {extraUrls.map((value,index)=><div className="batch-url-row" key={index}><label htmlFor={`batch-url-${index}`}>Video {index+2}</label><input id={`batch-url-${index}`} value={value} placeholder="https://…" onChange={e=>setExtraUrls(rows=>rows.map((s,i)=>i===index?e.target.value:s))}/><button className="btn btn-ghost" onClick={()=>setExtraUrls(rows=>rows.filter((_,i)=>i!==index))}>Remove</button></div>)}
            <button className="btn btn-ghost" disabled={extraUrls.length>=49} onClick={()=>setExtraUrls(rows=>[...rows,""])}>+ Add Another Link</button>
            <details><summary>Paste multiple links</summary><textarea aria-label="Paste video links" placeholder="One video URL per line" onPaste={e=>{e.preventDefault();pasteUrls(e.clipboardData.getData("text"))}} onBlur={e=>{if(e.target.value.trim()){pasteUrls(e.target.value);e.target.value=""}}}/></details>
            <p className="note">{urls.length} video{urls.length===1?"":"s"} selected · duplicate links are removed · maximum 50</p>
          </div>}
        />
      )}

      {step === 2 && (
        <Screen2Settings
          media={media} sourceReady={sourceReady} prepView={prepView}
          outputAspect={outputAspect} setOutputAspect={setOutputAspect}
          backgroundBlur={backgroundBlur} setBackgroundBlur={changeBackgroundBlur}
          blurStrength={blurStrength} setBlurStrength={setBlurStrength}
          squareCorners={squareCorners} setSquareCorners={setSquareCorners}
          barText={barText} setBarText={setBarText} barTextColor={barTextColor} setBarTextColor={setBarTextColor}
          barTextAnim={barTextAnim} setBarTextAnim={setBarTextAnim}
          language={language} changeLanguage={changeLanguage}
          device={device} setDevice={setDevice} devices={devices}
          numClips={numClips} setNumClips={setNumClips} clipLen={clipLen} setClipLen={setClipLen}
          studio={studio} fonts={fonts} aspect={aspect} fit={fit} signature={signature} setSig={setSig} videoRef={videoRef}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
          nextEnabled={!["downloading", "idle"].includes(prepView.phase)}
        />
      )}

      {step === 3 && (
        <Screen3Captions
          studio={studio} language={language} onFontUpload={onFontUpload}
          media={media} prepView={prepView} sourceReady={sourceReady}
          transcript={transcript} curTime={curTime} seekTo={seekTo} videoRef={videoRef} duration={vidDuration}
          aspect={aspect} fit={fit} backgroundBlur={backgroundBlur} setBackgroundBlur={changeBackgroundBlur}
          blurStrength={blurStrength} setBlurStrength={setBlurStrength} barText={barText} signature={signature} setSig={setSig}
          onBack={() => setStep(2)} onNext={() => setStep(4)}
        />
      )}

      {step === 4 && (
        <Screen4Effects
          studio={studio} language={language} media={media} sourceReady={sourceReady}
          aspect={aspect} fit={fit} backgroundBlur={backgroundBlur} setBackgroundBlur={changeBackgroundBlur}
          blurStrength={blurStrength} setBlurStrength={setBlurStrength} barText={barText} barTextColor={barTextColor} barTextAnim={barTextAnim}
          signature={signature} setSig={setSig} videoRef={videoRef}
          onBack={() => setStep(3)} onNext={() => setStep(5)}
        />
      )}

      {step === 5 && (
        <Screen5Music
          tracks={tracks} musicTrack={musicTrack} musicVolume={musicVolume} musicDuck={musicDuck}
          musicStart={musicStart} musicSuggest={musicSuggest}
          onTrack={(t) => { setMusicTrack(t); setMusicStart(0); }} onVolume={setMusicVolume} onDuck={setMusicDuck} onStart={setMusicStart}
          onMusicUpload={onMusicUpload} onRefreshMusic={refreshMusic}
          studio={studio} language={language} media={media} sourceReady={sourceReady}
          aspect={aspect} fit={fit} backgroundBlur={backgroundBlur} blurStrength={blurStrength} barText={barText} barTextColor={barTextColor} barTextAnim={barTextAnim}
          signature={signature} setSig={setSig} videoRef={videoRef}
          onBack={() => setStep(4)} onNext={() => setStep(6)}
        />
      )}


      {step === 6 && (
        <section className="card queue-review">
          <div className="card-h"><h2>Review & start processing</h2><span className="badge">{isBatch?`${urls.length} videos`:"Single video"}</span></div>
          <p>Nothing is rendered until you start processing. Jobs continue locally when you switch pages or close this browser tab.</p>
          <p className="note">Shared settings: {outputAspect} · {numClips} clips/video · {clipLen?`${clipLen}s`:"Auto length"} · {studio.styleId} · {device.toUpperCase()} · background blur {backgroundBlur?`${blurStrength}%`:"off"}</p>
          {isBatch&&<><p className="note">Optional per-video overrides. “Capture editor settings” saves every current caption, blur, effect, music and signature setting for that video. Return to earlier screens to edit, then capture a different video.</p>
            {urls.map((link,index)=>{
              const override=videoOverrides[link]||{};
              const value={...buildSettings(),...override};
              const change=(key,v)=>setVideoOverrides(old=>({...old,[link]:{...old[link],[key]:v}}));
              return <div className="batch-review-video" key={link}><h3>Video {index+1}</h3><p className="note">{link}</p>
                <div className="processing-toolbar">
                  <label>Aspect<select value={value.fit_mode==="square"?"1:1":value.aspect_ratio} onChange={e=>{const v=e.target.value;setVideoOverrides(o=>({...o,[link]:{...o[link],aspect_ratio:v==="1:1"?"9:16":v,fit_mode:v==="1:1"?"square":value.background_blur?"blur":"crop"}}))}}><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
                  <label>Clips<input type="number" min="1" max="100" value={value.num_clips} onChange={e=>change("num_clips",Number(e.target.value))}/></label>
                  <label>Length<input type="number" min="5" max="600" placeholder="Auto" value={value.clip_length??""} onChange={e=>change("clip_length",e.target.value?Number(e.target.value):null)}/></label>
                  <label>Device<select value={value.device} onChange={e=>change("device",e.target.value)}>{["auto","cpu","cuda"].map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label>
                  <label>Language<input value={value.language||"auto"} onChange={e=>change("language",e.target.value==="auto"?null:e.target.value)}/></label>
                  <label>Caption style<select value={value.caption_style} onChange={e=>change("caption_style",e.target.value)}>{presets.map(p=><option key={p.id} value={p.id}>{p.label||p.id}</option>)}</select></label>
                </div>
                <button className="btn btn-ghost" onClick={()=>setVideoOverrides(o=>({...o,[link]:buildSettings()}))}>Capture editor settings for video {index+1}</button>
                {Object.keys(override).length>0&&<button className="btn btn-ghost" onClick={()=>setVideoOverrides(o=>{const n={...o};delete n[link];return n})}>Reset to shared settings</button>}
              </div>
            })}
          </>}
          {error&&<div className="error">{error}</div>}
          <div className="acts"><button onClick={()=>setStep(5)}>Back to editing</button><button disabled={busy||!sourceReady} className="btn btn-primary" onClick={generate}>{busy?"Submitting…":isBatch?"Start Batch Processing":"Start Processing"}</button><button onClick={onProcessing}>Open Processing</button></div>
        </section>
      )}

      {step === 7 && (
        <Screen7Export clips={clips} onBack={() => setStep(6)} onRestart={restart} />
      )}

      {showStepper && (
        <div className="wizard-steps wizard-steps-bottom">
          {WIZARD_LABELS.slice(1).map((lbl, i) => {
            const n = i + 2;
            return (
              <button key={lbl} type="button" className={"wizard-step" + (step === n ? " active" : step > n ? " done" : "")}
                disabled={n===7&&clips.length===0} onClick={() => setStep(n)} title={`Jump to ${lbl}`}>
                <span className="wizard-step-dot">{step > n ? "✓" : n - 1}</span>
                <span className="wizard-step-lbl">{lbl}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
