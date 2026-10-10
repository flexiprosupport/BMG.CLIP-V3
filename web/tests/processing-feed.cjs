const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const esbuild=require("esbuild");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../src/useProcessing.js"),"utf8");
const code=esbuild.transformSync(source,{format:"cjs",loader:"js"}).code;
let states=[],refs=[],effects=[],cursor=0,refCursor=0,initial=true,stream,timer;
let queueError=new Error("Processing is unavailable. Stop BMG.CLIP-V3 and reopen.");
const hooks={
 useState(value){const i=cursor++;if(initial)states[i]=value;return [states[i],v=>{states[i]=typeof v==="function"?v(states[i]):v}]},
 useRef(value){const i=refCursor++;if(initial)refs[i]={current:value};return refs[i]},
 useEffect(fn){if(initial)effects.push(fn)},
};
const context={module:{exports:{}},exports:{},require(name){return name==="react"?hooks:{api:{jobs:async()=>{if(queueError)throw queueError;return {jobs:[],counts:{},batches:[],total:0}}}}},
 EventSource:class{constructor(){stream=this}close(){}},
 setInterval(fn){timer=fn;return 1},clearInterval(){},setTimeout(){return 1},clearTimeout(){},console,Date,Map};
context.exports=context.module.exports;
vm.runInNewContext(code,context);
function render(){cursor=0;refCursor=0;const value=context.module.exports.useProcessing();initial=false;return value}
async function flush(){await new Promise(resolve=>setImmediate(resolve))}
(async()=>{
 render();effects.forEach(fn=>fn());await flush();
 let value=render();
 assert.match(value.error,/Processing is unavailable/);
 assert.equal(value.loading,false,"Errors cannot remain disguised as initial loading/empty history");
 value.acceptJobs([{id:"saved-1",status:"queued",generated_clips:0}]);
 value=render();
 assert.equal(value.jobs.length,1);
 assert.equal(value.counts.queued,1);
 value.acceptJobs([{id:"saved-1",status:"queued"}]);
 assert.equal(render().jobs.length,1,"Receipt retries cannot duplicate cards");
 queueError=null;
 stream.onmessage({data:JSON.stringify({jobs:[{id:"saved-1",status:"running",generated_clips:0}],counts:{running:1},batches:[],total:1})});
 value=render();
 assert.equal(value.connected,true);assert.equal(value.error,"");
 stream.onerror();queueError=new Error("Disconnected");
 await timer();await flush();
 value=render();
 assert.equal(value.jobs[0].id,"saved-1","Connection errors retain last confirmed job");
 assert.equal(value.error,"Disconnected");assert.equal(value.connected,false);
 stream.onmessage({data:JSON.stringify({jobs:[{id:"saved-1",status:"done",generated_clips:1}],counts:{done:1},batches:[],total:1})});
 value=render();
 assert.equal(value.error,"");assert.equal(value.connected,true);
 assert.match(value.notice.text,/finished/);
 console.log("PASS: feed failures are visible; confirmed jobs appear immediately once; disconnect keeps jobs; reconnect restores updates/completion notice.");
})().catch(error=>{console.error(error);process.exitCode=1});
