"""Extract literal preset constants without executing legacy source."""
import ast,json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
result={}
for name in ['Capture','Truesoil','Greenmove']:
    tree=ast.parse((root/'Users'/name/'field_experiment.py').read_text(encoding='utf-8-sig'))
    vals={}
    for node in ast.walk(tree):
        if isinstance(node,ast.Assign):
            for target in node.targets:
                if isinstance(target,ast.Name) and target.id in ['Field_numbers','treatment_legend','treatmentlist']:
                    try: vals[target.id]=ast.literal_eval(node.value)
                    except (ValueError,TypeError): pass
    if name=='Capture':
        tree=ast.parse((root/'Users/Capture/analyzer-gui.py').read_text(encoding='utf-8-sig'))
        for node in ast.walk(tree):
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='treatment_legend' for t in node.targets): vals['treatment_legend']=ast.literal_eval(node.value)
    if 'Field_numbers' in vals: vals['waypoints']=[dict(waypoint=k[0],side=k[1],plotId=v) for k,v in vals.pop('Field_numbers').items()]
    result[name.lower()]=vals
(root/'crates/ffr-core/src/presets.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
