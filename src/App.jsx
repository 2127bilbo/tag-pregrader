import { useState, useRef, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════
   TAG CENTERING TOOL — Dev Build
   
   Pipeline:
   1. findBounds    — background-color card finder
   2. detectAngle   — fit lines to 4 card edges
   3. detectCentering — perpendicular border scan
                        using gradient edge find +
                        color-distance border scan
   4. Display       — deskewed upright image with
                        overlay + manual nudge
   ═══════════════════════════════════════════ */

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

// ─── Pixel utilities ──────────────────────────────────────────────────────────
function loadImg(src, mx=1400) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let w=img.width, h=img.height;
      if(Math.max(w,h)>mx){const s=mx/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
      const c=document.createElement("canvas"); c.width=w; c.height=h;
      const ctx=c.getContext("2d",{willReadFrequently:true});
      ctx.drawImage(img,0,0,w,h);
      resolve({canvas:c,ctx,w,h,data:ctx.getImageData(0,0,w,h)});
    };
    img.src=src;
  });
}
const PX    = (d,w,x,y)=>{const i=(y*w+x)*4;return[d[i],d[i+1],d[i+2]];};
const LUM   = (r,g,b)=>.299*r+.587*g+.114*b;
const CLAMP = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));

function lumAt(d, w, h, x, y) {
  const x0=CLAMP(Math.floor(x),0,w-1), x1=CLAMP(x0+1,0,w-1);
  const y0=CLAMP(Math.floor(y),0,h-1), y1=CLAMP(y0+1,0,h-1);
  const fx=x-x0, fy=y-y0;
  const l00=LUM(...PX(d,w,x0,y0)), l10=LUM(...PX(d,w,x1,y0));
  const l01=LUM(...PX(d,w,x0,y1)), l11=LUM(...PX(d,w,x1,y1));
  return l00*(1-fx)*(1-fy)+l10*fx*(1-fy)+l01*(1-fx)*fy+l11*fx*fy;
}

function medianArr(arr) {
  const s=[...arr].sort((a,b)=>a-b);
  return s[Math.floor(s.length/2)];
}

// ─── STEP 1: Card boundary ────────────────────────────────────────────────────
function findBounds(d, w, h) {
  const PATCH=12;
  let bgR=0,bgG=0,bgB=0,bgN=0;
  for(const [cx,cy] of [[0,0],[w-PATCH,0],[0,h-PATCH],[w-PATCH,h-PATCH]]){
    for(let dy=0;dy<PATCH;dy++) for(let dx=0;dx<PATCH;dx++){
      const[r,g,b]=PX(d,w,CLAMP(cx+dx,0,w-1),CLAMP(cy+dy,0,h-1));
      bgR+=r;bgG+=g;bgB+=b;bgN++;
    }
  }
  bgR/=bgN;bgG/=bgN;bgB/=bgN;
  let cR=0,cG=0,cB=0,cN=0;
  const CX=Math.round(w/2),CY=Math.round(h/2);
  for(let dy=-PATCH;dy<=PATCH;dy++) for(let dx=-PATCH;dx<=PATCH;dx++){
    const[r,g,b]=PX(d,w,CLAMP(CX+dx,0,w-1),CLAMP(CY+dy,0,h-1));
    cR+=r;cG+=g;cB+=b;cN++;
  }
  cR/=cN;cG/=cN;cB/=cN;
  const bgDist=(r,g,b)=>Math.sqrt((r-bgR)**2+(g-bgG)**2+(b-bgB)**2);
  const centerDist=bgDist(cR,cG,cB);
  if(centerDist<20) return varianceFallback(d,w,h,'close-up');
  const TOL=Math.max(12,centerDist*0.35);
  const N=24;
  const scanAvg=(dir,pos)=>{
    let dist=0;
    for(let i=0;i<N;i++){
      const f=0.25+0.5*i/(N-1);
      let px,py;
      if(dir==='L'||dir==='R'){px=pos;py=Math.round(h*f);}
      else{px=Math.round(w*f);py=pos;}
      const[r,g,b]=PX(d,w,CLAMP(px,0,w-1),CLAMP(py,0,h-1));
      dist+=bgDist(r,g,b);
    }
    return dist/N;
  };
  let left=0,right=w-1,top=0,bottom=h-1;
  const maxScan=Math.min(w,h)*0.45;
  for(let x=0;x<maxScan;x++)     if(scanAvg('L',x)>TOL){left=x;break;}
  for(let x=w-1;x>w-maxScan;x--) if(scanAvg('R',x)>TOL){right=x;break;}
  for(let y=0;y<maxScan;y++)     if(scanAvg('T',y)>TOL){top=y;break;}
  for(let y=h-1;y>h-maxScan;y--) if(scanAvg('B',y)>TOL){bottom=y;break;}
  const cardW=right-left,cardH=bottom-top,ratio=cardW/cardH;
  const tooLarge=(right-left)>w*0.92||(bottom-top)>h*0.92;
  if(!tooLarge&&cardW>w*0.15&&cardH>h*0.15&&ratio>0.55&&ratio<0.85)
    return{left,right,top,bottom,cardW,cardH,method:'bg-color'};
  return varianceFallback(d,w,h,'bg-fallback');
}

function varianceFallback(d,w,h,method='variance'){
  const GX=32,GY=32;
  const cellW=Math.floor(w/GX),cellH=Math.floor(h/GY);
  if(cellW<2||cellH<2)return{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1,method};
  const vg=[];let maxV=0;
  for(let gy=0;gy<GY;gy++){vg[gy]=[];for(let gx=0;gx<GX;gx++){
    let s=0,sq=0,n=0;
    const x0=gx*cellW,y0=gy*cellH,step=Math.max(1,Math.floor(Math.min(cellW,cellH)/5));
    for(let y=y0;y<y0+cellH&&y<h;y+=step)for(let x=x0;x<x0+cellW&&x<w;x+=step)
      {const v=LUM(...PX(d,w,x,y));s+=v;sq+=v*v;n++;}
    const variance=n>0?sq/n-(s/n)**2:0;
    vg[gy][gx]=variance;if(variance>maxV)maxV=variance;
  }}
  const floor=Math.max(30,maxV*0.12);
  let minGX=GX,maxGX=-1,minGY=GY,maxGY=-1,count=0;
  for(let gy=0;gy<GY;gy++)for(let gx=0;gx<GX;gx++)if(vg[gy][gx]>floor){
    if(gx<minGX)minGX=gx;if(gx>maxGX)maxGX=gx;
    if(gy<minGY)minGY=gy;if(gy>maxGY)maxGY=gy;count++;
  }
  if(count<6)return{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1,method};
  return{left:minGX*cellW,right:Math.min(w-1,(maxGX+1)*cellW),
         top:minGY*cellH,bottom:Math.min(h-1,(maxGY+1)*cellH),
         cardW:(maxGX-minGX+1)*cellW,cardH:(maxGY-minGY+1)*cellH,method};
}

// ─── STEP 2: Angle detection ──────────────────────────────────────────────────
function detectCardAngle(d, w, h, bn) {
  const{left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const PROBES=24, SEARCH=Math.round(Math.min(cW,cH)*0.07);
  const findEdgeY=(x,nearY)=>{let best=nearY,bestG=0;for(let y=CLAMP(nearY-SEARCH,0,h-2);y<=CLAMP(nearY+SEARCH,0,h-2);y++){const g=Math.abs(LUM(...PX(d,w,x,CLAMP(y-2,0,h-1)))-LUM(...PX(d,w,x,CLAMP(y+2,0,h-1))));if(g>bestG){bestG=g;best=y;}}return bestG>6?best:null;};
  const findEdgeX=(y,nearX)=>{let best=nearX,bestG=0;for(let x=CLAMP(nearX-SEARCH,0,w-2);x<=CLAMP(nearX+SEARCH,0,w-2);x++){const g=Math.abs(LUM(...PX(d,w,CLAMP(x-2,0,w-1),y))-LUM(...PX(d,w,CLAMP(x+2,0,w-1),y)));if(g>bestG){bestG=g;best=x;}}return bestG>6?best:null;};
  const fitSlope=pts=>{if(pts.length<5)return null;const n=pts.length;const sx=pts.reduce((s,p)=>s+p.x,0),sy=pts.reduce((s,p)=>s+p.y,0);const sxy=pts.reduce((s,p)=>s+p.x*p.y,0),sxx=pts.reduce((s,p)=>s+p.x*p.x,0);const den=n*sxx-sx*sx;return Math.abs(den)<1?null:(n*sxy-sx*sy)/den;};
  const angles=[];
  {const pts=[];for(let i=0;i<PROBES;i++){const x=Math.round(cl+cW*(0.05+0.90*i/(PROBES-1)));const y=findEdgeY(x,ct);if(y!==null)pts.push({x,y});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  {const pts=[];for(let i=0;i<PROBES;i++){const x=Math.round(cl+cW*(0.05+0.90*i/(PROBES-1)));const y=findEdgeY(x,cb);if(y!==null)pts.push({x,y});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  {const pts=[];for(let i=0;i<PROBES;i++){const y=Math.round(ct+cH*(0.05+0.90*i/(PROBES-1)));const x=findEdgeX(y,cl);if(x!==null)pts.push({x:y,y:x});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  {const pts=[];for(let i=0;i<PROBES;i++){const y=Math.round(ct+cH*(0.05+0.90*i/(PROBES-1)));const x=findEdgeX(y,cr);if(x!==null)pts.push({x:y,y:x});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  if(angles.length===0)return{angle:0,confidence:'failed'};
  angles.sort((a,b)=>a-b);
  // Cluster: if 2+ sources agree within 2°, use their average
  let bestClusterAngle=null,bestClusterSize=0;
  for(let i=0;i<angles.length;i++){
    const cluster=angles.filter(a=>Math.abs(a-angles[i])<=2.0);
    if(cluster.length>bestClusterSize){bestClusterSize=cluster.length;bestClusterAngle=cluster.reduce((s,v)=>s+v,0)/cluster.length;}
  }
  const median=angles[Math.floor(angles.length/2)];
  const finalAngle=bestClusterSize>=2?bestClusterAngle:median;
  return{angle:Math.round(finalAngle*100)/100,confidence:angles.length>=3?'good':'low',allAngles:angles};
}

// ─── STEP 3: Border measurement ───────────────────────────────────────────────
// Gradient ±5px finds the true card edge.
// Color sampling dep=2-5 gets border color very close to that edge.
// Color-distance scan inward finds where border ends.
// This was the approach that gave L:36 IQR:1, R:39 IQR:2 on card back.
function measureBorderWidth(d, w, h, bn, side, angleDeg) {
  const{left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const rad=angleDeg*Math.PI/180;
  const cosA=Math.cos(rad),sinA=Math.sin(rad);

  let alongX,alongY,perpInX,perpInY,edgeStartX,edgeStartY,edgeLen;
  if(side==='T'){alongX=cosA;alongY=sinA;perpInX=-sinA;perpInY=cosA;edgeStartX=cl;edgeStartY=ct;edgeLen=cW;}
  else if(side==='B'){alongX=cosA;alongY=sinA;perpInX=sinA;perpInY=-cosA;edgeStartX=cl;edgeStartY=cb;edgeLen=cW;}
  else if(side==='L'){alongX=-sinA;alongY=cosA;perpInX=cosA;perpInY=sinA;edgeStartX=cl;edgeStartY=ct;edgeLen=cH;}
  else{alongX=-sinA;alongY=cosA;perpInX=-cosA;perpInY=-sinA;edgeStartX=cr;edgeStartY=ct;edgeLen=cH;}

  const SAMPLES=32;
  const MAX_BORDER=Math.round(Math.min(cW,cH)*0.22);

  // Phase 1: Gradient ±5px edge refinement + border color sampling
  const edgePositions=[];
  const borderColorSamples=[];

  for(let si=0;si<SAMPLES;si++){
    const t=edgeLen*(0.10+0.80*si/(SAMPLES-1));
    const ex=edgeStartX+alongX*t, ey=edgeStartY+alongY*t;

    // Find sharpest gradient within ±5px of detected bound = true card edge
    let outerX=ex, outerY=ey, bestGrad=0;
    for(let dep=-5;dep<=5;dep++){
      const px=ex+perpInX*dep, py=ey+perpInY*dep;
      if(px<0||px>=w||py<0||py>=h) continue;
      const g=Math.abs(lumAt(d,w,h,px-perpInX*2,py-perpInY*2)-lumAt(d,w,h,px+perpInX*2,py+perpInY*2));
      if(g>bestGrad){bestGrad=g; outerX=px; outerY=py;}
    }
    edgePositions.push({x:outerX, y:outerY});

    // Sample border color from 2-5px inward — close to edge, avoids artwork
    for(let dep=2;dep<=5;dep++){
      const px=CLAMP(Math.round(outerX+perpInX*dep),0,w-1);
      const py=CLAMP(Math.round(outerY+perpInY*dep),0,h-1);
      borderColorSamples.push(PX(d,w,px,py));
    }
  }

  // Median border color — robust against corner noise
  const brR=medianArr(borderColorSamples.map(s=>s[0]));
  const brG=medianArr(borderColorSamples.map(s=>s[1]));
  const brB=medianArr(borderColorSamples.map(s=>s[2]));
  const colorDist=(r,g,b)=>Math.sqrt((r-brR)**2+(g-brG)**2+(b-brB)**2);

  // Adaptive threshold: 3× within-border color variance
  // Solid blue border → low variance → tight threshold → precise detection
  // Foil border → high variance → loose threshold → correctly returns 0 (no border)
  const withinBorderDist=medianArr(borderColorSamples.map(([r,g,b])=>colorDist(r,g,b)));
  const TOL=Math.max(22, withinBorderDist*3.0);

  // Phase 2: Scan inward until color diverges from border color
  const measurements=[];
  for(let si=0;si<SAMPLES;si++){
    const{x:outerX,y:outerY}=edgePositions[si];
    let borderWidth=MAX_BORDER;
    for(let dep=3;dep<=MAX_BORDER;dep++){
      const px=CLAMP(Math.round(outerX+perpInX*dep),0,w-1);
      const py=CLAMP(Math.round(outerY+perpInY*dep),0,h-1);
      const[r,g,b]=PX(d,w,px,py);
      if(colorDist(r,g,b)>TOL){borderWidth=dep;break;}
    }
    if(borderWidth<MAX_BORDER-1) measurements.push(borderWidth);
  }

  if(measurements.length<4) return{width:0,confidence:'failed',iqr:999,borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},tol:Math.round(TOL)};
  measurements.sort((a,b)=>a-b);
  const med=measurements[Math.floor(measurements.length/2)];
  const q1=measurements[Math.floor(measurements.length*0.25)];
  const q3=measurements[Math.floor(measurements.length*0.75)];
  const iqr=q3-q1;
  return{
    width:med,
    confidence:iqr<=5?'good':iqr<=15?'low':'failed',
    iqr,
    borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},
    tol:Math.round(TOL),
  };
}

function detectCentering(d, w, h, bn, angleDeg) {
  const sT=measureBorderWidth(d,w,h,bn,'T',angleDeg);
  const sB=measureBorderWidth(d,w,h,bn,'B',angleDeg);
  const sL=measureBorderWidth(d,w,h,bn,'L',angleDeg);
  const sR=measureBorderWidth(d,w,h,bn,'R',angleDeg);
  const bL=sL.width,bR=sR.width,bT=sT.width,bB=sB.width;
  const lrT=bL+bR,tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  const confs=[sL.confidence,sR.confidence,sT.confidence,sB.confidence];
  const conf=confs.every(c=>c==='good')?'good':confs.filter(c=>c==='failed').length>=2?'failed':'low';
  return{bL,bR,bT,bB,lrRatio,tbRatio,scanL:sL,scanR:sR,scanT:sT,scanB:sB,confidence:conf};
}

// ─── Deskew canvas (rotate card upright for display) ─────────────────────────
function deskewCanvas(srcCanvas, angleDeg) {
  if(Math.abs(angleDeg)<0.15) return srcCanvas;
  const rad=-angleDeg*Math.PI/180;
  const sw=srcCanvas.width, sh=srcCanvas.height;
  const cos=Math.abs(Math.cos(rad)), sin=Math.abs(Math.sin(rad));
  const nw=Math.round(sw*cos+sh*sin), nh=Math.round(sw*sin+sh*cos);
  const c=document.createElement('canvas'); c.width=nw; c.height=nh;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.translate(nw/2,nh/2); ctx.rotate(rad); ctx.drawImage(srcCanvas,-sw/2,-sh/2);
  return c;
}

// ─── Full pipeline ────────────────────────────────────────────────────────────
async function analyzeCard(src) {
  const{canvas,w,h,data}=await loadImg(src,1400);
  const d=data.data;
  const bounds=findBounds(d,w,h);
  const angleResult=detectCardAngle(d,w,h,bounds);
  const angle=angleResult.angle;
  const centering=detectCentering(d,w,h,bounds,angle);

  // Deskew for display — rotate card upright so user sees a straight card
  const deskewed=deskewCanvas(canvas,angle);
  const displayUrl=deskewed.toDataURL('image/jpeg',0.92);
  const dw=deskewed.width, dh=deskewed.height;

  // Transform original bounds into deskewed coordinate space mathematically.
  // Re-running findBounds on the deskewed image fails because rotation creates
  // dark corner triangles that confuse the background-color detector.
  const rad2=-angle*Math.PI/180; // negated because deskew rotates by -angle
  const cosD=Math.cos(rad2), sinD=Math.sin(rad2);
  // Original image center (rotation pivot for deskew)
  const ocx=w/2, ocy=h/2;
  // Deskewed image center
  const dcx=dw/2, dcy=dh/2;
  // Transform a point from original to deskewed space
  const transformPt=(x,y)=>{
    const dx=x-ocx, dy=y-ocy;
    return[dcx+dx*cosD-dy*sinD, dcy+dx*sinD+dy*cosD];
  };
  // Transform all 4 corners of original bounds
  const{left:bl,right:br,top:bt,bottom:bb}=bounds;
  const corners=[transformPt(bl,bt),transformPt(br,bt),transformPt(br,bb),transformPt(bl,bb)];
  const dLeft  =Math.round(Math.min(...corners.map(c=>c[0])));
  const dRight =Math.round(Math.max(...corners.map(c=>c[0])));
  const dTop   =Math.round(Math.min(...corners.map(c=>c[1])));
  const dBottom=Math.round(Math.max(...corners.map(c=>c[1])));
  const deskewedBounds={
    left:CLAMP(dLeft,0,dw-1), right:CLAMP(dRight,0,dw-1),
    top:CLAMP(dTop,0,dh-1),   bottom:CLAMP(dBottom,0,dh-1),
    cardW:dRight-dLeft, cardH:dBottom-dTop,
  };

  return{
    srcCanvas:canvas, displayUrl,
    w, h, dw, dh,
    bounds, deskewedBounds,
    centering, angle, angleResult,
  };
}

// ─── Overlay on deskewed image ────────────────────────────────────────────────
// Returns handle positions so CardPanel can hit-test mouse/touch events
function drawOverlay(canvas, result, borderOverrides, outerOffsets) {
  if(!canvas||!result) return [];
  const bn=result.deskewedBounds;
  if(!bn) return [];
  const w=result.dw, h=result.dh;
  const ctx=canvas.getContext('2d');
  canvas.width=w; canvas.height=h; ctx.clearRect(0,0,w,h);

  const cl=bn.left+(outerOffsets?.L||0);
  const cr=bn.right-(outerOffsets?.R||0);
  const ct=bn.top+(outerOffsets?.T||0);
  const cb=bn.bottom-(outerOffsets?.B||0);
  const cW=cr-cl, cH=cb-ct;

  const c=result.centering;
  const bL=Math.max(0,(borderOverrides?.L||0)+c.bL);
  const bR=Math.max(0,(borderOverrides?.R||0)+c.bR);
  const bT=Math.max(0,(borderOverrides?.T||0)+c.bT);
  const bB=Math.max(0,(borderOverrides?.B||0)+c.bB);

  // Inner border line positions — clamped so they never invert
  // (can happen when bounds=full-image and border scans are wrong)
  const iL=Math.min(cl+bL, cl+cW*0.48);
  const iR=Math.max(cr-bR, cl+cW*0.52);
  const iT=Math.min(ct+bT, ct+cH*0.48);
  const iB=Math.max(cb-bB, ct+cH*0.52);

  // Outer card boundary (orange)
  ctx.strokeStyle='#ff9944'; ctx.lineWidth=3; ctx.setLineDash([]);
  ctx.strokeRect(cl,ct,cW,cH);

  // Inner artwork boundary (green dashed)
  ctx.strokeStyle='#00ff88'; ctx.lineWidth=2; ctx.setLineDash([8,5]);
  ctx.strokeRect(iL, iT, iR-iL, iB-iT);
  ctx.setLineDash([]);

  // Border labels
  const fs=Math.max(12,~~(cW*0.024));
  ctx.font=`bold ${fs}px ${mono}`; ctx.textAlign='center';
  const lc=s=>s?.confidence==='good'?'#00ff88':s?.confidence==='low'?'#ccbb00':'#ff4444';
  const drawLabel=(txt,x,y,scan)=>{
    ctx.fillStyle='rgba(0,0,0,.8)'; ctx.fillRect(x-32,y-13,64,18);
    ctx.fillStyle=lc(scan); ctx.fillText(txt,x,y);
  };
  drawLabel(`L ${bL}px`, cl+bL/2, ct+cH/2, c.scanL);
  drawLabel(`R ${bR}px`, cr-bR/2, ct+cH/2, c.scanR);
  drawLabel(`T ${bT}px`, cl+cW/2, ct+bT/2+5, c.scanT);
  drawLabel(`B ${bB}px`, cl+cW/2, cb-bB/2, c.scanB);

  // Centering ratio
  const lrT=bL+bR, tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  const lrOk=Math.max(lrRatio,100-lrRatio)<=55;
  const tbOk=Math.max(tbRatio,100-tbRatio)<=65;
  ctx.font=`bold ${Math.max(13,~~(cW*0.028))}px ${mono}`;
  ctx.fillStyle=(lrOk&&tbOk)?'#00ff88':'#ff6633';
  ctx.fillText(
    `${lrRatio}/${Math.round((100-lrRatio)*10)/10}  ${tbRatio}/${Math.round((100-tbRatio)*10)/10}`,
    cl+cW/2, Math.max(20, ct-14)
  );

  // Draw drag handles — pill-shaped, sitting ON the border lines
  // Returns list of handles for hit-testing
  const handles=[];
  const HR=14; // handle radius
  const drawHandle=(x,y,color,id,axis)=>{
    // Pill shape — horizontal for T/B handles, vertical for L/R
    const isHoriz=axis==='x';
    ctx.save();
    ctx.translate(x,y);
    ctx.fillStyle=color;
    ctx.strokeStyle='#fff';
    ctx.lineWidth=1.5;
    ctx.beginPath();
    if(isHoriz){
      ctx.roundRect(-HR,-HR/2,HR*2,HR,HR/2);
    } else {
      ctx.roundRect(-HR/2,-HR,HR,HR*2,HR/2);
    }
    ctx.fill(); ctx.stroke();
    // Arrow indicators
    ctx.fillStyle='rgba(255,255,255,0.9)';
    ctx.font=`bold ${HR-2}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(isHoriz?'⟺':'⇕',0,0);
    ctx.restore();
    handles.push({x,y,id,axis,r:HR+6});
  };

  // Inner border handles (green) — dragging moves the inner border line
  drawHandle(cl+cW/2, iT,  '#00cc66', 'iT', 'x');
  drawHandle(cl+cW/2, iB,  '#00cc66', 'iB', 'x');
  drawHandle(iL, ct+cH/2,  '#00cc66', 'iL', 'y');
  drawHandle(iR, ct+cH/2,  '#00cc66', 'iR', 'y');

  // Outer boundary handles (orange) — dragging moves the card boundary
  drawHandle(cl+cW/2, ct,  '#ff7722', 'oT', 'x');
  drawHandle(cl+cW/2, cb,  '#ff7722', 'oB', 'x');
  drawHandle(cl, ct+cH/2,  '#ff7722', 'oL', 'y');
  drawHandle(cr, ct+cH/2,  '#ff7722', 'oR', 'y');

  return handles;
}

// ─── Card Panel ───────────────────────────────────────────────────────────────
function CardPanel({label, side, onResult}) {
  const[imgSrc,setImgSrc]=useState(null);
  const[result,setResult]=useState(null);
  const[loading,setLoading]=useState(false);
  const[angleOverride,setAngleOverride]=useState(null);
  const[borderOverrides,setBorderOverrides]=useState({L:0,R:0,T:0,B:0});
  const[outerOffsets,setOuterOffsets]=useState({L:0,R:0,T:0,B:0});
  const fileRef=useRef(null), canvasRef=useRef(null), imgRef=useRef(null);
  const recomputeRef=useRef(null);
  const handlesRef=useRef([]);       // current handle positions in canvas px
  const dragRef=useRef(null);        // {handle, startCanvasPos, startOverride}
  const borderRef=useRef({L:0,R:0,T:0,B:0});
  const outerRef=useRef({L:0,R:0,T:0,B:0});

  // Keep refs in sync with state for drag callbacks
  useEffect(()=>{borderRef.current=borderOverrides;},[borderOverrides]);
  useEffect(()=>{outerRef.current=outerOffsets;},[outerOffsets]);

  // Convert client coords to canvas pixel coords + return display scale
  const clientToCanvas=(clientX,clientY)=>{
    const c=canvasRef.current; if(!c) return{x:0,y:0,scaleX:1,scaleY:1};
    const rect=c.getBoundingClientRect();
    const scaleX=c.width/rect.width, scaleY=c.height/rect.height;
    return{x:(clientX-rect.left)*scaleX, y:(clientY-rect.top)*scaleY, scaleX, scaleY};
  };

  // Hit test — radius is scaled by display ratio so mobile taps work at ~24 display px
  const hitHandle=(cx,cy,scaleX)=>handlesRef.current.find(h=>Math.hypot(h.x-cx,h.y-cy)<=(h.r*Math.max(1,scaleX)));

  const onPointerDown=e=>{
    e.preventDefault();
    const{x,y,scaleX}=clientToCanvas(e.clientX,e.clientY);
    const h=hitHandle(x,y,scaleX);
    if(!h) return;
    dragRef.current={id:h.id,axis:h.axis,startX:x,startY:y,
      startBorder:{...borderRef.current},startOuter:{...outerRef.current}};
    canvasRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove=e=>{
    if(!dragRef.current) return;
    e.preventDefault();
    const{x,y}=clientToCanvas(e.clientX,e.clientY);
    const{id,axis,startX,startY,startBorder,startOuter}=dragRef.current;
    const dx=Math.round(x-startX), dy=Math.round(y-startY);
    const delta=axis==='x'?dy:dx;

    // Map handle id to which state to update and direction
    // Inner handles move the border line; positive delta = line moves that direction
    if(id==='iT') setBorderOverrides(p=>({...p,T:startBorder.T+delta}));
    if(id==='iB') setBorderOverrides(p=>({...p,B:startBorder.B-delta}));
    if(id==='iL') setBorderOverrides(p=>({...p,L:startBorder.L+delta}));
    if(id==='iR') setBorderOverrides(p=>({...p,R:startBorder.R-delta}));
    // Outer handles move the card boundary
    if(id==='oT') setOuterOffsets(p=>({...p,T:startOuter.T+delta}));
    if(id==='oB') setOuterOffsets(p=>({...p,B:startOuter.B-delta}));
    if(id==='oL') setOuterOffsets(p=>({...p,L:startOuter.L+delta}));
    if(id==='oR') setOuterOffsets(p=>({...p,R:startOuter.R-delta}));
  };

  const onPointerUp=e=>{ dragRef.current=null; };

  const handleFile=e=>{
    const f=e.target.files?.[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      const src=ev.target.result;
      setImgSrc(src); setResult(null); setLoading(true);
      setAngleOverride(null); setBorderOverrides({L:0,R:0,T:0,B:0}); setOuterOffsets({L:0,R:0,T:0,B:0});
      const res=await analyzeCard(src);
      setResult(res); setLoading(false);
      if(onResult) onResult(res);
    };
    reader.readAsDataURL(f);
  };

  // Recompute on angle change
  const recomputeAngle=useCallback(async(newAngle)=>{
    if(!result) return;
    clearTimeout(recomputeRef.current);
    recomputeRef.current=setTimeout(async()=>{
      const{srcCanvas,w,h,bounds}=result;
      const d=srcCanvas.getContext('2d').getImageData(0,0,w,h).data;
      const centering=detectCentering(d,w,h,bounds,newAngle);
      const deskewed=deskewCanvas(srcCanvas,newAngle);
      const displayUrl=deskewed.toDataURL('image/jpeg',0.92);
      const dw=deskewed.width, dh=deskewed.height;
      // Mathematical transform — same as analyzeCard. Re-running findBounds on the
      // deskewed image fails because dark corner triangles break background detection.
      const rad2=-newAngle*Math.PI/180;
      const cosD=Math.cos(rad2), sinD=Math.sin(rad2);
      const ocx=w/2, ocy=h/2, dcx=dw/2, dcy=dh/2;
      const transformPt=(x,y)=>{const dx=x-ocx,dy=y-ocy;return[dcx+dx*cosD-dy*sinD,dcy+dx*sinD+dy*cosD];};
      const{left:bl,right:br,top:bt,bottom:bb}=bounds;
      const corners=[transformPt(bl,bt),transformPt(br,bt),transformPt(br,bb),transformPt(bl,bb)];
      const dLeft=Math.round(Math.min(...corners.map(c=>c[0])));
      const dRight=Math.round(Math.max(...corners.map(c=>c[0])));
      const dTop=Math.round(Math.min(...corners.map(c=>c[1])));
      const dBottom=Math.round(Math.max(...corners.map(c=>c[1])));
      const deskewedBounds={
        left:CLAMP(dLeft,0,dw-1), right:CLAMP(dRight,0,dw-1),
        top:CLAMP(dTop,0,dh-1),   bottom:CLAMP(dBottom,0,dh-1),
        cardW:dRight-dLeft, cardH:dBottom-dTop,
      };
      setResult(prev=>({...prev,displayUrl,dw,dh,centering,angle:newAngle,deskewedBounds}));
      setBorderOverrides({L:0,R:0,T:0,B:0});
    },100);
  },[result]);

  useEffect(()=>{
    if(!result||!canvasRef.current||!imgRef.current) return;
    imgRef.current.src=result.displayUrl;
    const draw=()=>{
      handlesRef.current=drawOverlay(canvasRef.current,result,borderOverrides,outerOffsets)||[];
    };
    if(imgRef.current.complete&&imgRef.current.naturalWidth) draw();
    else imgRef.current.onload=draw;
  },[result,borderOverrides,outerOffsets]);

  const activeAngle=angleOverride??result?.angle??0;
  const c=result?.centering;
  const bL=(borderOverrides.L)+(c?.bL??0);
  const bR=(borderOverrides.R)+(c?.bR??0);
  const bT=(borderOverrides.T)+(c?.bT??0);
  const bB=(borderOverrides.B)+(c?.bB??0);
  const lrT=bL+bR, tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  const thresh=side==='back'?65:55;
  const lrOk=Math.max(lrRatio,100-lrRatio)<=55;
  const tbOk=Math.max(tbRatio,100-tbRatio)<=thresh;

  return(
    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:10}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontFamily:mono,fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'.1em'}}>{label}</span>
        <button onClick={()=>fileRef.current?.click()} style={{padding:'4px 12px',borderRadius:4,background:'rgba(255,153,68,.15)',border:'1px solid #ff994444',color:'#ff9944',fontFamily:mono,fontSize:9,cursor:'pointer'}}>{imgSrc?'CHANGE':'UPLOAD'}</button>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/>
      </div>

      {/* Image + draggable overlay */}
      <div style={{position:'relative',background:'#0a0a0a',borderRadius:10,overflow:'hidden',border:'1px solid #1a1c22'}}>
        {imgSrc?<>
          <img ref={imgRef} src={result?.displayUrl||imgSrc} style={{width:'100%',display:'block',userSelect:'none'}}/>
          <canvas ref={canvasRef}
            style={{position:'absolute',inset:0,width:'100%',height:'100%',cursor:'crosshair',touchAction:'none'}}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {loading&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.75)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6}}>
            <div style={{fontFamily:mono,fontSize:11,color:'#00ff88'}}>Analyzing…</div>
          </div>}
        </>:<div onClick={()=>fileRef.current?.click()} style={{aspectRatio:'2.5/3.5',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:10}}>
          <div style={{fontSize:36}}>📷</div>
          <div style={{fontFamily:mono,fontSize:10,color:'#444'}}>TAP TO UPLOAD</div>
        </div>}
      </div>

      {/* Rotation slider */}
      {result&&<div style={{background:'#0d0f13',borderRadius:8,border:'1px solid #1a1c22',padding:'10px 12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <span style={{fontFamily:mono,fontSize:9,color:'#555',textTransform:'uppercase'}}>Rotation</span>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontFamily:mono,fontSize:11,color:Math.abs(activeAngle)>0.15?'#ff9944':'#00ff88'}}>
              {activeAngle>0?'+':''}{activeAngle}°
            </span>
            <button onClick={()=>{setAngleOverride(result.angleResult?.angle||0);recomputeAngle(result.angleResult?.angle||0);}}
              style={{padding:'2px 8px',borderRadius:3,background:'transparent',border:'1px solid #333',color:'#555',fontFamily:mono,fontSize:8,cursor:'pointer'}}>↺ Auto</button>
          </div>
        </div>
        <input type="range" min="-15" max="15" step="0.1"
          value={activeAngle}
          onChange={e=>{const a=parseFloat(e.target.value);setAngleOverride(a);recomputeAngle(a);}}
          style={{width:'100%',accentColor:'#ff9944'}}/>
      </div>}

      {/* Full-frame warning — detection fails when card fills photo edge to edge */}
      {result?.bounds?.method==='bg-fallback'&&<div style={{background:'rgba(255,150,0,.08)',border:'1px solid #ff990033',borderRadius:8,padding:'8px 12px',marginBottom:6}}>
        <div style={{fontFamily:mono,fontSize:9,color:'#ff9944'}}>⚠ Card fills frame — include background in photo for accurate detection. Use handles to correct manually.</div>
      </div>}

      {/* Centering readout */}
      {c&&<div style={{background:'#0d0f13',borderRadius:10,border:'1px solid #1a1c22',padding:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <span style={{fontFamily:mono,fontSize:9,color:'#555',textTransform:'uppercase'}}>Centering</span>
          <span style={{fontFamily:mono,fontSize:9,fontWeight:700,color:c.confidence==='good'?'#00ff88':c.confidence==='low'?'#ccbb00':'#ff4444'}}>
            {c.confidence==='good'?'✓ CONFIDENT':c.confidence==='low'?'⚠ LOW CONF':'✗ FAILED'}
          </span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          {[['L/R',lrRatio,lrOk,55],['T/B',tbRatio,tbOk,thresh]].map(([lbl,ratio,ok,th])=>(
            <div key={lbl} style={{padding:'8px 10px',background:'rgba(0,0,0,.3)',borderRadius:6,border:`1px solid ${ok?'#1a1c22':'#ff663344'}`}}>
              <div style={{fontFamily:mono,fontSize:8,color:'#555',marginBottom:3}}>{lbl}</div>
              <div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:ok?'#00dd77':'#ff6633'}}>
                {ratio}<span style={{fontSize:12,color:'#555'}}>/</span>{Math.round((100-ratio)*10)/10}
              </div>
              {!ok&&<div style={{fontFamily:mono,fontSize:8,color:'#ff6633',marginTop:3}}>⚠ Over {th}/{100-th}</div>}
            </div>
          ))}
        </div>
        {/* Border widths */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4,marginBottom:8}}>
          {[['L',bL,c.scanL],['R',bR,c.scanR],['T',bT,c.scanT],['B',bB,c.scanB]].map(([lbl,px,scan])=>(
            <div key={lbl} style={{padding:'5px 3px',background:'rgba(0,0,0,.3)',borderRadius:5,textAlign:'center'}}>
              <div style={{fontFamily:mono,fontSize:8,color:'#555'}}>{lbl}</div>
              <div style={{fontFamily:mono,fontSize:13,fontWeight:600,
                color:scan?.confidence==='good'?'#aaa':scan?.confidence==='low'?'#ccbb00':'#ff4444'}}>{px}px</div>
            </div>
          ))}
        </div>
        <div style={{fontFamily:mono,fontSize:8,color:'#555',marginBottom:8}}>
          Drag green handles = inner border · Drag orange handles = card edge
        </div>
        {/* Debug dump — open by default so data is always accessible */}
        <details open style={{marginTop:10}}>
          <summary style={{fontFamily:mono,fontSize:8,color:'#444',cursor:'pointer',textTransform:'uppercase'}}>Debug data (tap to select all)</summary>
          <textarea readOnly onClick={e=>e.target.select()}
            value={JSON.stringify({bounds:{...result?.bounds,method:result?.bounds?.method},angle:result?.angle,angleSources:result?.angleResult?.allAngles?.map(a=>Math.round(a*100)/100),centering:{lrRatio,tbRatio,bL,bR,bT,bB},scanDetails:{L:{w:c.scanL?.width,iqr:c.scanL?.iqr,conf:c.scanL?.confidence,color:c.scanL?.borderColor,tol:c.scanL?.tol},R:{w:c.scanR?.width,iqr:c.scanR?.iqr,conf:c.scanR?.confidence,color:c.scanR?.borderColor,tol:c.scanR?.tol},T:{w:c.scanT?.width,iqr:c.scanT?.iqr,conf:c.scanT?.confidence,color:c.scanT?.borderColor,tol:c.scanT?.tol},B:{w:c.scanB?.width,iqr:c.scanB?.iqr,conf:c.scanB?.confidence,color:c.scanB?.borderColor,tol:c.scanB?.tol}}},null,2)}
            style={{width:'100%',height:140,marginTop:6,background:'#060810',color:'#66aaff',border:'none',borderRadius:4,fontFamily:mono,fontSize:8,resize:'none',padding:6,boxSizing:'border-box'}}/>
        </details>
      </div>}
      {/* Fallback debug when detection fails entirely — shows bounds + angle even with no centering */}
      {result&&!c&&<div style={{background:'#0d0f13',borderRadius:10,border:'1px solid #ff443344',padding:12,marginTop:8}}>
        <div style={{fontFamily:mono,fontSize:9,color:'#ff4444',marginBottom:6}}>⚠ Detection failed — bounds debug</div>
        <details open>
          <summary style={{fontFamily:mono,fontSize:8,color:'#444',cursor:'pointer',textTransform:'uppercase'}}>Debug data (tap to select all)</summary>
          <textarea readOnly onClick={e=>e.target.select()}
            value={JSON.stringify({bounds:{...result?.bounds,method:result?.bounds?.method},angle:result?.angle,angleSources:result?.angleResult?.allAngles?.map(a=>Math.round(a*100)/100)},null,2)}
            style={{width:'100%',height:100,marginTop:6,background:'#060810',color:'#ff6644',border:'none',borderRadius:4,fontFamily:mono,fontSize:8,resize:'none',padding:6,boxSizing:'border-box'}}/>
        </details>
      </div>}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App(){
  const[fR,setFR]=useState(null),[bR,setBR]=useState(null);
  const fc=fR?.centering, bc=bR?.centering;
  return(
    <div style={{minHeight:'100vh',background:'#090b0e',color:'#ccc',fontFamily:sans}}>
      <div style={{padding:'14px 16px',borderBottom:'1px solid #1a1c22',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:36,height:36,borderRadius:9,background:'linear-gradient(135deg,#00ff88,#0088ff)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:800,color:'#000'}}>CT</div>
        <div>
          <div style={{fontSize:15,fontWeight:600}}>Centering Tool</div>
          <div style={{fontFamily:mono,fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'.1em'}}>Auto-rotate · Border scan · Manual adjust</div>
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
