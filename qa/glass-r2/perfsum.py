import json,collections,glob
d=collections.defaultdict(list)
for f in sorted(glob.glob('perf-*-[12].log')):
    for l in open(f):
        if l.startswith('{'): r=json.loads(l); d[(r['vp'],r['theme'],r['phase'],r['label'])].append(r)
keys=sorted(set(k[:3] for k in d)); tot={'main':[0,0],'r2':[0,0]}
print('vp    theme phase  | main: frame avg / p95 ms, main-thread task ms, layouts | r2: same')
for k in keys:
    row=[]
    for lab in ['main','r2']:
        rs=d[k+(lab,)]; n=len(rs); a=sum(r['avg'] for r in rs)/n; p=sum(r['p95'] for r in rs)/n; t=sum(r['task_ms'] for r in rs)/n; L=sum(r['layouts'] for r in rs)/n
        tot[lab][0]+=t; tot[lab][1]+=a; row.append(f'{a:6.1f} / {p:6.1f}  {t:7.1f}  {L:5.1f}')
    print(f'{k[0]:5} {k[1]:5} {k[2]:6} | {row[0]} | {row[1]}')
print('sum task ms main=%.0f r2=%.0f ; sum avg frame main=%.0f r2=%.0f'%(tot['main'][0],tot['r2'][0],tot['main'][1],tot['r2'][1]))
print('errs', sum(r['errs'] for v in d.values() for r in v))
