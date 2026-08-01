"use strict";
(() => {
  const state = {
    position:null, address:"", routeText:"", searchText:"", lastSpeech:"", chosenVoice:"",
    voiceMode:localStorage.getItem("lisboaFalanteVoiceMode") || "aplicacao",
    route:null, guideWatch:null, guideActive:false, guideStep:0, guideStatus:"Guia parado.",
    announced:new Set(), offRouteCount:0, lastReroute:0, wakeLock:null, lastReverseAt:0,
    lastGoodPosition:null, lastProgressPosition:null, lastProgressSpeech:0, rejectedFixes:0, calibrationWatch:null
  };
  const $ = id => document.getElementById(id);
  const set = (id,msg) => { const e=$(id); if(e)e.textContent=msg; };
  const esc = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const diag = msg => { set("diagnostico", new Date().toLocaleTimeString("pt-PT")+" — "+msg); };

  function applicationVoice(){
    if (!("speechSynthesis" in window)) return null;
    const vs=speechSynthesis.getVoices();
    const preferred=[
      v=>/raquel/i.test(v.name)&&/^pt-PT/i.test(v.lang), v=>/raquel/i.test(v.name),
      v=>/natural|online/i.test(v.name)&&/^pt-PT/i.test(v.lang),
      v=>/microsoft/i.test(v.name)&&/^pt-PT/i.test(v.lang), v=>/^pt-PT/i.test(v.lang), v=>/^pt/i.test(v.lang)
    ];
    for(const test of preferred){const found=vs.find(test);if(found)return found;}
    return null;
  }
  function updateVoiceStatus(){
    const selected=document.querySelector('input[name="tipo-voz"]:checked');
    if(selected)state.voiceMode=selected.value;
    const v=applicationVoice();
    state.chosenVoice=v?v.name:"voz portuguesa disponível";
    if(state.voiceMode==="dispositivo") set("estado-voz","Opção atual: voz predefinida do dispositivo.");
    else set("estado-voz",v?"Opção atual: voz da aplicação. Voz encontrada: "+v.name+".":"Opção atual: voz da aplicação. Raquel não está disponível; será usada uma voz portuguesa disponível.");
  }
  function speak(msg,{interrupt=true}={}){
    msg=String(msg||"").trim(); if(!msg)return;
    state.lastSpeech=msg;
    if(!("speechSynthesis" in window)){set("estado-geral","Este navegador não disponibiliza voz.");return;}
    if(interrupt)speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(msg);u.lang="pt-PT";u.rate=0.95;u.pitch=1;u.volume=1;
    if(state.voiceMode==="aplicacao"){const v=applicationVoice();if(v)u.voice=v;}
    u.onerror=()=>set("estado-voz","A voz não conseguiu narrar. Tenta novamente.");
    speechSynthesis.speak(u);
  }
  function saveVoiceMode(){
    const selected=document.querySelector('input[name="tipo-voz"]:checked');
    state.voiceMode=selected?selected.value:"aplicacao";
    localStorage.setItem("lisboaFalanteVoiceMode",state.voiceMode);
    updateVoiceStatus(); speak(state.voiceMode==="dispositivo"?"Ficou escolhida a voz predefinida do dispositivo.":"Ficou escolhida a voz da aplicação, com prioridade à Raquel.");
  }
  document.querySelectorAll('input[name="tipo-voz"]').forEach(r=>{r.checked=r.value===state.voiceMode;r.addEventListener("change",updateVoiceStatus);});
  if("speechSynthesis" in window){speechSynthesis.onvoiceschanged=updateVoiceStatus;setTimeout(updateVoiceStatus,300);}

  async function fetchJson(url,options={},timeout=20000){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{const r=await fetch(url,{...options,signal:controller.signal,headers:{"Accept":"application/json",...(options.headers||{})}});if(!r.ok)throw new Error("serviço respondeu "+r.status);return await r.json();}
    finally{clearTimeout(timer);}
  }
  async function reverse(lat,lon){
    const u="https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=pt&lat="+encodeURIComponent(lat)+"&lon="+encodeURIComponent(lon);
    const j=await fetchJson(u);return j.display_name||("latitude "+lat+", longitude "+lon);
  }
  async function geocode(q){
    const u="https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=pt&countrycodes=pt&limit=5&q="+encodeURIComponent(q);
    const a=await fetchJson(u);if(!a.length)throw new Error("Não encontrei essa morada ou local.");
    const x=a.find(v=>{const n=(v.display_name||"").toLowerCase();return ["lisboa","loures","vila franca de xira","sintra","cascais","oeiras","amadora","odivelas"].some(k=>n.includes(k));})||a[0];
    return {lat:Number(x.lat),lon:Number(x.lon),address:x.display_name};
  }
  function geoError(e){
    if(e&&e.code===1)return "A localização está bloqueada. Autoriza a localização para este site e tenta novamente.";
    if(e&&e.code===2)return "O dispositivo não conseguiu determinar a localização.";
    if(e&&e.code===3)return "O GPS demorou demasiado. Tenta novamente junto a uma janela ou no exterior.";
    return "Não consegui obter a localização.";
  }
  function bearing(a,b){
    const r=x=>x*Math.PI/180,d=x=>x*180/Math.PI;
    const y=Math.sin(r(b.lon-a.lon))*Math.cos(r(b.lat));
    const x=Math.cos(r(a.lat))*Math.sin(r(b.lat))-Math.sin(r(a.lat))*Math.cos(r(b.lat))*Math.cos(r(b.lon-a.lon));
    return (d(Math.atan2(y,x))+360)%360;
  }
  function cardinal(deg){
    if(deg===null||deg===undefined||Number.isNaN(Number(deg)))return "direção ainda não determinada";
    const names=["norte","nordeste","nascente","sudeste","sul","sudoeste","poente","noroeste"];
    return names[Math.round(Number(deg)/45)%8];
  }
  function rawPosition(p){return {lat:Number(p.coords.latitude),lon:Number(p.coords.longitude),accuracy:Math.round(Number(p.coords.accuracy)||9999),heading:p.coords.heading,speed:p.coords.speed,timestamp:Number(p.timestamp)||Date.now()};}
  function acceptPosition(p,{calibration=false}={}){
    const next=rawPosition(p);
    if(!Number.isFinite(next.lat)||!Number.isFinite(next.lon)||next.accuracy>120){state.rejectedFixes++;diag("Leitura GPS rejeitada. Precisão: "+next.accuracy+" metros.");return false;}
    const prev=state.lastGoodPosition;
    if(prev){
      const dt=Math.max(1,(next.timestamp-prev.timestamp)/1000),jump=haversine(prev,next),possible=Math.max(80,dt*12+prev.accuracy+next.accuracy);
      if(jump>possible && jump>250){state.rejectedFixes++;diag("Salto GPS rejeitado: "+Math.round(jump)+" metros.");return false;}
      if((next.heading===null||Number.isNaN(Number(next.heading)))&&jump>=3)next.heading=bearing(prev,next);
    }
    if(!calibration && next.accuracy>80)return false;
    state.lastGoodPosition=next;state.position=next;return true;
  }
  function locate(){
    if(!navigator.geolocation){set("estado-gps","Este navegador não suporta localização.");return;}
    if(state.calibrationWatch!==null)navigator.geolocation.clearWatch(state.calibrationWatch);
    set("estado-gps","A calibrar o GPS. Mantém-te no exterior e espera por uma leitura precisa.");
    speak("A calibrar o GPS. Não vou aceitar uma localização imprecisa.");
    let best=null,count=0,finished=false;const started=Date.now();
    const finish=async()=>{
      if(finished)return;finished=true;if(state.calibrationWatch!==null)navigator.geolocation.clearWatch(state.calibrationWatch);state.calibrationWatch=null;
      if(!best||best.coords.accuracy>100){const m="Não obtive GPS seguro. A melhor precisão foi "+(best?distanceText(best.coords.accuracy):"desconhecida")+". Vai para o exterior, ativa a localização precisa e tenta novamente.";set("estado-gps",m);speak(m);return;}
      acceptPosition(best,{calibration:true});
      try{state.address=await reverse(state.position.lat,state.position.lon);}catch(e){state.address="coordenadas "+state.position.lat.toFixed(5)+", "+state.position.lon.toFixed(5);}
      const dir=cardinal(state.position.heading),msg="Localização confirmada: "+state.address+". Precisão aproximada: "+distanceText(state.position.accuracy)+". Direção: "+dir+".";
      set("estado-gps",msg);speak(msg);
    };
    state.calibrationWatch=navigator.geolocation.watchPosition(p=>{
      count++;if(!best||p.coords.accuracy<best.coords.accuracy)best=p;
      set("estado-gps","A calibrar. Melhor precisão até agora: "+distanceText(best.coords.accuracy)+".");
      if(best.coords.accuracy<=25 || count>=8 || Date.now()-started>20000)finish();
    },e=>{if(state.calibrationWatch!==null)navigator.geolocation.clearWatch(state.calibrationWatch);state.calibrationWatch=null;const m=geoError(e);set("estado-gps",m);speak(m);diag(m);},{enableHighAccuracy:true,timeout:30000,maximumAge:0});
    setTimeout(finish,22000);
  }
  async function getOrigin(){
    const q=$("partida").value.trim();if(q)return await geocode(q);
    if(!state.position)throw new Error("Primeiro obtém a localização ou escreve uma partida.");
    return {lat:state.position.lat,lon:state.position.lon,address:state.address||"localização atual"};
  }
  function distanceText(m){m=Number(m)||0;if(m<1000)return Math.max(1,Math.round(m))+" metros";const km=m/1000;return km.toFixed(km<10?1:0).replace(".",",")+" quilómetros";}
  function durationText(sec){const min=Math.max(1,Math.round(sec/60));if(min<60)return min+" minutos";const h=Math.floor(min/60),r=min%60;return h+" horas"+(r?" e "+r+" minutos":"");}
  function haversine(a,b){const R=6371000,rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),la1=rad(a.lat),la2=rad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
  function instruction(step){
    const type=step.maneuver&&step.maneuver.type||"continue",mod=step.maneuver&&step.maneuver.modifier||"",road=step.name?" para "+step.name:"";
    const map={depart:"Começa",arrive:"Chegaste ao destino",turn:"Vira",continue:"Continua",merge:"Entra",fork:"Segue",roundabout:"Entra na rotunda",exit:"Sai","new name":"Continua"};
    const mods={left:" à esquerda",right:" à direita",straight:" em frente","slight left":" ligeiramente à esquerda","slight right":" ligeiramente à direita","sharp left":" acentuadamente à esquerda","sharp right":" acentuadamente à direita"};
    const loc=step.maneuver&&step.maneuver.location;
    return {text:(map[type]||"Continua")+(mods[mod]||"")+road,distance:Number(step.distance)||0,location:loc?{lon:Number(loc[0]),lat:Number(loc[1])}:null};
  }
  function routeStepSentence(step,index){return "Passo "+(index+1)+": "+step.text+(step.distance>0?" durante "+distanceText(step.distance):"")+".";}
  function renderRoute(o,d,totalDistance,totalDuration,steps,geometry){
    state.route={origin:o,destination:d,totalDistance,totalDuration,steps,geometry:geometry||[],mode:document.querySelector('input[name="modo"]:checked').value};
    state.routeText="Percurso de "+o.address+" até "+d.address+". Distância total "+distanceText(totalDistance)+". Tempo aproximado "+durationText(totalDuration)+". "+steps.map(routeStepSentence).join(" ");
    $("resultado-percurso").innerHTML="<h3>Percurso</h3><p><strong>Partida:</strong> "+esc(o.address)+".</p><p><strong>Destino:</strong> "+esc(d.address)+".</p><p>Distância total: "+esc(distanceText(totalDistance))+". Tempo aproximado: "+esc(durationText(totalDuration))+".</p><button type=\"button\" id=\"ouvir-resumo-percurso\">Narrativa falada do resumo e instruções</button><ol>"+steps.map((s,i)=>"<li>"+esc(s.text+(s.distance>0?" durante "+distanceText(s.distance):""))+". <button type=\"button\" class=\"ouvir-passo\" data-passo=\""+i+"\">Narrativa falada deste passo</button></li>").join("")+"</ol>";
    $("ouvir-resumo-percurso").onclick=()=>speak(state.routeText);
    document.querySelectorAll(".ouvir-passo").forEach(b=>b.onclick=()=>speak(routeStepSentence(steps[Number(b.dataset.passo)],Number(b.dataset.passo))));
    set("estado-percurso","Percurso calculado. Já podes iniciar o guia por voz em tempo real.");
    ["iniciar-guia","estado-guia-falado","recalcular-guia"].forEach(id=>$(id).disabled=false);
    $("resultado-percurso").focus();
  }
  async function calculate({forGuide=false}={}){
    const dest=$("destino").value.trim();if(!dest){set("estado-percurso","Escreve o destino.");speak("Escreve o destino.");return false;}
    set("estado-percurso","A calcular o percurso.");if(!forGuide)$("resultado-percurso").innerHTML="";
    try{
      const [o,d]=await Promise.all([getOrigin(),geocode(dest)]),mode=document.querySelector('input[name="modo"]:checked').value;
      const profile=mode==="auto"?"driving":mode==="bicycle"?"cycling":"walking";
      const url="https://router.project-osrm.org/route/v1/"+profile+"/"+o.lon+","+o.lat+";"+d.lon+","+d.lat+"?overview=full&geometries=geojson&steps=true&alternatives=false";
      const j=await fetchJson(url,{},30000);
      if(j.code!=="Ok"||!j.routes||!j.routes.length)throw new Error("O serviço não encontrou um percurso.");
      const r=j.routes[0],steps=(r.legs||[]).flatMap(l=>l.steps||[]).map(instruction),geometry=(r.geometry&&r.geometry.coordinates||[]).map(c=>({lon:Number(c[0]),lat:Number(c[1])}));
      renderRoute(o,d,r.distance,r.duration,steps,geometry);return true;
    }catch(e){const m="Não consegui calcular: "+e.message;set("estado-percurso",m);speak(m);diag("Percurso: "+e.message);return false;}
  }

  function nearestStepIndex(pos){let best=0,bestD=Infinity;(state.route.steps||[]).forEach((s,i)=>{if(!s.location)return;const d=haversine(pos,s.location);if(d<bestD){bestD=d;best=i;}});return best;}
  function distanceToRoute(pos){let best=Infinity;for(const p of state.route.geometry||[]){const d=haversine(pos,p);if(d<best)best=d;}return best;}
  function setGuideStatus(msg,say=false){state.guideStatus=msg;set("estado-guia",msg);if(say)speak(msg);}
  async function requestWakeLock(){try{if("wakeLock" in navigator)state.wakeLock=await navigator.wakeLock.request("screen");}catch(e){diag("Bloqueio de ecrã indisponível: "+e.message);}}
  function releaseWakeLock(){try{if(state.wakeLock)state.wakeLock.release();}catch(e){}state.wakeLock=null;}
  function announceNext(pos){
    const steps=state.route.steps;if(!steps.length)return;
    const destination=state.route.destination,destDistance=haversine(pos,destination);
    if(destDistance<=Math.max(20,state.position.accuracy||0)){
      setGuideStatus("Chegaste ao destino, "+destination.address+".",true);stopGuide(false);return;
    }
    let next=Math.min(state.guideStep+1,steps.length-1);
    while(next<steps.length-1&&steps[next].location&&haversine(pos,steps[next].location)<12){state.guideStep=next;state.announced.clear();speak(steps[next].text+". Depois segue durante "+distanceText(steps[next].distance)+".");next++;}
    const target=steps[next];if(!target||!target.location)return;
    const d=haversine(pos,target.location),accuracy=state.position.accuracy||0;
    const thresholds=[150,100,50,25,10];
    for(const t of thresholds){const key=next+":"+t;if(d<=t+Math.min(accuracy,15)&&!state.announced.has(key)){state.announced.add(key);speak("Daqui a cerca de "+distanceText(d)+", "+target.text.toLowerCase()+".");break;}}
    const dir=cardinal(state.position.heading);
    setGuideStatus("Guia ativo. Segues para "+dir+". Próxima indicação: "+target.text+" dentro de aproximadamente "+distanceText(d)+". Destino a "+distanceText(destDistance)+". Precisão GPS "+distanceText(accuracy)+".");
    const now=Date.now();
    if(!state.lastProgressPosition)state.lastProgressPosition={...pos};
    const moved=haversine(state.lastProgressPosition,pos);
    if(moved>=30 && now-state.lastProgressSpeech>=14000){
      state.lastProgressPosition={...pos};state.lastProgressSpeech=now;
      speak("Segues para "+dir+". Próxima indicação dentro de cerca de "+distanceText(d)+". Destino a "+distanceText(destDistance)+".",{interrupt:false});
    }
    const off=distanceToRoute(pos),limit=Math.max(35,accuracy*1.6);
    if(off>limit)state.offRouteCount++;else state.offRouteCount=0;
    if(state.offRouteCount>=3){state.offRouteCount=0;const now=Date.now();speak("Parece que saíste do percurso. Vou tentar recalcular a partir da localização atual.");if(now-state.lastReroute>30000){state.lastReroute=now;recalculateFromHere();}}
  }
  async function guidePosition(p){
    if(!acceptPosition(p)){setGuideStatus("Guia ativo, mas esta leitura GPS foi rejeitada por falta de precisão.");return;}
    const pos={lat:state.position.lat,lon:state.position.lon};
    if(Date.now()-state.lastReverseAt>60000){state.lastReverseAt=Date.now();reverse(pos.lat,pos.lon).then(a=>{state.address=a;set("estado-gps","Localização durante o guia: "+a+". Precisão aproximada: "+distanceText(state.position.accuracy)+".");}).catch(()=>{});}
    announceNext(pos);
  }
  function startGuide(){
    if(!state.route){speak("Primeiro calcula um percurso.");return;}
    if(!navigator.geolocation){speak("Este navegador não suporta localização contínua.");return;}
    if(state.guideActive)return;
    if(!state.position||state.position.accuracy>80){speak("Primeiro usa o botão obter localização e espera pela confirmação de GPS seguro.");return;}
    state.guideActive=true;state.announced.clear();state.offRouteCount=0;state.lastProgressPosition=null;state.lastProgressSpeech=0;
    if(state.position)state.guideStep=nearestStepIndex(state.position);else state.guideStep=0;
    $("iniciar-guia").disabled=true;$("parar-guia").disabled=false;$("recalcular-guia").disabled=false;$("estado-guia-falado").disabled=false;
    requestWakeLock();
    setGuideStatus("A iniciar o guia por voz. Mantém o navegador aberto.",true);
    state.guideWatch=navigator.geolocation.watchPosition(guidePosition,e=>{const m=geoError(e);setGuideStatus(m,true);diag("Guia GPS: "+m);},{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
  }
  function stopGuide(say=true){
    if(state.guideWatch!==null)navigator.geolocation.clearWatch(state.guideWatch);
    state.guideWatch=null;state.guideActive=false;releaseWakeLock();
    $("parar-guia").disabled=true;$("iniciar-guia").disabled=!state.route;
    setGuideStatus("Guia em tempo real parado.",say);
  }
  async function recalculateFromHere(){
    if(!state.position){speak("Ainda não tenho localização atual para recalcular.");return;}
    const oldPartida=$("partida").value;$("partida").value="";
    setGuideStatus("A recalcular desde a localização atual.",true);
    const ok=await calculate({forGuide:true});$("partida").value=oldPartida;
    if(ok){state.guideStep=nearestStepIndex(state.position);state.announced.clear();setGuideStatus("Novo percurso calculado. O guia continua ativo.",true);}
  }

  function overpassFilter(q){const n=q.toLowerCase();if(n.includes("farm"))return '[amenity="pharmacy"]';if(n.includes("super")||n.includes("mercado"))return '[shop="supermarket"]';if(n.includes("café")||n.includes("cafe"))return '[amenity="cafe"]';if(n.includes("restaurante"))return '[amenity="restaurant"]';if(n.includes("multibanco")||n.includes("atm"))return '[amenity="atm"]';if(n.includes("hospital"))return '[amenity="hospital"]';if(n.includes("polícia")||n.includes("policia"))return '[amenity="police"]';if(n.includes("autocarro")||n.includes("paragem"))return '[highway="bus_stop"]';if(n.includes("comboio")||n.includes("estação")||n.includes("estacao"))return '[railway="station"]';return '[name~"'+q.replace(/["\\]/g," ")+'",i]';}
  async function searchNearby(){
    const q=$("pesquisa").value.trim();if(!q){set("estado-pesquisa","Escreve o que procuras.");speak("Escreve o que procuras.");return;}if(!state.position){set("estado-pesquisa","Primeiro obtém a localização atual.");speak("Primeiro obtém a localização atual.");return;}
    set("estado-pesquisa","A procurar "+q+" perto de ti.");$("resultado-pesquisa").innerHTML="";
    const f=overpassFilter(q),lat=state.position.lat,lon=state.position.lon,query='[out:json][timeout:25];(node(around:4000,'+lat+','+lon+')'+f+';way(around:4000,'+lat+','+lon+')'+f+';relation(around:4000,'+lat+','+lon+')'+f+';);out center tags 30;';
    try{
      const j=await fetchJson("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(query)},35000);
      const items=(j.elements||[]).map(x=>{const p=x.center||x,t=x.tags||{};if(!p.lat||!p.lon)return null;const name=t.name||t.brand||q,addr=[t["addr:street"],t["addr:housenumber"],t["addr:city"]].filter(Boolean).join(" "),dist=haversine({lat,lon},{lat:Number(p.lat),lon:Number(p.lon)});return{name,addr,dist};}).filter(Boolean).sort((a,b)=>a.dist-b.dist).slice(0,10);
      if(!items.length)throw new Error("Não encontrei resultados num raio de quatro quilómetros.");
      const sentence=(x,i)=>(i+1)+": "+x.name+", a cerca de "+distanceText(x.dist)+(x.addr?", em "+x.addr:"")+".";
      state.searchText="Resultados para "+q+". "+items.map(sentence).join(" ");
      $("resultado-pesquisa").innerHTML=items.map((x,i)=>"<article><h3>"+esc((i+1)+". "+x.name)+"</h3><p>"+esc((x.addr?x.addr+". ":"")+"Distância aproximada: "+distanceText(x.dist)+".")+"</p><button type=\"button\" class=\"ouvir-resultado\" data-resultado=\""+i+"\">Narrativa falada deste resultado</button></article>").join("");
      document.querySelectorAll(".ouvir-resultado").forEach(b=>b.onclick=()=>speak(sentence(items[Number(b.dataset.resultado)],Number(b.dataset.resultado))));
      set("estado-pesquisa",items.length+" resultados encontrados. Podes ouvir todos ou cada resultado separadamente.");$("resultado-pesquisa").focus();
    }catch(e){const m="Não consegui procurar: "+e.message;set("estado-pesquisa",m);speak(m);diag("Pesquisa: "+e.message);}
  }
  function speakField(id,label){const value=$(id).value.trim();speak(label+". "+(value?"Conteúdo: "+value+".":"O campo está vazio."));}

  $("obter-localizacao").onclick=locate;$("ouvir-localizacao").onclick=()=>speak(state.address?"Localização atual: "+state.address:"Ainda não tenho localização.");
  $("guardar-voz").onclick=saveVoiceMode;$("testar-voz").onclick=()=>speak(state.voiceMode==="dispositivo"?"Esta é a voz predefinida do teu dispositivo.":"Esta é a voz escolhida pela aplicação, com prioridade à Raquel.");
  $("repetir-ultima").onclick=()=>speak(state.lastSpeech||"Ainda não existe nenhuma narrativa para repetir.");$("parar-voz").onclick=()=>speechSynthesis.cancel();
  $("calcular").onclick=()=>calculate();$("ouvir-percurso").onclick=()=>speak(state.routeText||"Primeiro calcula o percurso.");
  $("iniciar-guia").onclick=startGuide;$("parar-guia").onclick=()=>stopGuide(true);$("recalcular-guia").onclick=recalculateFromHere;$("estado-guia-falado").onclick=()=>speak(state.guideStatus);
  $("procurar").onclick=searchNearby;$("ouvir-resultados").onclick=()=>speak(state.searchText||"Primeiro faz uma pesquisa.");
  document.querySelectorAll(".ouvir-campo").forEach(b=>b.onclick=()=>speakField(b.dataset.campo,b.dataset.rotulo));
  ["destino","pesquisa"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();id==="destino"?calculate():searchNearby();}}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.guideActive&&!state.wakeLock)requestWakeLock();});
  window.addEventListener("beforeunload",()=>{if(state.guideWatch!==null)navigator.geolocation.clearWatch(state.guideWatch);releaseWakeLock();});
  window.addEventListener("error",e=>diag("JavaScript: "+e.message+" na linha "+e.lineno));
  updateVoiceStatus();
})();
