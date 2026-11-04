# quick iteration shots: quick.py TAG [scrollY]  -> iter/TAG-{light,dark}.png (1440x900) + iter/TAG-edge-{theme}.png (DPR2 crop)
import sys
from playwright.sync_api import sync_playwright
tag=sys.argv[1]; sy=int(sys.argv[2]) if len(sys.argv)>2 else 0; out='/workspace/hub-preview-shots/hub-glass-r2/iter'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars'])
    for th in ['light','dark']:
        ctx=b.new_context(viewport={'width':1440,'height':900},device_scale_factor=2,color_scheme=th)
        ctx.add_init_script(f"localStorage.setItem('zbm-theme','{th}')")
        pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.goto('http://127.0.0.1:8741/',wait_until='networkidle')
        if sy: pg.evaluate(f'scrollTo(0,{sy})')
        pg.wait_for_timeout(4000)
        pg.screenshot(path=f'{out}/{tag}-{th}.png',scale='css')
        e=pg.evaluate("(()=>{const u=[...document.querySelectorAll('.shelf .unit')].find(u=>{const r=u.getBoundingClientRect();return r.bottom>0&&r.bottom<innerHeight});const r=u.getBoundingClientRect();return {x:r.left,b:r.bottom}})()")
        pg.screenshot(path=f'{out}/{tag}-edge-{th}.png',clip={'x':e['x']-30,'y':e['b']-120,'width':520,'height':190})
        print(th,errs); ctx.close()
    b.close()
