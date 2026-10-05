"""Exporta paragens e variantes do GTFS oficial; não contém previsões em tempo real."""
import csv, io, json, zipfile, urllib.request, sys
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
URL = 'https://gateway.carris.pt/gateway/gtfs/api/v2.11/GTFS'
def export(source=None, destination=None):
    data = Path(source).read_bytes() if source else urllib.request.urlopen(URL, timeout=90).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    def rows(name):
        return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))
    info = next(rows('feed_info.txt'))
    routes = {r['route_id']: r for r in rows('routes.txt')}
    stops = {r['stop_id']: {'id':r['stop_id'], 'code':r['stop_code'], 'name':r['stop_name'], 'lat':float(r['stop_lat']), 'lon':float(r['stop_lon']), 'wheelchair':r.get('wheelchair_boarding','')} for r in rows('stops.txt')}
    trips = {r['trip_id']:r for r in rows('trips.txt')}
    sequences = defaultdict(list)
    for r in rows('stop_times.txt'):
        sequences[r['trip_id']].append((int(r['stop_sequence']),r['stop_id']))
    calendars = list(rows('calendar.txt'))
    exceptions = list(rows('calendar_dates.txt'))
    patterns = {}
    for tid, sequence in sequences.items():
        trip = trips[tid]; ids = tuple(s for _,s in sorted(sequence))
        key = (trip['route_id'],trip.get('direction_id',''),ids)
        if key not in patterns:
            patterns[key] = {'stops':ids,'direction':trip.get('direction_id',''),'headsign':trip.get('trip_headsign',''),'services':set(),'wheelchair':set()}
        patterns[key]['services'].add(trip['service_id'])
        patterns[key]['wheelchair'].add(trip.get('wheelchair_accessible',''))
    out = Path(destination or Path(__file__).resolve().parents[1]/'data/carris'); out.mkdir(parents=True,exist_ok=True)
    lines = defaultdict(list); stop_lines=defaultdict(set)
    for (rid,_,_), pattern in patterns.items():
        route = routes[rid]; number=route['route_short_name']
        pattern['services']=sorted(pattern['services']);pattern['wheelchair']=sorted(pattern['wheelchair']);pattern['routeName']=route['route_long_name']
        if not pattern['headsign']: pattern['headsign']=stops[pattern['stops'][-1]]['name']
        lines[number].append(pattern)
        for sid in pattern['stops']: stop_lines[sid].add(number)
    def write(name,value): (out/name).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    manifest={'source':URL,'downloadedAt':datetime.now(timezone.utc).isoformat(),'feedStart':info['feed_start_date'],'feedEnd':info['feed_end_date'],'version':info['feed_version'],'lines':sorted(lines),'calendars':calendars,'exceptions':exceptions}
    write('index.json',manifest)
    write('stops.json',[{**s,'lines':sorted(stop_lines[sid])} for sid,s in stops.items()])
    for number, patterns_for_line in lines.items(): write(number+'.json',patterns_for_line)
    print(f'{len(stops)} paragens; {len(lines)} carreiras; {len(patterns)} variantes. Versão {info["feed_version"]}.')
if __name__=='__main__': export(sys.argv[1] if len(sys.argv)>1 else None)
