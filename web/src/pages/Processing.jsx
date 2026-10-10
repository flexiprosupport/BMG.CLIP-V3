import { useMemo, useState } from "react";
import { api } from "../api.js";
import { Icons } from "../components/Icons.jsx";

const STAGES={queued:"Queued",downloading:"Downloading",analyzing:"Analyzing Video",transcribing:"Transcribing Audio",selecting:"Detecting Highlights",rendering:"Generating Clips",captioning:"Rendering Captions",exporting:"Exporting",done:"Completed",error:"Failed",cancelled:"Cancelled"};
const clock=s=>s==null?"Calculating…":`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const terminal=j=>["done","error","cancelled"].includes(j.status);

function JobCard({job,onLibrary,onAction}){
  const fraction=job.status==="done"?1:job.stage_progress;
  return <article className={"processing-job status-"+job.status}>
    <div className="processing-thumb">{job.clip_id?<img src={`/api/jobs/${job.id}/thumbnail`} alt="" loading="lazy" onError={e=>e.currentTarget.style.visibility="hidden"}/>:<Icons.film/>}</div>
    <div className="processing-body">
      <div className="processing-heading"><h3>{job.source_title||"Video"}</h3><span className={"badge "+(job.status==="done"?"ok":job.status==="error"?"warn":"")}>{job.status==="cancelling"?"Stopping…":STAGES[job.status]||STAGES[job.stage]||job.status}</span></div>
      <p className="note">{job.source_type==="upload"?"Uploaded File":"Video URL"} · {job.duration?clock(job.duration):"Duration pending"} · {job.device||"Device pending"}</p>
      <div className="bar-row"><span className="msg">{job.message}</span><span className="pct">{fraction==null?"—":`${Math.round(fraction*100)}%`}</span></div>
      <div className="track"><div className={"fill"+(fraction==null&&!terminal(job)?" indeterminate":"")} style={fraction==null?{}:{width:Math.round(fraction*100)+"%"}}/></div>
      <div className="processing-stats"><span>Elapsed {clock(job.elapsed)}</span><span>Stage ETA {clock(job.eta)}</span><span>{job.generated_clips}/{job.planned_clips||job.requested_clips} clips ready</span><span>Attempt {job.attempts||0}</span></div>
      {job.error&&<p className="error">{job.error}</p>}
      <div className="acts">
        {!terminal(job)&&<button disabled={job.status==="cancelling"} onClick={()=>onAction(()=>api.cancel(job.id))}>Cancel</button>}
        {["error","cancelled"].includes(job.status)&&<button onClick={()=>onAction(()=>api.retryJob(job.id))}>Retry</button>}
        {job.generated_clips>0&&<button onClick={()=>onLibrary(job.clip_id)}>View Clips</button>}
        {terminal(job)&&<button onClick={()=>{if(confirm("Remove this processing-history item? Finished Library clips will NOT be deleted."))onAction(()=>api.removeJob(job.id))}}>Remove from history</button>}
      </div>
    </div>
  </article>;
}

export default function Processing({processing,onLibrary}){
  const [tab,setTab]=useState("All"),[query,setQuery]=useState(""),[sort,setSort]=useState("newest");
  const [collapsed,setCollapsed]=useState({}),[error,setError]=useState("");
  const [pending,setPending]=useState(false);
  const jobs=useMemo(()=>processing.jobs.filter(j=>{
    const match=tab==="All" || tab==="Active"&&["running","cancelling"].includes(j.status) || tab==="Queued"&&j.status==="queued" || tab==="Completed"&&j.status==="done" || tab==="Failed"&&j.status==="error";
    return match && `${j.source_title} ${j.source} ${j.message}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a,b)=>sort==="oldest"?a.created_at-b.created_at:sort==="status"?a.status.localeCompare(b.status):b.created_at-a.created_at),[processing.jobs,tab,query,sort]);
  const groups=new Map();
  jobs.forEach(job=>{const key=job.batch_id||"single";if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job)});
  async function action(fn){setError("");setPending(true);try{const r=await fn();if(r.errors?.length)setError(r.errors.map(e=>e.error).join(" · "))}catch(e){setError(e.message)}finally{setPending(false)}}
  return <section className="processing-page">
    <div className="processing-toolbar"><div className="tabs">{["All","Active","Queued","Completed","Failed"].map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</div>
      <input aria-label="Search processing jobs" placeholder="Search videos or stages…" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Sort processing jobs" value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="status">By status</option></select>
    </div>
    <p className="note">{processing.connected?"Live updates":"Reconnecting; polling backend…"} · {processing.counts.running||0} processing · {processing.counts.queued||0} queued · {processing.total} jobs in history. Percentages and ETA refer to the current measurable stage, not an invented whole-job percentage.</p>
    {processing.total>processing.jobs.length&&<p className="note">Showing the latest {processing.jobs.length} jobs.</p>}
    {error&&<div className="error">{error}</div>}
    {!jobs.length&&<div className="empty">No matching jobs. Configure a video in Create, then choose Start Processing.</div>}
    {[...groups].map(([id,items])=>{
      const full=processing.jobs.filter(j=>j.batch_id===id);
      const batch=processing.batches.find(b=>b.id===id);
      const complete=batch?.completed??full.filter(j=>j.status==="done").length;
      const total=batch?.total??full.length;
      return <section className="processing-group" key={id}>
        {id!=="single"&&<div className="card processing-batch"><button className="btn btn-ghost" onClick={()=>setCollapsed(c=>({...c,[id]:!c[id]}))}>{collapsed[id]?"▸":"▾"} {batch?.title||"Video batch"} · {total} videos</button>
          <span>{complete}/{total} videos completed ({Math.round(100*complete/Math.max(1,total))}%)</span>
          <button className="btn btn-ghost" disabled={pending} onClick={()=>action(()=>api.batchAction(id,"cancel-queued"))}>Cancel queued</button>
          <button className="btn btn-ghost" disabled={pending} onClick={()=>action(()=>api.batchAction(id,"retry-failed"))}>Retry failed</button>
        </div>}
        {!collapsed[id]&&items.map(job=><JobCard key={job.id} job={job} onLibrary={onLibrary} onAction={action}/>)}
      </section>
    })}
  </section>;
}
