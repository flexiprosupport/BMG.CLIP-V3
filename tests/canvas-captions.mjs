import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createCaptionRenderer, adaptedTemplate, palettes } from "../caption_renderer/adapter.mjs";
import catalog from "../caption_renderer/catalog.json" with { type: "json" };

const require = createRequire(new URL("../caption_renderer/package.json",import.meta.url));
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const root = fileURLToPath(new URL("../",import.meta.url));
for(const name of fs.readdirSync(path.join(root,"assets/fonts"))) {
  if(/\.(ttf|otf)$/i.test(name)) GlobalFonts.registerFromPath(path.join(root,"assets/fonts",name));
}
globalThis.document = {createElement:()=>createCanvas(1,1),fonts:{load:async()=>[],ready:Promise.resolve()}};
const words = "Make every word look amazing today".split(" ").map((word,i)=>({word,start:i*.5,end:(i+1)*.5}));
function alpha(canvas) {
  const buffer=canvas.data();let count=0,x=0,y=0;
  for(let i=3;i<buffer.length;i+=4)if(buffer[i]){count++;x+=((i-3)/4)%canvas.width;y+=Math.floor((i-3)/4/canvas.width)}
  return {count,x:x/Math.max(1,count),y:y/Math.max(1,count)};
}
assert.equal(catalog.length,85);
assert.equal(new Set(catalog.map(p=>p.id)).size,85);
assert.equal(catalog.filter(p=>p.category==="Premium").length,6);
assert.equal(catalog.filter(p=>p.category==="Multiline").length,15);
for(const preset of catalog) {
  for(const [width,height] of [[360,640],[640,360]]) {
    const canvas=createCanvas(width,height);
    const renderer=await createCaptionRenderer(canvas,{style:preset.id,words,duration:3.5});
    await renderer.draw(1.25);assert(alpha(canvas).count>0,preset.id);
    assert.equal(await renderer.draw(1.25),false);
    await renderer.draw(3.4);assert.equal(alpha(canvas).count,0);
    canvas.width=1;canvas.height=1;
  }
  globalThis.gc?.();
}
for(const p of palettes) {
  assert.equal(adaptedTemplate("studio:cinematic",{native_palette:p.id}).template.colour,p.palette.text);
}
assert.equal(adaptedTemplate("studio:cinematic",{native_palette:"cream",primary_color:"#ffffff"}).template.colour,"#ffffff");
for(const style of ["studio:cinematic","studio:premium-stack"]) {
  const metrics=[];
  for(const pos_x of [0,50,100]) {
    const canvas=createCanvas(360,640);
    const renderer=await createCaptionRenderer(canvas,{style,words,duration:3.5,overrides:{pos_x,pos_y:50}});
    await renderer.draw(1.25);metrics.push(alpha(canvas));canvas.width=1;canvas.height=1;
  }
  assert(metrics[0].x<metrics[1].x && metrics[1].x<metrics[2].x);
  assert(metrics[0].count<metrics[1].count && metrics[2].count<metrics[1].count);
}
for(const language of ["hi","ur","ar"]) {
  const sample=language==="hi"?"हर शब्द को सुंदर बनाएं":"ہر لفظ کو خوبصورت بنائیں";
  const ws=sample.split(" ").map((word,i)=>({word,start:i*.5,end:(i+1)*.5}));
  const canvas=createCanvas(360,640);
  const renderer=await createCaptionRenderer(canvas,{style:"studio:premium-stack",words:ws,language,duration:3});
  await renderer.draw(.75);assert(alpha(canvas).count>0);canvas.width=1;canvas.height=1;
}
console.log("PASS: all 85 added styles, portrait/landscape, 6 Premium, 15 multiline, 9 palettes, free edge placement, multilingual text, gap clearing and cache.");
