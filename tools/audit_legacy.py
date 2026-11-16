"""Audit legacy input counts without executing legacy project source."""
import argparse,collections,json,pathlib,re
import pandas as pd
p=argparse.ArgumentParser();p.add_argument('raw',type=pathlib.Path);p.add_argument('legacy',type=pathlib.Path);p.add_argument('manual',type=pathlib.Path);a=p.parse_args()
files=[p for p in a.raw.iterdir() if p.is_file() and p.name.startswith('2')];filtered=[];bad_names=[]
for f in files:
 try:
  x=float(re.search(r'-x(-?\d+_\d+)',f.name)[1].replace('_','.'));y=float(re.search(r'-y(-?\d+_\d+)',f.name)[1].replace('_','.'))
  if f.name<'2021-08-19' or not(599201<x<599246 and 6615259<y<6615314):filtered.append({'filename':f.name,'x':x,'y':y,'reason':'Capture date/bounding-box filter'})
 except (TypeError,ValueError):bad_names.append(f.name)
manual=pd.read_excel(a.manual);gold=pd.read_pickle(a.legacy/'output/df_all.pkl');gold=gold[gold.type=='manual'].copy();gold['date']=pd.to_datetime(gold.date)-pd.Timedelta(hours=12)
columns=['date','nr','N2O_N_mug_m2h','CO2_C_mug_m2h']
def keys(frame):
 return collections.Counter(tuple(str(pd.Timestamp(v)) if k=='date' else str(round(float(v),7)) for k,v in zip(columns,row)) for row in frame[columns].itertuples(index=False,name=None))
old,new=keys(gold),keys(manual)
print(json.dumps({'rawCandidates':len(files),'nonRawFiles':[p.name for p in a.raw.iterdir() if not p.name.startswith('2')],'filtered':filtered,'invalidNames':bad_names,'manualWorkbookRows':len(manual),'goldenManualRows':len(gold),'missingFromWorkbook':list((old-new).elements()),'newInWorkbook':list((new-old).elements())},indent=2))
