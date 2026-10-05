"use strict";
(() => {
  const state = {
    position:null, address:"", routeText:"", searchText:"", lastSpeech:"", chosenVoice:"",
    voiceMode:(()=>{try{return localStorage.getItem("lisboaFalanteVoiceMode")||"aplicacao";}catch(e){return "aplicacao";}})(),
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
    if(state.voiceMode==="nenhuma") { if("speechSynthesis" in window) speechSynthesis.cancel(); set("estado-voz","Sem voz da aplicação. O leitor de ecrã continua disponível."); }
    else if(state.voiceMode==="dispositivo") set("estado-voz","Opção atual: voz predefinida do dispositivo.");
    else set("estado-voz",v?"Opção atual: voz da aplicação. Voz encontrada: "+v.name+".":"Opção atual: voz da aplicação. Raquel não está disponível; será usada uma voz portuguesa disponível.");
  }
  function speak(msg,{interrupt=true}={}){
    msg=String(msg||"").trim(); if(!msg)return;
    state.lastSpeech=msg;
    if(state.voiceMode==="nenhuma") return;
    if(!("speechSynthesis" in window)){set("estado-geral","Este navegador não disponibiliza voz.");return;}
    if(interrupt)speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(msg);u.lang="pt-PT";u.rate=0.95;u.pitch=1;u.volume=1;
    if(state.voiceMode==="aplicacao"){const v=applicationVoice();if(v)u.voice=v;}
    u.onerror=e=>{if(!["canceled","interrupted"].includes(e.error))set("estado-voz","A voz não conseguiu narrar. Tenta novamente.");};
    speechSynthesis.speak(u);
  }
  function saveVoiceMode(){
    const selected=document.querySelector('input[name="tipo-voz"]:checked');
    state.voiceMode=selected?selected.value:"aplicacao";
    try { localStorage.setItem("lisboaFalanteVoiceMode",state.voiceMode); } catch(e) {}
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
    const pair=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if(pair){const lat=Number(pair[1]),lon=Number(pair[2]);if(Math.abs(lat)>90||Math.abs(lon)>180)throw new Error("Coordenadas inválidas.");return {lat,lon,address:q};}
    const u="https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=pt&countrycodes=pt&limit=5&q="+encodeURIComponent(q);
    const a=await fetchJson(u);if(!a.length)throw new Error("Não encontrei essa morada ou local.");
    const x=a.find(v=>{const n=(v.display_name||"").toLowerCase();return ["alcochete","almada","amadora","barreiro","cascais","lisboa","loures","mafra","moita","montijo","odivelas","oeiras","palmela","seixal","sesimbra","setúbal","setubal","sintra","vila franca de xira"].some(k=>n.includes(k));})||a[0];
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
    const names=["norte","nordeste","este","sudeste","sul","sudoeste","oeste","noroeste"];
    return names[Math.round(Number(deg)/45)%8];
  }
  function rawPosition(p){return {lat:Number(p.coords.latitude),lon:Number(p.coords.longitude),accuracy:Number.isFinite(p.coords.accuracy)?Math.ceil(p.coords.accuracy):9999,heading:p.coords.heading,speed:p.coords.speed,timestamp:Number(p.timestamp)||Date.now()};}
  function acceptPosition(p,{calibration=false}={}){
    const next=rawPosition(p);
    if(!Number.isFinite(next.lat)||!Number.isFinite(next.lon)||!Number.isFinite(next.accuracy)||next.accuracy<0||next.accuracy>120||Date.now()-next.timestamp>15000){state.rejectedFixes++;diag("Leitura GPS rejeitada. Precisão: "+next.accuracy+" metros.");return false;}
    const prev=state.lastGoodPosition;
    if(prev){
      const dt=Math.max(1,(next.timestamp-prev.timestamp)/1000),jump=haversine(prev,next),possible=Math.max(80,dt*12+prev.accuracy+next.accuracy);
      if(jump>possible && jump>250){state.rejectedFixes++;diag("Salto GPS rejeitado: "+Math.round(jump)+" metros.");return false;}
      if((next.heading===null||Number.isNaN(Number(next.heading)))&&jump>Math.max(15,prev.accuracy+next.accuracy))next.heading=bearing(prev,next);
    }
    if(!calibration && next.accuracy>80)return false;
    state.lastGoodPosition=next;state.position=next;return true;
  }
  function locate(){
    if(!navigator.geolocation){set("estado-gps","Este navegador não suporta localização.");return;}
    if(!window.isSecureContext){const m="O GPS preciso exige uma ligação HTTPS segura. Abre o endereço oficial começado por https.";set("estado-gps",m);speak(m);return;}
    if(state.calibrationWatch!==null)navigator.geolocation.clearWatch(state.calibrationWatch);
    state.position=null; state.lastGoodPosition=null; state.address="";
    set("estado-gps","A procurar localização com a melhor precisão disponível. No computador pode faltar GPS. No telemóvel, mantém o ecrã ativo e aguarda pela margem de erro.");
    speak("A procurar localização com a melhor precisão disponível. Vou mostrar a margem de erro comunicada pelo dispositivo.");
    let best=null,finished=false,lastSpokenBand="";
    const attempt=++locationAttempt;
    const finish=async()=>{
      if(finished||attempt!==locationAttempt)return;finished=true;
      if(state.calibrationWatch!==null)navigator.geolocation.clearWatch(state.calibrationWatch);state.calibrationWatch=null;
      if(!best||best.coords.accuracy>60){
        const got=best?distanceText(best.coords.accuracy):"nenhuma leitura";
        const m="Localização precisa não obtida. A melhor leitura foi "+got+". Essa posição não será usada. No PC podes escrever a partida. Um computador sem GPS pode não conseguir maior precisão. No iPhone ativa Localização exata para o navegador. No Android ativa Usar localização precisa. Depois volta ao exterior e tenta novamente.";
        set("estado-gps",m);speak(m);diag(m);return;
      }
      if(!acceptPosition(best,{calibration:true})){const m="A melhor leitura ainda não passou na validação de segurança. Tenta novamente no exterior.";set("estado-gps",m);speak(m);return;}
      const confirmed={...state.position};let address;
      try{address=await reverse(confirmed.lat,confirmed.lon);}catch(e){address="coordenadas "+confirmed.lat.toFixed(5)+", "+confirmed.lon.toFixed(5);}
      if(attempt!==locationAttempt)return;state.address=address;
      const dir=cardinal(state.position.heading),msg="Localização obtida: "+state.address+". Precisão aproximada: "+distanceText(state.position.accuracy)+". Direção de deslocação: "+dir+". A orientação do corpo não foi confirmada.";
      set("estado-gps",msg);speak(msg);
    };
    state.calibrationWatch=navigator.geolocation.watchPosition(p=>{
      if(finished||attempt!==locationAttempt||Date.now()-p.timestamp>15000)return;
      const a=Number(p.coords.accuracy); if(!Number.isFinite(a)||a<0)return;
      if(!best||Date.now()-best.timestamp>15000||a<best.coords.accuracy)best=p;
      let status;
      if(a>1000)status="Recebi uma localização com erro de cerca de "+distanceText(a)+". Continuo à espera de uma leitura mais precisa.";
      else if(a>200)status="A localização ainda é demasiado imprecisa: "+distanceText(a)+". Continuo à espera.";
      else if(a>60)status="O GPS está a melhorar. Precisão atual: "+distanceText(a)+". Ainda não será usada.";
      else status="GPS utilizável encontrado, com precisão aproximada de "+distanceText(a)+".";
      set("estado-gps",status+" Melhor leitura: "+distanceText(best.coords.accuracy)+".");
      const band=a>1000?"rede":a>200?"fraca":a>60?"melhorar":"boa";
      if(band!==lastSpokenBand){lastSpokenBand=band;speak(status,{interrupt:false});}
      if(best.coords.accuracy<=25)finish();
    },e=>{if(finished||attempt!==locationAttempt)return;finished=true;if(state.calibrationWatch!==null)navigator.geolocation.clearWatch(state.calibrationWatch);state.calibrationWatch=null;const m=geoError(e);set("estado-gps",m);speak(m);diag(m);},{enableHighAccuracy:true,timeout:95000,maximumAge:0});
    setTimeout(finish,90000);
  }
  async function getOrigin(){
    const q=$("partida").value.trim();if(q)return await geocode(q);
    if(!state.position||Date.now()-state.position.timestamp>120000)throw new Error("Obtém uma localização recente ou escreve uma partida.");
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
    if(state.route.mode==="transit"){state.routeText+=" A distância do troço de autocarro é estimada entre paragens. O tempo é uma estimativa sem espera, não um horário oficial.";$("resultado-percurso").insertAdjacentHTML("afterbegin","<p>Transportes: a distância entre paragens e o tempo são estimados, sem incluir espera. Não são horários oficiais. Confirma a variante no veículo.</p>");}
    $("ouvir-resumo-percurso").onclick=()=>speak(state.routeText);
    document.querySelectorAll(".ouvir-passo").forEach(b=>b.onclick=()=>speak(routeStepSentence(steps[Number(b.dataset.passo)],Number(b.dataset.passo))));
    set("estado-percurso","Percurso calculado. Confirma as instruções antes de iniciar o guia. Acessibilidade de passeios e atravessamentos por confirmar.");
    ["iniciar-guia","estado-guia-falado","recalcular-guia"].forEach(id=>$(id).disabled=false);
    $("resultado-percurso").focus();
  }
  async function calculate({forGuide=false}={}){
    const dest=$("destino").value.trim();if(!dest){set("estado-percurso","Escreve o destino.");speak("Escreve o destino.");return false;}
    set("estado-percurso","A calcular o percurso.");if(!forGuide)$("resultado-percurso").innerHTML="";
    try{
      const [o,d]=await Promise.all([getOrigin(),geocode(dest)]),mode=document.querySelector('input[name="modo"]:checked').value;
      const result=await routing(o,d,mode);
      const {totalDistance,totalDuration,steps,geometry}=result;
      renderRoute(o,d,totalDistance,totalDuration,steps,geometry);return true;
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
      setGuideStatus("Estás próximo do destino; confirma a entrada no local, "+destination.address+".",true);stopGuide(false);return;
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
    if(!acceptPosition(p)||state.position.accuracy>25){setGuideStatus("Guia ativo, mas esta leitura GPS foi rejeitada por falta de precisão.");return;}
    const pos={lat:state.position.lat,lon:state.position.lon};
    if(Date.now()-state.lastReverseAt>60000){state.lastReverseAt=Date.now();reverse(pos.lat,pos.lon).then(a=>{state.address=a;set("estado-gps","Localização durante o guia: "+a+". Precisão aproximada: "+distanceText(state.position.accuracy)+".");}).catch(()=>{});}
    announceNext(pos);
  }
  function startGuide(){
    if(!state.route){speak("Primeiro calcula um percurso.");return;}
    if(!navigator.geolocation){speak("Este navegador não suporta localização contínua.");return;}
    if(state.route.mode==="transit"){setGuideStatus("Usa a lista de paragens da Carris. O guia GPS não acompanha o interior de um autocarro.",true);return;}
    if(state.guideActive)return;
    if(!state.position||state.position.accuracy>25||Date.now()-state.position.timestamp>15000){setGuideStatus("Primeiro usa o botão obter localização e espera por uma leitura recente com margem de erro até 25 metros.",true);return;}
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

  function searchCategory(q){
    const n=q.toLowerCase();
    if(n.includes("ciclovia"))return "cycle";
    if(n.includes("instituiç"))return "public";
    if(n.includes("apoio social"))return "social";
    if(n.includes("cruz vermelha"))return "redcross";
    if(n.includes("passadeira"))return "crossings";
    if(n.includes("obra"))return "works";
    if(n.includes("farm"))return "pharmacy";
    if(n.includes("centro de saúde")||n.includes("centros de saúde")||n.includes("hospital")||n.includes("urgência")||n.includes("urgencia")||n.includes("saúde")||n.includes("saude"))return "health";
    if(n.includes("tasca")||n.includes("restaurante")||n.includes("café")||n.includes("cafe")||n.includes("bar")||n.includes("ementa"))return "food";
    if(n.includes("comida rápida")||n.includes("comida rapida")||n.includes("fast food")||n.includes("mcdonald")||n.includes("burger"))return "fastfood";
    if(n.includes("super")||n.includes("mercado")||n.includes("mercearia"))return "shops";
    if(n.includes("hotel")||n.includes("pensão")||n.includes("pensao")||n.includes("residencial")||n.includes("alojamento"))return "lodging";
    if(n.includes("táxi")||n.includes("taxi"))return "taxi";
    if(n.includes("polícia")||n.includes("policia"))return "police";
    if(n.includes("bombeiro"))return "fire";
    if(n.includes("casa de banho")||n.includes("sanitário")||n.includes("sanitario"))return "toilets";
    if(n.includes("autocarro")||n.includes("paragem"))return "bus";
    if(n.includes("comboio")||n.includes("estação")||n.includes("estacao"))return "rail";
    return "name";
  }
  function overpassFilter(q){
    const c=searchCategory(q);
    if(c==="cycle")return '[highway="cycleway"]';
    if(c==="public")return '[office="government"]';
    if(c==="social")return '[amenity="social_facility"]';
    if(c==="redcross")return '[name~"Cruz Vermelha|Red Cross",i]';
    if(c==="crossings")return '[highway="crossing"]';
    if(c==="works")return '[highway="construction"]';
    if(c==="pharmacy")return '[amenity="pharmacy"]';
    if(c==="health")return '[amenity~"hospital|clinic|doctors|health_post"]';
    if(c==="food")return '[amenity~"restaurant|cafe|bar|pub"]';
    if(c==="fastfood")return '[amenity="fast_food"]';
    if(c==="shops")return '[shop~"supermarket|convenience|grocery"]';
    if(c==="lodging")return '[tourism~"hotel|hostel|guest_house|motel|apartment"]';
    if(c==="taxi")return '[amenity="taxi"]';
    if(c==="police")return '[amenity="police"]';
    if(c==="fire")return '[amenity="fire_station"]';
    if(c==="toilets")return '[amenity="toilets"]';
    if(c==="bus")return '[highway="bus_stop"]';
    if(c==="rail")return '[railway="station"]';
    return '[name~"'+q.replace(/["\\]/g," ")+'",i]';
  }
  function radiusFor(category){
    if(category==="crossings")return 1500;
    if(category==="health")return 15000;
    if(category==="food"||category==="fastfood")return 7000;
    return 6000;
  }
  function safeUrl(value){
    const s=String(value||"").trim();
    return /^https?:\/\//i.test(s)?s:"";
  }
  function municipalFallback(category){
    if(category==="food")return [{
      name:"A Carruagem",addr:"Rua Afonso de Albuquerque, 14, 2625-102 Póvoa de Santa Iria",lat:38.86016612067767,lon:-9.063007235527039,
      phone:"963 479 335",website:"https://www.cm-vfxira.pt/saber-lazer/informacao-turistica/gastronomia-e-encostas-de-xira/onde-comer/poi/a-carruagem",menu:"",hours:"Encerra ao domingo",cuisine:"cozinha tradicional portuguesa",source:"Município de Vila Franca de Xira"
    }];
    return [];
  }
  async function healthFallback(){
    const records=[
      {name:"Unidade de Saúde de Vila Franca de Xira",addr:"Rua António Lúcio Batista, 6, 2600-102 Vila Franca de Xira",phone:"263 279 674",source:"Município de Vila Franca de Xira"},
      {name:"Unidade de Cuidados de Saúde Personalizados Castanheira do Ribatejo",addr:"Rua Dr. José Azeredo Perdigão, 2600-645 Castanheira do Ribatejo",phone:"263 286 100",source:"Município de Vila Franca de Xira"},
      {name:"Hospital de Vila Franca de Xira",addr:"Estrada Carlos Lima Costa, 2, 2600-009 Vila Franca de Xira",phone:"263 006 500",source:"Município de Vila Franca de Xira"}
    ];
    const out=[];
    for(const r of records){
      try{const g=await geocode(r.addr);out.push({...r,lat:g.lat,lon:g.lon,website:"",menu:"",hours:"",cuisine:""});}catch(e){}
    }
    return out;
  }
  function uniquePlaces(items){
    const seen=new Set();
    return items.filter(x=>{
      const key=(x.name+"|"+x.lat.toFixed(4)+"|"+x.lon.toFixed(4)).toLowerCase();
      if(seen.has(key))return false;seen.add(key);return true;
    });
  }
  async function searchNearby(){
    const q=$("pesquisa").value.trim();if(!q){set("estado-pesquisa","Escreve o que procuras.");speak("Escreve o que procuras.");return;}if(!state.position||Date.now()-state.position.timestamp>120000){set("estado-pesquisa","Primeiro obtém a localização atual.");speak("Primeiro obtém a localização atual.");return;}
    set("estado-pesquisa","A procurar "+q+" perto de ti, em várias categorias de dados.");$("resultado-pesquisa").innerHTML="";
    const category=searchCategory(q),f=overpassFilter(q),lat=state.position.lat,lon=state.position.lon,radius=radiusFor(category);
    let selectors=[];
    if(category==="health")selectors=['[amenity~"hospital|clinic|doctors|health_post"]','[healthcare~"hospital|clinic|doctor|centre|health_post"]'];
    else selectors=[f];
    const parts=[];
    for(const sel of selectors){parts.push('node(around:'+radius+','+lat+','+lon+')'+sel+';','way(around:'+radius+','+lat+','+lon+')'+sel+';','relation(around:'+radius+','+lat+','+lon+')'+sel+';');}
    const query='[out:json][timeout:35];('+parts.join('')+');out center tags 100;';
    try{
      let elements=[];
      try{
        const j=await fetchJson("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(query)},45000);
        elements=j.elements||[];
      }catch(primaryError){
        const j=await fetchJson("https://overpass.kumi.systems/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(query)},45000);
        elements=j.elements||[];
      }
      let items=elements.map(x=>{const p=x.center||x,t=x.tags||{};if(!p.lat||!p.lon)return null;const generic=category==="crossings"?"Passadeira":category==="works"?"Via assinalada em obras":q;const name=t.name||t.brand||t.operator||generic,addr=[t["addr:street"],t["addr:housenumber"],t["addr:postcode"],t["addr:city"]].filter(Boolean).join(" "),dist=haversine({lat,lon},{lat:Number(p.lat),lon:Number(p.lon)}),dir=cardinal(bearing({lat,lon},{lat:Number(p.lat),lon:Number(p.lon)})),phone=t.phone||t["contact:phone"]||"",website=safeUrl(t.website||t["contact:website"]),menu=safeUrl(t["website:menu"]||t.menu||t["contact:menu"]),hours=t.opening_hours||"",cuisine=(t.cuisine||"").replace(/;/g,", "),source="OpenStreetMap";return{name,addr,dist,dir,phone,lat:Number(p.lat),lon:Number(p.lon),website,menu,hours,cuisine,source};}).filter(Boolean);
      let extra=municipalFallback(category);
      if(category==="health")extra=extra.concat(await healthFallback());
      for(const x of extra){x.dist=haversine({lat,lon},x);x.dir=cardinal(bearing({lat,lon},x));}
      items=uniquePlaces(items.concat(extra)).filter(x=>x.dist<=radius*1.4);
      items.sort((a,b)=>{
        if(category==="food"){
          const pa=(a.menu?0:a.website?1:2),pb=(b.menu?0:b.website?1:2);if(pa!==pb)return pa-pb;
        }
        return a.dist-b.dist;
      });
      items=items.slice(0,20);
      if(!items.length)throw new Error("Não encontrei registos num raio de "+distanceText(radius)+". Isto pode significar falta de dados públicos, não ausência real do serviço.");
      const sentence=(x,i)=>(i+1)+": "+x.name+", a cerca de "+distanceText(x.dist)+", na direção "+x.dir+(x.addr?", em "+x.addr:"")+(x.cuisine?". Tipo de comida: "+x.cuisine:"")+(x.hours?". Horário publicado: "+x.hours:"")+(x.menu?". Tem ligação para ementa online":"")+(x.phone?". Telefone "+x.phone:"")+". Fonte: "+x.source+". Contactos e acessibilidade por confirmar na fonte.";
      state.searchText="Resultados para "+q+". "+items.map(sentence).join(" ");
      $("resultado-pesquisa").innerHTML=items.map((x,i)=>"<article><h3>"+esc((i+1)+". "+x.name)+"</h3><p>"+esc((x.addr?x.addr+". ":"")+"Distância aproximada: "+distanceText(x.dist)+". Direção: "+x.dir+"."+(x.cuisine?" Tipo de comida: "+x.cuisine+".":"")+(x.hours?" Horário publicado: "+x.hours+".":"")+" Fonte: "+x.source+". Contactos e acessibilidade por confirmar na fonte.")+"</p>"+(x.phone?"<a class=\"telefone-resultado\" href=\"tel:"+esc(x.phone.replace(/[^+\d]/g,""))+"\">Ligar para "+esc(x.phone)+"</a>":"")+(x.menu?"<a class=\"telefone-resultado\" target=\"_blank\" rel=\"noopener\" href=\""+esc(x.menu)+"\">Abrir ementa online</a>":"")+(x.website?"<a class=\"telefone-resultado\" target=\"_blank\" rel=\"noopener\" href=\""+esc(x.website)+"\">Abrir página oficial</a>":"")+"<button type=\"button\" class=\"ouvir-resultado\" data-resultado=\""+i+"\">Narrativa falada deste resultado</button><button type=\"button\" class=\"ir-resultado\" data-resultado=\""+i+"\">Usar como destino</button></article>").join("");
      document.querySelectorAll(".ouvir-resultado").forEach(b=>b.onclick=()=>speak(sentence(items[Number(b.dataset.resultado)],Number(b.dataset.resultado))));
      document.querySelectorAll(".ir-resultado").forEach(b=>b.onclick=()=>{const x=items[Number(b.dataset.resultado)];$("destino").value=x.lat+","+x.lon;speak(x.name+" ficou definido como destino. Vou calcular o percurso.");calculate();});
      set("estado-pesquisa",items.length+" resultados encontrados. Resultados com ementa online aparecem primeiro quando essa informação existe.");$("resultado-pesquisa").focus();
    }catch(e){const m="Não consegui procurar: "+e.message;set("estado-pesquisa",m);speak(m);diag("Pesquisa: "+e.message);}
  }
  function speakField(id,label){const value=$(id).value.trim();speak(label+". "+(value?"Conteúdo: "+value+".":"O campo está vazio."));}

  $("obter-localizacao").onclick=locate;$("ouvir-localizacao").onclick=()=>speak($("estado-gps").textContent+" "+$("estado-bussola").textContent);
  $("guardar-voz").onclick=saveVoiceMode;$("testar-voz").onclick=()=>speak(state.voiceMode==="dispositivo"?"Esta é a voz predefinida do teu dispositivo.":"Esta é a voz escolhida pela aplicação, com prioridade à Raquel.");
  $("repetir-ultima").onclick=()=>speak(state.lastSpeech||"Ainda não existe nenhuma narrativa para repetir.");$("parar-voz").onclick=()=>{if("speechSynthesis" in window)speechSynthesis.cancel();};
  $("calcular").onclick=()=>calculate();$("ouvir-percurso").onclick=()=>speak(state.routeText||"Primeiro calcula o percurso.");
  $("iniciar-guia").onclick=startGuide;$("parar-guia").onclick=()=>stopGuide(true);$("recalcular-guia").onclick=recalculateFromHere;$("estado-guia-falado").onclick=()=>speak(state.guideStatus);
  $("procurar").onclick=searchNearby;$("ouvir-resultados").onclick=()=>speak(state.searchText||"Primeiro faz uma pesquisa.");
  document.querySelectorAll(".ouvir-campo").forEach(b=>b.onclick=()=>speakField(b.dataset.campo,b.dataset.rotulo));
  ["destino","pesquisa"].forEach(id=>$(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();id==="destino"?calculate():searchNearby();}}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.guideActive&&!state.wakeLock)requestWakeLock();});
  window.addEventListener("beforeunload",()=>{if(state.guideWatch!==null)navigator.geolocation.clearWatch(state.guideWatch);releaseWakeLock();});
  window.addEventListener("error",e=>diag("JavaScript: "+e.message+" na linha "+e.lineno));
  document.querySelectorAll(".pesquisa-rapida").forEach(b=>b.onclick=()=>{$("pesquisa").value=b.dataset.query;searchNearby();});
  const ouvirTelefones=$("ouvir-telefones");if(ouvirTelefones)ouvirTelefones.onclick=()=>speak("Telefones úteis. Emergência, 112. SNS 24, 808 24 24 24. Centro de Informação Antivenenos, 800 250 250. Cruz Vermelha Portuguesa, 213 913 900.");
  updateVoiceStatus();
  let locationAttempt=0, compassListening=false, compassHeading=null, compassAt=0;
  let carrisIndex=null,carrisStops=null,carrisPatterns=[],carrisTrip=null,carrisCursor=0;
  let demoSteps=[],demoCursor=0,googlePromise=null;
  const contacts=[
    {name:"Carris — atendimento",phone:"213 613 000",url:"https://www.carris.pt/atendimento/falar-connosco/"},
    {name:"Sapadores Bombeiros — NISAC, apoio ao cidadão",phone:"800 913 913",url:"https://informacao.lisboa.pt/reportagens/servicos/rsb-nisac"},
    {name:"SOS Lisboa — teleassistência",phone:"800 204 204",url:"https://informacao.lisboa.pt/reportagens/servicos/rsb-nisac"}
  ];
  $("contactos-adicionais").innerHTML=contacts.map(c=>`<p><a href="tel:${c.phone.replace(/\s/g,"")}">Ligar ${esc(c.name)} — ${esc(c.phone)}</a>. <a href="${c.url}">Fonte oficial do contacto</a>.</p>`).join("")+`<p><a href="https://65mais.lisboa.pt/">Programa Lisboa 65+: apoios a pessoas idosas</a></p><p><a href="https://www.cruzvermelha.pt/contactos-cvp/">Contactos oficiais da Cruz Vermelha</a>. <a href="https://www.gov.pt/guias/contactos-de-emergencia-em-portugal">Contactos oficiais de emergência</a>.</p>`;
  $("ouvir-telefones").onclick=()=>speak($("telefones").innerText);
  $("ativar-bussola").onclick=async()=>{
    try{
      if(!window.DeviceOrientationEvent)throw new Error("Este dispositivo não disponibiliza bússola. No PC podes não ter este sensor.");
      if(typeof DeviceOrientationEvent.requestPermission==="function" && await DeviceOrientationEvent.requestPermission()!=="granted")throw new Error("Permissão da bússola recusada.");
      if(!compassListening){
        const handler=e=>{
          const h=Number.isFinite(e.webkitCompassHeading)?e.webkitCompassHeading:(e.absolute && Number.isFinite(e.alpha)?(360-e.alpha)%360:null);
          if(h===null || (Number.isFinite(e.webkitCompassAccuracy)&&(e.webkitCompassAccuracy<0||e.webkitCompassAccuracy>30)))return;
          compassHeading=h;compassAt=Date.now();set("estado-bussola","Topo do dispositivo orientado aproximadamente para "+cardinal(h)+". Mantém o telemóvel plano, com o topo na direção que queres verificar. Isto não confirma a orientação do corpo.");
        };
        window.addEventListener("deviceorientationabsolute",handler);window.addEventListener("deviceorientation",handler);compassListening=true;
      }
      set("estado-bussola","A aguardar uma leitura absoluta da bússola. Se não houver sensor, a orientação permanece desconhecida.");
      setTimeout(()=>{if(!compassAt||Date.now()-compassAt>5000)set("estado-bussola","Não recebi uma orientação fiável. Não sei se estás virado para norte, sul, este ou oeste.");},5000);
    }catch(e){set("estado-bussola",e.message);}
  };
  $("partilhar-posicao").onclick=()=>{
    if(!state.position){set("pedido-ajuda","Obtém a localização primeiro ou indica uma morada a quem te ajuda.");return;}
    const p=state.position, age=Math.round((Date.now()-p.timestamp)/1000);
    const text="Preciso de ajuda para me orientar. Última localização: "+(state.address||"morada desconhecida")+". Coordenadas "+p.lat.toFixed(6)+", "+p.lon.toFixed(6)+". Margem de erro "+p.accuracy+" metros. Leitura obtida há "+age+" segundos. "+(age>120?"A localização está desatualizada.":"");
    $("pedido-ajuda").innerHTML=`<p>${esc(text)}</p><label for="texto-ajuda">Texto para copiar e enviar a uma pessoa da tua escolha</label><textarea id="texto-ajuda" rows="6" readonly>${esc(text)}</textarea><p>Nenhuma mensagem foi enviada.</p>`;$("pedido-ajuda").focus();
  };
  function googleMaps(){
    if(window.google?.maps?.DirectionsService)return Promise.resolve(window.google.maps);
    const key=window.LISBOA_FALANTE_CONFIG?.GOOGLE_MAPS_API_KEY;
    if(!key||key.includes("COLOCA"))return Promise.reject(new Error("O serviço Google Maps não está configurado nesta instalação."));
    if(googlePromise)return googlePromise;
    googlePromise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("O Google Maps não respondeu.")),20000);
      window.lisboaMapsReady=()=>{clearTimeout(timer);resolve(google.maps);};
      const script=document.createElement("script");script.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(key)+"&language=pt-PT&callback=lisboaMapsReady";
      script.onerror=()=>{clearTimeout(timer);googlePromise=null;reject(new Error("Não foi possível carregar o serviço de percursos."));};document.head.append(script);
    });return googlePromise;
  }
  async function routing(o,d,mode){
    const hasKey=window.LISBOA_FALANTE_CONFIG?.GOOGLE_MAPS_API_KEY && !window.LISBOA_FALANTE_CONFIG.GOOGLE_MAPS_API_KEY.includes("COLOCA");
    if(mode==="transit"&&!hasKey)return directCarrisRoute(o,d);
    if(hasKey){
      const maps=await googleMaps(), travel={auto:"DRIVING",taxi:"DRIVING",pedestrian:"WALKING",wheelchair:"WALKING",bicycle:"BICYCLING",transit:"TRANSIT"}[mode];
      const response=await new maps.DirectionsService().route({origin:{lat:o.lat,lng:o.lon},destination:{lat:d.lat,lng:d.lon},travelMode:maps.TravelMode[travel],language:"pt-PT",...(mode==="transit"?{transitOptions:{departureTime:new Date()}}:{})});
      const leg=response.routes[0].legs[0], steps=[];
      const plain=html=>{const node=document.createElement("div");node.innerHTML=html||"";return node.textContent||"";};
      for(const step of leg.steps){
        let text=plain(step.instructions);
        if(step.transit){const t=step.transit;text+=". "+(t.line.short_name||t.line.name||"Transporte")+", sentido "+(t.headsign||"a confirmar")+". Entrada: "+t.departure_stop.name+". Saída: "+t.arrival_stop.name+". "+t.num_stops+" paragens. Para a ordem das paragens Carris, consulta a secção Carris e confirma a variante.";}
        steps.push({text,distance:step.distance?.value||0,location:{lat:step.start_location.lat(),lon:step.start_location.lng()}});
      }
      if(mode==="wheelchair")steps.unshift({text:"Percurso pedonal. Não há garantia de ausência de escadas, inclinações excessivas ou passeios sem rebaixamento. Confirma a acessibilidade antes da partida",distance:0,location:null});
      if(mode==="bicycle")steps.unshift({text:"O percurso de bicicleta pode incluir vias partilhadas com trânsito. Consulta as ciclovias na partida e chegada; não se garante ciclovia contínua",distance:0,location:null});
      return {totalDistance:leg.distance.value,totalDuration:leg.duration.value,steps,geometry:response.routes[0].overview_path.map(p=>({lat:p.lat(),lon:p.lng()}))};
    }
    const costing=["auto","taxi"].includes(mode)?"auto":mode==="bicycle"?"bicycle":"pedestrian";
    const request={locations:[{lat:o.lat,lon:o.lon},{lat:d.lat,lon:d.lon}],costing,directions_options:{language:"pt-PT",units:"kilometers"},shape_format:"geojson"};
    if(mode==="wheelchair")request.costing_options={pedestrian:{wheelchair:true}};
    const j=await fetchJson("https://valhalla1.openstreetmap.de/route?json="+encodeURIComponent(JSON.stringify(request)),{},30000);
    if(!j.trip?.legs?.length)throw new Error("O serviço não encontrou um percurso para este modo.");
    const geometry=[],steps=[];
    for(const leg of j.trip.legs){
      const coordinates=leg.shape.coordinates;
      geometry.push(...coordinates.map(c=>({lon:c[0],lat:c[1]})));
      for(const m of leg.maneuvers){const c=coordinates[m.begin_shape_index];steps.push({text:m.instruction.replace(/em direção à o passeio/g,"em direção ao passeio"),distance:m.length*1000,location:c?{lon:c[0],lat:c[1]}:null});}
    }
    if(mode==="wheelchair")steps.unshift({text:"Percurso calculado com preferência para cadeira de rodas. Inclinações, obstáculos e rebaixamentos dependem dos dados disponíveis e precisam de confirmação",distance:0,location:null});
    if(mode==="bicycle")steps.unshift({text:"Pode incluir vias partilhadas com trânsito. Não se garante ciclovia contínua",distance:0,location:null});
    return {totalDistance:j.trip.summary.length*1000,totalDuration:j.trip.summary.time,steps,geometry};
  }

  async function directCarrisRoute(o,d){
    await loadCarris();
    const starts=new Map(carrisStops.map(s=>[s.id,haversine(o,s)]).filter(([,distance])=>distance<=700));
    const ends=new Map(carrisStops.map(s=>[s.id,haversine(d,s)]).filter(([,distance])=>distance<=700));
    const startLines=new Set(carrisStops.filter(s=>starts.has(s.id)).flatMap(s=>s.lines));
    const lines=[...new Set(carrisStops.filter(s=>ends.has(s.id)).flatMap(s=>s.lines))].filter(l=>startLines.has(l));
    if(!lines.length)throw new Error("Não encontrei uma ligação Carris direta com paragens até 700 metros da partida e chegada. Ligações com transbordos precisam de um serviço de planeamento configurado. Consulta a Carris.");
    const byId=new Map(carrisStops.map(s=>[s.id,s]));let best=null;
    for(const line of lines){
      const patterns=await fetchJson("data/carris/"+encodeURIComponent(line)+".json");
      for(const p of patterns.filter(p=>p.services.some(serviceActive))){
        for(let a=0;a<p.stops.length-1;a++){
          if(!starts.has(p.stops[a]))continue;
          let length=0;
          for(let b=a+1;b<p.stops.length;b++){
            length+=haversine(byId.get(p.stops[b-1]),byId.get(p.stops[b]));
            if(!ends.has(p.stops[b]))continue;
            const score=starts.get(p.stops[a])*3+ends.get(p.stops[b])*3+length;
            if(!best||score<best.score)best={line,p,a,b,score,length};
          }
        }
      }
    }
    if(!best)throw new Error("Não encontrei uma variante direta no sentido necessário para hoje. Consulta a Carris para transbordos.");
    const board=byId.get(best.p.stops[best.a]),exit=byId.get(best.p.stops[best.b]);
    const access=await routing(o,{...board,address:board.name},"pedestrian");
    const finish=await routing({...exit,address:exit.name},d,"pedestrian");
    const stops=best.p.stops.slice(best.a,best.b+1).map(id=>byId.get(id));
    const steps=[{text:"Ligação direta prevista da Carris "+best.line+", sentido "+best.p.headsign+". Sem horário de partida ou previsão de chegada. Confirma a variante e acessibilidade com a Carris",distance:0,location:null},...access.steps,{text:"Entra na carreira "+best.line+" na paragem "+board.name+". Confirma o sentido "+best.p.headsign+" no veículo",distance:0,location:board},...stops.slice(1).map((stop,i)=>({text:"Paragem "+(i+2)+" do troço de autocarro: "+stop.name+(i===stops.length-2?". Sai nesta paragem":". Permanece no autocarro"),distance:0,location:stop})),...finish.steps];
    return {totalDistance:access.totalDistance+finish.totalDistance+best.length,totalDuration:access.totalDuration+finish.totalDuration+best.length/4,steps,geometry:[...access.geometry,...stops,...finish.geometry]};
  }
  const areaFilters=[
    ["Passadeiras",'[highway="crossing"]'],["Passeios e caminhos pedonais",'[highway="footway"]'],["Ciclovias",'[highway="cycleway"]'],["Praças de táxis",'[amenity="taxi"]'],["Paragens de autocarro",'[highway="bus_stop"]'],["Hospitais e centros de saúde",'[amenity~"hospital|clinic|doctors|health_post"]'],["Serviços de saúde registados",'[healthcare~"hospital|clinic|doctor|centre|health_post"]'],["Bombeiros",'[amenity="fire_station"]'],["Polícia",'[amenity="police"]'],["Instituições públicas",'[office="government"]'],["Apoio social",'[amenity="social_facility"]'],["Cruz Vermelha",'[name~"Cruz Vermelha|Red Cross",i]']
  ];
  async function environment(which){
    const button=$("envolvente-"+which);button.disabled=true;
    set("estado-envolvente","A consultar serviços na área da "+which+".");$("resultado-envolvente").textContent="";
    try{
      const point=which==="partida"?await getOrigin():state.route?.destination||await geocode($("destino").value.trim()||(()=>{throw new Error("Escreve um destino primeiro.");})());
      const query='[out:json][timeout:30];('+areaFilters.map(([,f])=>`nwr(around:700,${point.lat},${point.lon})${f};`).join('')+');out center tags;';
      const result=await fetchJson("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"data="+encodeURIComponent(query)},40000);
      const category=t=>t.highway==="crossing"?"Passadeira":t.highway==="cycleway"?"Ciclovia":t.highway==="footway"?"Passeio ou caminho pedonal":t.highway==="bus_stop"?"Paragem de autocarro":t.amenity==="taxi"?"Praça de táxis":t.amenity==="fire_station"?"Bombeiros":t.amenity==="police"?"Polícia":t.office==="government"?"Instituição pública":t.amenity==="social_facility"?"Apoio social":"Saúde ou apoio comunitário";
      const items=(result.elements||[]).map(e=>{const p=e.center||e,t=e.tags||{};return {p,t,dist:haversine(point,p),kind:category(t)};}).filter(x=>Number.isFinite(x.dist)).sort((a,b)=>a.dist-b.dist);
      const groups=new Map();for(const item of items){if(!groups.has(item.kind))groups.set(item.kind,[]);if(groups.get(item.kind).length<8)groups.get(item.kind).push(item);}
      const link=(phone)=>{const number=(phone||"").split(";")[0].replace(/[^+\d]/g,"");return number.length>=3?` <a href="tel:${number}">Ligar ${esc(phone)} — contacto do registo, por confirmar</a>`:"";};
      $("resultado-envolvente").innerHTML=`<h3>Área da ${which}: ${esc(point.address)}</h3><p>Fonte: OpenStreetMap. Consultado em ${esc(new Date().toLocaleString("pt-PT"))}. Distâncias em linha reta; direção em relação ao ponto de referência, sem indicação de esquerda ou direita do corpo.</p>`+(items.length?[...groups].map(([name,list])=>`<h4>${esc(name)}</h4><ul>`+list.map(({p,t,dist})=>`<li>${esc(t.name||name)}: ${esc(distanceText(dist))} para ${esc(cardinal(bearing(point,p)))}. Acesso em cadeira de rodas: ${esc(({yes:"assinalado como acessível",no:"assinalado como não acessível",limited:"limitado"})[t.wheelchair]||"não informado")}. ${t.highway==="crossing"?"Sinal sonoro: "+esc(t["traffic_signals:sound"]||"não informado")+". Rebaixamento: "+esc(t.kerb||"não informado")+". ":""}${link(t.phone||t["contact:phone"])} <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}">Consultar registo geográfico</a></li>`).join('')+'</ul>').join(''):'<p>Não foram encontrados registos. A ausência de dados não comprova a ausência de serviços.</p>')+`<p>A posição real de uma passadeira, o lado do passeio e a possibilidade de atravessar exigem confirmação no local.</p><button id="ouvir-envolvente">Ouvir serviços desta área</button>`;
      $("ouvir-envolvente").onclick=()=>speak($("resultado-envolvente").innerText);set("estado-envolvente",items.length+" registos encontrados.");$("resultado-envolvente").focus();
    }catch(e){set("estado-envolvente","Não foi possível consultar: "+e.message);}finally{button.disabled=false;}
  }
  $("envolvente-partida").onclick=()=>environment("partida");$("envolvente-chegada").onclick=()=>environment("chegada");
  async function loadCarris(){
    if(!carrisIndex)carrisIndex=await fetchJson("data/carris/index.json");
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()).replaceAll("-","");
    if(today<carrisIndex.feedStart||today>carrisIndex.feedEnd)throw new Error("Os dados Carris estão fora do período de validade. Confirma os percursos no site oficial; é necessária uma atualização dos dados.");
    if(!carrisStops)carrisStops=await fetchJson("data/carris/stops.json");
    return carrisIndex;
  }
  function carrisSource(){return "Fonte: GTFS Carris, versão "+carrisIndex.version+". Descarregado em "+new Date(carrisIndex.downloadedAt).toLocaleString("pt-PT")+". Sem previsões em tempo real.";}
  $("carris-proximas").onclick=async()=>{
    set("estado-carris","A consultar paragens Carris.");
    try{
      await loadCarris();const point=await getOrigin();
      const nearest=carrisStops.map(s=>({...s,dist:haversine(point,s)})).filter(s=>s.dist<=1200).sort((a,b)=>a.dist-b.dist).slice(0,12);
      $("resultado-carris").innerHTML=`<h3>Paragens próximas de ${esc(point.address)}</h3><p>${esc(carrisSource())}</p>`+(nearest.length?'<ol>'+nearest.map(s=>`<li>${esc(s.name)}, código ${esc(s.code)}. ${esc(distanceText(s.dist))} em linha reta para ${esc(cardinal(bearing(point,s)))}. Carreiras: ${esc(s.lines.join(', '))}. Acessibilidade: ${esc(({1:"assinalada como acessível",2:"não acessível"})[s.wheelchair]||"não informada")}. <button class="selecionar-carris" data-line="${esc(s.lines[0]||'')}">Consultar primeira carreira desta paragem</button></li>`).join('')+'</ol>':'<p>Não encontrei paragens Carris até 1200 metros. Isto não exclui outros operadores.</p>');
      document.querySelectorAll(".selecionar-carris").forEach(b=>b.onclick=()=>{$("carreira-carris").value=b.dataset.line;loadLine();});set("estado-carris",nearest.length+" paragens encontradas.");$("resultado-carris").focus();
    }catch(e){set("estado-carris",e.message);}
  };
  function serviceActive(id){
    const now=new Date(),date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon",year:"numeric",month:"2-digit",day:"2-digit"}).format(now).replaceAll("-","");
    const exception=carrisIndex.exceptions.find(e=>e.service_id===id&&e.date===date);if(exception)return exception.exception_type==="1";
    const weekday=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Lisbon",weekday:"long"}).format(now).toLowerCase();
    return carrisIndex.calendars.some(c=>c.service_id===id&&c.start_date<=date&&c.end_date>=date&&c[weekday]==="1");
  }
  async function loadLine(){
    $("carris-anterior").disabled=true;$("carris-seguinte").disabled=true;carrisTrip=null;carrisPatterns=[];$("sentido-carris").innerHTML='<option value="">Escolhe primeiro uma carreira</option>';$("embarque-carris").innerHTML='<option value="">Escolhe primeiro o sentido</option>';
    set("estado-carris","A consultar a carreira.");
    try{
      await loadCarris();const line=$("carreira-carris").value.trim().toUpperCase();if(!carrisIndex.lines.includes(line))throw new Error("Carreira não encontrada nos dados Carris. Confirma o número e o operador.");
      carrisPatterns=(await fetchJson("data/carris/"+encodeURIComponent(line)+".json")).filter(p=>p.services.some(serviceActive));
      if(!carrisPatterns.length)throw new Error("Não há variantes com serviço previsto para hoje nos dados disponíveis.");
      $("sentido-carris").innerHTML=carrisPatterns.map((p,i)=>`<option value="${i}">${esc(p.routeName)}; destino ${esc(p.headsign)}; variante ${i+1}; ${p.stops.length} paragens</option>`).join('');selectPattern();set("estado-carris",carrisSource()+" Confirma qual a variante indicada no autocarro.");
    }catch(e){set("estado-carris",e.message);}
  }
  function selectPattern(){const p=carrisPatterns[Number($("sentido-carris").value)];if(!p)return;const byId=new Map(carrisStops.map(s=>[s.id,s]));$("embarque-carris").innerHTML=p.stops.map((id,i)=>`<option value="${i}">${i+1}. ${esc(byId.get(id)?.name||id)}</option>`).join('');carrisTrip=null;$("carris-anterior").disabled=true;$("carris-seguinte").disabled=true;}
  $("carregar-carreira").onclick=loadLine;$("sentido-carris").onchange=selectPattern;$("embarque-carris").onchange=()=>{carrisTrip=null;$("carris-anterior").disabled=true;$("carris-seguinte").disabled=true;};
  $("mostrar-paragens").onclick=()=>{
    const p=carrisPatterns[Number($("sentido-carris").value)];if(!p){set("estado-carris","Escolhe uma carreira e sentido primeiro.");return;}
    const byId=new Map(carrisStops.map(s=>[s.id,s]));carrisTrip=p.stops.slice(Number($("embarque-carris").value)).map(id=>byId.get(id));carrisCursor=0;
    $("resultado-carris").innerHTML=`<h3>Paragens pela ordem da variante escolhida</h3><p>${esc(carrisSource())}</p><p>Avança manualmente depois de confirmar a paragem no veículo. A aplicação não deteta automaticamente a paragem nem sabe em que autocarro entraste.</p><ol>`+carrisTrip.map(s=>`<li>${esc(s.name)}. Código ${esc(s.code)}.</li>`).join('')+'</ol><button id="ouvir-lista-carris">Ouvir todas as paragens</button>';
    $("ouvir-lista-carris").onclick=()=>speak(carrisTrip.map((s,i)=>(i+1)+". "+s.name).join('. '));showCarrisStop();$("resultado-carris").focus();
  };
  function showCarrisStop(){if(!carrisTrip)return;const s=carrisTrip[carrisCursor],next=carrisTrip[carrisCursor+1];const msg="Paragem "+(carrisCursor+1)+" de "+carrisTrip.length+": "+s.name+". "+(next?"Próxima: "+next.name+".":"Última paragem da variante. Confirma a saída.");set("estado-carris",msg);speak(msg);$("carris-anterior").disabled=carrisCursor===0;$("carris-seguinte").disabled=carrisCursor===carrisTrip.length-1;}
  $("carris-anterior").onclick=()=>{if(carrisTrip&&carrisCursor>0){carrisCursor--;showCarrisStop();}};$("carris-seguinte").onclick=()=>{if(carrisTrip&&carrisCursor<carrisTrip.length-1){carrisCursor++;showCarrisStop();}};
  const demoCommon=[
    ["Partida e orientação","Estás na entrada fictícia do Centro de Apoio da Rua da Amizade. Na simulação, a margem de erro é de 8 metros e o topo do telemóvel aponta para norte. Na utilização real, o PC pode não ter GPS nem bússola. A voz da aplicação pode ser desligada na secção Voz."],
    ["Serviços na partida","Na simulação: passeio com 1,8 metros de largura; passadeira a 35 metros a norte; paragem de autocarro a 80 metros; praça de táxis a 120 metros a este. Junta de freguesia a 160 metros; centro de saúde a 240; farmácia a 90; bombeiros a 400; apoio a pessoas idosas a 170; Cruz Vermelha a 550 metros. Todos estes locais e distâncias são inventados."],
    ["Preparar a saída","Confirma a entrada do passeio. Mantém a bengala ou cão-guia e verifica obstáculos. A demonstração descreve um passeio livre, mas a aplicação real não consegue detetar buracos, obras inesperadas ou pessoas à tua frente."]
  ];
  const demoModes={
    pedestrian:[["Primeiro passeio","Segue 35 metros para norte pelo passeio fictício. A passadeira fica no fim deste troço. Não há ordens automáticas para atravessar."],["Passadeira","Na simulação há rebaixamento e sinal sonoro. Confirma presencialmente a autorização para atravessar e o trânsito. A aplicação não sabe o estado real do semáforo."],["Segundo passeio","Depois de atravessar, segue 180 metros para este. Na simulação há um banco aos 60 metros e um acesso à biblioteca aos 140. Vira para sul e segue 90 metros até ao destino."]],
    wheelchair:[["Passeio e rebaixamento","Na simulação, o passeio tem 1,8 metros e uma rampa suave. Segue 35 metros para norte. No percurso real a largura, inclinação e rebaixamento precisam de confirmação."],["Atravessamento","A passadeira fictícia tem rebaixamento dos dois lados. Confirma o trânsito antes de atravessar. Segue depois 180 metros para este e 90 para sul. O destino fictício dispõe de entrada sem degraus."]],
    transit:[["Chegar à paragem","Segue 35 metros para norte até à passadeira fictícia. Depois de confirmares e atravessares, segue 45 metros até à Paragem da Amizade. Este nome é inventado."],["Embarque","Entra no autocarro fictício D1, sentido Biblioteca do Bairro. Confirma número, destino e rampa com o motorista. D1 não é uma carreira real da Carris."],["Paragem 1: Amizade","Entrada na Amizade. Próxima paragem fictícia: Mercado."],["Paragem 2: Mercado","Segunda paragem da simulação. Próxima: Jardim. Permanece no autocarro."],["Paragem 3: Jardim","Terceira paragem. Próxima: Centro de Saúde."],["Paragem 4: Centro de Saúde","Quarta paragem. Próxima: Biblioteca. Prepara a saída sem te levantares se não for seguro."],["Paragem 5: Biblioteca","Última paragem desta simulação. Confirma a paragem e sai. Segue 40 metros pelo passeio fictício para sul até à entrada acessível. Na utilização real consulta a sequência da carreira na secção Carris."]],
    taxi:[["Praça de táxis","Praça fictícia a 120 metros a este. Percorre o passeio e confirma qualquer atravessamento. Se precisares de táxi adaptado, confirma disponibilidade com o operador antes da viagem."],["Viagem de táxi","Indica Biblioteca do Bairro, entrada acessível na Rua do Jardim, ambas fictícias. Na simulação o percurso rodoviário segue 600 metros para norte, vira para este durante 800 e termina 200 metros a sul."],["Desembarque","Pede para sair junto ao passeio da entrada, evitando uma saída para a faixa de rodagem. Na simulação faltam 15 metros até à porta."]],
    auto:[["Entrada no automóvel","Confirma o ponto de recolha com o condutor. Este modo pode ser usado por um passageiro cego. A simulação parte da Rua da Amizade."],["Percurso rodoviário","O condutor segue 600 metros para norte, vira à direita para este por 800 metros e novamente à direita para sul durante 200. Não são instruções para condução real."],["Estacionamento e saída","Na simulação há estacionamento reservado a 25 metros da porta e um percurso sem degraus. Confirma elegibilidade e lugares disponíveis no local."]],
    bicycle:[["Acesso à ciclovia","Na simulação há ciclovia a 70 metros a este. Confirma o acesso e as condições de circulação."],["Ciclovia","Segue 500 metros para norte pela ciclovia fictícia, passa um cruzamento depois de confirmares a sinalização e segue 200 metros para este. Não se garante continuidade das ciclovias num percurso real."],["Chegada de bicicleta","Estacionamento fictício de bicicletas a 30 metros da entrada. Termina a circulação e percorre a pé o acesso à biblioteca."]]
  };
  const demoEnd=[
    ["Serviços na chegada","Na simulação, a Biblioteca do Bairro tem entrada acessível. Há passadeira a 40 metros a norte, paragem a 40, táxis a 100 a oeste, hospital a 900 a este, centro de saúde a 230, bombeiros a 450, Cruz Vermelha a 500 e instituição pública a 150. A entidade fictícia de apoio a pessoas idosas fica a 200 metros. Não são dados reais."],
    ["Se te perderes","Pára num local seguro. Consulta Localização e a margem de erro, prepara o texto para pedir ajuda e consulta serviços próximos. As coordenadas não garantem o lado da rua. Na emergência real liga 112; para orientação de saúde, SNS 24: 808 24 24 24. Os contactos reais estão na secção Telefones úteis."],
    ["Chamadas e ligação à Internet","A opção Ligar abre o serviço telefónico do dispositivo. A aplicação não realiza chamadas por dados móveis. As pesquisas usam Wi-Fi ou dados móveis conforme as definições do dispositivo. Nenhuma chamada é feita nesta demonstração."],
    ["Demonstração terminada","Chegaste ao fim do exemplo fictício. Os dados reais da Carris e a consulta geográfica estão nas secções próprias. A simulação não alterou a tua partida, destino, localização nem o guia real."]
  ];
  function showDemo(){if(!demoSteps.length)return;const [title,text]=demoSteps[demoCursor];set("estado-demo","Demonstração fictícia. Passo "+(demoCursor+1)+" de "+demoSteps.length+".");$("resultado-demo").innerHTML=`<h3>${esc(title)}</h3><p>${esc(text)}</p>`;$("demo-anterior").disabled=demoCursor===0;$("demo-seguinte").disabled=demoCursor===demoSteps.length-1;speak("Demonstração fictícia. "+title+". "+text);}
  $("iniciar-demo").onclick=()=>{demoSteps=[...demoCommon,...demoModes[$("modo-demo").value],...demoEnd];demoCursor=0;showDemo();$("resultado-demo").focus();};
  $("demo-anterior").onclick=()=>{if(demoCursor>0){demoCursor--;showDemo();}};$("demo-seguinte").onclick=()=>{if(demoCursor<demoSteps.length-1){demoCursor++;showDemo();}};
  $("ouvir-demo").onclick=()=>speak(demoSteps.length?demoSteps[demoCursor].join('. '):"Inicia a demonstração primeiro.");
  $("terminar-demo").onclick=()=>{demoSteps=[];$("resultado-demo").textContent="";set("estado-demo","Demonstração terminada.");$("demo-anterior").disabled=true;$("demo-seguinte").disabled=true;if("speechSynthesis" in window)speechSynthesis.cancel();};

})();
