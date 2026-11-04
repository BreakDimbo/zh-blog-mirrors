# perfab.py: scroll-phase main-thread task ms, A/B with injected CSS, interleaved runs
import sys,json
from playwright.sync_api import sync_playwright
V={'main':('http://127.0.0.1:8742/',''),'r2':('http://127.0.0.1:8741/',''),
   'r2-nomask':('http://127.0.0.1:8741/','.tape::after,.tape::before{-webkit-mask-image:none!important;mask-image:none!important}'),
   'r2-nopseudo':('http://127.0.0.1:8741/','.tape::after,.tape::before{display:none!important}'),
   'r2-notoday':('http://127.0.0.1:8741/','.today{display:none!important}')}
SC=float(sys.argv[4]) if len(sys.argv)>4 else 1
names=sys.argv[1].split(','); N=int(sys.argv[2]) if len(sys.argv)>2 else 3; w=int(sys.argv[3]) if len(sys.argv)>3 else 1440
res={n:[] for n in names}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars'])
    for i in range(N):
        for n in names:
            url,css=V[n]; mob=w<500
            ctx=b.new_context(viewport={'width':w,'height':900 if not mob else 844},is_mobile=mob,has_touch=mob,color_scheme='dark')
            if css: ctx.add_init_script("document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=%s;document.head.appendChild(s)})"%json.dumps(css))
            pg=ctx.new_page(); pg.goto(url,wait_until='networkidle'); pg.wait_for_timeout(3000)
            cdp=ctx.new_cdp_session(pg); cdp.send('Performance.enable')
            g=lambda: {m['name']:m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
            m0=g()
            for k in range(60): pg.mouse.wheel(0,(40 if k<30 else -40)*SC); pg.wait_for_timeout(50)
            m1=g(); res[n].append(round((m1['TaskDuration']-m0['TaskDuration'])*1000)); ctx.close()
    b.close()
for n in names: print(n,res[n],'median',sorted(res[n])[len(res[n])//2])
