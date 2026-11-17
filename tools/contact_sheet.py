"""Reproducible CO2/N2O contact sheets through the public CLI contract.
Adapted from the local sheet.py draft; no measurement data is embedded here.
"""
import argparse,concurrent.futures,json,math,pathlib,random,subprocess
from datetime import datetime
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
p=argparse.ArgumentParser();p.add_argument('project');p.add_argument('--cli',default='target/release/ffr-cli.exe');p.add_argument('--out',type=pathlib.Path,default=pathlib.Path('local/sheets'));p.add_argument('--seed',type=int,default=17);p.add_argument('--ids',nargs='*',type=int);p.add_argument('--name',default='selected');p.add_argument('--groups',nargs='+',help='Generate only these named groups');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
def invoke(command,args):
 args={'projectPath':a.project,**args};r=subprocess.run([a.cli,'dump-json',command,json.dumps(args)],capture_output=True,check=False)
 if r.returncode:raise RuntimeError(r.stderr.decode('utf8',errors='replace'))
 return json.loads(r.stdout)
table=invoke('listFluxes',{});data=table['data'];rows=[dict(zip(data,values)) for values in zip(*data.values())];robot=[r for r in rows if r['source']=='robot'];lookup={r['id']:r for r in robot};rng=random.Random(a.seed)
if a.ids:groups={a.name:a.ids}
else:
 groups={'top_attention': [r['id'] for r in sorted(robot,key=lambda r:(-r['attention'],r['id']))[:24]]}
 for code in sorted({c for r in robot for c in (r['diag'] or '').split(',') if c}):
  ids=[r['id'] for r in robot if code in (r['diag'] or '').split(',')];groups[code]=rng.sample(ids,min(16,len(ids)))
 clean=[r['id'] for r in robot if r['attention']==0];groups['attention_zero']=rng.sample(clean,min(16,len(clean)))
if a.groups:groups={name:ids for name,ids in groups.items() if name in a.groups}
# Remove only PNGs recorded by this tool's previous manifest, within this output directory.
manifest=a.out/'index.json'
if manifest.exists():
 previous=json.loads(manifest.read_text(encoding='utf8'))
 for group in previous:
  if not group or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in group):continue
  for old in a.out.glob(group+'-*.png'):
   if old.resolve().parent==a.out.resolve():old.unlink()
(a.out/'index.json').write_text(json.dumps(groups,indent=2),encoding='utf8')
cache={}
def load(i):return i,invoke('getFluxDetail',{'fluxId':i})
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 for i,d in pool.map(load,sorted({i for ids in groups.values() for i in ids})):cache[i]=d
for name,ids in groups.items():
 if not ids:continue
 for page,start in enumerate(range(0,len(ids),8),1):
  selected=ids[start:start+8];cols=4;nrows=math.ceil(len(selected)/cols);fig,axes=plt.subplots(nrows*2,cols,figsize=(20,nrows*5.2),squeeze=False)
  for k,i in enumerate(selected):
   d=cache[i];row=lookup.get(i,d['flux']);me=1 if row['side']=='left' else 2;time=datetime.fromtimestamp(row['time']/1000,ZoneInfo('Europe/Oslo')).strftime('%Y-%m-%d %H:%M')
   for g,gas in enumerate(['CO2','N2O']):
    ax=axes[2*(k//cols)+g,k%cols];tr=next((t for t in d['traces'] if t['gas']==gas),None)
    if not tr:ax.text(.1,.4,'No valid trace',transform=ax.transAxes);continue
    t=np.asarray(tr['t']);y=np.asarray(tr['y'],dtype=float);s=np.asarray(tr['side']);u=np.asarray(tr['used'],dtype=bool)
    ax.scatter(t[s==0],y[s==0],c='#bbb',s=5,label='Discarded');ax.scatter(t[(s!=0)&(s!=me)],y[(s!=0)&(s!=me)],c='#c678a3',s=7,alpha=.5,label='Sibling');ax.scatter(t[(s==me)&~u],y[(s==me)&~u],c='#7fb6db',s=8,label='This chamber');ax.scatter(t[u],y[u],c='#1764a0',s=10,label='Used')
    for sw in d['switches']:ax.axvline(sw['t'],c='#ccc',lw=.4)
    for collection,style,color,label in [('regressions','-','#222','Legacy fit'),('robust','--','#18824f','Robust fit')]:
     rg=next((r for r in d.get(collection,[]) if r['gas']==gas),None)
     if rg:xx=np.array([rg['start'],rg['stop']]);ax.plot(xx,rg['intercept']+rg['slope']*xx,style,color=color,lw=1.5,label=label)
    value=row.get(gas+'_flux');robust=row.get(gas+'_robustFlux');impact=row.get(gas+'_impact');value='—' if value is None else f'{value:.2f}';robust='—' if robust is None else f'{robust:.2f}';impact='—' if impact is None else f'{100*impact:.0f}%'
    title=f'{i} {time} {row["side"]} attention={row["attention"]:.0f}'+(' EXCLUDED' if row.get('excluded') else '') if g==0 else (row.get('diag') or 'No findings')
    ax.set_title(title,fontsize=8,color='#a22' if row.get('excluded') else '#222',wrap=True);ax.set_xlabel(f'{gas}: flux {value}; robust {robust}; impact {impact}',fontsize=8);ax.set_ylabel('ppm',fontsize=8);ax.tick_params(labelsize=7)
    if k==0 and g==0:ax.legend(fontsize=6,ncol=3)
  for k in range(len(selected),nrows*cols):
   for g in [0,1]:axes[2*(k//cols)+g,k%cols].set_visible(False)
  fig.tight_layout();path=a.out/f'{name}-{page}.png';fig.savefig(path,dpi=110);plt.close(fig);print(path,flush=True)
