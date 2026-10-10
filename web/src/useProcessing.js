import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

// One app-wide stream; EventSource reconnects itself. Poll only if disconnected.
export function useProcessing() {
  const [data,setData]=useState({jobs:[],counts:{},batches:[],total:0});
  const [connected,setConnected]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState(null);
  const previous=useRef(new Map());
  const seen=useRef(false);
  const refreshRef=useRef(()=>{});
  useEffect(()=>{
    let alive=true,online=false;
    function apply(value){
      if(!alive)return;
      if(!Array.isArray(value?.jobs)||!value.counts||!Array.isArray(value.batches))throw Error("The Processing feed returned an invalid job list. Restart the updated desktop app.");
      if(seen.current){
        const completed=value.jobs.filter(j=>j.status==="done" && previous.current.has(j.id) && previous.current.get(j.id)!=="done");
        if(completed.length)setNotice({text:`${completed.length} video${completed.length===1?"":"s"} finished. Clips are ready in Library.`,at:Date.now()});
      }
      previous.current=new Map(value.jobs.map(j=>[j.id,j.status]));seen.current=true;setData(value);setError("");setLoading(false);
    }
    const stream=new EventSource("/api/jobs/events");
    stream.onopen=()=>{online=false};
    stream.onmessage=e=>{try{apply(JSON.parse(e.data));online=true;if(alive)setConnected(true)}catch(e){online=false;if(alive){setConnected(false);setError(e.message);setLoading(false)}}};
    stream.onerror=()=>{online=false;if(alive)setConnected(false)};
    async function poll(force=false){if(!online||force)try{apply(await api.jobs())}catch(e){if(alive){setError(e.message||"Cannot connect to the Processing backend. Reopen the desktop app.");setLoading(false)}}}
    refreshRef.current=()=>poll(true);
    poll();const timer=setInterval(poll,3000);
    return()=>{alive=false;stream.close();clearInterval(timer);refreshRef.current=()=>{}};
  },[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),9000);return()=>clearTimeout(t)},[notice]);
  function acceptJobs(jobs=[]){
    const incoming=jobs.filter(j=>j?.id);
    setData(old=>{
      const map=new Map(old.jobs.map(j=>[j.id,j])),counts={...old.counts};
      let added=0;
      for(const job of incoming)if(!map.has(job.id)){map.set(job.id,job);counts[job.status]=(counts[job.status]||0)+1;added++}
      return {...old,jobs:[...map.values()],counts,total:old.total+added};
    });
    for(const job of incoming)previous.current.set(job.id,job.status);
    seen.current=true;setLoading(false);
  }
  return {...data,connected,loading,error,notice,acceptJobs,refresh:()=>refreshRef.current(),dismissNotice:()=>setNotice(null)};
}
