// Thin API client for the FastAPI backend. All paths are proxied by Vite in dev
// (see vite.config.js) so these are plain same-origin fetches.

async function jget(path) {
  const r = await fetch(path);
  if (!r.ok) {const error=new Error(`${path} → ${r.status}`);error.status=r.status;throw error}
  return r.json();
}

async function jpost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(Array.isArray(data.detail)?data.detail.map(e=>`${e.loc?.slice(1).join(".")||"Input"}: ${e.msg}`).join(" · "):data.detail || `${path} → ${r.status}`);
  return data;
}

const restartMessage="The app interface was updated, but an older or incompatible backend is running. Use Stop BMG.CLIP-V3, then reopen BMG.CLIP-V3 from your desktop. If needed, install the latest Setup.";
async function requireCurrentBackend(){
  const health=await jget("/health");
  if(health.api_contract!==3)throw new Error(restartMessage);
}
function validQueue(value){
  if(!Array.isArray(value?.jobs)||!value.counts||!Array.isArray(value.batches))throw new Error("The backend returned an invalid Processing response. "+restartMessage);
  return value;
}
async function queueState(limit=1000){
  try{return validQueue(await jget(`/api/jobs?limit=${limit}`))}
  catch(error){if(error.status===404||error.status===405)throw new Error("Processing is unavailable in the running backend. "+restartMessage);throw error}
}
async function requireQueue(){await requireCurrentBackend();await queueState(1)}

export const api = {
  health: () => jget("/health"),
  modelStatus: () => jget("/api/model-status"),
  retryModel: () => jpost("/api/model-retry", {}),
  devices: () => jget("/api/devices"),

  captionStyles: () => jget("/api/caption-styles"),
  fonts: () => jget("/api/fonts"),
  history: () => jget("/api/history"),
  generate: async (payload) => {
    await requireQueue();
    const receipt=await jpost("/api/generate",payload);
    try{
      if(!receipt.job_id)throw Error("Missing job id");
      const job=await jget(`/api/jobs/${receipt.job_id}`);
      if(job.id!==receipt.job_id)throw Error("Job id mismatch");
      return {...receipt,job};
    }catch(error){throw new Error("Processing was requested, but the backend could not confirm the saved job. Your editor settings are kept. Retry with the same settings to avoid duplicates, or open Processing. "+error.message)}
  },
  jobs: queueState,
  batch: async (payload) => {
    await requireQueue();
    const receipt=await jpost("/api/batches",payload);
    try{
      const saved=await jget(`/api/batches/${receipt.batch_id}`);
      if(!saved.jobs?.length)throw Error("No saved jobs");
      return {...receipt,jobs:saved.jobs};
    }catch(error){throw new Error("The batch was requested, but its saved jobs could not be confirmed. Your editor settings are kept. Retry with the same settings to avoid duplicates. "+error.message)}
  },
  validateLinks: async (urls) => {
    await requireCurrentBackend();
    try{return await jpost("/api/jobs/validate",{urls})}
    catch(error){
      if(error.message==="Not Found")throw new Error("The running backend is missing link validation. Stop BMG.CLIP-V3 and reopen the updated desktop app.");
      throw error;
    }
  },
  retryJob: (id) => jpost(`/api/jobs/${id}/retry`,{}),
  queueSettings: () => jget("/api/jobs/settings"),
  saveQueueSettings: (values) => jpost("/api/jobs/settings",values),
  batchAction: (id,action) => jpost(`/api/batches/${id}/${action}`,{}),
  removeJob: async (id) => {
    const r=await fetch(`/api/jobs/${id}`,{method:"DELETE"});
    const value=await r.json();if(!r.ok)throw Error(value.detail||"Could not remove job.");return value;
  },
  cancel: (jobId) => jpost(`/api/cancel/${jobId}`, {}),
  musicSuggest: (sourceId, language) => jget(`/api/music-suggest/${sourceId}` + (language ? `?language=${encodeURIComponent(language)}` : "")),
  transcript: (sourceId, language) => jget(`/api/transcript/${sourceId}` + (language ? `?language=${encodeURIComponent(language)}` : "")),
  result: (jobId) => jget(`/api/result/${jobId}`),
  prefetch: (video_url) => jpost("/api/prefetch", { video_url }),
  prefetchStatus: (id) => jget(`/api/prefetch/${id}`),
  pretranscribe: (source_id, device, language) => jpost("/api/pretranscribe", { source_id, device, language }),
  pretranscribeStatus: (id) => jget(`/api/pretranscribe/${id}`),
  deleteClip: async (clipId, index) => {
    const r = await fetch(`/api/clip/${clipId}/${index}`, { method: "DELETE" });
    return r.ok;
  },
  clipSourceUrl: (clipId, index) => `/api/clip/${clipId}/${index}/source`,
  reframeInfo: (clipId, index) => jget(`/api/clip/${clipId}/${index}/reframe`),
  reframeClip: (clipId, index, keyframes) => jpost(`/api/clip/${clipId}/${index}/reframe`, { keyframes }),
  music: () => jget("/api/music"),
  uploadMusic: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/music/upload", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Music upload failed.");
    return d; // { name, file }
  },
  uploadFont: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/fonts/upload", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Font upload failed.");
    return d; // { family, file }
  },
  upload: async (file, onProgress) =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 200 && d.upload_id) resolve(d);
        else reject(new Error(d.detail || "Upload failed."));
      };
      xhr.onerror = () => reject(new Error("Upload failed — network error."));
      xhr.send(fd);
    }),
};

// Subscribe to a job's Server-Sent Events. Returns a close() fn.
export function streamProgress(jobId, onSnap, onError) {
  const es = new EventSource(`/api/progress/${jobId}`);
  es.onmessage = (ev) => {
    try { onSnap(JSON.parse(ev.data)); } catch {}
  };
  es.onerror = async () => {
    es.close();
    // Fall back to a one-shot result fetch so we don't lose the final state.
    try {
      const r = await fetch(`/api/result/${jobId}`);
      if (r.ok) { onSnap(await r.json()); return; }
    } catch {}
    if (onError) onError();
  };
  return () => es.close();
}
