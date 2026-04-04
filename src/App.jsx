import { useState, useRef, useEffect } from "react";

/* ═══════════════════════════════════════════
   TAG CENTERING TOOL — Dev Build
   Pipeline:
     1. findBounds    — locate card in image
     2. detectAngle   — fit lines to card edges,
                        compute rotation angle
     3. deskew        — rotate canvas so card is
                        perfectly axis-aligned
     4. detectBorderColor — sample actual border
                        color from each edge
     5. scanBorderWidth — scan inward matching
                        that color until artwork
     6. computeRatios — L/R T/B centering
   ═══════════════════════════════════════════ */

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

// ─── Pixel utilities ─────────────────────────────────────────────────────────
function loadImg(src, mx=1400) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w=img.width, h=img.height;
      if (Math.max(w,h) > mx) { const s=mx/Math.max(w,h); w=Math.round(w*s); h=Math.round(h*s); }
      const c = document.createElement("canvas");
      c.width=w; c.height=h;
      const ctx = c.getContext("2d", {willReadFrequently:true});
      ctx.drawImage(img,0,0,w,h);
      resolve({ canvas:c, ctx, w, h, data:ctx.getImageData(0,0,w,h) });
    };
    img.src = src;
  });
}
const PX    = (d,w,x,y) => { const i=(y*w+x)*4; return [d[i],d[i+1],d[i+2]]; };
const LUM   = (r,g,b)   => .299*r + .587*g + .114*b;
const CLAMP = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const MED   = arr => { const a=[...arr].sort((a,b)=>a-b); return a.length?a[Math.floor(a.length/2)]:0; };
const BLUR_RADIUS = 1;

function blurImageData(src, w, h, radius=BLUR_RADIUS){
  if(radius<=0) return src;
  const dst = new Uint8ClampedArray(src.length);
  const r=radius;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      let rs=0,gs=0,bs=0,ns=0;
      for(let dy=-r;dy<=r;dy++){
        const yy=CLAMP(y+dy,0,h-1);
        for(let dx=-r;dx<=r;dx++){
          const xx=CLAMP(x+dx,0,w-1);
          const i=(yy*w+xx)*4;
          rs+=src[i]; gs+=src[i+1]; bs+=src[i+2]; ns++;
        }
      }
      const o=(y*w+x)*4;
      dst[o]=rs/ns; dst[o+1]=gs/ns; dst[o+2]=bs/ns; dst[o+3]=255;
    }
  }
  return dst;
}

// ─── STEP 1: Card boundary detection ─────────────────────────────────────────
// Background-color approach: sample corners for paper/background color,
// sample image center for card color, set adaptive threshold between them.
// Adaptive threshold handles gray paper + silver card (low contrast) just as
// well as white paper + dark card (high contrast).
function findBounds(d, w, h) {
  const PATCH=12;

  // Sample background from 4 image corners
  let bgR=0,bgG=0,bgB=0,bgN=0;
  for(const [cx,cy] of [[0,0],[w-PATCH,0],[0,h-PATCH],[w-PATCH,h-PATCH]]){
    for(let dy=0;dy<PATCH;dy++) for(let dx=0;dx<PATCH;dx++){
      const [r,g,b]=PX(d,w,CLAMP(cx+dx,0,w-1),CLAMP(cy+dy,0,h-1));
      bgR+=r;bgG+=g;bgB+=b;bgN++;
    }
  }
  bgR/=bgN;bgG/=bgN;bgB/=bgN;

  // Sample card color from image center
  let cR=0,cG=0,cB=0,cN=0;
  const CX=Math.round(w/2),CY=Math.round(h/2);
  for(let dy=-PATCH;dy<=PATCH;dy++) for(let dx=-PATCH;dx<=PATCH;dx++){
    const [r,g,b]=PX(d,w,CLAMP(CX+dx,0,w-1),CLAMP(CY+dy,0,h-1));
    cR+=r;cG+=g;cB+=b;cN++;
  }
  cR/=cN;cG/=cN;cB/=cN;

  const bgDist=(r,g,b)=>Math.sqrt((r-bgR)**2+(g-bgG)**2+(b-bgB)**2);
  const centerDist=bgDist(cR,cG,cB);

  // Adaptive threshold: 35% of the background-to-card color distance.
  // Low contrast (gray paper + silver card): centerDist ~30 → TOL ~11
  // High contrast (white paper + dark card): centerDist ~200 → TOL ~70
  // Floor of 12 prevents triggering on camera noise in uniform backgrounds.
  const TOL=Math.max(12, centerDist*0.35);

  // Scan inward from each image edge — average N samples across middle 50%
  const N=24;
  const scanAvg=(dir,pos)=>{
    let dist=0;
    for(let i=0;i<N;i++){
      const f=0.25+0.5*i/(N-1);
      let px,py;
      if(dir==='L'||dir==='R'){px=pos;py=Math.round(h*f);}
      else{px=Math.round(w*f);py=pos;}
      const [r,g,b]=PX(d,w,CLAMP(px,0,w-1),CLAMP(py,0,h-1));
      dist+=bgDist(r,g,b);
    }
    return dist/N;
  };

  let left=0,right=w-1,top=0,bottom=h-1;
  const maxScan=Math.min(w,h)*0.45;
  for(let x=0;x<maxScan;x++)    if(scanAvg('L',x)>TOL){left=x;break;}
  for(let x=w-1;x>w-maxScan;x--) if(scanAvg('R',x)>TOL){right=x;break;}
  for(let y=0;y<maxScan;y++)    if(scanAvg('T',y)>TOL){top=y;break;}
  for(let y=h-1;y>h-maxScan;y--) if(scanAvg('B',y)>TOL){bottom=y;break;}

  const cardW=right-left,cardH=bottom-top;
  const ratio=cardW/cardH;
  const ok=cardW>w*0.15&&cardH>h*0.15&&ratio>0.55&&ratio<0.85;
  const suspicious = left<2||top<2||right>w-3||bottom>h-3||cardW>w*0.95||cardH>h*0.95;

  // Valid Pokemon card: aspect ratio 0.55???0.85, at least 15% of image each dim
  if(ok && !suspicious){
    return {left,right,top,bottom,cardW,cardH,method:'bg'};
  }
  const gBounds=gradientFallback(d,w,h);
  if(gBounds) return gBounds;
  if(ok) return {left,right,top,bottom,cardW,cardH,method:'bg'};
  return varianceFallback(d,w,h);
}

function varianceFallback(d,w,h){
  // Grid variance — original proven method, now as fallback
  const GX=32,GY=32;
  const cellW=Math.floor(w/GX),cellH=Math.floor(h/GY);
  if(cellW<2||cellH<2) return {left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1,method:'var'};
  const vg=[];let maxV=0;
  for(let gy=0;gy<GY;gy++){vg[gy]=[];for(let gx=0;gx<GX;gx++){
    let s=0,sq=0,n=0;const x0=gx*cellW,y0=gy*cellH;
    const step=Math.max(1,Math.floor(Math.min(cellW,cellH)/5));
    for(let y=y0;y<y0+cellH&&y<h;y+=step)for(let x=x0;x<x0+cellW&&x<w;x+=step){const v=LUM(...PX(d,w,x,y));s+=v;sq+=v*v;n++;}
    const variance=n>0?sq/n-(s/n)**2:0;vg[gy][gx]=variance;if(variance>maxV)maxV=variance;
  }}
  const floor=Math.max(30,maxV*0.12);
  let minGX=GX,maxGX=-1,minGY=GY,maxGY=-1,count=0;
  for(let gy=0;gy<GY;gy++)for(let gx=0;gx<GX;gx++)if(vg[gy][gx]>floor){
    if(gx<minGX)minGX=gx;if(gx>maxGX)maxGX=gx;if(gy<minGY)minGY=gy;if(gy>maxGY)maxGY=gy;count++;
  }
  if(count<6||maxGX<minGX||maxGY<minGY) return {left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1,method:'var'};
  const left=minGX*cellW,right=Math.min(w-1,(maxGX+1)*cellW);
  const top=minGY*cellH,bottom=Math.min(h-1,(maxGY+1)*cellH);
  return {left,right,top,bottom,cardW:right-left,cardH:bottom-top,method:'var'};
}

function gradientFallback(d,w,h){
  const maxScan=Math.min(w,h)*0.45;
  const N=28;
  const scanGrad=(dir,pos)=>{
    let g=0;
    for(let i=0;i<N;i++){
      const f=0.25+0.5*i/(N-1);
      let x,y;
      if(dir==='L'||dir==='R'){x=pos; y=Math.round(h*f);}
      else {x=Math.round(w*f); y=pos;}
      const xm=CLAMP(x-1,0,w-1), xp=CLAMP(x+1,0,w-1);
      const ym=CLAMP(y-1,0,h-1), yp=CLAMP(y+1,0,h-1);
      const gx=LUM(...PX(d,w,xp,y))-LUM(...PX(d,w,xm,y));
      const gy=LUM(...PX(d,w,x,yp))-LUM(...PX(d,w,x,ym));
      g+=Math.abs(gx)+Math.abs(gy);
    }
    return g/N;
  };
  const samples=12;
  const baseL=[],baseR=[],baseT=[],baseB=[];
  for(let i=0;i<samples;i++){
    baseL.push(scanGrad('L',i));
    baseR.push(scanGrad('R',w-1-i));
    baseT.push(scanGrad('T',i));
    baseB.push(scanGrad('B',h-1-i));
  }
  const base = arr => {
    const m=MED(arr);
    const mean=arr.reduce((s,v)=>s+v,0)/arr.length;
    const std=Math.sqrt(arr.reduce((s,v)=>s+(v-mean)**2,0)/arr.length);
    return {m,std};
  };
  const bL=base(baseL), bR=base(baseR), bT=base(baseT), bB=base(baseB);
  const thresh = b => Math.max(6, b.m + b.std*3.0);

  let left=0,right=w-1,top=0,bottom=h-1;
  const lt=thresh(bL), rt=thresh(bR), tt=thresh(bT), bt=thresh(bB);
  for(let x=0;x<maxScan;x++)     if(scanGrad('L',x)>lt){left=x;break;}
  for(let x=w-1;x>w-maxScan;x--) if(scanGrad('R',x)>rt){right=x;break;}
  for(let y=0;y<maxScan;y++)     if(scanGrad('T',y)>tt){top=y;break;}
  for(let y=h-1;y>h-maxScan;y--) if(scanGrad('B',y)>bt){bottom=y;break;}
  const cardW=right-left,cardH=bottom-top;
  const ratio=cardW/cardH;
  if(cardW>w*0.15&&cardH>h*0.15&&ratio>0.55&&ratio<0.85){
    return {left,right,top,bottom,cardW,cardH,method:'grad'};
  }
  return null;
}

// ─── STEP 2: Detect card rotation angle ─────────────────────────────────────
// For each of 4 card edges, probe at N evenly-spaced positions along the edge.
// At each probe: scan perpendicularly to find the exact gradient peak = card edge.
// Fit a line through all valid probes (least squares). Slope = tan(angle).
// Average angles from all 4 edges for robustness.
function detectCardAngle(d, w, h, bn) {
  const { left:cl, right:cr, top:ct, bottom:cb, cardW:cW, cardH:cH } = bn;
  const PROBES = 24;
  const SEARCH = Math.round(Math.min(cW,cH) * 0.07);

  const findEdgeY = (x, nearY) => {
    let best=nearY, bestG=0;
    for(let y=CLAMP(nearY-SEARCH,0,h-2);y<=CLAMP(nearY+SEARCH,0,h-2);y++){
      const g=Math.abs(LUM(...PX(d,w,x,CLAMP(y-2,0,h-1)))-LUM(...PX(d,w,x,CLAMP(y+2,0,h-1))));
      if(g>bestG){bestG=g;best=y;}
    }
    return bestG>8 ? best : null;
  };
  const findEdgeX = (y, nearX) => {
    let best=nearX, bestG=0;
    for(let x=CLAMP(nearX-SEARCH,0,w-2);x<=CLAMP(nearX+SEARCH,0,w-2);x++){
      const g=Math.abs(LUM(...PX(d,w,CLAMP(x-2,0,w-1),y))-LUM(...PX(d,w,CLAMP(x+2,0,w-1),y)));
      if(g>bestG){bestG=g;best=x;}
    }
    return bestG>8 ? best : null;
  };
  const fitSlope = pts => {
    if(pts.length<5) return null;
    const n=pts.length;
    const sx=pts.reduce((s,p)=>s+p.x,0),sy=pts.reduce((s,p)=>s+p.y,0);
    const sxy=pts.reduce((s,p)=>s+p.x*p.y,0),sxx=pts.reduce((s,p)=>s+p.x*p.x,0);
    const den=n*sxx-sx*sx;
    return Math.abs(den)<1 ? null : (n*sxy-sx*sy)/den;
  };

  const angles = [];
  // Top edge: probe horizontally, find y at each x
  {const pts=[];for(let i=0;i<PROBES;i++){const x=Math.round(cl+cW*(0.05+0.90*i/(PROBES-1)));const y=findEdgeY(x,ct);if(y!==null)pts.push({x,y});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  // Bottom edge
  {const pts=[];for(let i=0;i<PROBES;i++){const x=Math.round(cl+cW*(0.05+0.90*i/(PROBES-1)));const y=findEdgeY(x,cb);if(y!==null)pts.push({x,y});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  // Left edge: probe vertically, find x at each y — slope is dx/dy → same angle
  {const pts=[];for(let i=0;i<PROBES;i++){const y=Math.round(ct+cH*(0.05+0.90*i/(PROBES-1)));const x=findEdgeX(y,cl);if(x!==null)pts.push({x:y,y:x});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  // Right edge
  {const pts=[];for(let i=0;i<PROBES;i++){const y=Math.round(ct+cH*(0.05+0.90*i/(PROBES-1)));const x=findEdgeX(y,cr);if(x!==null)pts.push({x:y,y:x});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}

  if(angles.length===0) return {angle:0,confidence:'failed'};
  angles.sort((a,b)=>a-b);
  const median=angles[Math.floor(angles.length/2)];
  return {angle:Math.round(median*100)/100, confidence:angles.length>=3?'good':'low', allAngles:angles};
}

// ─── STEP 3: Deskew ──────────────────────────────────────────────────────────
// Rotate canvas by -angle so card edges become perfectly horizontal/vertical.
// Without this, every border measurement is slightly wrong because the
// scan lines cross the border at an angle instead of perpendicularly.
function deskewCanvas(srcCanvas, angle) {
  if (Math.abs(angle) < 0.3) return srcCanvas;
  const rad = -angle * Math.PI / 180;
  const sw=srcCanvas.width, sh=srcCanvas.height;
  const cos=Math.abs(Math.cos(rad)), sin=Math.abs(Math.sin(rad));
  const nw=Math.round(sw*cos+sh*sin), nh=Math.round(sw*sin+sh*cos);
  const c=document.createElement('canvas'); c.width=nw; c.height=nh;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.translate(nw/2,nh/2); ctx.rotate(rad); ctx.drawImage(srcCanvas,-sw/2,-sh/2);
  return c;
}

// ─── 
function refineBoundsByGradient(d,w,h,bn){
  const maxScan=Math.min(w,h)*0.45;
  const N=28;
  const gradAt=(dir,pos)=>{
    let g=0;
    for(let i=0;i<N;i++){
      const f=0.25+0.5*i/(N-1);
      let x,y;
      if(dir==='L'||dir==='R'){x=pos; y=Math.round(h*f);} else {x=Math.round(w*f); y=pos;}
      const xm=CLAMP(x-1,0,w-1), xp=CLAMP(x+1,0,w-1);
      const ym=CLAMP(y-1,0,h-1), yp=CLAMP(y+1,0,h-1);
      const gx=LUM(...PX(d,w,xp,y))-LUM(...PX(d,w,xm,y));
      const gy=LUM(...PX(d,w,x,yp))-LUM(...PX(d,w,x,ym));
      g+=Math.abs(gx)+Math.abs(gy);
    }
    return g/N;
  };
  const isSuspicious = bn.left<2||bn.top<2||bn.right>w-3||bn.bottom>h-3||bn.cardW>w*0.95||bn.cardH>h*0.95;
  const margin = Math.round(Math.min(bn.cardW,bn.cardH)*0.08);

  const findPeak=(dir,from,to,baseFrom,baseTo)=>{
    let bestPos=null,bestG=0;
    const base=[];
    for(let p=baseFrom;p<=baseTo;p++) base.push(gradAt(dir,p));
    const m=MED(base);
    const mean=base.reduce((s,v)=>s+v,0)/base.length;
    const std=Math.sqrt(base.reduce((s,v)=>s+(v-mean)**2,0)/base.length);
    const thresh=Math.max(1.2, m + std*3.0);
    for(let p=from;p<=to;p++){
      const g=gradAt(dir,p);
      if(g>bestG){bestG=g;bestPos=p;}
    }
    return bestG>thresh?{pos:bestPos,g:bestG,thresh}:null;
  };

  const Lfrom = isSuspicious? 2 : Math.max(2, bn.left - margin);
  const Lto   = isSuspicious? Math.round(maxScan) : Math.min(Math.round(maxScan), bn.left + margin);
  const Rfrom = isSuspicious? w-1-Math.round(maxScan) : Math.max(w-1-Math.round(maxScan), bn.right - margin);
  const Rto   = isSuspicious? w-3 : Math.min(w-3, bn.right + margin);
  const Tfrom = isSuspicious? 2 : Math.max(2, bn.top - margin);
  const Tto   = isSuspicious? Math.round(maxScan) : Math.min(Math.round(maxScan), bn.top + margin);
  const Bfrom = isSuspicious? h-1-Math.round(maxScan) : Math.max(h-1-Math.round(maxScan), bn.bottom - margin);
  const Bto   = isSuspicious? h-3 : Math.min(h-3, bn.bottom + margin);

  const L= findPeak('L', Lfrom, Lto, 0, Math.min(8,Lfrom));
  const R= findPeak('R', Rfrom, Rto, Math.max(w-9,Rfrom), w-1);
  const T= findPeak('T', Tfrom, Tto, 0, Math.min(8,Tfrom));
  const B= findPeak('B', Bfrom, Bto, Math.max(h-9,Bfrom), h-1);

  if(!(L&&R&&T&&B)) return null;
  const left=L.pos, right=R.pos, top=T.pos, bottom=B.pos;
  const cardW=right-left, cardH=bottom-top;
  const ratio=cardW/cardH;
  if(cardW>w*0.15&&cardH>h*0.15&&ratio>0.55&&ratio<0.85){
    return {left,right,top,bottom,cardW,cardH,method:'ref'};
  }
  return null;
}

// 
function makeEdgeMap(d,w,h){
  const out = new Uint8ClampedArray(d.length);
  const L=(y,x)=>LUM(d[(y*w+x)*4],d[(y*w+x)*4+1],d[(y*w+x)*4+2]);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const gx=-L(y-1,x-1)+L(y-1,x+1)-2*L(y,x-1)+2*L(y,x+1)-L(y+1,x-1)+L(y+1,x+1);
    const gy=-L(y-1,x-1)-2*L(y-1,x)-L(y-1,x+1)+L(y+1,x-1)+2*L(y+1,x)+L(y+1,x+1);
    const m=Math.min(255,Math.sqrt(gx*gx+gy*gy));
    const i=(y*w+x)*4;
    out[i]=out[i+1]=out[i+2]=m; out[i+3]=255;
  }
  return out;
}

function findBoundsV2(d, w, h) {
  const GX = 32, GY = 32;
  const cellW = Math.floor(w / GX), cellH = Math.floor(h / GY);
  if (cellW < 2 || cellH < 2) return { left:0, right:w-1, top:0, bottom:h-1, cardW:w-1, cardH:h-1, method:'v2-var' };

  const vg = [];
  let maxV = 0;
  for (let gy = 0; gy < GY; gy++) {
    vg[gy] = [];
    for (let gx = 0; gx < GX; gx++) {
      let s=0, sq=0, n=0;
      const x0=gx*cellW, y0=gy*cellH;
      const step = Math.max(1, Math.floor(Math.min(cellW,cellH)/5));
      for (let y=y0; y<y0+cellH && y<h; y+=step)
        for (let x=x0; x<x0+cellW && x<w; x+=step)
          { const v=LUM(...PX(d,w,x,y)); s+=v; sq+=v*v; n++; }
      const variance = n>0 ? sq/n-(s/n)**2 : 0;
      vg[gy][gx] = variance;
      if (variance > maxV) maxV = variance;
    }
  }

  const floor = Math.max(30, maxV * 0.12);
  let minGX=GX, maxGX=-1, minGY=GY, maxGY=-1, count=0;
  for (let gy=0; gy<GY; gy++)
    for (let gx=0; gx<GX; gx++)
      if (vg[gy][gx] > floor) {
        if (gx < minGX) minGX=gx; if (gx > maxGX) maxGX=gx;
        if (gy < minGY) minGY=gy; if (gy > maxGY) maxGY=gy;
        count++;
      }

  if (count < 6 || maxGX < minGX || maxGY < minGY) {
    return edgeScanFallbackV2(d, w, h);
  }

  let left   = minGX * cellW;
  let right  = Math.min(w-1, (maxGX+1) * cellW);
  let top    = minGY * cellH;
  let bottom = Math.min(h-1, (maxGY+1) * cellH);

  const scanLimit = Math.min(cellW*2, 60);
  const sampleN = 16;

  const edgeLum = (axis, pos, lo, hi) => {
    let s=0;
    for (let i=0; i<sampleN; i++) {
      const f = lo + (hi-lo)*(i+0.5)/sampleN;
      const px = axis==='x' ? Math.round(pos) : Math.round(f);
      const py = axis==='x' ? Math.round(f)   : Math.round(pos);
      s += LUM(...PX(d,w,CLAMP(px,0,w-1),CLAMP(py,0,h-1)));
    }
    return s/sampleN;
  };

  let bestContrast=0, bestPos=left;
  for (let i=0; i<scanLimit; i++) {
    const x=left+i; if(x>=right-10) break;
    const c=Math.abs(edgeLum('x',x,top,bottom)-edgeLum('x',x-1,top,bottom));
    if(c>bestContrast){bestContrast=c;bestPos=x;}
  }
  left=bestPos;

  bestContrast=0; bestPos=right;
  for (let i=0; i<scanLimit; i++) {
    const x=right-i; if(x<=left+10) break;
    const c=Math.abs(edgeLum('x',x,top,bottom)-edgeLum('x',x+1,top,bottom));
    if(c>bestContrast){bestContrast=c;bestPos=x;}
  }
  right=bestPos;

  bestContrast=0; bestPos=top;
  for (let i=0; i<scanLimit; i++) {
    const y=top+i; if(y>=bottom-10) break;
    const c=Math.abs(edgeLum('y',y,left,right)-edgeLum('y',y-1,left,right));
    if(c>bestContrast){bestContrast=c;bestPos=y;}
  }
  top=bestPos;

  bestContrast=0; bestPos=bottom;
  for (let i=0; i<scanLimit; i++) {
    const y=bottom-i; if(y<=top+10) break;
    const c=Math.abs(edgeLum('y',y,left,right)-edgeLum('y',y+1,left,right));
    if(c>bestContrast){bestContrast=c;bestPos=y;}
  }
  bottom=bestPos;

  const cardW=right-left, cardH=bottom-top;
  if (cardW > w*0.08 && cardH > h*0.08) {
    return { left, right, top, bottom, cardW, cardH, method:'v2-var' };
  }

  return edgeScanFallbackV2(d, w, h);
}

function edgeScanFallbackV2(d, w, h) {
  const thresholds = [15, 25, 40, 60];
  let best=null, bestArea=0;
  for (const t of thresholds) {
    let l=0, r=w-1, tp=0, b=h-1;
    const rowVar=(y,x1,x2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((x2-x1)/60));for(let x=x1;x<x2;x+=st){const v=LUM(...PX(d,w,CLAMP(x,0,w-1),CLAMP(y,0,h-1)));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
    const colVar=(x,y1,y2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((y2-y1)/60));for(let y=y1;y<y2;y+=st){const v=LUM(...PX(d,w,CLAMP(x,0,w-1),CLAMP(y,0,h-1)));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
    for(let x=0;x<w*.4;x++) if(colVar(x,~~(h*.1),~~(h*.9))>t){l=x;break;}
    for(let x=w-1;x>w*.6;x--) if(colVar(x,~~(h*.1),~~(h*.9))>t){r=x;break;}
    for(let y=0;y<h*.4;y++) if(rowVar(y,~~(w*.1),~~(w*.9))>t){tp=y;break;}
    for(let y=h-1;y>h*.6;y--) if(rowVar(y,~~(w*.1),~~(w*.9))>t){b=y;break;}
    const area=(r-l)*(b-tp);
    if(area>bestArea&&(r-l)>w*0.15&&(b-tp)>h*0.15){bestArea=area;best={left:l,right:r,top:tp,bottom:b,cardW:r-l,cardH:b-tp,method:'v2-edge'};}
  }
  return best||{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1,method:'v2-edge'};
}

function scanBorderFromEdgeV2(d, w, h, dir, edgeCoord, along0, along1) {
  const sampleN = 20;
  const maxScan = Math.round(Math.abs(along1-along0) * 0.18);
  const sample = (depth) => {
    let s = 0;
    for(let i=0; i<sampleN; i++){
      const f = along0 + (along1-along0)*(i+0.5)/sampleN;
      let px, py;
      if(dir==='L')      { px=edgeCoord+depth; py=Math.round(f); }
      else if(dir==='R') { px=edgeCoord-depth; py=Math.round(f); }
      else if(dir==='T') { px=Math.round(f);   py=edgeCoord+depth; }
      else               { px=Math.round(f);   py=edgeCoord-depth; }
      s += LUM(...PX(d,w,CLAMP(px,0,w-1),CLAMP(py,0,h-1)));
    }
    return s/sampleN;
  };
  const edgeLum = (sample(0)+sample(1)+sample(2))/3;
  const tolerance = 20;
  for(let dep=3; dep<maxScan; dep++){
    if(Math.abs(sample(dep)-edgeLum) > tolerance) return dep;
  }
  return 0;
}

function analyzeCenteringV2(edgeD, origD, w, h, bn){
  const{left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const thresholds = [50, 100, 150, 200, 300, 500];
  const validResults = [];
  const colVar=(x,y1,y2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((y2-y1)/60));for(let y=y1;y<y2;y+=st){const v=LUM(...PX(edgeD,w,CLAMP(x,0,w-1),CLAMP(y,0,h-1)));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};
  const rowVar=(y,x1,x2)=>{let s=0,q=0,n=0;const st=Math.max(1,~~((x2-x1)/60));for(let x=x1;x<x2;x+=st){const v=LUM(...PX(edgeD,w,CLAMP(x,0,w-1),CLAMP(y,0,h-1)));s+=v;q+=v*v;n++;}return n>0?q/n-(s/n)**2:0;};

  for (const vT of thresholds) {
    let bL=0,bR=0,bT=0,bB=0;
    for(let x=cl+~~(cW*.01);x<cl+~~(cW*.25);x++) if(colVar(x,ct+~~(cH*.1),ct+~~(cH*.9))>vT){bL=x-cl;break;}
    for(let x=cr-~~(cW*.01);x>cr-~~(cW*.25);x--) if(colVar(x,ct+~~(cH*.1),ct+~~(cH*.9))>vT){bR=cr-x;break;}
    for(let y=ct+~~(cH*.01);y<ct+~~(cH*.25);y++) if(rowVar(y,cl+~~(cW*.1),cl+~~(cW*.9))>vT){bT=y-ct;break;}
    for(let y=cb-~~(cH*.01);y>cb-~~(cH*.25);y--) if(rowVar(y,cl+~~(cW*.1),cl+~~(cW*.9))>vT){bB=cb-y;break;}
    if (bL > 0 && bR > 0 && bT > 0 && bB > 0) {
      const lrTotal = bL+bR, tbTotal = bT+bB;
      const lrPct = lrTotal/cW, tbPct = tbTotal/cH;
      if (lrPct > 0.01 && lrPct < 0.35 && tbPct > 0.01 && tbPct < 0.35) {
        validResults.push({ borderL:bL, borderR:bR, borderT:bT, borderB:bB });
      }
    }
  }

  let bestResult = null;
  if (validResults.length > 0) {
    const med = arr => { const s=[...arr].sort((a,b)=>a-b); const m=~~(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
    bestResult = {
      borderL: med(validResults.map(r=>r.borderL)),
      borderR: med(validResults.map(r=>r.borderR)),
      borderT: med(validResults.map(r=>r.borderT)),
      borderB: med(validResults.map(r=>r.borderB)),
    };
  }

  let mode='mode1';
  if(!bestResult) {
    const bL = scanBorderFromEdgeV2(origD,w,h,'L',cl,ct+~~(cH*.1),cb-~~(cH*.1));
    const bR = scanBorderFromEdgeV2(origD,w,h,'R',cr,ct+~~(cH*.1),cb-~~(cH*.1));
    const bT = scanBorderFromEdgeV2(origD,w,h,'T',ct,cl+~~(cW*.1),cr-~~(cW*.1));
    const bB = scanBorderFromEdgeV2(origD,w,h,'B',cb,cl+~~(cW*.1),cr-~~(cW*.1));
    const lrTot=bL+bR, tbTot=bT+bB;
    const lrPct=lrTot/cW, tbPct=tbTot/cH;
    if(bL>0&&bR>0&&bT>0&&bB>0 && lrPct>0.01&&lrPct<0.18 && tbPct>0.01&&tbPct<0.18){
      bestResult = { borderL:bL, borderR:bR, borderT:bT, borderB:bB };
      mode='mode2';
    }
  }

  if (!bestResult) {
    bestResult = { borderL: ~~(cW*0.05), borderR: ~~(cW*0.05), borderT: ~~(cH*0.07), borderB: ~~(cH*0.07) };
    mode='fallback';
  }

  const {borderL:bL,borderR:bR,borderT:bT,borderB:bB} = bestResult;
  const tLR=bL+bR, tTB=bT+bB;
  const lrRatio = Math.round((tLR>0?(bL/tLR)*100:50)*10)/10;
  const tbRatio = Math.round((tTB>0?(bT/tTB)*100:50)*10)/10;

  return { bL,bR,bT,bB,lrRatio,tbRatio,mode };
}

// STEP 4: Sample border color from card edge ──────────────────────────────
// Sample the outermost pixels of the detected card on each side.
// This is the "ground truth" border color under current lighting conditions —
// works on blue card backs, white/silver fronts, dark WOTC borders, all of them.
function sampleEdgeColor(d, w, h, bn, edge) {
  const {left:cl,right:cr,top:ct,cardW:cW,cardH:cH}=bn; const cb=ct+cH;
  const STRIP=5, N=28;
  const INSET=Math.max(2, Math.round(Math.min(cW,cH)*0.004));
  const rs=[],gs=[],bs=[];
  for(let i=0;i<N;i++){
    const f=0.30+0.40*i/(N-1); // center 40% of each edge — avoids corners
    for(let s=0;s<STRIP;s++){
      let px,py;
      if(edge==='L'){px=cl+INSET+s;             py=Math.round(ct+cH*f);}
      if(edge==='R'){px=CLAMP(cr-INSET-s,0,w-1);py=Math.round(ct+cH*f);}
      if(edge==='T'){px=Math.round(cl+cW*f);    py=ct+INSET+s;}
      if(edge==='B'){px=Math.round(cl+cW*f);    py=CLAMP(cb-INSET-s,0,h-1);}
      px=CLAMP(px,0,w-1); py=CLAMP(py,0,h-1);
      const [r,g,b]=PX(d,w,px,py);
      rs.push(r); gs.push(g); bs.push(b);
    }
  }
  const r=MED(rs), g=MED(gs), b=MED(bs);
  const dist=rs.map((_,i)=>Math.sqrt((rs[i]-r)**2+(gs[i]-g)**2+(bs[i]-b)**2));
  const mean=dist.reduce((s,v)=>s+v,0)/dist.length;
  const std=Math.sqrt(dist.reduce((s,v)=>s+(v-mean)**2,0)/dist.length);
  return {r,g,b,std};
}

// ─── STEP 5: Scan border width ───────────────────────────────────────────────
// Scan inward from the card edge. At each depth, sample 11 points across
// the middle section of that edge. When the color diverges from the sampled
// border color by more than the tolerance, we've crossed into artwork.
// Run 9 parallel scan lines and take the median — robust against corner
// rounding, pokeball highlights, holo shimmer, text elements near borders.
function scanBorderWidth(d, w, h, bn, edge, borderColor) {
  const {left:cl,right:cr,top:ct,cardW:cW,cardH:cH}=bn; const cb=ct+cH;
  const maxDepth=Math.round(Math.min(cW,cH)*0.22);
  const LINES=9, PTS=11;
  const {r:br,g:bg,b:bb}=borderColor;
  const colorDist=(r,g,b)=>Math.sqrt((r-br)**2+(g-bg)**2+(b-bb)**2);
  const distThresh=Math.min(80, Math.max(8, (borderColor.std||0)*1.6));

  const results=[];
  const gMedArr=[], gThreshArr=[], bestGArr=[], bestDepArr=[];
  for(let li=0;li<LINES;li++){
    const frac=0.15+0.70*(li/(LINES-1));
    let hit=maxDepth;
    const gArr=[], dArr=[];
    for(let dep=1;dep<maxDepth-1;dep++){
      let dSum=0, gSum=0;
      for(let pi=0;pi<PTS;pi++){
        const sp=0.25+0.50*(pi/(PTS-1));
        let px,py;
        if(edge==='L'){px=cl+dep; py=Math.round(ct+cH*sp);}
        if(edge==='R'){px=CLAMP(cr-dep,0,w-1); py=Math.round(ct+cH*sp);}
        if(edge==='T'){px=Math.round(cl+cW*sp); py=ct+dep;}
        if(edge==='B'){px=Math.round(cl+cW*sp); py=CLAMP(cb-dep,0,h-1);}
        px=CLAMP(px,0,w-1); py=CLAMP(py,0,h-1);
        const [r,g,b]=PX(d,w,px,py); dSum+=colorDist(r,g,b);
        let g1,g2;
        if(edge==='L' || edge==='R'){
          g1=LUM(...PX(d,w,CLAMP(px-1,0,w-1),py));
          g2=LUM(...PX(d,w,CLAMP(px+1,0,w-1),py));
        }else{
          g1=LUM(...PX(d,w,px,CLAMP(py-1,0,h-1)));
          g2=LUM(...PX(d,w,px,CLAMP(py+1,0,h-1)));
        }
        gSum+=Math.abs(g2-g1);
      }
      dArr[dep]=dSum/PTS;
      gArr[dep]=gSum/PTS;
    }
    const gMed=MED(gArr.filter(v=>typeof v==='number'));
    const gThresh=Math.max(1.5, gMed*2.0);
    const minDepth=2;
    for(let dep=minDepth;dep<maxDepth-1;dep++){
      if(gArr[dep]>gThresh && dArr[dep]>distThresh*0.7){hit=dep;break;}
    }
    let bestDep=maxDepth, bestG=0;
    if(hit===maxDepth){
      for(let dep=minDepth;dep<maxDepth-1;dep++){
        if(gArr[dep]>bestG){bestG=gArr[dep];bestDep=dep;}
      }
      if(bestG>gThresh*1.1) hit=bestDep;
    }
    gMedArr.push(gMed); gThreshArr.push(gThresh); bestGArr.push(bestG); bestDepArr.push(bestDep);
    results.push(hit);
  }
  results.sort((a,b)=>a-b);
  const med=results[Math.floor(LINES/2)];
  const failures=results.filter(v=>v>=maxDepth-2).length;
  const dbg={
    gMed: MED(gMedArr),
    gThresh: MED(gThreshArr),
    distThresh,
    bestG: MED(bestGArr),
    bestDep: Math.round(MED(bestDepArr))
  };
  return {width:med, confidence:failures<=2?'good':failures<=5?'low':'failed', rawValues:results, debug:dbg};
}

// ─── STEP 6: Full centering calculation ─────────────────────────────────────
function detectCentering(d, w, h, bn, scanData=null) {
  const scanD = scanData || d;
  const cL=sampleEdgeColor(d,w,h,bn,'L'), cR=sampleEdgeColor(d,w,h,bn,'R');
  const cT=sampleEdgeColor(d,w,h,bn,'T'), cB=sampleEdgeColor(d,w,h,bn,'B');
  const sL=scanBorderWidth(scanD,w,h,bn,'L',cL), sR=scanBorderWidth(scanD,w,h,bn,'R',cR);
  const sT=scanBorderWidth(scanD,w,h,bn,'T',cT), sB=scanBorderWidth(scanD,w,h,bn,'B',cB);
  const minDim=Math.min(bn.cardW,bn.cardH);
  const minW=Math.max(2, Math.round(minDim*0.008));
  const maxW=Math.round(minDim*0.28);
  const clamp=(v)=>Math.max(minW,Math.min(maxW,v));
  const bL=clamp(sL.width),bR=clamp(sR.width),bT=clamp(sT.width),bB=clamp(sB.width);
  const clamped = (bL!==sL.width)||(bR!==sR.width)||(bT!==sT.width)||(bB!==sB.width);
  const lrT=bL+bR, tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  const confs=[sL.confidence,sR.confidence,sT.confidence,sB.confidence];
  let conf=confs.every(c=>c==='good')?'good':confs.filter(c=>c==='failed').length>=2?'failed':'low';
  if(conf==='good' && clamped) conf='low';
  return {bL,bR,bT,bB,lrRatio,tbRatio,colorL:cL,colorR:cR,colorT:cT,colorB:cB,scanL:sL,scanR:sR,scanT:sT,scanB:sB,confidence:conf,clamped};
}

// ─── Full pipeline ────────────────────────────────────────────────────────────
async function analyzeCard(src) {
  const {canvas,w,h,data}=await loadImg(src,1400);
  // Stage 1: rough bounds on original
  const roughBounds=findBounds(data.data,w,h);
  // Stage 2: detect angle
  const angleResult=detectCardAngle(data.data,w,h,roughBounds);
  const angle=angleResult.angle;
  // Stage 3: deskew
  const deskewed=deskewCanvas(canvas,angle);
  const deskewApplied=Math.abs(angle)>=0.3;
  // Stage 4: precise bounds on deskewed image
  const dc=deskewed.getContext('2d',{willReadFrequently:true});
  const dd=dc.getImageData(0,0,deskewed.width,deskewed.height);
  const dw=deskewed.width,dh=deskewed.height;
  const edgeMap=makeEdgeMap(dd.data,dw,dh);
  const bounds=findBoundsV2(edgeMap,dw,dh);
  // Stages 5+6: centering on clean deskewed card
  const centering=analyzeCenteringV2(edgeMap,dd.data,dw,dh,bounds);
  const cL=sampleEdgeColor(dd.data,dw,dh,bounds,'L'), cR=sampleEdgeColor(dd.data,dw,dh,bounds,'R');
  const cT=sampleEdgeColor(dd.data,dw,dh,bounds,'T'), cB=sampleEdgeColor(dd.data,dw,dh,bounds,'B');
  const scanStub = (w,mode)=>({width:w,confidence:mode==='fallback'?'failed':mode==='mode2'?'low':'good',debug:{mode}});
  const centeringFull={
    bL:centering.bL,bR:centering.bR,bT:centering.bT,bB:centering.bB,
    lrRatio:centering.lrRatio,tbRatio:centering.tbRatio,
    colorL:cL,colorR:cR,colorT:cT,colorB:cB,
    scanL:scanStub(centering.bL,centering.mode),
    scanR:scanStub(centering.bR,centering.mode),
    scanT:scanStub(centering.bT,centering.mode),
    scanB:scanStub(centering.bB,centering.mode),
    confidence:centering.mode==='fallback'?'low':centering.mode==='mode2'?'low':'good',
    clamped:false
  };
  const displayUrl=deskewed.toDataURL('image/jpeg',0.92);
  return {displayUrl,dw,dh,bounds,centering:centeringFull,angle,angleResult,deskewApplied};
}

// ─── Overlay ─────────────────────────────────────────────────────────────────
function drawOverlay(canvas, result, debug) {
  if(!canvas||!result) return;
  const {dw:w,dh:h,bounds:bn,centering:c,angle}=result;
  const ctx=canvas.getContext('2d'); canvas.width=w; canvas.height=h; ctx.clearRect(0,0,w,h);
  const {left:cl,right:cr,top:ct,cardW:cW,cardH:cH}=bn; const cb=ct+cH;
  const fs=Math.max(13,~~(cW*0.026));
  const lc=s=>s.confidence==='good'?'#00ff88':s.confidence==='low'?'#ccbb00':'#ff4444';

  // Card outer boundary
  ctx.strokeStyle='#ff9944';ctx.lineWidth=3;ctx.setLineDash([]);ctx.strokeRect(cl,ct,cW,cH);
  // Artwork inner boundary
  ctx.strokeStyle='#00ff88';ctx.lineWidth=2;ctx.setLineDash([10,5]);
  ctx.strokeRect(cl+c.bL,ct+c.bT,cW-c.bL-c.bR,cH-c.bT-c.bB);ctx.setLineDash([]);

  // Border dimension labels
  ctx.font=`bold ${fs}px ${mono}`; ctx.textAlign='center';
  const label=(text,x,y,conf)=>{
    ctx.fillStyle='rgba(0,0,0,.65)';
    ctx.fillRect(x-28,y-14,56,20);
    ctx.fillStyle=lc(conf);ctx.fillText(text,x,y);
  };
  label(`L ${c.bL}px`, cl+c.bL/2,           ct+cH/2, c.scanL);
  label(`R ${c.bR}px`, cr-c.bR/2,           ct+cH/2, c.scanR);
  label(`T ${c.bT}px`, cl+cW/2,             ct+c.bT/2+6, c.scanT);
  label(`B ${c.bB}px`, cl+cW/2,             cb-c.bB/2, c.scanB);

  // Ratio badge above card
  const lrOk=Math.max(c.lrRatio,100-c.lrRatio)<=55;
  const tbOk=Math.max(c.tbRatio,100-c.tbRatio)<=65;
  ctx.font=`bold ${Math.max(15,~~(cW*0.032))}px ${mono}`;
  ctx.fillStyle=(lrOk&&tbOk)?'#00ff88':'#ff6633';
  ctx.fillText(`${c.lrRatio}/${Math.round((100-c.lrRatio)*10)/10}  ${c.tbRatio}/${Math.round((100-c.tbRatio)*10)/10}`,cl+cW/2,ct-18);

  if(Math.abs(angle)>=0.3){
    ctx.font=`${Math.max(11,~~(cW*0.022))}px ${mono}`;
    ctx.fillStyle='#ff9944';
    ctx.fillText(`↺ ${angle>0?'+':''}${angle}° corrected`,cl+cW/2,ct-4);
  }

  if(debug){
    // Debug text
    ctx.font=`${Math.max(10,~~(cW*0.018))}px ${mono}`;
    ctx.fillStyle='rgba(0,0,0,.7)';
    ctx.fillRect(cl+6,ct+6,220,72);
    ctx.fillStyle='#fff';
    ctx.textAlign='left';
    ctx.fillText(`bounds: ${bn.method||'?'}`, cl+10, ct+20);
    ctx.fillText(`clamped: ${c.clamped?'yes':'no'}`, cl+10, ct+34);
    const dL=c.scanL.debug||{}, dR=c.scanR.debug||{}, dT=c.scanT.debug||{}, dB=c.scanB.debug||{};
    ctx.fillText(`L gT:${(dL.gThresh||0).toFixed(1)} dT:${(dL.distThresh||0).toFixed(1)}`, cl+10, ct+48);
    ctx.fillText(`R gT:${(dR.gThresh||0).toFixed(1)} dT:${(dR.distThresh||0).toFixed(1)}`, cl+10, ct+62);

    // Color swatches
    const sw=16;
    [['L',c.colorL,cl+4,ct+4],['R',c.colorR,cl+28,ct+4],
     ['T',c.colorT,cl+52,ct+4],['B',c.colorB,cl+76,ct+4]].forEach(([l,col,x,y])=>{
      ctx.fillStyle=`rgb(${~~col.r},${~~col.g},${~~col.b})`;ctx.fillRect(x,y,sw,sw);
      ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(x,y,sw,sw);
      ctx.fillStyle='#fff';ctx.font=`8px ${mono}`;ctx.textAlign='left';ctx.fillText(l,x+1,y+sw-2);
    });
    // Scan line dots
    const LINES=9;
    ['L','R','T','B'].forEach(edge=>{
      for(let li=0;li<LINES;li++){
        const frac=0.15+0.70*(li/(LINES-1));
        let px,py;
        if(edge==='L'){px=cl;py=Math.round(ct+cH*frac);}
        if(edge==='R'){px=cr;py=Math.round(ct+cH*frac);}
        if(edge==='T'){px=Math.round(cl+cW*frac);py=ct;}
        if(edge==='B'){px=Math.round(cl+cW*frac);py=cb;}
        ctx.fillStyle='rgba(0,200,255,.8)';ctx.beginPath();ctx.arc(px,py,3,0,Math.PI*2);ctx.fill();
      }
    });
  }
}

// ─── Card Panel ───────────────────────────────────────────────────────────────
function CardPanel({label,side,onResult}){
  const [imgSrc,setImgSrc]=useState(null);
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [debug,setDebug]=useState(false);
  const fileRef=useRef(null),canvasRef=useRef(null),imgRef=useRef(null);

  const handleFile=e=>{
    const f=e.target.files?.[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      const src=ev.target.result;
      setImgSrc(src);setResult(null);setLoading(true);
      try{
        const res=await analyzeCard(src);
        setResult(res);
        if(onResult)onResult(res);
      }catch(err){
        console.error('analyzeCard failed', err);
        setResult(null);
      }finally{
        setLoading(false);
      }
    };
    reader.readAsDataURL(f);
  };

  useEffect(()=>{
    if(!result||!canvasRef.current||!imgRef.current)return;
    imgRef.current.src=result.displayUrl;
    const draw=()=>drawOverlay(canvasRef.current,result,debug);
    if(imgRef.current.complete)draw();else imgRef.current.onload=draw;
  },[result,debug]);

  const c=result?.centering;
  const thresh=side==='back'?65:55;
  const lrOk=c?Math.max(c.lrRatio,100-c.lrRatio)<=55:true;
  const tbOk=c?Math.max(c.tbRatio,100-c.tbRatio)<=thresh:true;

  return(
    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontFamily:mono,fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'.1em'}}>{label}</span>
        <div style={{display:'flex',gap:6}}>
          {result&&<button onClick={()=>setDebug(d=>!d)} style={{padding:'3px 9px',borderRadius:4,background:debug?'rgba(0,200,255,.1)':'transparent',border:`1px solid ${debug?'#0088ff55':'#333'}`,color:debug?'#44aaff':'#555',fontFamily:mono,fontSize:8,cursor:'pointer'}}>DBG</button>}
          <button onClick={()=>fileRef.current?.click()} style={{padding:'3px 10px',borderRadius:4,background:'rgba(255,153,68,.15)',border:'1px solid #ff994444',color:'#ff9944',fontFamily:mono,fontSize:8,cursor:'pointer'}}>{imgSrc?'CHANGE':'UPLOAD'}</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/>
      </div>

      <div style={{position:'relative',background:'#0a0a0a',borderRadius:10,overflow:'hidden',border:'1px solid #1a1c22',aspectRatio:'2.5/3.5'}}>
        {imgSrc?<>
          <img ref={imgRef} src={result?.displayUrl||imgSrc} style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/>
          <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'}}/>
          {loading&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.75)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6}}>
            <div style={{fontFamily:mono,fontSize:11,color:'#00ff88'}}>Analyzing…</div>
            <div style={{fontFamily:mono,fontSize:9,color:'#555'}}>Detecting angle · Deskewing · Scanning borders</div>
          </div>}
        </>:<div onClick={()=>fileRef.current?.click()} style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:10}}>
          <div style={{fontSize:36}}>📷</div>
          <div style={{fontFamily:mono,fontSize:10,color:'#444'}}>TAP TO UPLOAD</div>
        </div>}
      </div>

      {result&&<div style={{padding:'6px 10px',borderRadius:6,background:result.deskewApplied?'rgba(255,153,68,.08)':'rgba(0,255,136,.05)',border:`1px solid ${result.deskewApplied?'#ff994433':'#00ff8822'}`,display:'flex',justifyContent:'space-between'}}>
        <span style={{fontFamily:mono,fontSize:9,color:'#555'}}>ROTATION</span>
        <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:result.deskewApplied?'#ff9944':'#00ff88'}}>
          {result.deskewApplied?`${result.angle>0?'+':''}${result.angle}° — corrected`:`${result.angle}° — straight`}
        </span>
      </div>}

      {c&&<div style={{background:'#0d0f13',borderRadius:10,border:'1px solid #1a1c22',padding:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <span style={{fontFamily:mono,fontSize:9,color:'#555',textTransform:'uppercase'}}>Detection</span>
          <span style={{fontFamily:mono,fontSize:9,fontWeight:700,color:c.confidence==='good'?'#00ff88':c.confidence==='low'?'#ccbb00':'#ff4444'}}>
            {c.confidence==='good'?'✓ CONFIDENT':c.confidence==='low'?'⚠ LOW CONF':'✗ FAILED'}
          </span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          {[['L/R',c.lrRatio,lrOk,55],['T/B',c.tbRatio,tbOk,thresh]].map(([lbl,ratio,ok,th])=>(
            <div key={lbl} style={{padding:'8px 10px',background:'rgba(0,0,0,.3)',borderRadius:6,border:`1px solid ${ok?'#1a1c22':'#ff663344'}`}}>
              <div style={{fontFamily:mono,fontSize:8,color:'#555',marginBottom:3}}>{lbl}</div>
              <div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:ok?'#00dd77':'#ff6633'}}>
                {ratio}<span style={{fontSize:12,color:'#555'}}>/</span>{Math.round((100-ratio)*10)/10}
              </div>
              {!ok&&<div style={{fontFamily:mono,fontSize:8,color:'#ff6633',marginTop:3}}>⚠ Over {th}/{100-th}</div>}
            </div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4,marginBottom:8}}>
          {[['L',c.bL,c.scanL],['R',c.bR,c.scanR],['T',c.bT,c.scanT],['B',c.bB,c.scanB]].map(([lbl,px,scan])=>(
            <div key={lbl} style={{padding:'5px 3px',background:'rgba(0,0,0,.3)',borderRadius:5,textAlign:'center'}}>
              <div style={{fontFamily:mono,fontSize:8,color:'#555'}}>{lbl}</div>
              <div style={{fontFamily:mono,fontSize:13,fontWeight:600,color:scan.confidence==='good'?'#aaa':scan.confidence==='low'?'#ccbb00':'#ff4444'}}>{px}px</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontFamily:mono,fontSize:8,color:'#444'}}>SAMPLED:</span>
          {[['L',c.colorL],['R',c.colorR],['T',c.colorT],['B',c.colorB]].map(([lbl,col])=>(
            <div key={lbl} style={{display:'flex',alignItems:'center',gap:3}}>
              <div style={{width:12,height:12,borderRadius:2,background:`rgb(${~~col.r},${~~col.g},${~~col.b})`,border:'1px solid #333'}}/>
              <span style={{fontFamily:mono,fontSize:7,color:'#444'}}>{lbl}</span>
            </div>
          ))}
        </div>
        {debug&&result&&(
          <div style={{marginTop:10}}>
            <div style={{fontFamily:mono,fontSize:8,color:'#555',marginBottom:4}}>DEBUG DUMP</div>
            <textarea
              readOnly
              value={JSON.stringify({
                bounds: result.bounds,
                angle: result.angle,
                centering: {
                  bL:c.bL,bR:c.bR,bT:c.bT,bB:c.bB,
                  lrRatio:c.lrRatio,tbRatio:c.tbRatio,
                  clamped:c.clamped,confidence:c.confidence
                },
                scans: {
                  L: c.scanL.debug,
                  R: c.scanR.debug,
                  T: c.scanT.debug,
                  B: c.scanB.debug
                }
              }, null, 2)}
              style={{width:'100%',height:140,background:'#0a0a0a',border:'1px solid #222',borderRadius:6,color:'#aaa',fontFamily:mono,fontSize:9,padding:8,resize:'vertical'}}
            />
          </div>
        )}
      </div>}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [fR,setFR]=useState(null),[bR,setBR]=useState(null);
  const fc=fR?.centering,bc=bR?.centering;
  return(
    <div style={{minHeight:'100vh',background:'#090b0e',color:'#ccc',fontFamily:sans}}>
      <div style={{padding:'14px 16px',borderBottom:'1px solid #1a1c22',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:36,height:36,borderRadius:9,background:'linear-gradient(135deg,#00ff88,#0088ff)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:800,color:'#000'}}>CT</div>
        <div>
          <div style={{fontSize:15,fontWeight:600}}>Centering Tool</div>
          <div style={{fontFamily:mono,fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'.1em'}}>Angle detection · Deskew · Color-based border scan</div>
        </div>
      </div>
      <div style={{padding:14,display:'flex',gap:12}}>
        <CardPanel label="Front" side="front" onResult={setFR}/>
        <CardPanel label="Back"  side="back"  onResult={setBR}/>
      </div>
      {fc&&bc&&(
        <div style={{margin:'0 14px 16px',padding:12,background:'#0d0f13',borderRadius:10,border:'1px solid #1a1c22'}}>
          <div style={{fontFamily:mono,fontSize:9,color:'#555',textTransform:'uppercase',marginBottom:10}}>Combined Result</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[['Front',fc,55,55],['Back',bc,55,65]].map(([lbl,c,lrT,tbT])=>{
              const pass=Math.max(c.lrRatio,100-c.lrRatio)<=lrT&&Math.max(c.tbRatio,100-c.tbRatio)<=tbT;
              return(<div key={lbl} style={{padding:10,background:'rgba(0,0,0,.3)',borderRadius:7,border:`1px solid ${pass?'#00ff8822':'#ff663344'}`}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontFamily:mono,fontSize:9,color:'#888'}}>{lbl}</span>
                  <span style={{fontFamily:mono,fontSize:9,fontWeight:700,color:pass?'#00ff88':'#ff6633'}}>{pass?'✓ PASS':'✗ DING'}</span>
                </div>
                <div style={{fontFamily:mono,fontSize:14,color:'#ccc'}}>{c.lrRatio}/{Math.round((100-c.lrRatio)*10)/10} · {c.tbRatio}/{Math.round((100-c.tbRatio)*10)/10}</div>
              </div>);
            })}
          </div>
        </div>
      )}
      <div style={{padding:'8px 14px 28px',textAlign:'center',fontFamily:mono,fontSize:7,color:'#222',textTransform:'uppercase',letterSpacing:'.15em'}}>Centering Tool · Dev Build · Not For Release</div>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
    </div>
  );
}