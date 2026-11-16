"""Compare a Rust-produced SQLite project with pandas golden output (verification only)."""
import argparse,json,sqlite3,pathlib
import numpy as np
import pandas as pd
p=argparse.ArgumentParser();p.add_argument('project');p.add_argument('legacy');p.add_argument('summary');a=p.parse_args()
con=sqlite3.connect(a.project)
r=pd.DataFrame([json.loads(row[0]) for row in con.execute('SELECT row FROM fluxes')])
g=pd.read_pickle(pathlib.Path(a.legacy)/'output/df_all.pkl');g=g[g.type=='robot']
m=g.merge(r,on=['filename','side'],suffixes=('_gold','_rust'))
report={'robotRows':len(g),'rustRows':len(r[r.source=='robot']),'joinedRows':len(m)}
for gold,new in [('Tc','airTemp'),('nr','plotId'),('treatment','treatmentId'),('N2O_N_mug_m2h','N2O_flux'),('CO2_C_mug_m2h','CO2_flux')]:
 left=gold+'_gold' if gold in r.columns else gold
 right=new+'_rust' if new in g.columns else new
 x=pd.to_numeric(m[left],errors='coerce');y=pd.to_numeric(m[right],errors='coerce')
 report[new]={'matched':int(np.isclose(x,y,rtol=1e-9,atol=1e-10,equal_nan=True).sum()),'maxAbsError':float((x-y).abs().max())}
# Independent treatment computation using golden pandas rows, current exclusion semantics.
summary=json.loads(pathlib.Path(a.summary).read_bytes())['summary']
t=summary['treatments'][0]['id'];df=g[g.treatment==t].copy()
if 'excluded' in df: df=df[~df.excluded.fillna(False)]
totals=[]
for nr,plot in df.groupby('nr'):
 means=plot.groupby(pd.to_datetime(plot.date).dt.floor('D')).N2O_N_mug_m2h.mean().dropna()*1e-5
 increments=means.rolling(2).mean()*means.index.to_series().diff().dt.total_seconds()/3600
 totals.append(float(increments.sum()))
report['summary']={'treatmentId':t,'pythonMean':float(np.mean(totals)),'pythonSd':float(np.std(totals)),'rust':summary['treatments'][0]}
print(json.dumps(report,indent=2))
