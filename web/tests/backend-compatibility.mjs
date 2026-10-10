import assert from "node:assert/strict";
import {api} from "../src/api.js";

const url="https://youtu.be/2AGegNK_dAY?si=rB-cG0fMJCYHfLDT";
let calls=[];
const mock=(contract,missing=false)=>{
  calls=[];
  globalThis.fetch=async(path,options)=>{
    calls.push(path);
    if(path==="/health")return new Response(JSON.stringify({status:"ok",api_contract:contract}));
    assert.equal(path,"/api/jobs/validate");
    assert.deepEqual(JSON.parse(options.body),{urls:[url]});
    return new Response(JSON.stringify(missing?{detail:"Not Found"}:{valid:[url],invalid:[],duplicates:[]}),{status:missing?404:200});
  };
};
mock(undefined);
await assert.rejects(api.validateLinks([url]),/older.*backend.*Stop BMG.CLIP-V3/);
assert.deepEqual(calls,["/health"]);
mock(3);
assert.deepEqual((await api.validateLinks([url])).valid,[url]);
assert.deepEqual(calls,["/health","/api/jobs/validate"]);
mock(3,true);
await assert.rejects(api.validateLinks([url]),/missing link validation.*Stop BMG.CLIP-V3/);
console.log("PASS: old backend is rejected clearly; shared YouTube URL validates on matched backend; 404 has actionable restart instructions.");

mock(undefined);
await assert.rejects(api.generate({video_url:url}),/older.*backend/);
assert.deepEqual(calls,["/health"],"Never start invisible work against an incompatible backend");
globalThis.fetch=async()=>new Response(JSON.stringify({detail:"Not Found"}),{status:404});
await assert.rejects(api.jobs(),/Processing is unavailable.*Stop BMG.CLIP-V3/);

const empty={jobs:[],counts:{},batches:[],total:0};
let missingConfirmation=false;
let posts=0;
globalThis.fetch=async(path,options)=>{
  if(path==="/health")return new Response(JSON.stringify({api_contract:3}));
  if(path.startsWith("/api/jobs?"))return new Response(JSON.stringify(empty));
  if(path==="/api/generate"){posts++;assert.equal(JSON.parse(options.body).submission_id,"retry-same");return new Response(JSON.stringify({job_id:"saved-1"}))}
  if(path==="/api/jobs/saved-1")return new Response(JSON.stringify(missingConfirmation?{detail:"Unavailable"}:{id:"saved-1",status:"queued"}),{status:missingConfirmation?503:200});
  if(path==="/api/batches")return new Response(JSON.stringify({batch_id:"batch-1"}));
  if(path==="/api/batches/batch-1")return new Response(JSON.stringify({jobs:[{id:"batch-job-1",status:"queued"}]}));
  throw Error("Unexpected "+path);
};
assert.equal((await api.generate({video_url:url,submission_id:"retry-same"})).job.id,"saved-1");
missingConfirmation=true;
await assert.rejects(api.generate({video_url:url,submission_id:"retry-same"}),/could not confirm.*settings are kept/);
missingConfirmation=false;
assert.equal((await api.generate({video_url:url,submission_id:"retry-same"})).job.id,"saved-1");
assert.equal(posts,3);
assert.equal((await api.batch({jobs:[]})).jobs[0].id,"batch-job-1");
console.log("PASS: submissions preflight the queue; single and batch jobs are confirmed; failed confirmation retains retry semantics.");
