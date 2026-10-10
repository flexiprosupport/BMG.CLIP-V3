import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

// One app-wide stream; EventSource reconnects itself. Poll only if disconnected.
export function useProcessing() {
  const [data,setData]=useState({jobs:[],counts:{},batches:[],total:0});
  const [connected,setConnected]=useState(false);
  const [notice,setNotice]=useState(null);
  const previous=useRef(new Map());
  const seen=useRef(false);
  useEffect(()=>{
    let alive=true,online=false;
    function apply(value){
      if(!alive)return;
      if(seen.current){
        const completed=value.jobs.filter(j=>j.status==="done" && previous.current.has(j.id) && previous.current.get(j.id)!=="done");
        if(completed.length)setNotice({text:`${completed.length} video${completed.length===1?"":"s"} finished. Clips are ready in Library.`,at:Date.now()});
      }
      previous.current=new Map(value.jobs.map(j=>[j.id,j.status]));seen.current=true;setData(value);
    }
    const stream=new EventSource("/api/jobs/events");
    stream.onopen=()=>{online=true;setConnected(true)};
    stream.onmessage=e=>{try{apply(JSON.parse(e.data))}catch{}};
    stream.onerror=()=>{online=false;if(alive)setConnected(false)};
    async function poll(){if(!online)try{apply(await api.jobs())}catch{}}
    poll();const timer=setInterval(poll,3000);
    return()=>{alive=false;stream.close();clearInterval(timer)};
  },[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),9000);return()=>clearTimeout(t)},[notice]);
  return {...data,connected,notice,dismissNotice:()=>setNotice(null)};
}
