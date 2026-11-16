"""Verify a treatment against pandas, restricted to rows shared by both projects."""
import argparse,json,sqlite3,subprocess,pathlib
import pandas as pd
import numpy as np
from scipy.stats import gmean,gstd
p=argparse.ArgumentParser();p.add_argument('project');p.add_argument('legacy');p.add_argument('cli');p.add_argument('out',type=pathlib.Path);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
g=pd.read_pickle(pathlib.Path(a.legacy)/'output/df_all.pkl');g=g[(g.type=='robot')&(g.treatment==1)].copy()
r=pd.DataFrame([json.loads(row[0]) for row in sqlite3.connect(a.project).execute('SELECT row FROM fluxes')])
m=g.merge(r,on=['filename','side'],suffixes=('_gold','_rust'))
q={'projectPath':a.project,'gas':'N2O','sources':['robot'],'fluxIds':m.id.astype(int).tolist()}
query=a.out/'summary-query.json';query.write_text(json.dumps(q),encoding='utf8')
response=json.loads(subprocess.check_output([a.cli,'dump-json','treatmentSummary','@'+str(query)]))
rust=next(t for t in response['treatments'] if t['id']==1)
if 'excluded_gold' in m:g=g[~g.excluded.fillna(False)]
totals=[]
for _,plot in g.groupby('nr'):
 means=plot.groupby(pd.to_datetime(plot.date).dt.floor('D')).N2O_N_mug_m2h.mean().dropna()*1e-5
 increments=means.rolling(2).mean()*means.index.to_series().diff().dt.total_seconds()/3600
 totals.append(float(increments.sum()))
positive=g[g.N2O_N_mug_m2h>0].N2O_N_mug_m2h
means=g.groupby(pd.to_datetime(g.date).dt.floor('D')).N2O_N_mug_m2h.mean().dropna()
expected={'mean':float(np.mean(totals)),'sd':float(np.std(totals)),'gmean':float(gmean(positive)),'gsd':float(gstd(positive)),'box':np.quantile(means,[0,.25,.5,.75,1]).tolist()}
report={'treatmentId':1,'python':expected,'rust':{k:rust[k] for k in expected}}
print(json.dumps(report,indent=2))
for k in expected:np.testing.assert_allclose(rust[k],expected[k],rtol=1e-9,atol=1e-10)
