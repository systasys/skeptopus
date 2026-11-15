// The four who say "it's done", alive on the journal page.
//
// They were still pictures with a hover tilt. A still picture of a character reads as a sticker; what makes
// a drawing read as a body is not the number of joints but three things, asked for and judged on 2026-11-14:
//   1. the motion TRAVELS up the body instead of turning it in one block (hips first, head last). A block
//      that rotates reads as cardboard on a stick, and that is what was wrong with the first two tries;
//   2. a body TAKES a pose and HOLDS it. A spring always returns to the same rest, and that return is what
//      the eye reads as a machine. Here the rest itself moves, and there are seconds of stillness;
//   3. a glance JUMPS. It does not glide to its target, it snaps there in a tenth of a second and stops.
//
// No cutting of the drawing into limbs: that leaves holes at the joints as soon as anything moves. The whole
// picture is laid on an elastic net and the net is what deforms, so there is nothing to tear.
//
// Nothing here is decoration: what each one does says what it answers. The ant has seen, it is steady. The
// frog was caught out, it is jumpy. The mole could not look, so it draws BACK from the pointer instead of
// turning towards it. A page where things move for no reason is the kind of page this tool exists against.

/** How each of the four moves, by the class its picture already carries. Measured on the drawings themselves. */
export const GENS = {
  "f-fourmi": { axe: 0.477, cou: 0.32, bassin: 0.62, ampleur: 0.85, vitesse: 0.9, souffle: 1.45, elan: 4.5, retrait: 0, retard: 11, raideur: [0.1, 0.06, 0.08], amorti: [0.22, 0.17, 0.16] },
  "f-pigeon": { axe: 0.489, cou: 0.42, bassin: 0.78, ampleur: 1.15, vitesse: 1.6, souffle: 2.3, elan: 8, retrait: 0, retard: 8, raideur: [0.14, 0.095, 0.13], amorti: [0.2, 0.11, 0.09] },
  "f-grenouille": { axe: 0.621, cou: 0.5, bassin: 0.85, ampleur: 1, vitesse: 1.9, souffle: 2.6, elan: 9, retrait: 0, retard: 7, raideur: [0.16, 0.115, 0.15], amorti: [0.19, 0.1, 0.08] },
  "f-taupe": { axe: 0.363, cou: 0.55, bassin: 0.9, ampleur: 0.55, vitesse: 0.8, souffle: 1.25, elan: 3.2, retrait: 1, retard: 13, raideur: [0.09, 0.05, 0.07], amorti: [0.24, 0.2, 0.19] },
};

/**
 * The script the page carries, as text. It runs on the four of the crew and on nothing else: a page may hold
 * two thousand cards, and two thousand elastic nets would melt the machine of whoever opens it.
 */
export const VIVANT = `(function(){
var GENS=${JSON.stringify(GENS)};
// Reduced motion: the page already stops every animation it holds, and this one stops itself too. Without a
// canvas, or without the picture, the drawings simply stay as they were: nothing here is needed to read them.
try{ if(matchMedia("(prefers-reduced-motion: reduce)").matches) return; }catch(e){ return; }
var COLS=9,LIGNES=13,vies=[],bat=null;
function ressort(k,a){return {v:0,x:0,k:k,a:a,vers:function(c){this.v=(this.v+(c-this.x)*this.k)*(1-this.a);this.x+=this.v;return this.x}}}
// A face only comes to life once it is really on screen, and only then is its net built. The page writes the
// crew once per language and keeps the explainer folded, so a page holds twenty of these pictures while
// four at most are ever shown: measured on 2026-11-14, when all twenty-five woke up and none could be drawn,
// each having no size at all. Waiting for the first appearance settles the languages, the folded panel and
// anything below the fold in one rule.
function naitre(span){
  var cls=null; for(var k in GENS) if(span.classList.contains(k)) cls=k;
  if(!cls) return;
  if(!window.IntersectionObserver){ return; }
  var oeil=new IntersectionObserver(function(l){
    if(!l[0].isIntersecting) return;
    oeil.disconnect();
    eveiller(span,cls);
  });
  oeil.observe(span);
}
function eveiller(span,cls){
  if(span.dataset.vivant) return; span.dataset.vivant="1";
  var src=(getComputedStyle(span).backgroundImage||"").match(/url\\(["']?([^"')]+)/);
  if(!src) return;
  var toile=document.createElement("canvas"); toile.className="vivant"; toile.setAttribute("aria-hidden","true");
  var ctx=toile.getContext&&toile.getContext("2d"); if(!ctx) return;
  var img=new Image();
  var s={b:GENS[cls],span:span,toile:toile,ctx:ctx,img:img,L:0,H:0,dpr:1,cadre:null,viseX:0,impulsion:0,
    phase:vies.length*1.37,pose:{buste:0,poids:0},tenue:Math.random()*2,anticipe:0,
    sac:{de:0,vers:0,duree:0.14,reste:0},hist:[],vu:true,
    bas:ressort(GENS[cls].raideur[0],GENS[cls].amorti[0]),
    haut:ressort(GENS[cls].raideur[1],GENS[cls].amorti[1]),
    tete:ressort(GENS[cls].raideur[2],GENS[cls].amorti[2]),
    poids:ressort(GENS[cls].raideur[0]*0.8,GENS[cls].amorti[0]+0.04),
    souffle:ressort(0.09,0.2),saut:ressort(0.13,0.26)};
  img.onload=function(){
    // Le dessin se pose SUR l'image, pas à côté : posé à côté, chaque personnage prenait deux largeurs
    // (vu à 420 px le 15/11, un grand vide entre le dessin et sa phrase). L'image cachée garde sa place,
    // le dessin, lui, en hérite le cadre et reste visible.
    if(getComputedStyle(span).position==="static") span.style.position="relative";
    toile.style.cssText="position:absolute;left:0;top:0;visibility:visible";
    span.appendChild(toile);
    taille(s);
    if(!s.cadre){ toile.parentNode.removeChild(toile); return; }   // sans taille, on laisse l'image tranquille
    // On DESSINE avant de cacher l'image : dans un onglet d'arrière-plan, la boucle d'animation ne tourne
    // pas, et cacher d'abord laisserait un trou à la place du personnage. L'ordre compte.
    var repos={bas:0,haut:0,tete:0,poids:0,souffle:0,saut:0,t:0};
    s.hist.push(repos);
    dessine(s,repos);
    span.style.visibility="hidden";          // la place reste prise : rien ne saute dans la page
    vies.push(s); if(!bat) bat=requestAnimationFrame(battre);
  };
  img.onerror=function(){};
  img.src=src[1];
  var fig=span.closest("figure")||span;
  fig.addEventListener("mousemove",function(e){var r=toile.getBoundingClientRect();s.viseX=((e.clientX-r.left)/(r.width||1)-0.5)*2});
  fig.addEventListener("mouseleave",function(){s.viseX=0});
  fig.addEventListener("mouseenter",function(){s.impulsion=Math.max(s.impulsion,0.5)});
  if(window.IntersectionObserver){
    new IntersectionObserver(function(l){s.vu=l[0].isIntersecting}).observe(toile);
  }
}
function taille(s){
  var r=s.span.getBoundingClientRect();
  s.dpr=Math.min(window.devicePixelRatio||1,2);
  s.L=Math.round(r.width);s.H=Math.round(r.height);
  if(!s.L||!s.H)return;
  s.toile.width=s.L*s.dpr;s.toile.height=s.H*s.dpr;
  s.toile.style.width=s.L+"px";s.toile.style.height=s.H+"px";
  s.ctx.setTransform(s.dpr,0,0,s.dpr,0,0);
  var k=Math.min(s.L/s.img.width,s.H/s.img.height);
  s.cadre={l:s.img.width*k,h:s.img.height*k,x:0,y:0};
  s.cadre.x=(s.L-s.cadre.l)/2;s.cadre.y=s.H-s.cadre.h;
}
function place(s,u,v,m,tps){
  var b=s.b,hautain=1-v,buste=Math.max(0,(b.bassin-v)/b.bassin),crane=Math.max(0,(b.cou-v)/b.cou),pivot=b.axe;
  var ang=(m.bas*hautain*hautain+m.haut*buste*buste*1.6+m.tete*crane*crane*2.2)*Math.PI/180;
  var x=u-pivot,y=v-1,ca=Math.cos(ang),sa=Math.sin(ang);
  var X=x*ca-y*sa+pivot,Y=x*sa+y*ca+1;
  var sol=Math.min(1,Math.max(0,(0.97-v)/0.22));
  X+=m.poids*0.018*sol; Y+=Math.abs(m.poids)*0.004*sol;
  var g=m.souffle*0.013*buste; X+=(X-pivot)*g; Y-=g*0.9*buste;
  var e=m.saut*0.07; Y+=e*hautain; X+=(X-pivot)*-e*0.7;
  var T=tps+b.axe*7;
  X+=(Math.sin(T*2.3)*0.5+Math.sin(T*3.7+1.3)*0.33+Math.sin(T*6.1+2.7)*0.17)*0.0016*hautain;
  Y+=(Math.sin(T*2.9+0.7)*0.5+Math.sin(T*4.3+2.1)*0.3)*0.0011*hautain;
  return [s.cadre.x+X*s.cadre.l,s.cadre.y+Y*s.cadre.h];
}
function triangle(ctx,img,p0,p1,p2,t0,t1,t2){
  ctx.save();ctx.beginPath();
  var cx=(p0[0]+p1[0]+p2[0])/3,cy=(p0[1]+p1[1]+p2[1])/3;
  var g=function(p){return [p[0]+(p[0]-cx)*0.02+(p[0]>cx?0.8:-0.8),p[1]+(p[1]-cy)*0.02+(p[1]>cy?0.8:-0.8)]};
  var a=g(p0),b=g(p1),c=g(p2);
  ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(c[0],c[1]);ctx.closePath();ctx.clip();
  var u0=t0[0],v0=t0[1],u1=t1[0],v1=t1[1],u2=t2[0],v2=t2[1];
  var det=u0*(v1-v2)-v0*(u1-u2)+(u1*v2-u2*v1);
  if(!det){ctx.restore();return}
  var sol=function(q0,q1,q2){return [(q0*(v1-v2)-v0*(q1-q2)+(q1*v2-q2*v1))/det,
    (u0*(q1-q2)-q0*(u1-u2)+(u1*q2-u2*q1))/det,
    (u0*(v1*q2-v2*q1)-v0*(u1*q2-u2*q1)+q0*(u1*v2-u2*v1))/det]};
  var A=sol(p0[0],p1[0],p2[0]),B=sol(p0[1],p1[1],p2[1]);
  ctx.transform(A[0],B[0],A[1],B[1],A[2],B[2]);
  ctx.drawImage(img,0,0);
  ctx.restore();
}
function dessine(s,m){
  var ctx=s.ctx,img=s.img;
  ctx.clearRect(0,0,s.L,s.H);
  if(!s.cadre||!img.width)return;
  var pts=[],i,k;
  for(i=0;i<=LIGNES;i++){
    var v=i/LIGNES,recul=Math.min(s.hist.length-1,Math.round((1-v)*s.b.retard));
    var vu=s.hist[s.hist.length-1-recul]||m,ligne=[];
    for(k=0;k<=COLS;k++) ligne.push(place(s,k/COLS,v,vu,m.t));
    pts.push(ligne);
  }
  var iw=img.width,ih=img.height;
  for(i=0;i<LIGNES;i++) for(k=0;k<COLS;k++){
    var a0=(k/COLS)*iw,a1=((k+1)/COLS)*iw,b0=(i/LIGNES)*ih,b1=((i+1)/LIGNES)*ih;
    triangle(ctx,img,pts[i][k],pts[i][k+1],pts[i+1][k],[a0,b0],[a1,b0],[a0,b1]);
    triangle(ctx,img,pts[i][k+1],pts[i+1][k+1],pts[i+1][k],[a1,b0],[a1,b1],[a0,b1]);
  }
}
function viser(s,ou,vite){
  s.sac.de=s.sac.reste>0?s.sac.de+(s.sac.vers-s.sac.de)*0.5:s.sac.vers;
  s.sac.vers=ou;s.sac.duree=s.sac.reste=vite;
}
// The next move, drawn at random but never anything: shift weight, look away, straighten up, a small start.
// Then it HOLDS. The durations are deliberately unequal: equal ones, even random, give back a machine's beat.
function choisir(s){
  var a=s.b.ampleur,r=Math.random();
  if(r<0.32){s.pose.poids=(Math.random()<0.5?-1:1)*(0.5+Math.random()*0.55)*a;s.pose.buste=-s.pose.poids*0.85}
  else if(r<0.62) viser(s,(Math.random()*2-1)*3.6*a,0.09+Math.random()*0.1);
  else if(r<0.74) viser(s,0,0.11+Math.random()*0.08);
  else if(r<0.88){s.pose.poids*=0.15;s.pose.buste*=0.15;viser(s,s.sac.vers*0.25,0.14)}
  else s.impulsion=Math.max(s.impulsion,0.3+Math.random()*0.3);
  var d=Math.random();
  s.tenue=(d<0.22?0.22+Math.random()*0.25:d<0.78?1.1+Math.random()*1.8:3.4+Math.random()*3.2)/s.b.vitesse;
  s.anticipe=0.07+Math.random()*0.09;
}
var t=0;
function battre(){
  bat=requestAnimationFrame(battre);
  t+=1/60;
  for(var i=0;i<vies.length;i++){
    var s=vies[i];
    if(!s.vu||!s.cadre) continue;
    var b=s.b,u=t*b.vitesse+s.phase,a=b.ampleur,recule=b.retrait?-1:1,suit=b.retrait?0.45:1;
    s.tenue-=1/60; if(s.tenue<=0) choisir(s);
    var anti=s.anticipe>0?-0.4:1; if(s.anticipe>0) s.anticipe-=1/60;
    if(s.impulsion>0.0005) s.impulsion*=0.9; else s.impulsion=0;
    var derive=Math.sin(u*0.41)*0.18+Math.sin(u*0.233+1.1)*0.12;
    var regard=s.sac.vers;
    if(s.sac.reste>0){
      s.sac.reste-=1/60;
      var p=Math.max(0,Math.min(1,1-s.sac.reste/s.sac.duree));
      var course=1-Math.pow(1-p,2.2),dep=p>0.72?Math.sin((p-0.72)/0.28*Math.PI)*0.09:0;
      regard=s.sac.de+(s.sac.vers-s.sac.de)*(course+dep);
    }
    var m={
      bas:s.bas.vers((s.pose.buste*0.35*anti+s.viseX*0.5*suit+derive)*a),
      haut:s.haut.vers((s.pose.buste*anti+s.viseX*1.5*suit+derive*1.4)*a+s.impulsion*b.elan*recule),
      tete:s.tete.vers((regard*anti+s.viseX*2.6*suit)*a-s.haut.x*0.55+s.impulsion*b.elan*1.3*recule),
      poids:s.poids.vers(s.pose.poids*anti),
      souffle:s.souffle.vers(Math.sin(u*b.souffle)*(1+0.35*Math.sin(u*0.19))),
      saut:s.saut.vers(s.impulsion>0.4?(b.retrait?0.7:-1):0),
      t:u};
    s.hist.push(m); if(s.hist.length>46) s.hist.shift();
    dessine(s,m);
  }
}
function partir(){
  var l=document.querySelectorAll(".who > .face");
  for(var i=0;i<l.length;i++) naitre(l[i]);
  // A watcher does not always speak: in a page that is not being drawn (a background tab, a frame that
  // reports nothing), the first appearance may never be announced. So a second later, anything that has a
  // real size on screen is woken anyway. Anything still flat stays asleep, which is what we want.
  setTimeout(function(){
    var l2=document.querySelectorAll(".who > .face");
    for(var j=0;j<l2.length;j++){
      var sp=l2[j];
      if(sp.dataset.vivant || sp.style.visibility==="hidden") continue;
      var r=sp.getBoundingClientRect();
      if(r.width>8 && r.height>8){ var c=null; for(var k in GENS) if(sp.classList.contains(k)) c=k; if(c) eveiller(sp,c); }
    }
  },1200);
}
addEventListener("resize",function(){for(var i=0;i<vies.length;i++) taille(vies[i])});
if(document.readyState==="loading") addEventListener("DOMContentLoaded",partir); else partir();
})();`;
