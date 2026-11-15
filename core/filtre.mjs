// The four counters, made to open on what they count.
//
// Asked on 2026-11-14: the numbers at the top should lead to a place where every claimed thing can be read,
// and each one should lead to what it is about. The number was already true; it just could not be opened.
//
// Two rules hold this together, and they are the same rule twice:
//   - the filter is done in the page and nothing else: no address is asked for, nothing is fetched. The
//     journal is shown inside a frame that is allowed scripts and nothing else, and it must stay that way;
//   - a link exists only where the address was really seen when the claim was checked. A link built by
//     guessing which repository a number belongs to would be believed, and would lead somewhere false,
//     which is precisely what this tool exists to prevent. Everything else stays plain text.

/** The script the page carries: clicking a counter keeps only what it counts, clicking it again shows all. */
export const FILTRE = `(function(){
var tuiles=[].slice.call(document.querySelectorAll(".tile[data-v]"));
if(!tuiles.length) return;
var choisi=null;
function montrer(){
  var lignes=document.querySelectorAll("li[data-v]");
  for(var i=0;i<lignes.length;i++){
    var l=lignes[i];
    l.hidden = choisi ? l.getAttribute("data-v")!==choisi : false;
  }
  // Une fiche dont plus aucune ligne ne reste n'a plus rien à dire : elle s'efface aussi, sinon la page
  // se remplit de cartes vides et le filtre ne sert à rien.
  var fiches=document.querySelectorAll("article");
  for(var k=0;k<fiches.length;k++){
    var f=fiches[k],vues=f.querySelectorAll("li[data-v]:not([hidden])").length;
    f.hidden = choisi ? vues===0 : false;
  }
  // Un jour entièrement masqué emporte son titre.
  var jours=document.querySelectorAll("h2");
  for(var j=0;j<jours.length;j++){
    var t=jours[j],n=t.nextElementSibling,reste=false;
    while(n && n.tagName==="ARTICLE"){ if(!n.hidden) reste=true; n=n.nextElementSibling; }
    t.hidden = choisi ? !reste : false;
  }
  for(var m=0;m<tuiles.length;m++){
    var on=tuiles[m].getAttribute("data-v")===choisi;
    tuiles[m].setAttribute("aria-pressed",on?"true":"false");
    tuiles[m].classList.toggle("choisi",on);
  }
  document.body.classList.toggle("filtre",!!choisi);
}
for(var i=0;i<tuiles.length;i++) tuiles[i].addEventListener("click",function(){
  var v=this.getAttribute("data-v");
  choisi = choisi===v ? null : v;
  montrer();
  if(choisi){ var a=document.querySelector("article:not([hidden])"); if(a&&a.scrollIntoView) a.scrollIntoView({block:"nearest"}); }
});
addEventListener("keydown",function(e){ if(e.key==="Escape"&&choisi){ choisi=null; montrer(); } });
})();`;
