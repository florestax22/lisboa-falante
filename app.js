"use strict";
(() => {
  const state = { position:null, address:"", routeText:"", searchText:"", lastSpeech:"" };
  const $ = id => document.getElementById(id);
  const set = (id,msg) => { const e=$(id); if(e)e.textContent=msg; };
  const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const diag = msg => { set("diagnostico", new Date().toLocaleTimeString("pt-PT")+" — "+msg); };

  function voice(){
    const vs = speechSynthesis.getVoices();
    return vs.find(v=>/^pt-PT/i.test(v.lang)) || vs.find(v=>/^pt/i.test(v.lang)) || null;
  }
  function speak(msg){
    msg=String(msg||"").trim(); if(!msg)return;
    state.lastSpeech=msg;
    if(!("speechSynthesis" in window)){set("estado-geral","Este navegador não disponibiliza voz.");return;}
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(msg); u.lang="pt-PT"; u.rate=1; u.volume=1;
    const v=voice(); if(v)u.voice=v; speechSynthesis.speak(u);
  }
  async function fetchJson(url, options={}, timeout=20000){
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
    try{const r=await fetch(url,{...options,signal:controller.signal,headers:{"Accept":"application/json",...(options.headers||{})}});if(!r.ok)throw new Error("serviço respondeu "+r.status);return await r.json();}
    finally{clearTimeout(timer)}
  }
  async function reverse(lat,lon){
    const u="https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=pt&lat="+encodeURIComponent(lat)+"&lon="+encodeURIComponent(lon);
    const j=await fetchJson(u); return j.display_name||("latitude "+lat+", longitude "+lon);
  }
  async function geocode(q){
    const u="https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=pt&countrycodes=pt&limit=5&q="+encodeURIComponent(q);
    const a=await fetchJson(u); if(!a.length)throw new Error("Não encontrei essa morada ou local.");
    const lisbon=a.find(x=>{const n=(x.display_name||"").toLowerCase();return n.includes("lisboa")||n.includes("loures")||n.includes("vila franca de xira")||n.includes("sintra")||n.includes("cascais")||n.includes("oeiras")||n.includes("amadora")||n.includes("odivelas")})||a[0];
    return {lat:Number(lisbon.lat),lon:Number(lisbon.lon),address:lisbon.display_name};
  }
  function geoError(e){
    if(e&&e.code===1)return "A localização está bloqueada. No navegador, autoriza a localização para este site e tenta novamente.";
    if(e&&e.code===2)return "O computador ou telemóvel não conseguiu determinar a localização.";
    if(e&&e.code===3)return "O GPS demorou demasiado. Tenta novamente junto a uma janela ou no telemóvel.";
    return "Não consegui obter a localização.";
  }
  function locate(){
    if(!navigator.geolocation){set("estado-gps","Este navegador não suporta localização.");return;}
    set("estado-gps","A pedir localização ao dispositivo. Autoriza quando o navegador perguntar.");
    navigator.geolocation.getCurrentPosition(async p=>{
      state.position={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:Math.round(p.coords.accuracy||0)};
      try{state.address=await reverse(state.position.lat,state.position.lon);}catch(e){state.address="coordenadas "+state.position.lat.toFixed(5)+", "+state.position.lon.toFixed(5);diag("GPS recebido; falhou identificação da rua: "+e.message);}
      const msg="Localização atual: "+state.address+". Precisão aproximada: "+state.position.accuracy+" metros.";
      set("estado-gps",msg); speak(msg);
    },e=>{const m=geoError(e);set("estado-gps",m);diag(m);},{enableHighAccuracy:true,timeout:30000,maximumAge:0});
  }
  async function getOrigin(){
    const q=$("partida").value.trim(); if(q)return await geocode(q);
    if(!state.position)throw new Error("Primeiro obtém a localização ou escreve uma partida.");
    return {lat:state.position.lat,lon:state.position.lon,address:state.address||"localização atual"};
  }
  function distanceText(m){return m<1000?Math.round(m)+" metros":(m/1000).toFixed(1).replace(".",",")+" quilómetros"}
  function durationText(sec){const min=Math.round(sec/60);if(min<60)return min+" minutos";const h=Math.floor(min/60),r=min%60;return h+" horas"+(r?" e "+r+" minutos":"")}
  function instruction(step){
    const type=step.maneuver&&step.maneuver.type||"continue"; const mod=step.maneuver&&step.maneuver.modifier||""; const road=step.name?" para "+step.name:"";
    const map={depart:"Começa",arrive:"Chegaste ao destino",turn:"Vira",continue:"Continua",merge:"Entra",fork:"Segue",roundabout:"Entra na rotunda",exit:"Sai"};
    const mods={left:" à esquerda",right:" à direita",straight:" em frente","slight left":" ligeiramente à esquerda","slight right":" ligeiramente à direita","sharp left":" acentuadamente à esquerda","sharp right":" acentuadamente à direita"};
    return (map[type]||"Continua")+(mods[mod]||"")+road;
  }
  async function calculate(){
    const dest=$("destino").value.trim(); if(!dest){set("estado-percurso","Escreve o destino.");return;}
    set("estado-percurso","A calcular o percurso."); $("resultado-percurso").innerHTML="";
    try{
      const [o,d]=await Promise.all([getOrigin(),geocode(dest)]); const mode=document.querySelector('input[name="modo"]:checked').value;
      const profile=mode==="auto"?"driving":mode==="bicycle"?"cycling":"walking";
      const url="https://router.project-osrm.org/route/v1/"+profile+"/"+o.lon+","+o.lat+";"+d.lon+","+d.lat+"?overview=false&steps=true&alternatives=false";
      let j;
      try{j=await fetchJson(url,{},30000);}catch(e){
        const costing=mode;
        const body={locations:[{lat:o.lat,lon:o.lon},{lat:d.lat,lon:d.lon}],costing,units:"kilometers",language:"pt-PT",directions_options:{units:"kilometers"}};
        j=await fetchJson("https://valhalla1.openstreetmap.de/route",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},30000);
        const trip=j.trip;if(!trip||!trip.legs)throw e;
        const mans=trip.legs[0].maneuvers||[]; const steps=mans.map(x=>x.instruction||"Continua");
        state.routeText="Percurso de "+o.address+" até "+d.address+". Distância "+distanceText((trip.summary.length||0)*1000)+". Tempo aproximado "+durationText(trip.summary.time||0)+". "+steps.map((x,i)=>"Passo "+(i+1)+": "+x+".").join(" ");
        $("resultado-percurso").innerHTML="<h3>Percurso</h3><p>Distância: "+esc(distanceText((trip.summary.length||0)*1000))+". Tempo: "+esc(durationText(trip.summary.time||0))+".</p><ol>"+steps.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ol>";
        set("estado-percurso","Percurso calculado."); $("resultado-percurso").focus(); return;
      }
      if(j.code!=="Ok"||!j.routes||!j.routes.length)throw new Error("O serviço não encontrou um percurso.");
      const r=j.routes[0], steps=(r.legs||[]).flatMap(l=>l.steps||[]).map(instruction);
      state.routeText="Percurso de "+o.address+" até "+d.address+". Distância "+distanceText(r.distance)+". Tempo aproximado "+durationText(r.duration)+". "+steps.map((x,i)=>"Passo "+(i+1)+": "+x+".").join(" ");
      $("resultado-percurso").innerHTML="<h3>Percurso</h3><p>Distância: "+esc(distanceText(r.distance))+". Tempo: "+esc(durationText(r.duration))+".</p><ol>"+steps.map(s=>"<li>"+esc(s)+"</li>").join("")+"</ol>";
      set("estado-percurso","Percurso calculado."); $("resultado-percurso").focus();
    }catch(e){set("estado-percurso","Não consegui calcular: "+e.message);diag("Percurso: "+e.message)}
  }
  function overpassFilter(q){
    const n=q.toLowerCase();
    if(n.includes("farm"))return '[amenity="pharmacy"]';
    if(n.includes("super")||n.includes("mercado"))return '[shop="supermarket"]';
    if(n.includes("café")||n.includes("cafe"))return '[amenity="cafe"]';
    if(n.includes("restaurante"))return '[amenity="restaurant"]';
    if(n.includes("multibanco")||n.includes("atm"))return '[amenity="atm"]';
    if(n.includes("hospital"))return '[amenity="hospital"]';
    if(n.includes("polícia")||n.includes("policia"))return '[amenity="police"]';
    if(n.includes("autocarro")||n.includes("paragem"))return '[highway="bus_stop"]';
    if(n.includes("comboio")||n.includes("estação")||n.includes("estacao"))return '[railway="station"]';
    return '[name~"'+q.replace(/["\\]/g," ")+'",i]';
  }
  async function searchNearby(){
    const q=$("pesquisa").value.trim(); if(!q){set("estado-pesquisa","Escreve o que procuras.");return;}
    if(!state.position){set("estado-pesquisa","Primeiro obtém a localização atual.");return;}
    set("estado-pesquisa","A procurar "+q+" perto de ti."); $("resultado-pesquisa").innerHTML="";
    const f=overpassFilter(q),lat=state.position.lat,lon=state.position.lon;
    const query='[out:json][timeout:25];(node(around:4000,'+lat+','+lon+')'+f+';way(around:4000,'+lat+','+lon+')'+f+';relation(around:4000,'+lat+','+lon+')'+f+';);out center tags 30;';
    try{
      const j=await fetchJson("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(query)},35000);
      const items=(j.elements||[]).map(x=>{const p=x.center||x,t=x.tags||{};if(!p.lat||!p.lon)return null;const name=t.name||t.brand||q;const addr=[t["addr:street"],t["addr:housenumber"],t["addr:city"]].filter(Boolean).join(" ");const dx=(p.lon-lon)*Math.cos(lat*Math.PI/180),dy=p.lat-lat,dist=Math.sqrt(dx*dx+dy*dy)*111320;return{name,addr,dist}}).filter(Boolean).sort((a,b)=>a.dist-b.dist).slice(0,10);
      if(!items.length)throw new Error("Não encontrei resultados num raio de quatro quilómetros.");
      state.searchText="Resultados para "+q+". "+items.map((x,i)=>(i+1)+": "+x.name+", a cerca de "+distanceText(x.dist)+(x.addr?", "+x.addr:"")+".").join(" ");
      $("resultado-pesquisa").innerHTML=items.map((x,i)=>"<article><h3>"+esc((i+1)+". "+x.name)+"</h3><p>"+esc((x.addr?x.addr+". ":"")+"Distância aproximada: "+distanceText(x.dist)+".")+"</p></article>").join("");
      set("estado-pesquisa",items.length+" resultados encontrados."); $("resultado-pesquisa").focus();
    }catch(e){set("estado-pesquisa","Não consegui procurar: "+e.message);diag("Pesquisa: "+e.message)}
  }
  $("obter-localizacao").onclick=locate;
  $("ouvir-localizacao").onclick=()=>speak(state.address?"Localização atual: "+state.address:"Ainda não tenho localização.");
  $("calcular").onclick=calculate; $("ouvir-percurso").onclick=()=>speak(state.routeText||"Primeiro calcula o percurso.");
  $("procurar").onclick=searchNearby; $("ouvir-resultados").onclick=()=>speak(state.searchText||"Primeiro faz uma pesquisa.");
  $("testar-voz").onclick=()=>speak("Lisboa Falante. A voz está a funcionar."); $("parar-voz").onclick=()=>speechSynthesis.cancel();
  ["destino","pesquisa"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();id==="destino"?calculate():searchNearby()}}));
  window.addEventListener("error",e=>diag("JavaScript: "+e.message+" na linha "+e.lineno));
})();
