from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
SECRET_CANDIDATES = [
    BASE_DIR / "segredos" / "lisboa_falante.env",
    BASE_DIR / "lisboa_falante.env",
    BASE_DIR.parent / "lisboa_falante.env",
]

MUNICIPIOS_DISTRITO_LISBOA = {
    "alenquer", "amadora", "arruda dos vinhos", "azambuja", "cadaval",
    "cascais", "lisboa", "loures", "lourinha", "mafra", "odivelas",
    "oeiras", "sintra", "sobral de monte agraco", "torres vedras",
    "vila franca de xira",
}

app = Flask(__name__)


def carregar_env() -> None:
    for path in SECRET_CANDIDATES:
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
        break


carregar_env()


def api_key() -> str:
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "A chave não foi encontrada. Copia lisboa_falante.env para a pasta segredos."
        )
    return key


def google_json(url: str, *, method: str = "GET", payload: Optional[dict] = None, headers: Optional[dict] = None) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req_headers = {"Content-Type": "application/json; charset=utf-8"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=body, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"A Google respondeu com erro {exc.code}: {detail[:500]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("Não foi possível contactar a Google. Confirma a ligação à Internet.") from exc


def normalizar(texto: str) -> str:
    table = str.maketrans("áàãâéêíóôõúç", "aaaaeeiooouc")
    return texto.casefold().translate(table).strip()


def encontrar_municipio(result: dict) -> str:
    """Reconhece qualquer morada pertencente ao distrito de Lisboa.

    A Google nem sempre devolve o município no mesmo nível administrativo.
    Em localidades como Póvoa de Santa Iria pode devolver primeiro a freguesia,
    o município Vila Franca de Xira ou simplesmente o distrito Lisboa.
    """
    components = result.get("address_components", [])
    distrito_aliases = {"lisboa", "distrito de lisboa", "lisbon", "lisbon district"}

    # Primeiro confirma diretamente o distrito, em qualquer nível administrativo.
    for comp in components:
        tipos = set(comp.get("types", []))
        if tipos.intersection({
            "administrative_area_level_1", "administrative_area_level_2",
            "administrative_area_level_3"
        }):
            nomes = {normalizar(comp.get("long_name", "")), normalizar(comp.get("short_name", ""))}
            if nomes.intersection(distrito_aliases):
                return "Distrito de Lisboa"

    # Depois reconhece qualquer um dos dezasseis municípios do distrito.
    for comp in components:
        nome = normalizar(comp.get("long_name", ""))
        if nome in MUNICIPIOS_DISTRITO_LISBOA:
            return comp.get("long_name", "")

    # Última defesa: procura no endereço completo devolvido pela Google.
    address = normalizar(result.get("formatted_address", ""))
    if any(alias in address for alias in distrito_aliases):
        return "Distrito de Lisboa"
    for municipio in MUNICIPIOS_DISTRITO_LISBOA:
        if municipio in address:
            return municipio.title()
    return ""


def geocodificar(endereco: str) -> dict:
    query = urllib.parse.urlencode({
        "address": endereco,
        "region": "pt",
        "language": "pt-PT",
        "components": "country:PT",
        "key": api_key(),
    })
    data = google_json("https://maps.googleapis.com/maps/api/geocode/json?" + query)
    if data.get("status") != "OK" or not data.get("results"):
        raise RuntimeError("Não consegui localizar esse destino.")
    results = data["results"]
    postal = re.search(r"\b\d{4}-\d{3}\b", endereco)
    porta = re.search(r"(?:\bn(?:úmero|umero|\.|º|°)?\s*|,\s*|\s)(\d{1,5})(?:\s*(?:,|$))", endereco, re.I)
    def score_result(item: dict) -> int:
        formatted = normalizar(item.get("formatted_address", ""))
        score = 0
        if postal and postal.group(0) in item.get("formatted_address", ""): score += 200
        if porta:
            wanted = porta.group(1)
            comps = item.get("address_components", [])
            nums = [c.get("long_name", "") for c in comps if "street_number" in c.get("types", [])]
            if wanted in nums: score += 120
        for token in re.findall(r"[A-Za-zÀ-ÿ]{4,}", endereco):
            if normalizar(token) in formatted: score += 2
        if "ROOFTOP" == (item.get("geometry", {}).get("location_type") or ""): score += 20
        return score
    result = max(results, key=score_result)
    if porta:
        wanted = porta.group(1)
        nums = [c.get("long_name", "") for c in result.get("address_components", []) if "street_number" in c.get("types", [])]
        if wanted not in nums:
            raise RuntimeError(
                f"Não encontrei com segurança o número {wanted}. Não vou substituir por outro número. "
                "Escreve rua, número, código postal e localidade completos."
            )
    location = result["geometry"]["location"]
    municipio = encontrar_municipio(result)
    return {
        "lat": location["lat"],
        "lng": location["lng"],
        "address": result.get("formatted_address", endereco),
        "municipio": municipio,
        "distrito_lisboa": bool(municipio),
    }


def reverse_geocode(lat: float, lng: float) -> dict:
    query = urllib.parse.urlencode({
        "latlng": f"{lat},{lng}",
        "language": "pt-PT",
        "result_type": "street_address|route|premise|subpremise|point_of_interest",
        "key": api_key(),
    })
    data = google_json("https://maps.googleapis.com/maps/api/geocode/json?" + query)
    if data.get("status") != "OK" or not data.get("results"):
        raise RuntimeError("Recebi a localização, mas não consegui obter o nome da rua.")
    result = data["results"][0]
    municipio = encontrar_municipio(result)
    return {
        "address": result.get("formatted_address", "Localização atual"),
        "municipio": municipio,
        "distrito_lisboa": bool(municipio),
    }


def numero_por_extenso(n: int) -> str:
    n = int(n)
    unidades = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"]
    especiais = {10:"dez",11:"onze",12:"doze",13:"treze",14:"catorze",15:"quinze",16:"dezasseis",17:"dezassete",18:"dezoito",19:"dezanove"}
    dezenas = {20:"vinte",30:"trinta",40:"quarenta",50:"cinquenta",60:"sessenta",70:"setenta",80:"oitenta",90:"noventa"}
    centenas = {100:"cem",200:"duzentos",300:"trezentos",400:"quatrocentos",500:"quinhentos",600:"seiscentos",700:"setecentos",800:"oitocentos",900:"novecentos"}
    if n < 0: return "menos " + numero_por_extenso(-n)
    if n < 10: return unidades[n]
    if n < 20: return especiais[n]
    if n < 100:
        d, r = divmod(n, 10)
        return dezenas[d*10] + (" e " + unidades[r] if r else "")
    if n < 1000:
        c, r = divmod(n, 100)
        base = centenas[c*100]
        return base + (" e " + numero_por_extenso(r) if r else "")
    if n < 1000000:
        m, r = divmod(n, 1000)
        base = "mil" if m == 1 else numero_por_extenso(m) + " mil"
        lig = " e " if r and r < 100 else " "
        return base + (lig + numero_por_extenso(r) if r else "")
    return str(n)


def expandir_abreviaturas(texto: str) -> str:
    """Expande abreviaturas e números para uma leitura clara em português."""
    regras = [
        (r"\bAv\.(?=\s|$)", "Avenida"), (r"\bR\.(?=\s|$)", "Rua"),
        (r"\bPç\.(?=\s|$)", "Praça"), (r"\bLg\.(?=\s|$)", "Largo"),
        (r"\bTv\.(?=\s|$)", "Travessa"), (r"\bEstr\.(?=\s|$)", "Estrada"),
        (r"\bRot\.(?=\s|$)", "Rotunda"), (r"\bAl\.(?=\s|$)", "Alameda"),
        (r"\bDr\.(?=\s|$)", "Doutor"), (r"\bDra\.(?=\s|$)", "Doutora"),
        (r"\bEng\.(?=\s|$)", "Engenheiro"), (r"\bProf\.(?=\s|$)", "Professor"),
        (r"\bSr\.(?=\s|$)", "Senhor"), (r"\bSra\.(?=\s|$)", "Senhora"),
        (r"\bCP\b", "código postal"), (r"\bIC\s*(\d+)", lambda m: "itinerário complementar " + numero_por_extenso(int(m.group(1)))),
        (r"\bEN\s*(\d+)", lambda m: "estrada nacional " + numero_por_extenso(int(m.group(1)))),
        (r"\bA\s*(\d+)\b", lambda m: "autoestrada " + numero_por_extenso(int(m.group(1)))),
        (r"\bn(?:\.|º|°|o)?\s*(\d+)", lambda m: "número " + numero_por_extenso(int(m.group(1)))),
        (r"\b(\d+)\s*m\b", lambda m: numero_por_extenso(int(m.group(1))) + " metros"),
        (r"\b(\d+)\s*km\b", lambda m: numero_por_extenso(int(m.group(1))) + " quilómetros"),
        (r"\b(\d+)\s*min\b", lambda m: numero_por_extenso(int(m.group(1))) + " minutos"),
    ]
    out = str(texto or "")
    # Corrige erros de escrita ou codificação já conhecidos antes da leitura.
    correcoes = {
        "ruápido": "curto", "ruápida": "curta",
        "rapido": "curto", "rapida": "curta",
        "rápido": "curto", "rápida": "curta",
        "semafero": "semáforo", "semaferos": "semáforos",
        "avinida": "avenida", "procima": "próxima",
    }
    for errado, certo in correcoes.items():
        out = re.sub(rf"\b{re.escape(errado)}\b", certo, out, flags=re.IGNORECASE)
    for pattern, repl in regras:
        out = re.sub(pattern, repl, out, flags=re.IGNORECASE)

    # Códigos postais são lidos algarismo a algarismo para não perder clareza.
    def postal(m):
        a, b = m.group(1), m.group(2)
        return "código postal " + " ".join(numero_por_extenso(int(x)) for x in a + b)
    out = re.sub(r"\b(\d{4})-(\d{3})\b", postal, out)

    # Números isolados, incluindo números de linhas, ficam sempre por extenso.
    out = re.sub(r"(?<![\w-])\d+(?![\w-])", lambda m: numero_por_extenso(int(m.group(0))), out)
    return re.sub(r"\s+", " ", out).strip()


def limpar_instrucao(texto: str) -> str:
    replacements = {
        "leste": "nascente", "oeste": "poente", "northeast": "nordeste",
        "northwest": "noroeste", "southeast": "sudeste", "southwest": "sudoeste",
        "east": "nascente", "west": "poente", "north": "norte", "south": "sul",
    }
    result = texto
    for old, new in replacements.items():
        result = re.sub(rf"\b{re.escape(old)}\b", new, result, flags=re.IGNORECASE)
    result = re.sub(r"<[^>]+>", " ", result)
    result = expandir_abreviaturas(result)
    result = re.sub(r"\s+", " ", result).strip(" .")
    return result


def formatar_hora(valor: str) -> str:
    if not valor:
        return ""
    try:
        dt = datetime.fromisoformat(valor.replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Lisbon"))
        return f"{numero_por_extenso(dt.hour)} horas e {numero_por_extenso(dt.minute)} minutos"
    except Exception:
        return ""


def distancia_falada(metros: int) -> str:
    metros = int(metros or 0)
    if metros < 1000:
        return numero_por_extenso(max(1, metros)) + " metros"
    km = metros / 1000
    if abs(km - round(km)) < 0.05:
        return numero_por_extenso(round(km)) + " quilómetros"
    inteiros = int(km)
    dec = round((km - inteiros) * 10)
    return numero_por_extenso(inteiros) + " vírgula " + numero_por_extenso(dec) + " quilómetros"


def _route_request(origin: dict, destination: dict, mode: str, transit_preference: Optional[str] = None) -> List[dict]:
    travel_mode = {"TRANSIT":"TRANSIT", "WALK":"WALK", "BICYCLE":"BICYCLE", "DRIVE":"DRIVE"}.get(mode.upper(), "TRANSIT")
    payload: Dict[str, Any] = {
        "origin": {"location": {"latLng": {"latitude": origin["lat"], "longitude": origin["lng"]}}},
        "destination": {"location": {"latLng": {"latitude": destination["lat"], "longitude": destination["lng"]}}},
        "travelMode": travel_mode,
        "languageCode": "pt-PT",
        "units": "METRIC",
        "computeAlternativeRoutes": travel_mode != "TRANSIT",
    }
    if travel_mode == "TRANSIT":
        prefs = {"allowedTravelModes": ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"]}
        if transit_preference:
            prefs["routingPreference"] = transit_preference
        payload["transitPreferences"] = prefs
    fields = (
        "routes.duration,routes.distanceMeters,routes.description,"
        "routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.localizedValues,"
        "routes.legs.steps.navigationInstruction,routes.legs.steps.travelMode,"
        "routes.legs.steps.startLocation,routes.legs.steps.endLocation,"
        "routes.legs.steps.transitDetails"
    )
    data = google_json(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        method="POST", payload=payload,
        headers={"X-Goog-Api-Key": api_key(), "X-Goog-FieldMask": fields},
    )
    return data.get("routes", [])


def _nome_rua_no_ponto(loc: dict) -> str:
    try:
        lat, lng = loc.get("latitude"), loc.get("longitude")
        if lat is None or lng is None:
            return ""
        return expandir_abreviaturas(reverse_geocode(float(lat), float(lng)).get("address", ""))
    except Exception:
        return ""


def _route_to_output(route: dict) -> dict:
    steps_out, stop_count, lines, operators = [], 0, [], []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            distance = int(step.get("distanceMeters") or 0)
            instruction = limpar_instrucao(step.get("navigationInstruction", {}).get("instructions", ""))
            # Não orientar apenas por pontos cardeais. É pouco útil para uma pessoa cega.
            instruction = re.sub(r"\b(?:para|em direção a|na direção de)\s+(?:nascente|poente|norte|sul)\b", "pela via indicada", instruction, flags=re.I)
            transit = step.get("transitDetails") or {}
            details = []
            if instruction:
                details.append(instruction)
            travel_mode = str(step.get("travelMode", "")).upper()
            if distance and not transit:
                details.append("Percorra " + distancia_falada(distance))
                if travel_mode == "WALK":
                    details.append("Segue com cuidado e usa corretamente a bengala")
            start_loc = ((step.get("startLocation") or {}).get("latLng") or {})
            end_loc = ((step.get("endLocation") or {}).get("latLng") or {})
            if transit:
                stop_details = transit.get("stopDetails") or {}
                line = transit.get("transitLine") or {}
                vehicle_obj = line.get("vehicle") or {}
                vehicle = (vehicle_obj.get("name") or {}).get("text", "transporte público")
                line_name = line.get("nameShort") or line.get("name") or ""
                headsign = transit.get("headsign") or ""
                agencies = [a.get("name", "") for a in line.get("agencies", []) if a.get("name")]
                for agency in agencies:
                    if agency not in operators: operators.append(agency)
                if line_name and line_name not in lines: lines.append(line_name)
                dep = (stop_details.get("departureStop") or {}).get("name", "")
                arr = (stop_details.get("arrivalStop") or {}).get("name", "")
                dep_time = formatar_hora(stop_details.get("departureTime", ""))
                arr_time = formatar_hora(stop_details.get("arrivalTime", ""))
                n_stops = int(transit.get("stopCount") or 0)
                stop_count += n_stops
                frase = "Apanhe " + vehicle.lower()
                if line_name: frase += " da linha " + expandir_abreviaturas(str(line_name))
                if headsign: frase += ", na direção indicada para " + expandir_abreviaturas(headsign)
                if agencies: frase += ", operado por " + ", ".join(agencies)
                details.append(frase)
                if dep:
                    t = "Entre na paragem ou estação " + expandir_abreviaturas(dep)
                    t += ", com partida prevista para as " + dep_time if dep_time else ". O horário de partida não foi disponibilizado"
                    details.append(t)
                if n_stops:
                    details.append("Faltam " + numero_por_extenso(n_stops) + (" paragem até à saída" if n_stops == 1 else " paragens até à saída"))
                if arr:
                    t = "Saia na paragem ou estação " + expandir_abreviaturas(arr)
                    if arr_time: t += ", com chegada prevista para as " + arr_time
                    details.append(t)
                rua_saida = _nome_rua_no_ponto(end_loc)
                if rua_saida:
                    details.append("Depois de sair, estará junto de " + rua_saida + ". Segue com cuidado e usa corretamente a bengala")
            text = ". ".join(d.strip(" .") for d in details if d).strip()
            if text:
                step_seconds = int(str(step.get("staticDuration", "0s")).rstrip("s") or 0)
                steps_out.append({
                    "text": expandir_abreviaturas(text + "."),
                    "distance_meters": distance,
                    "duration_seconds": step_seconds,
                    "travel_mode": step.get("travelMode", ""),
                    "start": {"lat": start_loc.get("latitude"), "lng": start_loc.get("longitude")},
                    "end": {"lat": end_loc.get("latitude"), "lng": end_loc.get("longitude")},
                    "transit": {
                        "stop_count": int(transit.get("stopCount") or 0),
                        "departure_stop": expandir_abreviaturas((transit.get("stopDetails") or {}).get("departureStop", {}).get("name", "")),
                        "arrival_stop": expandir_abreviaturas((transit.get("stopDetails") or {}).get("arrivalStop", {}).get("name", "")),
                        "line": expandir_abreviaturas(str((transit.get("transitLine") or {}).get("nameShort") or (transit.get("transitLine") or {}).get("name") or "")),
                        "headsign": expandir_abreviaturas(str(transit.get("headsign") or "")),
                        "intermediate_stop_names": [],
                    } if transit else None,
                })
    seconds = int(str(route.get("duration", "0s")).rstrip("s") or 0)
    return {
        "duration_minutes": max(1, round(seconds / 60)),
        "duration_spoken": numero_por_extenso(max(1, round(seconds / 60))) + " minutos",
        "distance_meters": route.get("distanceMeters", 0),
        "distance_spoken": distancia_falada(route.get("distanceMeters", 0)),
        "steps": steps_out,
        "stop_count": stop_count,
        "stop_count_spoken": numero_por_extenso(stop_count) if stop_count else "",
        "lines": [expandir_abreviaturas(str(x)) for x in lines],
        "operators": operators,
    }


def compute_routes(origin: dict, destination: dict, mode: str) -> List[dict]:
    raw: List[dict] = []
    if mode.upper() == "TRANSIT":
        # A Google não devolve alternativas de transporte numa única chamada.
        # Fazemos pesquisas com prioridades diferentes, eliminamos duplicados e ordenamos por tempo.
        for pref in (None, "LESS_WALKING", "FEWER_TRANSFERS"):
            raw.extend(_route_request(origin, destination, mode, pref))
    else:
        raw.extend(_route_request(origin, destination, mode))
    outputs, seen = [], set()
    for r in raw:
        out = _route_to_output(r)
        signature = (out["duration_minutes"], tuple(out["lines"]), out["distance_meters"])
        if signature in seen: continue
        seen.add(signature); outputs.append(out)
    outputs.sort(key=lambda x: (x["duration_minutes"], x["distance_meters"]))
    if not outputs:
        raise RuntimeError("Não encontrei um percurso para essa combinação.")
    for i, out in enumerate(outputs):
        out["ranking_label"] = "Percurso mais curto" if i == 0 else f"Alternativa {numero_por_extenso(i + 1)}"
    return outputs



def nearby_places(lat: float, lng: float, category: str) -> dict:
    groups = {
        "commerce": (["supermarket", "pharmacy", "restaurant", "cafe", "bank", "shopping_mall"], "Comércio e serviços próximos", 1500.0),
        "transport": (["train_station", "transit_station", "bus_station", "subway_station"], "Estações e paragens próximas", 2000.0),
        "emergency": (["hospital", "police", "fire_station"], "Hospitais, polícia e bombeiros próximos", 5000.0),
        "public": (["city_hall", "post_office", "library", "courthouse", "local_government_office"], "Utilidades públicas próximas", 4000.0),
        "leisure": (["park", "museum", "movie_theater", "tourist_attraction", "performing_arts_theater"], "Lazer e cultura próximos", 4000.0),
    }
    types, title, radius = groups.get(category, groups["commerce"])
    payload = {
        "includedTypes": types,
        "maxResultCount": 10,
        "rankPreference": "DISTANCE",
        "languageCode": "pt-PT",
        "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius}},
    }
    data = google_json(
        "https://places.googleapis.com/v1/places:searchNearby",
        method="POST", payload=payload,
        headers={
            "X-Goog-Api-Key": api_key(),
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.primaryType,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.businessStatus",
        },
    )
    out = []
    for place in data.get("places", []):
        loc = place.get("location") or {}
        plat, plng = loc.get("latitude"), loc.get("longitude")
        if plat is None or plng is None:
            continue
        from math import radians, sin, cos, asin, sqrt
        dlat, dlng = radians(plat-lat), radians(plng-lng)
        a = sin(dlat/2)**2 + cos(radians(lat))*cos(radians(plat))*sin(dlng/2)**2
        dist = int(round(6371000 * 2 * asin(sqrt(a))))
        out.append({
            "name": (place.get("displayName") or {}).get("text", "Local sem nome"),
            "address": place.get("formattedAddress", ""),
            "type": place.get("primaryType", ""),
            "distance_meters": dist,
            "distance_spoken": distancia_falada(dist),
            "phone": place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber") or "",
            "website": place.get("websiteUri", ""),
            "maps_url": place.get("googleMapsUri", ""),
            "business_status": place.get("businessStatus", ""),
        })
    out.sort(key=lambda x: x["distance_meters"])
    return {"title": title, "places": out[:10]}

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def status():
    try:
        api_key()
        return jsonify({"ok": True, "message": "Aplicação pronta."})
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)}), 503


@app.post("/api/location")
def location():
    try:
        body = request.get_json(force=True)
        return jsonify({"ok": True, **reverse_geocode(float(body["lat"]), float(body["lng"]))})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/api/geocode")
def geocode_address():
    try:
        body = request.get_json(force=True)
        address = str(body.get("address", "")).strip()
        if not address:
            raise RuntimeError("Escreve a morada completa.")
        result = geocodificar(address)
        return jsonify({"ok": True, **result})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400



@app.post("/api/nearby")
def nearby():
    try:
        body = request.get_json(force=True)
        lat = float(body["lat"]); lng = float(body["lng"])
        category = str(body.get("category", "commerce"))
        return jsonify({"ok": True, **nearby_places(lat, lng, category)})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

@app.post("/api/route")
def route():
    try:
        body = request.get_json(force=True)
        origin_query = str(body.get("origin_query", "")).strip()
        if origin_query:
            origin_geo = geocodificar(origin_query)
            origin = {"lat": origin_geo["lat"], "lng": origin_geo["lng"]}
        else:
            origin = {"lat": float(body["origin"]["lat"]), "lng": float(body["origin"]["lng"])}
        destination_text = str(body.get("destination", "")).strip()
        if not destination_text:
            raise RuntimeError("Escreve a morada ou o local de destino.")
        destination = geocodificar(destination_text)
        if not destination["distrito_lisboa"]:
            return jsonify({"ok": False, "error": "O destino indicado fica fora do distrito de Lisboa."}), 400
        results = compute_routes(origin, destination, str(body.get("mode", "TRANSIT")))
        return jsonify({"ok": True, "destination": destination, "route": results[0], "routes": results})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


if __name__ == "__main__":
    print("Lisboa Falante versão 15 iniciada na porta 5000")
    app.run(host="0.0.0.0", port=5000, debug=False)
