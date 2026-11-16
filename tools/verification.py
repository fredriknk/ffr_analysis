"""Read-only legacy verification bridge; outputs must be under local/ or outside git."""
import argparse, ast, json, pathlib
p = argparse.ArgumentParser()
p.add_argument('legacy', type=pathlib.Path)
p.add_argument('out', type=pathlib.Path)
a=p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
with (a.legacy/'output/capture_slopes.txt').open() as src, (a.out/'golden.jsonl').open('w') as out:
    for line in src:
        fields=line.rstrip('\n').split('\t')
        if len(fields)<4: continue
        options=ast.literal_eval(fields[2])
        values=dict(zip(fields[3::2],fields[4::2]))
        out.write(json.dumps(dict(filename=fields[0],side=fields[1],options=options,values=values))+'\n')
import pandas as pd
frame=pd.read_pickle(a.legacy/'output/df_all.pkl')
cols=[c for c in ['filename','side','type','date','t','Tc','nr','treatment','N2O_N_mug_m2h','CO2_C_mug_m2h','excluded'] if c in frame]
frame[cols].to_csv(a.out/'df_all.csv',index=False)
print('Golden lines:', sum(1 for _ in (a.out/'golden.jsonl').open()), 'Dataframe rows:',len(frame))
