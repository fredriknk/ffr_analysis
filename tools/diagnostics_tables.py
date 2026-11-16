"""Export reviewable, untracked CSV reports from ffr-cli diagnostics JSON."""
import argparse,csv,json,pathlib
from datetime import datetime
from zoneinfo import ZoneInfo
p=argparse.ArgumentParser();p.add_argument('report',type=pathlib.Path);p.add_argument('out',type=pathlib.Path);a=p.parse_args();d=json.loads(a.report.read_bytes());a.out.mkdir(parents=True,exist_ok=True)
columns=['id','localTime','side','attention','diag','N2O_flux','N2O_robustFlux','N2O_impact','CO2_flux','CO2_robustFlux','CO2_impact','valveLagS','N2O_lagS','filename']
def write(name,rows,fields=columns):
 with (a.out/name).open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader()
  for r in rows:
   r=dict(r)
   if 'time' in r:r['localTime']=datetime.fromtimestamp(r['time']/1000,ZoneInfo('Europe/Oslo')).isoformat()
   w.writerow(r)
write('top40-attention.csv',d['top40']);write('top30-n2o-impact.csv',d['top30N2OImpact']);write('legacy-excluded-ranks.csv',[dict(x['flux'],rank=x['rank']) for x in d['legacyExcludedRanks']],['rank']+columns)
rates=[]
for code,counts in d['severityCounts'].items():
 for severity,n in counts.items():rates.append({'code':code,'severity':severity,'fluxes':n,'percent':100*n/d['robotFluxes']})
write('rates.csv',rates,['code','severity','fluxes','percent'])
print(json.dumps({'queue':d['queue'],'noiseFloors':d['noiseFloors'],'legacyRanks':[{k:x['flux'][k] for k in ['id','attention','diag']}|{'rank':x['rank']} for x in d['legacyExcludedRanks']]},indent=2))
