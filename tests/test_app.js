const fs=require('fs'), vm=require('vm');
const Vision=require('../vision.js');
const cache={}; const lists={};
function ctxStub(){ const base={ canvas:null, measureText:()=>({width:50}), createRadialGradient:()=>({addColorStop(){}}), createLinearGradient:()=>({addColorStop(){}}),
  getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(Math.max(1,w*h*4)),width:w,height:h}), createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}) };
  return new Proxy(base,{get:(t,p)=> p in t? t[p] : ()=>undefined, set:(t,p,v)=>{t[p]=v;return true;}}); }
function makeEl(tag,sel){ const cls=new Set(); const el={tag,sel,listeners:{},children:[],attrs:{},dataset:{},style:{setProperty(){},removeProperty(){}},value:'8',innerHTML:'',disabled:false,width:960,height:540,offsetWidth:800,type:'',
  classList:{toggle(c,f){const on=f===undefined?!cls.has(c):!!f; on?cls.add(c):cls.delete(c);return on;},add(c){cls.add(c)},remove(c){cls.delete(c)},contains:c=>cls.has(c)},
  addEventListener(t,f){(el.listeners[t]=el.listeners[t]||[]).push(f)}, removeEventListener(){}, setAttribute(k,v){el.attrs[k]=v}, getAttribute:k=>el.attrs[k], removeAttribute(){},
  appendChild(c){el.children.push(c);return c}, append(...c){el.children.push(...c)}, remove(){}, focus(){}, blur(){}, scrollIntoView(){}, setPointerCapture(){},
  click(){ (el.listeners.click||[]).forEach(f=>f({target:el,stopPropagation(){},preventDefault(){}})); },
  closest:()=>null, contains:()=>false, querySelector:s=>getEl(s), querySelectorAll:()=>[], getBoundingClientRect:()=>({left:0,top:0,width:960,height:540}),
  getContext:()=>ctx(el), toDataURL:()=>'data:image/png;base64,AA', toBlob(cb){cb({size:1})}, captureStream:()=>({}),
  fire(t,e){ (el.listeners[t]||[]).forEach(f=>f(e)); } };
  let tc=''; Object.defineProperty(el,'textContent',{get:()=>tc,set:v=>{tc=v; if(v==='') el.children.length=0;}});
  Object.defineProperty(el,'_cls',{value:cls}); return el; }
const ctxs=new WeakMap(); function ctx(el){ if(!ctxs.has(el)){const c=ctxStub(); c.canvas=el; ctxs.set(el,c);} return ctxs.get(el); }
function getEl(s){ return cache[s]||(cache[s]=makeEl('div',s)); }
function listOf(s,items){ lists[s]=items.map(d=>{const e=makeEl('button',s); Object.assign(e.dataset,d); return e;}); }
listOf('.rail-btn',['shapes','fill','text','trace','motion'].map(t=>({tool:t})));
listOf('.dock-tool[data-tool]',['select','brush','erase','smudge','picker','pan'].map(t=>({tool:t})));
listOf('.shape-tile',['circle','rect','star','line'].map(t=>({shape:t})));
listOf('.mode-btn',['draw','pixel','animate','ai'].map(v=>({view:v})));
const pixelCustom=getEl('#pixelCustom'), pixelCustomPopover=getEl('#pixelCustomControls');
pixelCustom.setAttribute('aria-controls','pixelCustomControls'); pixelCustom.setAttribute('aria-expanded','false');
pixelCustomPopover.classList.add('hidden'); lists['.pixel-color-tool']=[pixelCustom]; lists['[data-color-toggle]']=[pixelCustom];
const store={}; const toasts=[];
const doc={ getElementById:id=>getEl('#'+id), querySelector:s=>getEl(s), querySelectorAll:s=>lists[s]||[], createElement:t=>{ const e=makeEl(t); if(t==='script'){ let sv=''; Object.defineProperty(e,'src',{get:()=>sv,set:v=>{sv=v; setTimeout(()=>e.onerror&&e.onerror(),0);}}); } return e; }, head:makeEl('head'), addEventListener(t,f){(doc.l=doc.l||{});(doc.l[t]=doc.l[t]||[]).push(f)}, body:makeEl('body'), activeElement:null };
const fetchLog=[]; let health={ok:true,generate:true,coach:true,live:true,mock:false}; let apiMode='ok'; let confirmAnswer=true;
const fakeFetch=async(url,opt={})=>{ fetchLog.push({url,opt}); if(url.endsWith('/api/health')){ if(health===null) throw new Error('offline'); return {ok:true,json:async()=>health}; }
  if(apiMode==='down') throw new Error('net'); if(apiMode==='503') return {ok:false,status:503,json:async()=>({error:'AI is not configured on this server.'})};
  if(url.endsWith('/api/generate')) return {ok:true,json:async()=>({image:'data:image/png;base64,AA',provider:'gemini:gemini-2.5-flash-image'})};
  if(url.endsWith('/api/coach')) return {ok:true,json:async()=>({text:'- Nice circle on the left.'})}; };
const sandbox={ fetch:fakeFetch, AbortController,  document:doc, console, Vision, performance, setTimeout, clearTimeout, requestAnimationFrame:f=>setTimeout(()=>f(performance.now()),0), cancelAnimationFrame:clearTimeout,
  localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}}, ImageData:class{constructor(d,w,h){this.data=d;this.width=w;this.height=h}},
  Image:class{set src(v){setTimeout(()=>this.onload&&this.onload(),0)} get width(){return 960} get height(){return 540}}, createImageBitmap:async()=>({width:800,height:600}),
  URL:{createObjectURL:()=>'blob:x',revokeObjectURL(){}}, confirm:()=>confirmAnswer, prompt:()=>'Renamed', Blob:class{}, navigator:{}, MediaRecorder:undefined, Float32Array,Uint8Array,Uint8ClampedArray,Int32Array,Uint32Array };
sandbox.addEventListener=()=>{}; sandbox.window=sandbox; sandbox.globalThis=sandbox;
let code=fs.readFileSync(__dirname+'/../script.js','utf8');
code+='\n;this.__t={state,trace,anim,undoStack:()=>undoStack,redoStack:()=>redoStack,undo,redo,selectTool,serialize,deserialize,poseAt,suggestAnim,suggestNext,renderStudio,studio,fxC,setView,PRESETS,changed,analyze,sel,addShapeAt,hit,doFill,renderLayers,drawC,toastEl,pix,buildPixelGrid,exportPng,SAMPLES,hexToHsv,updateColorDisplay,finishTextColorEdit,checkHealth,generateAI,askCoach,identifyPhoto,applyShapeFilter,updateRecipe,recipeText,ai,localTip,initWelcome,setPhoto,level,LEVEL,applyPalette,renderTimeline,laneDown,addKey,studioMetrics,updateGhostBar};';
vm.createContext(sandbox);
const errs=[]; process.on('uncaughtException',e=>{errs.push(e);console.log('UNCAUGHT',e.stack.split('\n').slice(0,4).join('\n'))});
vm.runInContext(code,sandbox,{filename:'script.js'});
const T=sandbox.__t; const fx=T.fxC;
const ev=(x,y,extra={})=>({pointerType:'mouse',button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){},shiftKey:false,...extra});
const tick=()=>new Promise(r=>setTimeout(r,20));
const assert=(c,m)=>{ if(!c){console.log('FAIL',m); errs.push(m);} else console.log('ok  ',m); };
(async()=>{
  await tick();
  assert(T.state.objects.length===0,'starts empty');
  // brush stroke
  T.selectTool('brush');
  fx.fire('pointerdown',ev(100,100)); for(let i=1;i<=10;i++) fx.fire('pointermove',ev(100+i*10,100+i*5)); fx.fire('pointerup',ev(200,150));
  assert(T.state.objects.length===1 && T.state.objects[0].type==='stroke','brush creates stroke');
  assert(T.state.objects[0].pts.length>=2,'stroke has points');
  // shape by drag
  T.selectTool('shapes'); fx.fire('pointerdown',ev(300,200)); fx.fire('pointermove',ev(400,330)); fx.fire('pointerup',ev(400,330));
  const o=T.state.objects[1]; assert(o&&o.type==='circle'&&o.w===130&&o.h===130,'drag-drawn circle is square-constrained (130x130)');
  assert(T.state.tool==='select'&&T.state.selected===o.id,'switches to select with new shape selected');
  // move
  fx.fire('pointerdown',ev(365,265)); fx.fire('pointermove',ev(405,285)); fx.fire('pointerup',ev(405,285));
  assert(Math.round(o.x)===340&&Math.round(o.y)===220,'move by (40,20) -> '+o.x+','+o.y);
  // resize via bottom-right handle (470,350)
  fx.fire('pointerdown',ev(470,350)); fx.fire('pointermove',ev(520,400)); fx.fire('pointerup',ev(520,400));
  assert(o.w>130&&o.h>130,'corner resize grows shape '+o.w+'x'+o.h);
  // undo / redo
  const n0=T.undoStack().length; T.undo(); T.undo(); T.undo(); assert(T.state.objects.length===1,'3x undo removes shape (objects='+T.state.objects.length+')');
  T.redo(); T.redo(); T.redo(); assert(T.state.objects.length===2 && Math.round(T.state.objects[1].w)>130,'redo restores resized shape');
  // drop shape from tile
  T.addShapeAt('star',{x:700,y:300}); assert(T.state.objects.length===3 && T.state.objects[2].type==='star','addShapeAt star');
  // fill
  T.selectTool('fill'); fx.fire('pointerdown',ev(50,50)); assert(T.state.objects.length===4 && T.state.objects[3].type==='bitmap','fill creates bitmap layer');
  // hit on transparent bitmap area should not select (stub alpha=0)
  assert(T.hit(T.state.objects[3],{x:10,y:10})===false,'transparent bitmap not hittable');
  // delete selected via key
  T.selectTool('select'); const sid=T.state.objects[2].id; fx.fire('pointerdown',ev(700,300)); 
  (doc.l.keydown||[]).forEach(f=>f({key:'Delete',code:'Delete',preventDefault(){},ctrlKey:false}));
  assert(!T.state.objects.some(q=>q.id===sid),'Delete key removes selected star');
  // layers panel
  T.renderLayers(); assert(sandbox.document.querySelector('#layerList').children.length===T.state.objects.length,'layer rows = objects ('+T.state.objects.length+')');
  // animation
  const circ=T.state.objects.find(q=>q.type==='circle'); T.state.selected=circ.id; T.suggestAnim();
  assert(circ.keys&&circ.keys.length===3,'suggestAnim adds bob keys'); const p=T.poseAt(circ,0.25); assert(Math.abs(p.dy+26)<1e-6,'pose at .25 dy=-26 ('+p.dy+')');
  const p0=T.poseAt(circ,0), p1=T.poseAt(circ,1); assert(p0.dy===0&&p1.dy===0,'loop returns to rest pose');
  const pm=T.poseAt(circ,0.125); assert(pm.dy<0&&pm.dy>-26,'eased in-between pose');
  T.anim.t=0; T.setView('animate'); T.setView('draw');
  // save / load roundtrip
  const json=T.serialize(); const before=T.state.objects.length; T.state.objects=[]; await T.deserialize(json); assert(T.state.objects.length===before,'serialize/deserialize roundtrip ('+before+')');
  assert(T.state.objects.find(q=>q.type==='circle').keys.length===3,'keyframes survive save/load');
  // suggest next (no photo)
  T.selectTool('brush',{assist:true}); T.suggestNext(); assert(T.trace.ghost&&T.trace.ghost.type,'ghost suggestion (no photo): '+(T.trace.ghost&&T.trace.ghost.type));
  // studio filters
  T.state._ink=500; T.state._lum=Array.from({length:100},(_,i)=>i*2); for(const s of ['Cartoon','Watercolor','Anime','Pencil sketch']){ T.studio.style=s; T.state._ink=500; T.renderStudio(); await new Promise(r=>setTimeout(r,500)); assert(!!T.studio.last,'studio '+s+' rendered'); }
  // pixel builder
  T.buildPixelGrid(8); assert(T.pix.data.length===64,'pixel grid 8x8');
  pixelCustom.click(); assert(pixelCustom.getAttribute('aria-expanded')==='true'&&!pixelCustomPopover.classList.contains('hidden'),'custom pixel swatch opens the color wheel');
  pixelCustom.click(); assert(pixelCustom.getAttribute('aria-expanded')==='false'&&pixelCustomPopover.classList.contains('hidden'),'custom pixel swatch closes the color wheel');
  const textColorObject={id:T.state.nextId++,type:'text',text:'Color test',x:10,y:10,w:100,h:24,size:24,color:'#FE90E8',name:'Color test'};
  T.state.objects.push(textColorObject); T.state.selected=textColorObject.id;
  const textColorSource={closest:selector=>selector==='[data-text-color]'?{}:null}, textUndoCount=T.undoStack().length;
  T.updateColorDisplay('#3366CC',true,textColorSource); T.finishTextColorEdit();
  assert(textColorObject.color==='#3366CC'&&T.undoStack().length===textUndoCount+1,'text color picker recolors selected text and supports undo');
  T.state.objects=T.state.objects.filter(o=>o!==textColorObject); T.state.selected=null;
  // --- trace branch with injected data ---
  T.setPhoto({}, 960, 540); assert(T.trace.has===true,'setPhoto runs through analysePhoto without throwing');
  T.trace.regions=[{type:'circle',x:300,y:150,w:200,h:200,color:'#F4A259',key:'c1'},{type:'triangle',x:100,y:50,w:120,h:100,color:'#C83C3C',key:'t1'}];
    T.trace.E=new Uint8Array(480*270); for(let x=40;x<100;x++) T.trace.E[100*480+x]=1; T.trace.edgeCount=60; T.trace.dtE=sandbox.Vision.chamfer(T.trace.E,480,270); T.trace.dtM=null;
  T.suggestNext(); assert(T.trace.ghost&&T.trace.ghost.areaHint&&T.trace.ghost.label==='left'&&T.trace.ghost.points.every(p=>p.y>190&&p.y<210),'guide highlights the actual uncovered left outline');
  assert(/Trace the pink line on the left/.test(getEl('#ghostLabel').textContent),'guide gives a plain-language location');
  const nb=T.state.objects.length; (getEl('#ghostAccept').listeners.click||[]).forEach(f=>f({})); assert(T.state.objects.length===nb,'Done, next does not insert a guessed shape');
  T.trace.levelMode='auto'; assert(['easy','medium','hard'].includes(T.level()),'adaptive level = '+T.level());
  T.trace.levelMode='hard'; assert(T.LEVEL[T.level()].alpha===0,'hard hides outline');
  T.renderTimeline(); T.studioMetrics(); T.analyze(); assert(true,'timeline/metrics/analyze run');

  // ================= AI services =================
  const gl=getEl('#genStatus'), cb=getEl('#coachText');
  // health
  health=null; await T.checkHealth(); assert(T.ai.health===null && /not connected/.test(getEl('#aiStatus').textContent),'offline server -> "not connected" status');
  health={ok:true,generate:true,coach:true,live:true,mock:false}; await T.checkHealth(); assert(T.ai.health.generate===true && /connected/.test(getEl('#aiStatus').textContent),'online server -> connected status');
  // generate: too little ink
  T.state._ink=0; await T.generateAI(); assert(/Draw something first/.test(gl.textContent),'generate requires a drawing');
  // generate: consent declined -> nothing sent
  T.state._ink=500; T.ai.consented=false; confirmAnswer=false; fetchLog.length=0; await T.generateAI();
  assert(fetchLog.filter(f=>f.url.endsWith('/api/generate')).length===0 && /Cancelled/.test(gl.textContent),'declined consent sends nothing');
  // generate: success
  confirmAnswer=true; T.ai.consented=false; fetchLog.length=0; getEl('#genPrompt').value='make the sky purple'; T.studio.style='Anime'; await T.generateAI();
  const call=fetchLog.find(f=>f.url.endsWith('/api/generate')); const sent=call&&JSON.parse(call.opt.body);
  assert(!!call && sent.style==='Anime' && sent.prompt==='make the sky purple' && /^data:image\//.test(sent.image),'generate posts drawing + style + prompt');
  assert(T.studio.mode==='ai' && !!T.studio.last && /Done/.test(gl.textContent),'AI result becomes the "After" image');
  assert(!JSON.stringify(call).includes('GEMINI') ,'no API key in browser request');
  // generate: server not configured -> graceful fallback
  T.state._ink=500; apiMode='503'; T.ai.consented=true; await T.generateAI(); assert(/not configured/.test(gl.textContent) && T.studio.mode==='local',`503 -> message + on-device fallback (${gl.textContent})`);
  T.state._ink=500; apiMode='down'; await T.generateAI(); assert(/Could not reach/.test(gl.textContent),`network failure -> clear message (${gl.textContent})`);
  apiMode='ok'; assert(T.ai.busy===false && getEl('#genBtn').disabled===false,'button re-enabled after failure (retry possible)');
  // generate: server absent
  T.state._ink=500; health=null; T.ai.health=null; await T.generateAI(); assert(/not connected/.test(gl.textContent),`no server -> on-device fallback message (${gl.textContent})`);
  health={ok:true,generate:true,coach:true,live:true,mock:false}; await T.checkHealth();
  // coach
  T.state._ink=500; T.trace.lastScore=62; T.trace.lastP=0.5; T.trace.lastR=0.7; T.trace.levelMode='medium'; fetchLog.length=0; await T.askCoach();
  const cc=fetchLog.find(f=>f.url.endsWith('/api/coach')); const cs=cc&&JSON.parse(cc.opt.body);
  assert(!!cc && cs && cs.metrics.accuracy===62 && cs.metrics.level==='medium',`coach sends the deterministic score as metrics (${cc && JSON.stringify(cs)})`);
  assert(/Nice circle/.test(cb.textContent),`coach text shown (${cb.textContent})`);
  T.state._ink=500; apiMode='down'; await T.askCoach(); assert(/On-device tip/.test(cb.textContent),`coach offline -> on-device tip (${cb.textContent})`);
  apiMode='ok'; T.trace.lastR=0.2; assert(/uncovered/.test(T.localTip()),'localTip: low recall advice'); T.trace.lastR=0.9; T.trace.lastP=0.2; assert(/away from the outline/.test(T.localTip()),'localTip: low precision advice');
  // on-device classifier
  T.trace.has=true; await T.identifyPhoto(); assert(/Couldn’t identify this photo/.test(getEl('#photoLabel').textContent),'classifier unavailable offline -> clear message, no crash');
  sandbox.tf={}; sandbox.mobilenet={load:async()=>({classify:async()=>[{className:'tabby, tabby cat',probability:0.87},{className:'tiger cat',probability:0.06}]})};
  T.state.title='Untitled canvas'; await T.identifyPhoto();
  assert(/tabby \(87%\)/.test(getEl('#photoLabel').textContent) && T.trace.label[0].name==='tabby','classifier labels the photo');
  assert(T.state.title==='Tabby trace','project auto-titled from the label');
  // lesson recipe + shape library matching the photo
  T.trace.regions=[{type:'circle',x:0,y:0,w:10,h:10,color:'#fff',key:'a'},{type:'triangle',x:0,y:0,w:10,h:10,color:'#fff',key:'b'},{type:'triangle',x:0,y:0,w:10,h:10,color:'#fff',key:'c'}];
  assert(T.recipeText()==='1 circle, 2 triangles','recipe text: '+T.recipeText());
  T.updateRecipe(); assert(/Pink marks show a part/.test(getEl('#lessonRecipe').textContent),'lesson explains its guide in plain language');
  getEl('#tgPhotoShapes')._cls.add('on'); T.applyShapeFilter();
  const tiles=sandbox.document.querySelectorAll('.shape-tile'); const vis=t=>!t.classList.contains('hidden');
  assert(vis(tiles[0]) && !vis(tiles[1]) && !vis(tiles[2]) && vis(tiles[3]),'shape library shows only photo shapes (+ line)');
  getEl('#tgPhotoShapes')._cls.delete('on'); T.applyShapeFilter(); assert(tiles.every(vis),'toggle off -> all shapes back');
  // first-run welcome
  T.initWelcome(); assert(!getEl('#welcome').classList.contains('hidden'),'welcome shows on first visit');
  getEl('#welcomeSkip').click(); assert(getEl('#welcome').classList.contains('hidden') && store['doodlebrick:welcomed']==='1','skip closes it and remembers');
  const hid=getEl('#welcome'); hid.classList.add('hidden'); T.initWelcome(); assert(hid.classList.contains('hidden'),'welcome does not reappear');
  await tick(); console.log(errs.length? 'ERRORS: '+errs.length : 'ALL GOOD'); process.exit(errs.length?1:0);
})();
