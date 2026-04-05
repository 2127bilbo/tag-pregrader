import { useState, useRef, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════
   TAG CENTERING TOOL v2 — Dev Build
   - Cropped upright card display
   - Rotation slider + fine-tune
   - Per-edge border nudge arrows
   - Live centering recalculation
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

// ─── Card boundary detection ──────────────────────────────────────────────────
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

// ─── Angle detection ──────────────────────────────────────────────────────────
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
  let bestClusterAngle=null,bestClusterSize=0;
  for(let i=0;i<angles.length;i++){
    const cluster=angles.filter(a=>Math.abs(a-angles[i])<=2.0);
    if(cluster.length>bestClusterSize){bestClusterSize=cluster.length;bestClusterAngle=cluster.reduce((s,v)=>s+v,0)/cluster.length;}
  }
  const median=angles[Math.floor(angles.length/2)];
  const finalAngle=bestClusterSize>=2?bestClusterAngle:median;
  return{angle:Math.round(finalAngle*100)/100,confidence:angles.length>=3?'good':'low',allAngles:angles};
}

// ─── Border measurement (color-distance from actual card edge) ────────────────
//
// Problem with gradient-peak approach (confirmed from debug data):
//   L/R IQR always 30-100+ because gradient from card artwork (pokeball,
//   text, swirl) is STRONGER than the border→artwork transition gradient.
//   T/B work better because top/bottom border strips are more uniform.
//
// New approach:
//   1. Find the actual physical card edge precisely (±15px search around detected bound)
//   2. Sample border color from 3-8px inward from that real edge
//   3. Use adaptive threshold = 3x within-border color variance
//   4. Scan inward until color diverges from border color → border width
//   This self-calibrates to each card's border material and lighting.

function medianArr(arr) {
  const s=[...arr].sort((a,b)=>a-b);
  return s[Math.floor(s.length/2)];
}

function measureBorderWidth(d, w, h, bn, side, angleDeg, bgColor) {
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

  // Phase 1: Find actual card edges + sample border color
  const edgePositions=[];
  const borderColorSamples=[];

  for(let si=0;si<SAMPLES;si++){
    const t=edgeLen*(0.10+0.80*si/(SAMPLES-1));
    const ex=edgeStartX+alongX*t;
    const ey=edgeStartY+alongY*t;

    // Gradient search ±5px around detected bound.
    // This proved more reliable than bgColor walk-outward:
    // the card-background gradient is sharp and well-localized,
    // finds the true edge even when bounds are off by a few px.
    let outerX=ex, outerY=ey, bestGrad=0;
    for(let dep=-5;dep<=5;dep++){
      const px=ex+perpInX*dep, py=ey+perpInY*dep;
      if(px<0||px>=w||py<0||py>=h) continue;
      const g=Math.abs(
        lumAt(d,w,h,px-perpInX*2,py-perpInY*2)-
        lumAt(d,w,h,px+perpInX*2,py+perpInY*2)
      );
      if(g>bestGrad){bestGrad=g; outerX=px; outerY=py;}
    }
    edgePositions.push({x:outerX, y:outerY});

    // Sample border color from 2-5px inward from true card edge.
    // 2-5px stays well inside the border but avoids the card edge artifact.
    for(let dep=2;dep<=5;dep++){
      const px=CLAMP(Math.round(outerX+perpInX*dep),0,w-1);
      const py=CLAMP(Math.round(outerY+perpInY*dep),0,h-1);
      const [r,g,b]=PX(d,w,px,py);
      borderColorSamples.push([r,g,b]);
    }
  }

  // Compute median border color (robust to outliers at corners)
  const brR=medianArr(borderColorSamples.map(s=>s[0]));
  const brG=medianArr(borderColorSamples.map(s=>s[1]));
  const brB=medianArr(borderColorSamples.map(s=>s[2]));
  const colorDist=(r,g,b)=>Math.sqrt((r-brR)**2+(g-brG)**2+(b-brB)**2);

  // Adaptive threshold: 3x median within-border color distance
  // Adapts to solid blue border (low variance → tight threshold)
  // vs foil/holo border (high variance → looser threshold)
  const dists=borderColorSamples.map(([r,g,b])=>colorDist(r,g,b));
  const withinBorderDist=medianArr(dists);
  const TOL=Math.max(22, withinBorderDist*3.0);

  // Phase 2: From each actual edge, scan inward until color diverges
  const measurements=[];
  for(let si=0;si<SAMPLES;si++){
    const{x:outerX,y:outerY}=edgePositions[si];
    let borderWidth=MAX_BORDER;

    // Skip first 2px (right at card edge, can have clipping artifacts)
    for(let dep=3;dep<=MAX_BORDER;dep++){
      const px=CLAMP(Math.round(outerX+perpInX*dep),0,w-1);
      const py=CLAMP(Math.round(outerY+perpInY*dep),0,h-1);
      const [r,g,b]=PX(d,w,px,py);
      if(colorDist(r,g,b)>TOL){borderWidth=dep;break;}
    }
    if(borderWidth<MAX_BORDER-1)measurements.push(borderWidth);
  }

  if(measurements.length<4)return{width:0,confidence:'failed',iqr:999,borderColor:{r:brR,g:brG,b:brB},tol:Math.round(TOL)};
  measurements.sort((a,b)=>a-b);
  const med=measurements[Math.floor(measurements.length/2)];
  const q1=measurements[Math.floor(measurements.length*0.25)];
  const q3=measurements[Math.floor(measurements.length*0.75)];
  const iqr=q3-q1;
  // IQR thresholds: ≤8 = good, ≤20 = low, >20 = failed
  // Card backs have "Pokémon" text right at border edge → IQR naturally up to 26
  // That's still a usable measurement, not a failure
  return{
    width:med,
    confidence:iqr<=8?'good':iqr<=20?'low':'failed',
    iqr,
    borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},
    tol:Math.round(TOL),
    rawValues:measurements,
  };
}

function detectCentering(d, w, h, bn, angleDeg, bgColor) {
  const sT=measureBorderWidth(d,w,h,bn,'T',angleDeg,bgColor);
  const sB=measureBorderWidth(d,w,h,bn,'B',angleDeg,bgColor);
  const sL=measureBorderWidth(d,w,h,bn,'L',angleDeg,bgColor);
  const sR=measureBorderWidth(d,w,h,bn,'R',angleDeg,bgColor);
  const bL=sL.width,bR=sR.width,bT=sT.width,bB=sB.width;
  const lrT=bL+bR,tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  const confs=[sL.confidence,sR.confidence,sT.confidence,sB.confidence];
  const conf=confs.every(c=>c==='good')?'good':confs.filter(c=>c==='failed').length>=2?'failed':'low';
  return{bL,bR,bT,bB,lrRatio,tbRatio,scanL:sL,scanR:sR,scanT:sT,scanB:sB,confidence:conf};
}

// ─── Extract card as upright cropped canvas ───────────────────────────────────
function extractCardCanvas(srcCanvas, bounds, angleDeg) {
  const{left:cl,right:cr,top:ct,cardW:cW,cardH:cH}=bounds;
  const cb=ct+cH;
  const rad=-angleDeg*Math.PI/180; // negate to rotate card upright
  const cx=cl+cW/2, cy=ct+cH/2;
  // Output canvas: same size as card bounds
  const out=document.createElement('canvas');
  out.width=Math.round(cW); out.height=Math.round(cH);
  const ctx=out.getContext('2d');
  ctx.translate(cW/2,cH/2);
  ctx.rotate(rad);
  ctx.drawImage(srcCanvas,-cx,-cy);
  return out;
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────
async function analyzeCard(src) {
  const{canvas,w,h,data}=await loadImg(src,1400);
  const d=data.data;
  const imgUrl=canvas.toDataURL('image/jpeg',0.92);
  const bounds=findBounds(d,w,h);
  const angleResult=detectCardAngle(d,w,h,bounds);
  const angle=angleResult.angle;

  // Compute background color from image corners (same as findBounds uses)
  // Pass to measureBorderWidth so it can precisely locate card edges
  const PATCH=12;
  let bgR=0,bgG=0,bgB=0,bgN=0;
  for(const [cx,cy] of [[0,0],[w-PATCH,0],[0,h-PATCH],[w-PATCH,h-PATCH]]){
    for(let dy=0;dy<PATCH;dy++) for(let dx=0;dx<PATCH;dx++){
      const[r,g,b]=PX(d,w,CLAMP(cx+dx,0,w-1),CLAMP(cy+dy,0,h-1));
      bgR+=r;bgG+=g;bgB+=b;bgN++;
    }
  }
  const bgColor={r:bgR/bgN, g:bgG/bgN, b:bgB/bgN};

  const centering=detectCentering(d,w,h,bounds,angle,bgColor);
  return{srcCanvas:canvas,imgUrl,w,h,bounds,centering,angle,angleResult,cardW:bounds.cardW,cardH:bounds.cardH};
}

// ─── Card display with overlay ─────────────────────────────────────────────────
function CardDisplay({result, borderOverrides, outerOffsets, debug}){
  const canvasRef=useRef(null);
  const imgRef=useRef(null);

  useEffect(()=>{
    if(!result||!canvasRef.current||!imgRef.current)return;
    const c=canvasRef.current;
    const img=imgRef.current;
    const draw=()=>{
      const cen=result.centering;
      const bn=result.bounds;
      const bL=Math.max(0,(borderOverrides?.L??0)+cen.bL);
      const bR=Math.max(0,(borderOverrides?.R??0)+cen.bR);
      const bT=Math.max(0,(borderOverrides?.T??0)+cen.bT);
      const bB=Math.max(0,(borderOverrides?.B??0)+cen.bB);
      // Apply outer offsets to bounds
      const cl=bn.left+(outerOffsets?.L??0);
      const cr=bn.right-(outerOffsets?.R??0);
      const ct=bn.top+(outerOffsets?.T??0);
      const cb=bn.bottom-(outerOffsets?.B??0);
      const cW=cr-cl, cH=cb-ct;

      const w=img.naturalWidth||result.w;
      const h=img.naturalHeight||result.h;
      c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      ctx.clearRect(0,0,w,h);

      const angle=result.angle;
      const rad=angle*Math.PI/180;
      const cosA=Math.cos(rad),sinA=Math.sin(rad);

      // Rotate a point around card center
      const cardCX=cl+cW/2, cardCY=ct+cH/2;
      const rot=([x,y])=>{
        const dx=x-cardCX,dy=y-cardCY;
        return[cardCX+dx*cosA-dy*sinA, cardCY+dx*sinA+dy*cosA];
      };

      // Draw outer card boundary (rotated orange box)
      const outerCorners=[[cl,ct],[cr,ct],[cr,cb],[cl,cb]].map(([x,y])=>rot([x,y]));
      ctx.beginPath();
      ctx.moveTo(outerCorners[0][0],outerCorners[0][1]);
      for(let i=1;i<4;i++) ctx.lineTo(outerCorners[i][0],outerCorners[i][1]);
      ctx.closePath();
      ctx.strokeStyle='#ff9944'; ctx.lineWidth=3; ctx.setLineDash([]); ctx.stroke();

      // Draw inner artwork boundary (rotated green dashed box)
      const il=cl+bL,ir=cr-bR,it=ct+bT,ib=cb-bB;
      const innerCorners=[[il,it],[ir,it],[ir,ib],[il,ib]].map(([x,y])=>rot([x,y]));
      ctx.beginPath();
      ctx.moveTo(innerCorners[0][0],innerCorners[0][1]);
      for(let i=1;i<4;i++) ctx.lineTo(innerCorners[i][0],innerCorners[i][1]);
      ctx.closePath();
      ctx.strokeStyle='#00ff88'; ctx.lineWidth=2; ctx.setLineDash([10,5]); ctx.stroke();
      ctx.setLineDash([]);

      // Border labels positioned along rotated edges
      const fs=Math.max(13,~~(cW*0.024));
      ctx.font=`bold ${fs}px ${mono}`; ctx.textAlign='center';
      const lc=s=>s?.confidence==='good'?'#00ff88':s?.confidence==='low'?'#ccbb00':'#ff4444';
      const drawLabel=(txt,x,y,conf)=>{
        ctx.fillStyle='rgba(0,0,0,.75)'; ctx.fillRect(x-36,y-14,72,20);
        ctx.fillStyle=lc(conf); ctx.fillText(txt,x,y);
      };
      const mid=(p0,p1)=>[(p0[0]+p1[0])/2,(p0[1]+p1[1])/2];
      const tMid=mid(outerCorners[0],outerCorners[1]);
      const bMid=mid(outerCorners[3],outerCorners[2]);
      const lMid=mid(outerCorners[0],outerCorners[3]);
      const rMid=mid(outerCorners[1],outerCorners[2]);
      drawLabel(`T ${bT}px`,tMid[0],tMid[1]-12,cen.scanT);
      drawLabel(`B ${bB}px`,bMid[0],bMid[1]+20,cen.scanB);
      drawLabel(`L ${bL}px`,lMid[0]-42,lMid[1],cen.scanL);
      drawLabel(`R ${bR}px`,rMid[0]+42,rMid[1],cen.scanR);

      // Centering ratio badge above card
      const lrT=bL+bR,tbT=bT+bB;
      const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
      const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
      const lrOk=Math.max(lrRatio,100-lrRatio)<=55;
      const tbOk=Math.max(tbRatio,100-tbRatio)<=65;
      ctx.font=`bold ${Math.max(14,~~(cW*0.030))}px ${mono}`;
      ctx.fillStyle=(lrOk&&tbOk)?'#00ff88':'#ff6633';
      ctx.fillText(
        `${lrRatio}/${Math.round((100-lrRatio)*10)/10}  ${tbRatio}/${Math.round((100-tbRatio)*10)/10}`,
        cardCX, ct-16
      );
      if(Math.abs(angle)>=0.1){
        ctx.font=`${Math.max(11,~~(cW*0.02))}px ${mono}`;
        ctx.fillStyle='#ff9944';
        ctx.fillText(`${angle>0?'+':''}${angle}°`, cardCX, ct-2);
      }
    };
    if(img.complete&&img.naturalWidth)draw(); else img.onload=draw;
  },[result,borderOverrides,outerOffsets,debug]);

  if(!result)return null;
  return(
    <div style={{position:'relative',width:'100%'}}>
      <img ref={imgRef} src={result.imgUrl} style={{width:'100%',display:'block',borderRadius:6}}/>
      <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}/>
    </div>
  );
}

// ─── Card Panel ───────────────────────────────────────────────────────────────
function CardPanel({label,side,onResult}){
  const[imgSrc,setImgSrc]=useState(null);
  const[result,setResult]=useState(null);
  const[loading,setLoading]=useState(false);
  const[debug,setDebug]=useState(false);
  const[angleOverride,setAngleOverride]=useState(null);
  const[borderOverrides,setBorderOverrides]=useState({L:0,R:0,T:0,B:0});
  const[outerOffsets,setOuterOffsets]=useState({L:0,R:0,T:0,B:0});
  const[recomputedCentering,setRecomputedCentering]=useState(null);
  const[liveRatios,setLiveRatios]=useState(null);
  const fileRef=useRef(null);
  const recomputeRef=useRef(null);

  const handleFile=e=>{
    const f=e.target.files?.[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      const src=ev.target.result;
      setImgSrc(src);setResult(null);setLoading(true);
      setAngleOverride(null);setBorderOverrides({L:0,R:0,T:0,B:0});
      setOuterOffsets({L:0,R:0,T:0,B:0});
      setRecomputedCentering(null);setLiveRatios(null);
      const res=await analyzeCard(src);
      setResult(res);setLoading(false);
      if(onResult)onResult(res);
    };
    reader.readAsDataURL(f);
  };

  // Recompute centering when angle changes
  const recomputeAngle=useCallback(async(newAngle)=>{
    if(!result)return;
    clearTimeout(recomputeRef.current);
    recomputeRef.current=setTimeout(async()=>{
      const{srcCanvas,w,h,bounds}=result;
      const d=srcCanvas.getContext('2d').getImageData(0,0,w,h).data;
      const centering=detectCentering(d,w,h,bounds,newAngle);
      const cardCanvas=extractCardCanvas(srcCanvas,bounds,newAngle);
      const cardUrl=cardCanvas.toDataURL('image/jpeg',0.92);
      setRecomputedCentering(centering);
      setResult(prev=>({...prev,cardUrl,centering,angle:newAngle}));
      setBorderOverrides({L:0,R:0,T:0,B:0});
    },80);
  },[result]);

  const handleAngleSlider=v=>{
    const a=parseFloat(v);
    setAngleOverride(a);
    recomputeAngle(a);
  };

  const nudgeBorder=(edge,delta)=>{
    setBorderOverrides(prev=>({...prev,[edge]:Math.max(-20,(prev[edge]||0)+delta)}));
  };

  const nudgeOuter=(edge,delta)=>{
    setOuterOffsets(prev=>({...prev,[edge]:(prev[edge]||0)+delta}));
  };

  // Apply outer offsets to bounds for centering display
  const adjBounds = result ? {
    ...result.bounds,
    left:  result.bounds.left  + (outerOffsets.L||0),
    right: result.bounds.right - (outerOffsets.R||0),
    top:   result.bounds.top   + (outerOffsets.T||0),
    bottom:result.bounds.bottom- (outerOffsets.B||0),
    cardW: result.bounds.cardW - (outerOffsets.L||0) - (outerOffsets.R||0),
    cardH: result.bounds.cardH - (outerOffsets.T||0) - (outerOffsets.B||0),
  } : null;

  const resetAll=()=>{
    if(result){setAngleOverride(result.angleResult?.angle||0);setBorderOverrides({L:0,R:0,T:0,B:0});setOuterOffsets({L:0,R:0,T:0,B:0});}
  };

  const activeAngle=angleOverride??result?.angle??0;
  const c=result?.centering;
  const bL=(borderOverrides.L)+(c?.bL??0);
  const bR=(borderOverrides.R)+(c?.bR??0);
  const bT=(borderOverrides.T)+(c?.bT??0);
  const bB=(borderOverrides.B)+(c?.bB??0);
  const lrT=bL+bR,tbT=bT+bB;
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
        <div style={{display:'flex',gap:6}}>
          {result&&<button onClick={()=>setDebug(d=>!d)} style={{padding:'3px 9px',borderRadius:4,background:debug?'rgba(0,200,255,.1)':'transparent',border:`1px solid ${debug?'#0088ff55':'#333'}`,color:debug?'#44aaff':'#555',fontFamily:mono,fontSize:8,cursor:'pointer'}}>DBG</button>}
          <button onClick={()=>fileRef.current?.click()} style={{padding:'3px 10px',borderRadius:4,background:'rgba(255,153,68,.15)',border:'1px solid #ff994444',color:'#ff9944',fontFamily:mono,fontSize:8,cursor:'pointer'}}>{imgSrc?'CHANGE':'UPLOAD'}</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/>
      </div>

      {/* Card display area */}
      <div style={{background:'#0a0a0a',borderRadius:10,overflow:'hidden',border:'1px solid #1a1c22'}}>
        {imgSrc?(
          loading
            ?<div style={{aspectRatio:'2.5/3.5',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6}}>
               <div style={{fontFamily:mono,fontSize:11,color:'#00ff88'}}>Analyzing…</div>
               <div style={{fontFamily:mono,fontSize:9,color:'#555'}}>Tracing edges · Measuring borders</div>
             </div>
            :<div style={{padding:8}}>
               {/* Rotation slider */}
               {result&&<div style={{marginBottom:8}}>
                 <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                   <span style={{fontFamily:mono,fontSize:8,color:'#555',textTransform:'uppercase'}}>Rotation Adjustment</span>
                   <div style={{display:'flex',alignItems:'center',gap:6}}>
                     <span style={{fontFamily:mono,fontSize:10,color:Math.abs(activeAngle)>0.3?'#ff9944':'#00ff88'}}>{activeAngle>0?'+':''}{activeAngle}°</span>
                     <button onClick={resetAll} style={{padding:'2px 7px',borderRadius:3,background:'transparent',border:'1px solid #333',color:'#555',fontFamily:mono,fontSize:8,cursor:'pointer'}}>↺ Reset</button>
                   </div>
                 </div>
                 <input type="range" min="-15" max="15" step="0.1"
                   value={activeAngle}
                   onChange={e=>handleAngleSlider(e.target.value)}
                   style={{width:'100%',accentColor:'#ff9944'}}/>
               </div>}

               {/* Full photo with rotated overlay — no crop until detection is solid */}
               {result&&<div style={{position:'relative'}}>
                 <CardDisplay result={result} borderOverrides={borderOverrides} outerOffsets={outerOffsets} debug={debug}/>
                 {/* Inner border nudge arrows (green) */}
                 <div style={{position:'absolute',top:'30%',left:4,display:'flex',flexDirection:'column',gap:2,zIndex:10}}>
                   <button onClick={()=>nudgeBorder('L',-1)} style={arrowBtn}>◀</button>
                   <button onClick={()=>nudgeBorder('L',1)}  style={arrowBtn}>▶</button>
                 </div>
                 <div style={{position:'absolute',top:'30%',right:4,display:'flex',flexDirection:'column',gap:2,zIndex:10}}>
                   <button onClick={()=>nudgeBorder('R',1)}  style={arrowBtn}>◀</button>
                   <button onClick={()=>nudgeBorder('R',-1)} style={arrowBtn}>▶</button>
                 </div>
                 <div style={{position:'absolute',bottom:28,left:'50%',transform:'translateX(-50%)',display:'flex',gap:2,zIndex:10}}>
                   <button onClick={()=>nudgeBorder('T',-1)} style={arrowBtn}>▲T</button>
                   <button onClick={()=>nudgeBorder('T',1)}  style={arrowBtn}>▼T</button>
                   <button onClick={()=>nudgeBorder('B',1)}  style={arrowBtn}>▲B</button>
                   <button onClick={()=>nudgeBorder('B',-1)} style={arrowBtn}>▼B</button>
                 </div>
                 {/* Outer boundary nudge arrows (orange) */}
                 <div style={{position:'absolute',bottom:4,left:'50%',transform:'translateX(-50%)',display:'flex',gap:2,zIndex:10}}>
                   <button onClick={()=>nudgeOuter('L',1)}  style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>◀L</button>
                   <button onClick={()=>nudgeOuter('L',-1)} style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>▶L</button>
                   <button onClick={()=>nudgeOuter('R',1)}  style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>▶R</button>
                   <button onClick={()=>nudgeOuter('R',-1)} style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>◀R</button>
                   <button onClick={()=>nudgeOuter('T',1)}  style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>▼T</button>
                   <button onClick={()=>nudgeOuter('T',-1)} style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>▲T</button>
                   <button onClick={()=>nudgeOuter('B',1)}  style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>▲B</button>
                   <button onClick={()=>nudgeOuter('B',-1)} style={{...arrowBtn,background:'rgba(255,120,0,.7)',fontSize:8}}>▼B</button>
                 </div>
               </div>}
             </div>
        ):(
          <div onClick={()=>fileRef.current?.click()} style={{aspectRatio:'2.5/3.5',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:10}}>
            <div style={{fontSize:36}}>📷</div>
            <div style={{fontFamily:mono,fontSize:10,color:'#444'}}>TAP TO UPLOAD</div>
          </div>
        )}
      </div>

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
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
          {[['L',bL,c.scanL],['R',bR,c.scanR],['T',bT,c.scanT],['B',bB,c.scanB]].map(([lbl,px,scan])=>(
            <div key={lbl} style={{padding:'5px 3px',background:'rgba(0,0,0,.3)',borderRadius:5,textAlign:'center'}}>
              <div style={{fontFamily:mono,fontSize:8,color:'#555'}}>{lbl}</div>
              <div style={{fontFamily:mono,fontSize:13,fontWeight:600,color:scan?.confidence==='good'?'#aaa':scan?.confidence==='low'?'#ccbb00':'#ff4444'}}>{px}px</div>
            </div>
          ))}
        </div>
        {(borderOverrides.L||borderOverrides.R||borderOverrides.T||borderOverrides.B)&&
          <div style={{marginTop:8,fontFamily:mono,fontSize:8,color:'#ff9944',textAlign:'center'}}>
            Manual adj: L{borderOverrides.L>0?'+':''}{borderOverrides.L} R{borderOverrides.R>0?'+':''}{borderOverrides.R} T{borderOverrides.T>0?'+':''}{borderOverrides.T} B{borderOverrides.B>0?'+':''}{borderOverrides.B}
          </div>
        }
      </div>}

      {/* Debug dump */}
      {debug&&result&&<div style={{background:'#0a0c10',borderRadius:8,border:'1px solid #0088ff33',padding:10}}>
        <div style={{fontFamily:mono,fontSize:8,color:'#0088ff',marginBottom:6,textTransform:'uppercase'}}>Debug — tap to copy</div>
        <textarea readOnly value={JSON.stringify({
          bounds:{left:result.bounds.left,right:result.bounds.right,top:result.bounds.top,bottom:result.bounds.bottom,cardW:result.bounds.cardW,cardH:result.bounds.cardH,method:result.bounds.method},
          detectedAngle:result.angleResult?.angle,
          appliedAngle:activeAngle,
          angleSources:result.angleResult?.allAngles?.map(a=>Math.round(a*100)/100),
          centering:{lrRatio,tbRatio,bL,bR,bT,bB},
          scanDetails:{
            L:{w:c.scanL?.width,iqr:c.scanL?.iqr,conf:c.scanL?.confidence,color:c.scanL?.borderColor,tol:c.scanL?.tol},
            R:{w:c.scanR?.width,iqr:c.scanR?.iqr,conf:c.scanR?.confidence,color:c.scanR?.borderColor,tol:c.scanR?.tol},
            T:{w:c.scanT?.width,iqr:c.scanT?.iqr,conf:c.scanT?.confidence,color:c.scanT?.borderColor,tol:c.scanT?.tol},
            B:{w:c.scanB?.width,iqr:c.scanB?.iqr,conf:c.scanB?.confidence,color:c.scanB?.borderColor,tol:c.scanB?.tol},
          },
          borderOverrides
        },null,2)}
        style={{width:'100%',height:160,background:'#060810',color:'#66aaff',border:'none',borderRadius:4,fontFamily:mono,fontSize:8,resize:'none',padding:6,boxSizing:'border-box'}}
        onClick={e=>e.target.select()}/>
      </div>}
    </div>
  );
}

const arrowBtn={
  padding:'4px 6px',borderRadius:4,
  background:'rgba(0,0,0,.7)',border:'1px solid #ffffff33',
  color:'#fff',fontSize:10,cursor:'pointer',lineHeight:1,
  backdropFilter:'blur(4px)',
};

// ─── Root ──────────────────────────────────────────────────────────────────────
export default function App(){
  const[fR,setFR]=useState(null),[bR,setBR]=useState(null);
  return(
    <div style={{minHeight:'100vh',background:'#090b0e',color:'#ccc',fontFamily:sans}}>
      <div style={{padding:'14px 16px',borderBottom:'1px solid #1a1c22',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:36,height:36,borderRadius:9,background:'linear-gradient(135deg,#00ff88,#0088ff)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:800,color:'#000'}}>CT</div>
        <div>
          <div style={{fontSize:15,fontWeight:600}}>Centering Tool</div>
          <div style={{fontFamily:mono,fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'.1em'}}>Auto-rotate · Edge trace · Manual fine-tune</div>
        </div>
      </div>
      <div style={{padding:14,display:'flex',gap:12}}>
        <CardPanel label="Front" side="front" onResult={setFR}/>
        <CardPanel label="Back"  side="back"  onResult={setBR}/>
      </div>
      {fR?.centering&&bR?.centering&&(
        <div style={{margin:'0 14px 16px',padding:12,background:'#0d0f13',borderRadius:10,border:'1px solid #1a1c22'}}>
          <div style={{fontFamily:mono,fontSize:9,color:'#555',textTransform:'uppercase',marginBottom:10}}>Combined Result</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[['Front',fR.centering,55,55],['Back',bR.centering,55,65]].map(([lbl,c,lrT,tbT])=>{
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
