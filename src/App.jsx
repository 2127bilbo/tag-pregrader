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
  const GX = 32, GY = 32;
  const cellW = Math.floor(w / GX), cellH = Math.floor(h / GY);
  if (cellW < 2 || cellH < 2) return { left:0, right:w-1, top:0, bottom:h-1, cardW:w-1, cardH:h-1, method:'var' };

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
    return edgeScanFallback(d, w, h);
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
    return { left, right, top, bottom, cardW, cardH, method:'var' };
  }

  return edgeScanFallback(d, w, h);
}

function edgeScanFallback(d, w, h) {
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
    if(area>bestArea&&(r-l)>w*0.15&&(b-tp)>h*0.15){bestArea=area;best={left:l,right:r,top:tp,bottom:b,cardW:r-l,cardH:b-tp,method:'edge'};}
  }
  return best||{left:0,right:w-1,top:0,bottom:h-1,cardW:w-1,cardH:h-1,method:'edge'};
}

// ─── Angle detection ───
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


function fitLine(points, mode){
  if(points.length<6) return null;
  if(mode==='x'){ // x = m*y + b
    const n=points.length;
    let sy=0,sx=0,syy=0,syx=0;
    for(const p of points){sy+=p.y;sx+=p.x;syy+=p.y*p.y;syx+=p.y*p.x;}
    const den=n*syy-sy*sy;
    if(Math.abs(den)<1e-6) return null;
    const m=(n*syx-sy*sx)/den; const b=(sx-m*sy)/n;
    return {a:-m,b:1,c:-b}; // line ax+by+c=0
  }else{ // y = m*x + b
    const n=points.length;
    let sx=0,sy=0,sxx=0,sxy=0;
    for(const p of points){sx+=p.x;sy+=p.y;sxx+=p.x*p.x;sxy+=p.x*p.y;}
    const den=n*sxx-sx*sx;
    if(Math.abs(den)<1e-6) return null;
    const m=(n*sxy-sx*sy)/den; const b=(sy-m*sx)/n;
    return {a:-m,b:1,c:-b};
  }
}

function intersectLines(l1,l2){
  const det=l1.a*l2.b-l2.a*l1.b;
  if(Math.abs(det)<1e-6) return null;
  const x=(l2.b*(-l1.c)-l1.b*(-l2.c))/det;
  const y=(l1.a*(-l2.c)-l2.a*(-l1.c))/det;
  return {x,y};
}

function detectCardLines(d,w,h,bn){
  const {left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const PROBES=26;
  const SEARCH=Math.round(Math.min(cW,cH)*0.08);
  const findEdgeY=(x,nearY)=>{let best=nearY,bestG=0;for(let y=CLAMP(nearY-SEARCH,0,h-2);y<=CLAMP(nearY+SEARCH,0,h-2);y++){const g=Math.abs(LUM(...PX(d,w,x,CLAMP(y-2,0,h-1)))-LUM(...PX(d,w,x,CLAMP(y+2,0,h-1))));if(g>bestG){bestG=g;best=y;}}return bestG>6?best:null;};
  const findEdgeX=(y,nearX)=>{let best=nearX,bestG=0;for(let x=CLAMP(nearX-SEARCH,0,w-2);x<=CLAMP(nearX+SEARCH,0,w-2);x++){const g=Math.abs(LUM(...PX(d,w,CLAMP(x-2,0,w-1),y))-LUM(...PX(d,w,CLAMP(x+2,0,w-1),y)));if(g>bestG){bestG=g;best=x;}}return bestG>6?best:null;};

  const topPts=[], botPts=[], leftPts=[], rightPts=[];
  for(let i=0;i<PROBES;i++){
    const fx=0.05+0.90*i/(PROBES-1);
    const x=Math.round(cl+cW*fx);
    const yT=findEdgeY(x,ct); if(yT!==null) topPts.push({x,y:yT});
    const yB=findEdgeY(x,cb); if(yB!==null) botPts.push({x,y:yB});
  }
  for(let i=0;i<PROBES;i++){
    const fy=0.05+0.90*i/(PROBES-1);
    const y=Math.round(ct+cH*fy);
    const xL=findEdgeX(y,cl); if(xL!==null) leftPts.push({x:xL,y});
    const xR=findEdgeX(y,cr); if(xR!==null) rightPts.push({x:xR,y});
  }

  const top=fitLine(topPts,'y');
  const bottom=fitLine(botPts,'y');
  const left=fitLine(leftPts,'x');
  const right=fitLine(rightPts,'x');
  if(!(top&&bottom&&left&&right)) return null;
  return {top,bottom,left,right};
}

function computeCardCorners(lines){
  const tl=intersectLines(lines.top,lines.left);
  const tr=intersectLines(lines.top,lines.right);
  const br=intersectLines(lines.bottom,lines.right);
  const bl=intersectLines(lines.bottom,lines.left);
  if(!(tl&&tr&&br&&bl)) return null;
  return {tl,tr,br,bl};
}

function solve8(A,b){
  const n=8;
  for(let i=0;i<n;i++){
    // pivot
    let maxRow=i; let maxVal=Math.abs(A[i][i]);
    for(let r=i+1;r<n;r++){ if(Math.abs(A[r][i])>maxVal){maxVal=Math.abs(A[r][i]);maxRow=r;} }
    if(maxVal<1e-8) return null;
    if(maxRow!==i){A[i],A[maxRow]=A[maxRow],A[i]; b[i],b[maxRow]=b[maxRow],b[i];}
    const diag=A[i][i];
    for(let c=i;c<n;c++) A[i][c]/=diag; b[i]/=diag;
    for(let r=0;r<n;r++) if(r!=i){
      const f=A[r][i];
      for(let c=i;c<n;c++) A[r][c]-=f*A[i][c];
      b[r]-=f*b[i];
    }
  }
  return b;
}

function computeHomography(srcPts, dstPts){
  const A=[], B=[];
  for(let i=0;i<4;i++){
    const xs=srcPts[i].x, ys=srcPts[i].y;
    const xd=dstPts[i].x, yd=dstPts[i].y;
    A.push([xs,ys,1,0,0,0,-xd*xs,-xd*ys]); B.push(xd);
    A.push([0,0,0,xs,ys,1,-yd*xs,-yd*ys]); B.push(yd);
  }
  const h=solve8(A,B); if(!h) return null;
  return [h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
}

function warpPerspective(srcData,w,h,corners){
  const topW=Math.hypot(corners.tr.x-corners.tl.x, corners.tr.y-corners.tl.y);
  const botW=Math.hypot(corners.br.x-corners.bl.x, corners.br.y-corners.bl.y);
  const leftH=Math.hypot(corners.bl.x-corners.tl.x, corners.bl.y-corners.tl.y);
  const rightH=Math.hypot(corners.br.x-corners.tr.x, corners.br.y-corners.tr.y);
  let outW=Math.max(10, Math.round((topW+botW)/2));
  let outH=Math.max(10, Math.round((leftH+rightH)/2));
  const maxDim=1000;
  const scale=Math.min(1, maxDim/Math.max(outW,outH));
  outW=Math.round(outW*scale);
  outH=Math.round(outH*scale);
  const srcPts=[corners.tl,corners.tr,corners.br,corners.bl];
  const dstPts=[{x:0,y:0},{x:outW-1,y:0},{x:outW-1,y:outH-1},{x:0,y:outH-1}];
  const H=computeHomography(dstPts, srcPts); // map dst -> src
  if(!H) return null;
  const out=new Uint8ClampedArray(outW*outH*4);
  for(let y=0;y<outH;y++){
    for(let x=0;x<outW;x++){
      const denom=H[6]*x+H[7]*y+H[8];
      const sx=(H[0]*x+H[1]*y+H[2])/denom;
      const sy=(H[3]*x+H[4]*y+H[5])/denom;
      const i=(y*outW+x)*4;
      if(sx>=0&&sx<w-1&&sy>=0&&sy<h-1){
        const r=lumAt(srcData,w,h,sx,sy); // use lumAt for smoothness then map to rgb
        const x0=Math.floor(sx), y0=Math.floor(sy);
        const [pr,pg,pb]=PX(srcData,w,x0,y0);
        out[i]=pr; out[i+1]=pg; out[i+2]=pb; out[i+3]=255;
      }else{out[i]=out[i+1]=out[i+2]=0; out[i+3]=255;}
    }
  }
  return {data:out,w:outW,h:outH};
}

function detectCenteringRectified(d,w,h){
  const LINES=9;
  const maxDepth=Math.round(Math.min(w,h)*0.22);
  const scan=(side)=>{
    const medGrad=[];
    for(let dep=2;dep<maxDepth-1;dep++){
      const gs=[];
      for(let li=0;li<LINES;li++){
        const f=0.20+0.60*(li/(LINES-1));
        if(side==='L'||side==='R'){
          const y=Math.round(h*f);
          const x=(side==='L')?dep:(w-1-dep);
          const xm=CLAMP(x-1,0,w-1), xp=CLAMP(x+1,0,w-1);
          const yy=CLAMP(y,0,h-1);
          gs.push(Math.abs(LUM(...PX(d,w,xp,yy))-LUM(...PX(d,w,xm,yy))));
        }else{
          const x=Math.round(w*f);
          const y=(side==='T')?dep:(h-1-dep);
          const ym=CLAMP(y-1,0,h-1), yp=CLAMP(y+1,0,h-1);
          const xx=CLAMP(x,0,w-1);
          gs.push(Math.abs(LUM(...PX(d,w,xx,yp))-LUM(...PX(d,w,xx,ym))));
        }
      }
      gs.sort((a,b)=>a-b);
      medGrad[dep]=gs[Math.floor(gs.length/2)];
    }
    const vals=medGrad.filter(v=>typeof v==='number');
    const mean=vals.reduce((s,v)=>s+v,0)/vals.length;
    const std=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
    const med=vals.slice().sort((a,b)=>a-b)[Math.floor(vals.length/2)];
    const thresh=Math.max(2, med*2.0, mean+std*1.5);
    let hit=null;
    for(let dep=2;dep<maxDepth-2;dep++){ if(medGrad[dep]>thresh){ hit=dep; break; } }
    return hit||0;
  };
  const bL=scan('L'), bR=scan('R'), bT=scan('T'), bB=scan('B');
  const lrT=bL+bR, tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  return {bL,bR,bT,bB,lrRatio,tbRatio,scanL:{width:bL,confidence:'low'},scanR:{width:bR,confidence:'low'},scanT:{width:bT,confidence:'low'},scanB:{width:bB,confidence:'low'},confidence:'low'};
}

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
  let brR=medianArr(borderColorSamples.map(s=>s[0]));
  let brG=medianArr(borderColorSamples.map(s=>s[1]));
  let brB=medianArr(borderColorSamples.map(s=>s[2]));
  let colorDist=(r,g,b)=>Math.sqrt((r-brR)**2+(g-brG)**2+(b-brB)**2);

  // Recompute border color after filtering obvious outliers (glare/text)
  let dists0=borderColorSamples.map(([r,g,b])=>colorDist(r,g,b));
  const medDist=medianArr(dists0);
  const keep=borderColorSamples.filter(([r,g,b])=>colorDist(r,g,b)<=medDist*2.2);
  if(keep.length>=Math.max(10, borderColorSamples.length*0.25)){
    brR=medianArr(keep.map(s=>s[0]));
    brG=medianArr(keep.map(s=>s[1]));
    brB=medianArr(keep.map(s=>s[2]));
    colorDist=(r,g,b)=>Math.sqrt((r-brR)**2+(g-brG)**2+(b-brB)**2);
    dists0=keep.map(([r,g,b])=>colorDist(r,g,b));
  }


  // Adaptive threshold: 3x median within-border color distance
  // Adapts to solid blue border (low variance → tight threshold)
  // vs foil/holo border (high variance → looser threshold)
  const withinBorderDist=medianArr(dists0);
  const TOL=Math.min(80, Math.max(18, withinBorderDist*2.5));

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

  // Gradient-based fallback (edge-band peaks) when color scan is unstable
  const gradMeasurements=[];
  for(const {x:outerX,y:outerY} of edgePositions){
    const grads=[];
    for(let dep=2;dep<=MAX_BORDER-2;dep++){
      const a=lumAt(d,w,h,outerX+perpInX*(dep-1),outerY+perpInY*(dep-1));
      const b=lumAt(d,w,h,outerX+perpInX*(dep+1),outerY+perpInY*(dep+1));
      grads[dep]=Math.abs(b-a);
    }
    const gMean=grads.reduce((s,v)=>s+(v||0),0)/(grads.length||1);
    const gStd=Math.sqrt(grads.reduce((s,v)=>s+((v||0)-gMean)**2,0)/(grads.length||1));
    const gThresh=Math.max(4, gMean+gStd*2.0);
    let outer=null, inner=null;
    for(let dep=2;dep<=MAX_BORDER-2;dep++) if(grads[dep]>gThresh){outer=dep;break;}
    if(outer!==null){
      for(let dep=outer+3;dep<=MAX_BORDER-2;dep++) if(grads[dep]>gThresh){inner=dep;break;}
    }
    if(inner) gradMeasurements.push(inner);
  }

  if(measurements.length<4){
    if(gradMeasurements.length>=4){
      const sideDim = (side==='L' || side==='R') ? cW : cH;
      const minOk = Math.max(2, sideDim*0.01);
      const maxOk = sideDim*0.18;
      const filtered=gradMeasurements.filter(v=>v>=minOk && v<=maxOk);
      const useArr = filtered.length>=3?filtered:gradMeasurements;
      useArr.sort((a,b)=>a-b);
      const med=useArr[Math.floor(useArr.length/2)];
      return{width:med,confidence:'low',iqr:999,borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},tol:Math.round(TOL),rawValues:useArr,mode:filtered.length>=3?'grad-range':'grad'};
    }
    return{width:0,confidence:'failed',iqr:999,borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},tol:Math.round(TOL)};
  }
  measurements.sort((a,b)=>a-b);
  const med=measurements[Math.floor(measurements.length/2)];
  const q1=measurements[Math.floor(measurements.length*0.25)];
  const q3=measurements[Math.floor(measurements.length*0.75)];
  const iqr=q3-q1;
  const sideDim = (side==='L' || side==='R') ? cW : cH;
  const minOk = Math.max(2, sideDim*0.01);
  const maxOk = sideDim*0.18;
  if((med<minOk || med>maxOk) && gradMeasurements.length>=4){
    const filtered=gradMeasurements.filter(v=>v>=minOk && v<=maxOk);
    if(filtered.length>=3){
      filtered.sort((a,b)=>a-b);
      const gmed=filtered[Math.floor(filtered.length/2)];
      return{width:gmed,confidence:'low',iqr, borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},tol:Math.round(TOL),rawValues:filtered,mode:'grad-range'};
    }
  }
  if((iqr>24 || med>MAX_BORDER*0.7) && gradMeasurements.length>=4){
    gradMeasurements.sort((a,b)=>a-b);
    const gmed=gradMeasurements[Math.floor(gradMeasurements.length/2)];
    return{width:gmed,confidence:'low',iqr, borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},tol:Math.round(TOL),rawValues:gradMeasurements,mode:'grad'};
  }
  // IQR thresholds: <=8 = good, <=20 = low, >20 = failed
  return{
    width:med,
    confidence:iqr<=8?'good':iqr<=20?'low':'failed',
    iqr,
    borderColor:{r:Math.round(brR),g:Math.round(brG),b:Math.round(brB)},
    tol:Math.round(TOL),
    rawValues:measurements,
  };
}


function edgeBandWidth(d,w,h,bn,side){
  const {left:cl,right:cr,top:ct,bottom:cb,cardW:cW,cardH:cH}=bn;
  const L=(y,x)=>LUM(d[(y*w+x)*4],d[(y*w+x)*4+1],d[(y*w+x)*4+2]);
  const LINES=9;
  const maxDepth=Math.round(Math.min(cW,cH)*0.22);
  const gradsMed=[];
  for(let dep=2;dep<maxDepth-1;dep++){
    const gs=[];
    for(let li=0;li<LINES;li++){
      const f=0.20+0.60*(li/(LINES-1));
      let x,y;
      if(side==='L'||side==='R'){
        y=Math.round(ct+cH*f);
        x=(side==='L') ? (cl+dep) : (cr-dep);
        const xm=CLAMP(x-1,0,w-1), xp=CLAMP(x+1,0,w-1);
        const yy=CLAMP(y,0,h-1);
        gs.push(Math.abs(L(yy,xp)-L(yy,xm)));
      }else{
        x=Math.round(cl+cW*f);
        y=(side==='T') ? (ct+dep) : (cb-dep);
        const ym=CLAMP(y-1,0,h-1), yp=CLAMP(y+1,0,h-1);
        const xx=CLAMP(x,0,w-1);
        gs.push(Math.abs(L(yp,xx)-L(ym,xx)));
      }
    }
    gs.sort((a,b)=>a-b);
    gradsMed[dep]=gs[Math.floor(gs.length/2)];
  }
  const smooth=[];
  for(let dep=2;dep<maxDepth-1;dep++){
    const a=gradsMed[dep-1]||0,b=gradsMed[dep]||0,c=gradsMed[dep+1]||0;
    smooth[dep]=(a+b+c)/3;
  }
  const vals=smooth.filter(v=>typeof v==='number');
  if(vals.length<5) return {width:0,confidence:'failed',mode:'edgeband'};
  const mean=vals.reduce((s,v)=>s+v,0)/vals.length;
  const std=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
  const med=vals.slice().sort((a,b)=>a-b)[Math.floor(vals.length/2)];
  const thresh=Math.max(2, med*2.0, mean+std*1.5);
  let outer=null, inner=null;
  for(let dep=2;dep<maxDepth-2;dep++) if(smooth[dep]>thresh){ outer=dep; break; }
  if(outer!==null){
    for(let dep=outer+3;dep<maxDepth-2;dep++) if(smooth[dep]>thresh){ inner=dep; break; }
  }
  if(inner===null){
    let bestG=0,bestDep=null;
    for(let dep=(outer||2)+3;dep<maxDepth-2;dep++) if(smooth[dep]>bestG){bestG=smooth[dep];bestDep=dep;}
    if(bestDep!==null) inner=bestDep;
  }
  const sideDim=(side==='L'||side==='R')?cW:cH;
  const minOk=Math.max(2,sideDim*0.01);
  const maxOk=sideDim*0.18;
  if(inner!==null && (inner<minOk || inner>maxOk)) inner=null;
  return {width:inner||0,confidence:inner?'low':'failed',mode:'edgeband'};
}

function detectCentering(d, w, h, bn, angleDeg, bgColor) {
  const {cardW:cW,cardH:cH}=bn;
  const sT=measureBorderWidth(d,w,h,bn,'T',angleDeg,bgColor);
  const sB=measureBorderWidth(d,w,h,bn,'B',angleDeg,bgColor);
  const sL=measureBorderWidth(d,w,h,bn,'L',angleDeg,bgColor);
  const sR=measureBorderWidth(d,w,h,bn,'R',angleDeg,bgColor);

  const eT=edgeBandWidth(d,w,h,bn,'T');
  const eB=edgeBandWidth(d,w,h,bn,'B');
  const eL=edgeBandWidth(d,w,h,bn,'L');
  const eR=edgeBandWidth(d,w,h,bn,'R');

  const pick=(s,e,sideDim,isTB)=>{
    const minOk=Math.max(3, sideDim*0.008);
    const maxOk=sideDim*(isTB?0.12:0.10);
    const inRange=v=>v>=minOk && v<=maxOk;

    if(s.confidence==='good' && inRange(s.width)) return s;

    const eOk = e.width>0 && inRange(e.width);
    if(eOk) return {...s,width:e.width,confidence:'low',mode:e.mode||'edgeband'};

    if(inRange(s.width)) return s;

    const clamped = Math.min(maxOk, Math.max(minOk, s.width||0));
    return {...s,width:clamped,confidence:'low',mode:'clamp'};
  };
  const sT2=pick(sT,eT,cH,true), sB2=pick(sB,eB,cH,true), sL2=pick(sL,eL,cW,false), sR2=pick(sR,eR,cW,false);
  const bL=sL2.width,bR=sR2.width,bT=sT2.width,bB=sB2.width;
  const lrT=bL+bR,tbT=bT+bB;
  const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
  const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
  const confs=[sL2.confidence,sR2.confidence,sT2.confidence,sB2.confidence];
  const conf=confs.every(c=>c==='good')?'good':confs.filter(c=>c==='failed').length>=2?'failed':'low';
  return{bL,bR,bT,bB,lrRatio,tbRatio,scanL:sL2,scanR:sR2,scanT:sT2,scanB:sB2,confidence:conf};
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

  const lines=detectCardLines(d,w,h,bounds);
  const corners=lines?computeCardCorners(lines):null;
  let rect=null;
  if(corners){ rect=warpPerspective(d,w,h,corners); }

  const PATCH=12;
  let bgR=0,bgG=0,bgB=0,bgN=0;
  for(const [cx,cy] of [[0,0],[w-PATCH,0],[0,h-PATCH],[w-PATCH,h-PATCH]]){
    for(let dy=0;dy<PATCH;dy++) for(let dx=0;dx<PATCH;dx++){
      const[r,g,b]=PX(d,w,CLAMP(cx+dx,0,w-1),CLAMP(cy+dy,0,h-1));
      bgR+=r;bgG+=g;bgB+=b;bgN++;
    }
  }
  const bgColor={r:bgR/bgN, g:bgG/bgN, b:bgB/bgN};

  let centering=detectCentering(d,w,h,bounds,angle,bgColor);
  let rectUrl=null;
  if(rect){
    // Compute quick brightness check to reject bad warps
    let sum=0, n=0;
    for(let i=0;i<rect.data.length;i+=16){
      sum += rect.data[i]+rect.data[i+1]+rect.data[i+2];
      n++;
    }
    const avg = n?sum/(n*3):0;
    if(avg>8){
      centering=detectCenteringRectified(rect.data,rect.w,rect.h);
      const c=document.createElement('canvas'); c.width=rect.w; c.height=rect.h;
      const ctx=c.getContext('2d');
      const imgData=ctx.createImageData(rect.w,rect.h); imgData.data.set(rect.data); ctx.putImageData(imgData,0,0);
      rectUrl=c.toDataURL('image/jpeg',0.92);
    }else{
      rect=null;
    }
  }

  return{srcCanvas:canvas,imgUrl,rectUrl,rect,w,h,bounds,centering,angle,angleResult,cardW:bounds.cardW,cardH:bounds.cardH};
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
      const bL=Math.max(0,(borderOverrides?.L??0)+cen.bL);
      const bR=Math.max(0,(borderOverrides?.R??0)+cen.bR);
      const bT=Math.max(0,(borderOverrides?.T??0)+cen.bT);
      const bB=Math.max(0,(borderOverrides?.B??0)+cen.bB);

      const w=img.naturalWidth||result.w;
      const h=img.naturalHeight||result.h;
      c.width=w; c.height=h;
      const ctx=c.getContext('2d');
      ctx.clearRect(0,0,w,h);

      const cl=(outerOffsets?.L??0);
      const cr=w-(outerOffsets?.R??0);
      const ct=(outerOffsets?.T??0);
      const cb=h-(outerOffsets?.B??0);
      const cW=cr-cl, cH=cb-ct;

      // Outer rect
      ctx.strokeStyle='#ff9944'; ctx.lineWidth=3; ctx.setLineDash([]);
      ctx.strokeRect(cl,ct,cW,cH);

      // Inner rect
      const il=cl+bL, ir=cr-bR, it=ct+bT, ib=cb-bB;
      ctx.strokeStyle='#00ff88'; ctx.lineWidth=2; ctx.setLineDash([10,5]);
      ctx.strokeRect(il,it,Math.max(0,ir-il),Math.max(0,ib-it));
      ctx.setLineDash([]);

      const fs=Math.max(13,~~(cW*0.024));
      ctx.font=`bold ${fs}px ${mono}`; ctx.textAlign='center';
      const lc=s=>s?.confidence==='good'?'#00ff88':s?.confidence==='low'?'#ccbb00':'#ff4444';
      const drawLabel=(txt,x,y,conf)=>{
        ctx.fillStyle='rgba(0,0,0,.75)'; ctx.fillRect(x-36,y-14,72,20);
        ctx.fillStyle=lc(conf); ctx.fillText(txt,x,y);
      };
      drawLabel(`T ${bT}px`, cl+cW/2, ct-12, cen.scanT);
      drawLabel(`B ${bB}px`, cl+cW/2, cb+20, cen.scanB);
      drawLabel(`L ${bL}px`, cl-32, ct+cH/2, cen.scanL);
      drawLabel(`R ${bR}px`, cr+32, ct+cH/2, cen.scanR);

      const lrT=bL+bR,tbT=bT+bB;
      const lrRatio=lrT>0?Math.round((bL/lrT)*1000)/10:50;
      const tbRatio=tbT>0?Math.round((bT/tbT)*1000)/10:50;
      const lrOk=Math.max(lrRatio,100-lrRatio)<=55;
      const tbOk=Math.max(tbRatio,100-tbRatio)<=65;
      ctx.font=`bold ${Math.max(14,~~(cW*0.030))}px ${mono}`;
      ctx.fillStyle=(lrOk&&tbOk)?'#00ff88':'#ff6633';
      ctx.fillText(`${lrRatio}/${Math.round((100-lrRatio)*10)/10}  ${tbRatio}/${Math.round((100-tbRatio)*10)/10}`, cl+cW/2, ct-28);
    };
    if(img.complete&&img.naturalWidth)draw(); else img.onload=draw;
  },[result,borderOverrides,outerOffsets,debug]);

  if(!result)return null;
  const src=result.rectUrl||result.imgUrl;
  return(
    <div style={{position:'relative',width:'100%'}}>
      <img ref={imgRef} src={src} style={{width:'100%',display:'block',borderRadius:6}}/>
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
            L:{w:c.scanL?.width,iqr:c.scanL?.iqr,conf:c.scanL?.confidence,mode:c.scanL?.mode,color:c.scanL?.borderColor,tol:c.scanL?.tol},
            R:{w:c.scanR?.width,iqr:c.scanR?.iqr,conf:c.scanR?.confidence,mode:c.scanR?.mode,color:c.scanR?.borderColor,tol:c.scanR?.tol},
            T:{w:c.scanT?.width,iqr:c.scanT?.iqr,conf:c.scanT?.confidence,mode:c.scanT?.mode,color:c.scanT?.borderColor,tol:c.scanT?.tol},
            B:{w:c.scanB?.width,iqr:c.scanB?.iqr,conf:c.scanB?.confidence,mode:c.scanB?.mode,color:c.scanB?.borderColor,tol:c.scanB?.tol},
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

