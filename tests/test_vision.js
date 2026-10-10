const V=require('../vision.js');
const W=480,H=270;
function img(){ const d=new Uint8ClampedArray(W*H*4); for(let i=0;i<W*H;i++){d[i*4]=255;d[i*4+1]=244;d[i*4+2]=214;d[i*4+3]=255;} return d; }
function fillShape(d,test,rgb){ for(let y=0;y<H;y++)for(let x=0;x<W;x++) if(test(x,y)){const j=(y*W+x)*4; d[j]=rgb[0];d[j+1]=rgb[1];d[j+2]=rgb[2];} }
const d=img();
fillShape(d,(x,y)=>(x-240)**2+(y-150)**2<95**2,[244,162,89]);                        // circle head
fillShape(d,(x,y)=>{ if(y<40||y>100) return false; const t=(y-40)/60; return Math.abs(x-150)<=t*40;},[200,60,60]); // triangle
fillShape(d,(x,y)=>x>330&&x<420&&y>40&&y<120,[50,120,200]);                          // rect
// detail levels
for(const lv of ['simple','balanced','detailed']){ const o=V.outline(d,W,H,lv); console.log('outline',lv,o.count); }
const o=V.outline(d,W,H,'balanced');
const dtE=V.chamfer(o.edges,W,H);
// perfect trace: draw mask = dilated edges
const M=V.dilate(V.dilate(o.edges,W,H),W,H);
let r=V.accuracy(o.edges,dtE,M,W,H,8); console.log('traced score',r.score,r.precision.toFixed(2),r.recall.toFixed(2));
// empty
r=V.accuracy(o.edges,dtE,new Uint8Array(W*H),W,H,8); console.log('empty score',r.score);
// scribble far away
const M2=new Uint8Array(W*H); for(let y=240;y<260;y++)for(let x=10;x<60;x++)M2[y*W+x]=1;
r=V.accuracy(o.edges,dtE,M2,W,H,8); console.log('wrong score',r.score);
// full-canvas fill
const M3=new Uint8Array(W*H).fill(1); r=V.accuracy(o.edges,dtE,M3,W,H,8); console.log('flood score',r.score);
// regions
const small={w:160,h:90,d:new Uint8ClampedArray(160*90*4)};
for(let y=0;y<90;y++)for(let x=0;x<160;x++){const j=(y*160+x)*4; const sx=x*3,sy=y*3; const k=(sy*W+sx)*4; small.d[j]=d[k];small.d[j+1]=d[k+1];small.d[j+2]=d[k+2];small.d[j+3]=255;}
const regions=V.regions(small.d,160,90);
console.log(regions.map(r=>r.type+' '+r.color+' '+r.w+'x'+r.h));
console.log('palette',V.palette(d,W,H,5));
for(const s of ['Cartoon','Anime','Watercolor','Pencil sketch']){ const t=Date.now(); const out=V.stylize(s,d,W,H,3); console.log(s,out.length===d.length,(Date.now()-t)+'ms'); }
