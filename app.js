"use strict";
(() => {
  const S = {gps:null,manual:null,voice:false,voiceName:"Raquel",lastSpeech:"",watch:null,pendingPhone:"",texts:{},routeText:"",mapsReady:false,geocoder:null,directions:null,places:null};
  const MUNICIPIOS = ["alenquer","amadora","arruda dos vinhos","azambuja","cadaval","cascais","lisboa","loures","lourinha","mafra","odivelas","oeiras","sintra","sobral de monte agraco","torres vedras","vila franca de xira"];
  const CATS = {
    commerce:{title:"Comércio próximo",types:["store","supermarket","pharmacy","restaurant"]},
    transport:{title:"Transportes próximos",types:["transit_station","bus_station","train_station","subway_station","taxi_stand"]},
    public:{title:"Utilidades públicas próximas",types:["local_government_office","city_hall","post_office","courthouse","library"]},
    leisure:{title:"Lazer e cultura próximos",types:["museum","park","tourist_attraction","movie_theater","library"]},
    emergency:{title:"Hospitais, polícia e bombeiros próximos",types:["hospital","police","fire_station"]}
  };
  const boxes={commerce:"resultado-comercio",transport:"resultado-transportes",public:"resultado-utilidades",leisure:"resultado-lazer",emergency:"resultado-emergencia"};
  const $=id=>document.getElementById(id);
  const text=(id,v)=>{const e=$(id);if(e)e.textContent=String(v)};
  const val=id=>(($(id)||{}).value||"").trim();
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const stripHtml=s=>{const d=document.createElement("div");d.innerHTML=String(s||"");return (d.textContent||"").replace(/\s+/g," ").trim()};
  const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const safety=()=>" Segue com cuidado e usa corretamente a bengala.";
  const origin=()=>S.manual||S.gps;

  function voices(){return "speechSynthesis" in window?speechSynthesis.getVoices():[]}
  function chosen(){const w=S.voiceName.toLowerCase();return voices().find(v=>v.name.toLowerCase().includes(w)&&/^pt/i.test(v.lang))||voices().find(v=>/^pt-PT/i.test(v.lang))||voices().find(v=>/^pt/i.test(v.lang))||null}
  function speak(m,force=false){m=String(m||"").trim();if(!m)return;S.lastSpeech=m;if((!S.voice&&!force)||!("speechSynthesis" in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(m);u.lang="pt-PT";u.rate=1;u.volume=1;const v=chosen();if(v)u.voice=v;speechSynthesis.speak(u)}
  function sayStatus(m,id){if(id)text(id,m);speak(m)}
  function bind(id,fn){const e=$(id);if(e)e.addEventListener("click",fn)}
  function distritoLisboa(result){const comps=result.address_components||[];for(const c of comps){const n=norm(c.long_name);if(n==="lisboa"||n==="distrito de lisboa"||MUNICIPIOS.includes(n))return true}const f=norm(result.formatted_address);return f.includes("distrito de lisboa")||MUNICIPIOS.some(m=>f.includes(m))}
  function requireMaps(){if(!S.mapsReady)throw new Error("O serviço de mapas ainda não está pronto.")}

  function loadMaps(){
    const key=((window.LISBOA_FALANTE_CONFIG||{}).GOOGLE_MAPS_API_KEY||"").trim();
    if(!key||key.includes("COLOCA_A_CHAVE")){
      text("estado-servidor","Falta configurar a chave Google Maps no ficheiro config.js.");
      text("diagnostico","Configuração incompleta: GOOGLE_MAPS_API_KEY.");
      return;
    }
    window.iniciarLisboaFalante=()=>{
      S.geocoder=new google.maps.Geocoder();
      S.directions=new google.maps.DirectionsService();
      S.places=new google.maps.places.PlacesService($("mapa-servicos"));
      S.mapsReady=true;
      text("estado-servidor","Aplicação pronta. Podes usar GPS ou escrever a partida manualmente.");
    };
    const sc=document.createElement("script");
    sc.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(key)+"&libraries=places&language=pt-PT&region=PT&callback=iniciarLisboaFalante";
    sc.async=true;sc.defer=true;
    sc.onerror=()=>text("estado-servidor","Não foi possível carregar o serviço Google Maps. Confirma a chave e as restrições do domínio.");
    document.head.appendChild(sc);
  }

  function geocodeAddress(address){return new Promise((resolve,reject)=>{try{requireMaps();S.geocoder.geocode({address,componentRestrictions:{country:"PT"},region:"PT"},(results,status)=>{if(status!=="OK"||!results||!results.length)return reject(new Error("Não consegui localizar essa morada."));const r=results[0];if(!distritoLisboa(r))return reject(new Error("A morada fica fora do distrito de Lisboa."));resolve({lat:r.geometry.location.lat(),lng:r.geometry.location.lng(),address:r.formatted_address,query:address})})}catch(e){reject(e)}})}
  function reverseGeocode(lat,lng){return new Promise((resolve,reject)=>{try{requireMaps();S.geocoder.geocode({location:{lat,lng}},(results,status)=>{if(status!=="OK"||!results||!results.length)return reject(new Error("Recebi o GPS, mas não consegui identificar a rua."));const r=results[0];resolve({address:r.formatted_address,distrito:distritoLisboa(r)})})}catch(e){reject(e)}})}
  function geoError(e){return e&&e.code===1?"A localização foi recusada ou bloqueada. Usa a partida manual.":"Não foi possível obter a localização. Usa a partida manual."}
  async function updatePos(p){const c={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:Math.round(p.coords.accuracy||0)};S.gps=c;try{const r=await reverseGeocode(c.lat,c.lng);Object.assign(S.gps,r);text("estado-gps","Localização atual: "+r.address+". Precisão aproximada: "+c.accuracy+" metros."+(r.distrito?"":" A localização parece estar fora do distrito de Lisboa."))}catch(e){text("estado-gps","GPS ativo, mas não consegui obter o nome da rua: "+e.message)}}
  function startGps(){if(S.watch!==null)return;if(!("geolocation" in navigator)){text("estado-gps","Este navegador não tem geolocalização. Usa a partida manual.");return}text("estado-gps","A iniciar GPS contínuo.");S.watch=navigator.geolocation.watchPosition(updatePos,e=>text("estado-gps",geoError(e)),{enableHighAccuracy:true,timeout:30000,maximumAge:5000});$("localizar").disabled=true;$("parar-gps").disabled=false}
  function stopGps(){if(S.watch!==null)navigator.geolocation.clearWatch(S.watch);S.watch=null;$("localizar").disabled=false;$("parar-gps").disabled=true;text("estado-gps","GPS desligado.")}
  async function manual(){const a=val("origem-manual");if(!a){text("estado-origem","Escreve a morada completa.");return}text("estado-origem","A confirmar a partida.");try{S.manual=await geocodeAddress(a);sayStatus("Partida confirmada: "+S.manual.address+".","estado-origem")}catch(e){text("estado-origem",e.message)}}

  function distanceMeters(a,b){const R=6371000,toRad=x=>x*Math.PI/180;const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;return Math.round(2*R*Math.asin(Math.sqrt(q)))}
  function distanceSpoken(m){return m<1000?m+" metros":(m/1000).toFixed(m<10000?1:0).replace(".",",")+" quilómetros"}
  function nearbyOne(location,type){return new Promise(resolve=>S.places.nearbySearch({location,radius:3000,type},(r,status)=>resolve(status===google.maps.places.PlacesServiceStatus.OK?(r||[]):[])))}
  function details(placeId){return new Promise(resolve=>S.places.getDetails({placeId,fields:["name","formatted_phone_number","international_phone_number","formatted_address","vicinity","geometry"]},(r,status)=>resolve(status===google.maps.places.PlacesServiceStatus.OK?r:null)))}
  async function nearby(cat){const o=origin(),box=$(boxes[cat]);if(!o){text(boxes[cat],"Primeiro inicia o GPS ou confirma uma partida manual.");return}if(!S.mapsReady){text(boxes[cat],"O serviço de mapas ainda não está pronto.");return}box.innerHTML="<p>A procurar.</p>";try{const cfg=CATS[cat];const sets=await Promise.all(cfg.types.map(t=>nearbyOne({lat:o.lat,lng:o.lng},t)));const map=new Map();sets.flat().forEach(p=>{if(p.place_id&&!map.has(p.place_id))map.set(p.place_id,p)});let ps=[...map.values()].map(p=>({raw:p,distance:distanceMeters(o,{lat:p.geometry.location.lat(),lng:p.geometry.location.lng()})})).sort((a,b)=>a.distance-b.distance).slice(0,8);const enriched=[];for(const p of ps){const d=await details(p.raw.place_id);enriched.push({name:(d&&d.name)||p.raw.name||"Local sem nome",address:(d&&(d.formatted_address||d.vicinity))||p.raw.vicinity||"Morada não indicada",phone:(d&&(d.international_phone_number||d.formatted_phone_number))||"",distance:p.distance})}let html="<h3>"+esc(cfg.title)+"</h3>",narr=cfg.title+". ";if(!enriched.length){html+="<p>Não foram encontrados locais num raio aproximado de três quilómetros.</p>";narr+="Não foram encontrados locais."}else enriched.forEach((p,i)=>{const frase=(i+1)+". "+p.name+", "+p.address+", a cerca de "+distanceSpoken(p.distance)+". ";narr+=frase;html+="<article><h3>"+esc((i+1)+". "+p.name)+"</h3><p>"+esc(p.address+". Distância aproximada: "+distanceSpoken(p.distance)+".")+"</p>"+(p.phone?'<button class="call" data-name="'+esc(p.name)+'" data-phone="'+esc(p.phone)+'">Ligar para '+esc(p.name)+"</button>":"<p>Telefone não disponível.</p>")+"</article>"});S.texts[cat]=narr+safety();box.innerHTML=html;box.querySelectorAll(".call").forEach(b=>b.onclick=()=>askCall(b.dataset.name,b.dataset.phone));box.focus()}catch(e){box.innerHTML='<p class="erro">'+esc(e.message)+"</p>";S.texts[cat]="Não consegui fazer esta pesquisa. "+e.message}}
  function narrate(cat){speak(S.texts[cat]||"Primeiro faz a pesquisa desta categoria.",true)}

  function routeRequest(req){return new Promise((resolve,reject)=>S.directions.route(req,(r,status)=>status==="OK"?resolve(r):reject(new Error("Não consegui calcular o percurso. Estado: "+status))))}
  async function route(){const o=origin(),d=val("destino");if(!o){text("estado-percurso","Primeiro inicia o GPS ou confirma uma partida manual.");return}if(!d){text("estado-percurso","Escreve o destino.");return}if(!S.mapsReady){text("estado-percurso","O serviço de mapas ainda não está pronto.");return}text("estado-percurso","A calcular o percurso.");try{const mode=(document.querySelector('input[name="modo"]:checked')||{}).value||"WALKING";const r=await routeRequest({origin:{lat:o.lat,lng:o.lng},destination:d,travelMode:google.maps.TravelMode[mode],provideRouteAlternatives:true,region:"PT"});const routes=(r.routes||[]).slice(0,3);if(!routes.length)throw new Error("Não foi encontrado percurso.");const destination=(routes[0].legs[0]||{}).end_address||d;let html="<h3>Destino</h3><p>"+esc(destination)+"</p>";let narr="Percurso desde "+(o.address||"o ponto de partida")+" até "+destination+". ";routes.forEach((x,i)=>{const leg=x.legs[0];html+="<article><h3>"+(i===0?"Percurso principal":"Alternativa "+(i+1))+"</h3><p>Tempo: "+esc(leg.duration.text)+". Distância: "+esc(leg.distance.text)+".</p><ol>";if(i===0)narr+="Tempo estimado: "+leg.duration.text+". Distância: "+leg.distance.text+". ";(leg.steps||[]).forEach((s,j)=>{let instruction=stripHtml(s.instructions);if(s.transit&&s.transit.line){instruction+=". Linha "+(s.transit.line.short_name||s.transit.line.name||"")}html+="<li>"+esc(instruction)+"</li>";if(i===0)narr+="Passo "+(j+1)+": "+instruction+". "});html+="</ol></article>"});S.routeText=narr+safety();$("resultado").innerHTML=html;$("resultado").focus();text("estado-percurso","Percurso calculado. Usa o botão Narrativa completa do percurso para ouvir todas as instruções.")}catch(e){$("resultado").innerHTML='<p class="erro">'+esc(e.message)+"</p>";text("estado-percurso","Não consegui calcular: "+e.message);S.routeText="Não consegui calcular o percurso. "+e.message}}

  function askCall(name,phone){S.pendingPhone=String(phone||"").replace(/[^+\d]/g,"");text("chamada-texto","Queres ligar para "+name+"?");const d=$("confirmar-chamada");d.showModal?d.showModal():d.setAttribute("open","")}
  function closeDialog(){const d=$("confirmar-chamada");d.close?d.close():d.removeAttribute("open")}

  bind("testar-voz",()=>{S.voiceName=val("voz-escolhida")||"Raquel";speak("Esta é a voz da aplicação Lisboa Falante.",true)});
  bind("usar-voz",()=>{S.voice=true;$("usar-voz").disabled=true;$("desligar-voz").disabled=false;sayStatus("Voz da aplicação ativada.","estado-voz")});
  bind("desligar-voz",()=>{S.voice=false;speechSynthesis.cancel();$("usar-voz").disabled=false;$("desligar-voz").disabled=true;text("estado-voz","Voz desligada.")});
  bind("localizar",startGps);bind("parar-gps",stopGps);
  bind("dizer-localizacao",()=>{const o=origin();speak(o?"Está em "+(o.address||"localização atual")+"."+safety():"Ainda não tenho localização. Usa o GPS ou confirma a partida manual.",true)});
  bind("confirmar-origem",manual);bind("usar-gps",()=>{S.manual=null;text("estado-origem","O GPS voltou a ter prioridade.")});
  bind("comercio",()=>nearby("commerce"));bind("transportes",()=>nearby("transport"));bind("utilidades",()=>nearby("public"));bind("lazer",()=>nearby("leisure"));bind("emergencia",()=>nearby("emergency"));
  bind("narrar-comercio",()=>narrate("commerce"));bind("narrar-transportes",()=>narrate("transport"));bind("narrar-utilidades",()=>narrate("public"));bind("narrar-lazer",()=>narrate("leisure"));bind("narrar-emergencia",()=>narrate("emergency"));
  bind("procurar",route);bind("narrar-percurso",()=>speak(S.routeText||"Primeiro calcula o percurso.",true));bind("repetir",()=>speak(S.lastSpeech||"Ainda não existe narrativa.",true));bind("parar-voz",()=>speechSynthesis.cancel());
  bind("ligar-112",()=>askCall("o cento e doze","112"));bind("sim-ligar",()=>{const p=S.pendingPhone;closeDialog();if(p)location.href="tel:"+p});bind("nao-ligar",closeDialog);
  window.addEventListener("error",e=>{text("estado-servidor","Erro interno: "+e.message);text("diagnostico","JavaScript: "+e.message+" linha "+e.lineno)});
  loadMaps();
})();
