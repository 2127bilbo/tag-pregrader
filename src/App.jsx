import { useState, useRef, useEffect } from "react";

/* ═══════════════════════════════════════════
   TAG CENTERING TOOL — Dev Build
   
   Algorithm (learned from reverse-engineering
   centeringcheck.com pixel sampling pattern):
   
   1. findBounds  — background-color card finder
   2. detectAngle — fit lines to card edges
   3. traceEdge   — walk actual card edge at angle
                    pixel by pixel, like CenteringCheck
   4. traceBorder — walk inner border edge the
                    same way, offset perpendicular
   5. borderWidth — perpendicular distance between
                    outer and inner edge traces
   6. centering   — compare opposite border widths
   
   Key insight: never rotate the canvas.
   Sample along the actual rotated edge direction.
   ═══════════════════════════════════════════ */

const mono = "'JetBrains Mono','SF Mono',monospace";
const sans = "'Inter',-apple-system,sans-serif";

// ─── Pixel utilities ─────────────────────────────────────────────────────────
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

// Bilinear interpolated luminance at sub-pixel position
function lumAt(d, w, h, x, y) {
  const x0=CLAMP(Math.floor(x),0,w-1), x1=CLAMP(x0+1,0,w-1);
  const y0=CLAMP(Math.floor(y),0,h-1), y1=CLAMP(y0+1,0,h-1);
  const fx=x-x0, fy=y-y0;
  const l00=LUM(...PX(d,w,x0,y0)), l10=LUM(...PX(d,w,x1,y0));
  const l01=LUM(...PX(d,w,x0,y1)), l11=LUM(...PX(d,w,x1,y1));
  return l00*(1-fx)*(1-fy)+l10*fx*(1-fy)+l01*(1-fx)*fy+l11*fx*fy;
}

// ─── STEP 1: Card boundary (background-color method) ─────────────────────────
// Handles two scenarios:
//   A) Card on table with clear background — corners are background
//   B) Close-up shot where card fills most of frame — corners may be card
// Detects (B) by checking if corners and center look the same (low contrast)
function findBounds(d, w, h) {
  const PATCH=12;

  // Sample background from 4 corners
  let bgR=0,bgG=0,bgB=0,bgN=0;
  for(const [cx,cy] of [[0,0],[w-PATCH,0],[0,h-PATCH],[w-PATCH,h-PATCH]]){
    for(let dy=0;dy<PATCH;dy++) for(let dx=0;dx<PATCH;dx++){
      const[r,g,b]=PX(d,w,CLAMP(cx+dx,0,w-1),CLAMP(cy+dy,0,h-1));
      bgR+=r;bgG+=g;bgB+=b;bgN++;
    }
  }
  bgR/=bgN;bgG/=bgN;bgB/=bgN;

  // Sample card from image center
  let cR=0,cG=0,cB=0,cN=0;
  const CX=Math.round(w/2),CY=Math.round(h/2);
  for(let dy=-PATCH;dy<=PATCH;dy++) for(let dx=-PATCH;dx<=PATCH;dx++){
    const[r,g,b]=PX(d,w,CLAMP(CX+dx,0,w-1),CLAMP(CY+dy,0,h-1));
    cR+=r;cG+=g;cB+=b;cN++;
  }
  cR/=cN;cG/=cN;cB/=cN;

  const bgDist=(r,g,b)=>Math.sqrt((r-bgR)**2+(g-bgG)**2+(b-bgB)**2);
  const centerDist=bgDist(cR,cG,cB);

  // If corners and center look similar, card fills the frame — no background to use
  if(centerDist < 20) return varianceFallback(d,w,h,'close-up');

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
  // Reject if result is basically the whole image (detection failed)
  const tooLarge=(right-left)>w*0.92||(bottom-top)>h*0.92;
  if(!tooLarge&&cardW>w*0.15&&cardH>h*0.15&&ratio>0.55&&ratio<0.85)
    return{left,right,top,bottom,cardW,cardH,method:'bg-color',centerDist:Math.round(centerDist)};
  return varianceFallback(d,w,h,'bg-fallback');
}

function varianceFallback(d,w,h,method='variance'){
  const GX=32,GY=32;
  const cellW=Math.floor(w/GX),cellH=Math.floor(h/GY);
  if(cellW<2||cellH<2)return{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1};
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
  if(count<6)return{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1};
  return{left:minGX*cellW,right:Math.min(w-1,(maxGX+1)*cellW),
         top:minGY*cellH,bottom:Math.min(h-1,(maxGY+1)*cellH),
         cardW:(maxGX-minGX+1)*cellW,cardH:(maxGY-minGY+1)*cellH,method};
}

// ─── STEP 2: Detect card rotation angle ──────────────────────────────────────
// Probe each of 4 card edges at N positions. At each probe, scan
// perpendicular to find exact gradient peak. Fit line → get slope → angle.
function detectCardAngle(d, w, h, bn) {
  const{left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const PROBES=24, SEARCH=Math.round(Math.min(cW,cH)*0.07);

  const findEdgeY=(x,nearY)=>{
    let best=nearY,bestG=0;
    for(let y=CLAMP(nearY-SEARCH,0,h-2);y<=CLAMP(nearY+SEARCH,0,h-2);y++){
      const g=Math.abs(LUM(...PX(d,w,x,CLAMP(y-2,0,h-1)))-LUM(...PX(d,w,x,CLAMP(y+2,0,h-1))));
      if(g>bestG){bestG=g;best=y;}
    }
    return bestG>6?best:null;
  };
  const findEdgeX=(y,nearX)=>{
    let best=nearX,bestG=0;
    for(let x=CLAMP(nearX-SEARCH,0,w-2);x<=CLAMP(nearX+SEARCH,0,w-2);x++){
      const g=Math.abs(LUM(...PX(d,w,CLAMP(x-2,0,w-1),y))-LUM(...PX(d,w,CLAMP(x+2,0,w-1),y)));
      if(g>bestG){bestG=g;best=x;}
    }
    return bestG>6?best:null;
  };
  const fitSlope=pts=>{
    if(pts.length<5)return null;
    const n=pts.length;
    const sx=pts.reduce((s,p)=>s+p.x,0),sy=pts.reduce((s,p)=>s+p.y,0);
    const sxy=pts.reduce((s,p)=>s+p.x*p.y,0),sxx=pts.reduce((s,p)=>s+p.x*p.x,0);
    const den=n*sxx-sx*sx;
    return Math.abs(den)<1?null:(n*sxy-sx*sy)/den;
  };

  const angles=[];
  // Top edge
  {const pts=[];for(let i=0;i<PROBES;i++){const x=Math.round(cl+cW*(0.05+0.90*i/(PROBES-1)));const y=findEdgeY(x,ct);if(y!==null)pts.push({x,y});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  // Bottom edge
  {const pts=[];for(let i=0;i<PROBES;i++){const x=Math.round(cl+cW*(0.05+0.90*i/(PROBES-1)));const y=findEdgeY(x,cb);if(y!==null)pts.push({x,y});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  // Left edge
  {const pts=[];for(let i=0;i<PROBES;i++){const y=Math.round(ct+cH*(0.05+0.90*i/(PROBES-1)));const x=findEdgeX(y,cl);if(x!==null)pts.push({x:y,y:x});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}
  // Right edge
  {const pts=[];for(let i=0;i<PROBES;i++){const y=Math.round(ct+cH*(0.05+0.90*i/(PROBES-1)));const x=findEdgeX(y,cr);if(x!==null)pts.push({x:y,y:x});}const s=fitSlope(pts);if(s!==null)angles.push(Math.atan(s)*180/Math.PI);}

  if(angles.length===0)return{angle:0,confidence:'failed'};
  angles.sort((a,b)=>a-b);
  const median=angles[Math.floor(angles.length/2)];
  return{angle:Math.round(median*100)/100,confidence:angles.length>=3?'good':'low',allAngles:angles};
}

// ─── STEPS 3-5: Edge tracing + border measurement ─────────────────────────────
//
// KEY INSIGHT from CenteringCheck reverse engineering:
// They never rotate the canvas. Instead they sample pixel by pixel
// along the actual rotated edge direction. For a card rotated θ degrees,
// the top edge direction vector is (cos θ, sin θ) and the perpendicular
// inward direction is (-sin θ, cos θ).
//
// For each of 4 sides:
//   a) Trace the OUTER card edge at N evenly-spaced positions
//   b) From each outer edge point, scan PERPENDICULAR to the edge inward
//      looking for the gradient peak = inner border edge
//   c) That perpendicular distance = border width at that position
//   d) Median across all positions = robust border width for that side
//
// This works correctly regardless of card rotation angle.

function measureBorderWidth(d, w, h, bn, side, angleDeg) {
  const{left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const rad = angleDeg * Math.PI / 180;
  const cosA=Math.cos(rad), sinA=Math.sin(rad);

  // Edge direction vectors (along edge) and perpendicular inward vectors
  // For top/bottom: along = (cosA, sinA), inward perp = (-sinA, cosA) for top, (sinA, -cosA) for bottom
  // For left/right: along = (-sinA, cosA), inward perp = (cosA, sinA) for left, (-cosA, -sinA) for right
  let alongX, alongY, perpInX, perpInY;
  let edgeStartX, edgeStartY, edgeLen;

  if(side==='T'){
    alongX=cosA; alongY=sinA;
    perpInX=-sinA; perpInY=cosA;  // perpendicular pointing into card (downward for small angles)
    edgeStartX=cl; edgeStartY=ct; edgeLen=cW;
  } else if(side==='B'){
    alongX=cosA; alongY=sinA;
    perpInX=sinA; perpInY=-cosA;  // perpendicular pointing into card (upward for small angles)
    edgeStartX=cl; edgeStartY=cb; edgeLen=cW;
  } else if(side==='L'){
    alongX=-sinA; alongY=cosA;
    perpInX=cosA; perpInY=sinA;   // perpendicular pointing into card (rightward for small angles)
    edgeStartX=cl; edgeStartY=ct; edgeLen=cH;
  } else { // R
    alongX=-sinA; alongY=cosA;
    perpInX=-cosA; perpInY=-sinA; // perpendicular pointing into card (leftward for small angles)
    edgeStartX=cr; edgeStartY=ct; edgeLen=cH;
  }

  const SAMPLES = 32;   // positions along the edge to measure
  const MAX_BORDER = Math.round(Math.min(cW,cH)*0.20); // max border search depth
  const measurements = [];

  for(let si=0; si<SAMPLES; si++){
    // Position along edge — skip 10% at each end to avoid corners
    const t = edgeLen * (0.10 + 0.80*si/(SAMPLES-1));
    const ex = edgeStartX + alongX*t;
    const ey = edgeStartY + alongY*t;

    // Find exact outer edge by scanning perpendicular from estimated edge
    // outward first (3px) then inward to find the sharpest gradient
    let outerX=ex, outerY=ey;
    let bestGrad=0;
    for(let dep=-3; dep<=6; dep++){
      const px=ex+perpInX*dep, py=ey+perpInY*dep;
      if(px<0||px>=w||py<0||py>=h) continue;
      const g = Math.abs(
        lumAt(d,w,h,px-perpInX,py-perpInY) -
        lumAt(d,w,h,px+perpInX,py+perpInY)
      );
      if(g>bestGrad){bestGrad=g;outerX=px;outerY=py;}
    }

    // Now scan perpendicular INWARD from outer edge, looking for
    // the next significant gradient peak = inner border/artwork edge
    let peakGrad=0, peakDep=MAX_BORDER;
    let prevLum = lumAt(d,w,h,outerX,outerY);

    for(let dep=2; dep<=MAX_BORDER; dep++){
      const px=outerX+perpInX*dep, py=outerY+perpInY*dep;
      if(px<0||px>=w||py<0||py>=h) break;
      const curLum = lumAt(d,w,h,px,py);
      const g = Math.abs(curLum - lumAt(d,w,h,
        CLAMP(px-perpInX*2,0,w-1),
        CLAMP(py-perpInY*2,0,h-1)
      ));
      if(g > peakGrad && g > 8){
        peakGrad=g; peakDep=dep;
      }
      prevLum=curLum;
    }

    if(peakDep < MAX_BORDER-1) measurements.push(peakDep);
  }

  if(measurements.length < 4) return{width:0,confidence:'failed',peakGrad:0};
  measurements.sort((a,b)=>a-b);

  // Use median to reject outlier measurements from card design elements
  const med = measurements[Math.floor(measurements.length/2)];

  // Interquartile consistency check — tightly clustered = confident
  const q1 = measurements[Math.floor(measurements.length*0.25)];
  const q3 = measurements[Math.floor(measurements.length*0.75)];
  const iqr = q3-q1;
  const confidence = iqr<=4?'good':iqr<=10?'low':'failed';

  return{
    width: med,
    confidence,
    iqr,
    rawValues: measurements,
    sampleCount: measurements.length,
  };
}

// ─── STEP 6: Full centering calculation ──────────────────────────────────────
function detectCentering(d, w, h, bn, angleDeg) {
  const sT = measureBorderWidth(d,w,h,bn,'T',angleDeg);
  const sB = measureBorderWidth(d,w,h,bn,'B',angleDeg);
  const sL = measureBorderWidth(d,w,h,bn,'L',angleDeg);
  const sR = measureBorderWidth(d,w,h,bn,'R',angleDeg);

  const bL=sL.width,bR=sR.width,bT=sT.width,bB=sB.width;
  const lrT=bL+bR, tbT=bT+bB;
  const lrRatio = lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio = tbT>0?Math.round((bT/tbT)*1000)/10:50;

  const confs=[sL.confidence,sR.confidence,sT.confidence,sB.confidence];
  const conf = confs.every(c=>c==='good')?'good'
    : confs.filter(c=>c==='failed').length>=2?'failed':'low';

  return{bL,bR,bT,bB,lrRatio,tbRatio,scanL:sL,scanR:sR,scanT:sT,scanB:sB,confidence:conf};
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────
async function analyzeCard(src) {
  const{canvas,w,h,data}=await loadImg(src,1400);
  const d=data.data;
  const imgUrl=canvas.toDataURL('image/jpeg',0.92);

  // Step 1: Find card boundary
  const bounds=findBounds(d,w,h);

  // Step 2: Detect rotation angle
  const angleResult=detectCardAngle(d,w,h,bounds);
  const angle=angleResult.angle;

  // Steps 3-6: Measure borders along actual rotated edges, compute centering
  const centering=detectCentering(d,w,h,bounds,angle);

  return{imgUrl,w,h,bounds,centering,angle,angleResult};
}

// ─── Overlay drawing ──────────────────────────────────────────────────────────
function drawOverlay(canvas, result, debug) {
  if(!canvas||!result)return;
  const{w,h,bounds:bn,centering:c,angle}=result;
  const ctx=canvas.getContext('2d');
  canvas.width=w; canvas.height=h; ctx.clearRect(0,0,w,h);
  const{left:cl,right:cr,top:ct,cardW:cW,cardH:cH}=bn; const cb=ct+cH;
  const rad=angle*Math.PI/180;
  const cosA=Math.cos(rad),sinA=Math.sin(rad);
  const fs=Math.max(13,~~(cW*0.026));
  const lc=s=>s.confidence==='good'?'#00ff88':s.confidence==='low'?'#ccbb00':'#ff4444';

  // Draw card outer boundary (rotated rectangle)
  const corners=[
    [cl,ct],[cr,ct],[cr,cb],[cl,cb]
  ].map(([x,y])=>{
    // Rotate each corner around card center
    const cx=cl+cW/2, cy=ct+cH/2;
    const dx=x-cx, dy=y-cy;
    return[cx+dx*cosA-dy*sinA, cy+dx*sinA+dy*cosA];
  });
  ctx.beginPath();
  ctx.moveTo(corners[0][0],corners[0][1]);
  for(let i=1;i<4;i++) ctx.lineTo(corners[i][0],corners[i][1]);
  ctx.closePath();
  ctx.strokeStyle='#ff9944'; ctx.lineWidth=3; ctx.setLineDash([]); ctx.stroke();

  // Draw inner border rectangle (inset by border widths, also rotated)
  const il=cl+c.bL, ir=cr-c.bR, it=ct+c.bT, ib=cb-c.bB;
  const innerCorners=[
    [il,it],[ir,it],[ir,ib],[il,ib]
  ].map(([x,y])=>{
    const cx=cl+cW/2, cy=ct+cH/2;
    const dx=x-cx, dy=y-cy;
    return[cx+dx*cosA-dy*sinA, cy+dx*sinA+dy*cosA];
  });
  ctx.beginPath();
  ctx.moveTo(innerCorners[0][0],innerCorners[0][1]);
  for(let i=1;i<4;i++) ctx.lineTo(innerCorners[i][0],innerCorners[i][1]);
  ctx.closePath();
  ctx.strokeStyle='#00ff88'; ctx.lineWidth=2; ctx.setLineDash([10,5]); ctx.stroke();
  ctx.setLineDash([]);

  // Border width labels — positioned along rotated edges
  const edgeMid=(p0,p1)=>[(p0[0]+p1[0])/2,(p0[1]+p1[1])/2];
  ctx.font=`bold ${fs}px ${mono}`; ctx.textAlign='center';
  const drawLabel=(text,x,y,conf)=>{
    ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(x-32,y-14,64,20);
    ctx.fillStyle=lc(conf); ctx.fillText(text,x,y);
  };
  const [tMid,bMid,lMid,rMid]=[
    edgeMid(corners[0],corners[1]),
    edgeMid(corners[3],corners[2]),
    edgeMid(corners[0],corners[3]),
    edgeMid(corners[1],corners[2]),
  ];
  drawLabel(`T ${c.bT}px`, tMid[0], tMid[1]-16, c.scanT);
  drawLabel(`B ${c.bB}px`, bMid[0], bMid[1]+20, c.scanB);
  drawLabel(`L ${c.bL}px`, lMid[0]-40, lMid[1], c.scanL);
  drawLabel(`R ${c.bR}px`, rMid[0]+40, rMid[1], c.scanR);

  // Centering ratio badge
  const lrOk=Math.max(c.lrRatio,100-c.lrRatio)<=55;
  const tbOk=Math.max(c.tbRatio,100-c.tbRatio)<=65;
  ctx.font=`bold ${Math.max(15,~~(cW*0.032))}px ${mono}`;
  ctx.fillStyle=(lrOk&&tbOk)?'#00ff88':'#ff6633';
  ctx.fillText(
    `${c.lrRatio}/${Math.round((100-c.lrRatio)*10)/10}  ${c.tbRatio}/${Math.round((100-c.tbRatio)*10)/10}`,
    cl+cW/2, ct-18
  );
  if(Math.abs(angle)>=0.1){
    ctx.font=`${Math.max(11,~~(cW*0.02))}px ${mono}`;
    ctx.fillStyle='#ff9944';
    ctx.fillText(`${angle>0?'+':''}${angle}°`,cl+cW/2,ct-4);
  }

  // Debug: show sample positions along each edge
  if(debug){
    const SAMPLES=32;
    [['T',cl,ct,cW,cosA,sinA,-sinA,cosA],
     ['B',cl,cb,cW,cosA,sinA,sinA,-cosA],
     ['L',cl,ct,cH,-sinA,cosA,cosA,sinA],
     ['R',cr,ct,cH,-sinA,cosA,-cosA,-sinA]
    ].forEach(([side,sx,sy,len,aX,aY,pX,pY])=>{
      for(let si=0;si<SAMPLES;si++){
        const t=len*(0.10+0.80*si/(SAMPLES-1));
        const ex=sx+aX*t, ey=sy+aY*t;
        ctx.fillStyle='rgba(0,200,255,.6)';
        ctx.beginPath(); ctx.arc(ex,ey,2,0,Math.PI*2); ctx.fill();
      }
    });
    // IQR labels
    ctx.font=`10px ${mono}`; ctx.textAlign='left';
    [['T',c.scanT,cl+4,ct+20],['B',c.scanB,cl+4,ct+36],
     ['L',c.scanL,cl+4,ct+52],['R',c.scanR,cl+4,ct+68]].forEach(([lbl,scan,x,y])=>{
      ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(x,y-12,100,16);
      ctx.fillStyle=lc(scan);
      ctx.fillText(`${lbl}: ${scan.width}px IQR:${scan.iqr??'?'}`,x+3,y);
    });
  }
}

// ─── Card Panel ───────────────────────────────────────────────────────────────
function CardPanel({label,side,onResult}){
  const[imgSrc,setImgSrc]=useState(null);
  const[result,setResult]=useState(null);
  const[loading,setLoading]=useState(false);
  const[debug,setDebug]=useState(false);
  const fileRef=useRef(null),canvasRef=useRef(null),imgRef=useRef(null);

  const handleFile=e=>{
    const f=e.target.files?.[0]; if(!f)return;
    const reader=new FileReader();
    reader.onload=async ev=>{
      const src=ev.target.result;
      setImgSrc(src); setResult(null); setLoading(true);
      const res=await analyzeCard(src);
      setResult(res); setLoading(false);
      if(onResult)onResult(res);
    };
    reader.readAsDataURL(f);
  };

  useEffect(()=>{
    if(!result||!canvasRef.current||!imgRef.current)return;
    imgRef.current.src=result.imgUrl;
    const draw=()=>drawOverlay(canvasRef.current,result,debug);
    if(imgRef.current.complete)draw(); else imgRef.current.onload=draw;
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
          <img ref={imgRef} src={result?.imgUrl||imgSrc} style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/>
          <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',pointerEvents:'none'}}/>
          {loading&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.75)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6}}>
            <div style={{fontFamily:mono,fontSize:11,color:'#00ff88'}}>Analyzing…</div>
            <div style={{fontFamily:mono,fontSize:9,color:'#555'}}>Tracing card edges · Measuring borders</div>
          </div>}
        </>:<div onClick={()=>fileRef.current?.click()} style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:10}}>
          <div style={{fontSize:36}}>📷</div>
          <div style={{fontFamily:mono,fontSize:10,color:'#444'}}>TAP TO UPLOAD</div>
        </div>}
      </div>

      {result&&<div style={{padding:'6px 10px',borderRadius:6,
        background:Math.abs(result.angle)>=0.1?'rgba(255,153,68,.08)':'rgba(0,255,136,.05)',
        border:`1px solid ${Math.abs(result.angle)>=0.1?'#ff994433':'#00ff8822'}`,
        display:'flex',justifyContent:'space-between'}}>
        <span style={{fontFamily:mono,fontSize:9,color:'#555'}}>ROTATION</span>
        <span style={{fontFamily:mono,fontSize:11,fontWeight:600,
          color:Math.abs(result.angle)>=0.1?'#ff9944':'#00ff88'}}>
          {Math.abs(result.angle)<0.1?`${result.angle}° — straight`:`${result.angle>0?'+':''}${result.angle}° detected`}
        </span>
      </div>}

      {c&&<div style={{background:'#0d0f13',borderRadius:10,border:'1px solid #1a1c22',padding:12}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
          <span style={{fontFamily:mono,fontSize:9,color:'#555',textTransform:'uppercase'}}>Detection</span>
          <span style={{fontFamily:mono,fontSize:9,fontWeight:700,
            color:c.confidence==='good'?'#00ff88':c.confidence==='low'?'#ccbb00':'#ff4444'}}>
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
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
          {[['L',c.bL,c.scanL],['R',c.bR,c.scanR],['T',c.bT,c.scanT],['B',c.bB,c.scanB]].map(([lbl,px,scan])=>(
            <div key={lbl} style={{padding:'5px 3px',background:'rgba(0,0,0,.3)',borderRadius:5,textAlign:'center'}}>
              <div style={{fontFamily:mono,fontSize:8,color:'#555'}}>{lbl}</div>
              <div style={{fontFamily:mono,fontSize:13,fontWeight:600,
                color:scan.confidence==='good'?'#aaa':scan.confidence==='low'?'#ccbb00':'#ff4444'}}>{px}px</div>
            </div>
          ))}
        </div>
      </div>}

      {/* Debug text dump — copy/paste to share full data */}
      {debug&&result&&<div style={{background:'#0a0c10',borderRadius:8,border:'1px solid #0088ff33',padding:10}}>
        <div style={{fontFamily:mono,fontSize:8,color:'#0088ff',marginBottom:6,textTransform:'uppercase'}}>Debug Dump — copy & paste</div>
        <textarea readOnly value={JSON.stringify({
          bounds:{left:result.bounds.left,right:result.bounds.right,top:result.bounds.top,bottom:result.bounds.bottom,cardW:result.bounds.cardW,cardH:result.bounds.cardH,method:result.bounds.method},
          angle:result.angle,
          angleSources:result.angleResult?.allAngles?.map(a=>Math.round(a*100)/100),
          centering:{lrRatio:result.centering?.lrRatio,tbRatio:result.centering?.tbRatio,bL:result.centering?.bL,bR:result.centering?.bR,bT:result.centering?.bT,bB:result.centering?.bB},
          scanDetails:{
            L:{w:result.centering?.scanL?.width,iqr:result.centering?.scanL?.iqr,conf:result.centering?.scanL?.confidence},
            R:{w:result.centering?.scanR?.width,iqr:result.centering?.scanR?.iqr,conf:result.centering?.scanR?.confidence},
            T:{w:result.centering?.scanT?.width,iqr:result.centering?.scanT?.iqr,conf:result.centering?.scanT?.confidence},
            B:{w:result.centering?.scanB?.width,iqr:result.centering?.scanB?.iqr,conf:result.centering?.scanB?.confidence},
          }
        },null,2)}
        style={{width:'100%',height:180,background:'#060810',color:'#66aaff',border:'none',borderRadius:4,fontFamily:mono,fontSize:8,resize:'none',padding:6,boxSizing:'border-box'}}
        onClick={e=>e.target.select()}/>
      </div>}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App(){
  const[fR,setFR]=useState(null),[bR,setBR]=useState(null);
  const fc=fR?.centering,bc=bR?.centering;
  return(
    <div style={{minHeight:'100vh',background:'#090b0e',color:'#ccc',fontFamily:sans}}>
      <div style={{padding:'14px 16px',borderBottom:'1px solid #1a1c22',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:36,height:36,borderRadius:9,background:'linear-gradient(135deg,#00ff88,#0088ff)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:mono,fontSize:13,fontWeight:800,color:'#000'}}>CT</div>
        <div>
          <div style={{fontSize:15,fontWeight:600}}>Centering Tool</div>
          <div style={{fontFamily:mono,fontSize:9,color:'#444',textTransform:'uppercase',letterSpacing:'.1em'}}>Edge tracing · Perpendicular border scan</div>
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
