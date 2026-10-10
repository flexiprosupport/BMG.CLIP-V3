import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Settings() {
  const [d, setD] = useState(null);
  const [queue,setQueue]=useState(null),[message,setMessage]=useState("");
  useEffect(()=>{api.queueSettings().then(setQueue).catch(e=>setMessage(e.message))},[]);
  useEffect(() => { api.devices().then(setD).catch(() => setD({ devices: [], cuda_available: false })); }, []);

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <div className="card-h"><h2>Compute</h2></div>
      {!d ? <div className="note">Checking…</div> : (
        <>
          <div className="row" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <span className="note" style={{ margin: 0 }}>GPU (CUDA)</span>
            <b>{d.cuda_available ? (d.gpu_name || "Available") : "Not available"}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <span className="note" style={{ margin: 0 }}>Active device</span>
            <b>{(d.default || "—").toUpperCase()}</b>
          </div>
          <div className="row" style={{ justifyContent: "space-between", padding: "10px 0" }}>
            <span className="note" style={{ margin: 0 }}>Available</span>
            <b>{(d.devices || []).map((x) => x.toUpperCase()).join(" · ") || "—"}</b>
          </div>
          <div className="note" style={{ marginTop: 16 }}>
            Everything runs locally — yt-dlp downloads, faster-whisper transcribes, and ffmpeg renders.
            No video or audio leaves this machine.
          </div>
        </>
      )}
      <div className="card-h" style={{marginTop:28}}><h2>Queue Settings</h2></div>
      <p className="note">Defaults favour stability. RAM and disk checks can postpone heavy jobs. GPU transcription is serialized; FFmpeg exports (including Reframe) are limited to one at a time.</p>
      {queue&&<div className="processing-toolbar">
        <label>Processing workers<select value={queue.max_parallel_jobs} onChange={e=>setQueue(q=>({...q,max_parallel_jobs:Number(e.target.value)}))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Download workers<select value={queue.max_downloads} onChange={e=>setQueue(q=>({...q,max_downloads:Number(e.target.value)}))}>{[1,2,3].map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Retries allowed<select value={queue.retry_limit} onChange={e=>setQueue(q=>({...q,retry_limit:Number(e.target.value)}))}>{[0,1,2,3,4,5].map(n=><option key={n}>{n}</option>)}</select></label>
        <button className="btn btn-primary" onClick={async()=>{try{await api.saveQueueSettings(queue);setMessage("Queue settings saved.")}catch(e){setMessage(e.message)}}}>Save queue settings</button>
      </div>}
      <p className="note">{message}</p>
    </div>
  );
}
