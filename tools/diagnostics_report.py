"""Summarise ignored diagnostics benchmark output and day clustering without copying raw data."""
import argparse,json,sqlite3,statistics,collections
p=argparse.ArgumentParser();p.add_argument('benchmark');p.add_argument('project');a=p.parse_args()
r=json.loads(open(a.benchmark,'rb').read());d=r['diagnostics']
print('Seconds:',json.dumps(r['timingsSeconds'],sort_keys=True))
print('code,excluded,not_excluded,not_excluded_percent')
for c in d['codes']:print(f"{c['code']},{c['excluded']},{c['notExcluded']},{100*c['notExcluded']/max(1,d['notExcluded']):.2f}")
print('Ranking:',json.dumps(d['ranking']));print('Excluded without findings:',json.dumps(d['excludedWithoutFindings']))
print('Lag quantiles [min,p10,median,p90,max]:',d['valveLag']['quantiles'])
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
conn=sqlite3.connect('file:'+a.project+'?mode=ro',uri=True)
by_day=collections.defaultdict(list);seen=set()
for (text,) in conn.execute('SELECT row FROM fluxes'):
 row=json.loads(text)
 if row.get('source')!='robot' or row.get('measurementId') in seen:continue
 seen.add(row.get('measurementId'));date=datetime.fromtimestamp(row['time']/1000,timezone.utc).astimezone(ZoneInfo('Europe/Oslo')).strftime('%Y-%m-%d');by_day[date].append(row.get('valveLagS',0))
all_lags=[v for values in by_day.values() for v in values];mean=statistics.mean(all_lags);total=sum((v-mean)**2 for v in all_lags);between=sum(len(v)*(statistics.mean(v)-mean)**2 for v in by_day.values());print('Date explains fraction of lag variance:',between/total if total else 0)
print('Dates with median lag at least 5 seconds from zero:',json.dumps([{'date':day,'n':len(v),'median':statistics.median(v)} for day,v in sorted(by_day.items()) if abs(statistics.median(v))>=5]))
