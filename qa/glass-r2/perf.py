# perf.py BASE LABEL -> rAF frame intervals (avg/p95/max, >20ms count) during scripted scroll + mouse moves with fish active; CDP TaskDuration/LayoutCount/RecalcStyleCount deltas
import sys,json
from playwright.sync_api import sync_playwright
base=sys.argv[1]; label=sys.argv[2]
JS_START="""window.__ft=[];(function f(t){if(window.__last)window.__ft.push(t-window.__last);window.__last=t;window.__raf=requestAnimationFrame(f)})(performance.now())"""
def run(b,vp,mob,theme,phase):
    ctx=b.new_context(viewport=vp,is_mobile=mob,has_touch=mob,device_scale_factor=1,color_scheme=theme)
    ctx.add_init_script(f"try{{localStorage.setItem('zbm-theme','{theme}');localStorage.removeItem('zbm-view')}}catch(e){{}}")
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(base,wait_until='networkidle'); pg.wait_for_timeout(3500)
    cdp=ctx.new_cdp_session(pg); cdp.send('Performance.enable')
    m0={m['name']:m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
    pg.evaluate("window.__last=0;"+JS_START)
    if phase=='scroll':
        for i in range(60):
            pg.mouse.wheel(0,40 if i<30 else -40); pg.wait_for_timeout(50)
    elif phase=='idle':
        pg.wait_for_timeout(3000)
    else: # pointer sweeps across the first visible shelf's books (hover springs) + fish
        yb=pg.evaluate("(()=>{const r=document.querySelector('.shelf .tape').getBoundingClientRect();return (r.top+r.bottom)/2})()")
        yb=min(yb,vp['height']-60)
        for i in range(60):
            pg.mouse.move(100+i*(vp['width']-200)/60, yb+((i%10)-5)*8); pg.wait_for_timeout(50)
    ft=pg.evaluate("cancelAnimationFrame(window.__raf);window.__ft")
    m1={m['name']:m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
    ft=sorted(ft[2:]); n=len(ft)
    r=dict(vp=f"{vp['width']}",theme=theme,phase=phase,frames=n,avg=round(sum(ft)/n,2),p95=round(ft[int(n*.95)],2),max=round(ft[-1],2),over20=sum(1 for x in ft if x>20),
           task_ms=round((m1['TaskDuration']-m0['TaskDuration'])*1000,1),layouts=int(m1['LayoutCount']-m0['LayoutCount']),recalcs=int(m1['RecalcStyleCount']-m0['RecalcStyleCount']),errs=len(errs))
    ctx.close(); return r
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars'])
    out=[]
    for vp,mob in [({'width':1440,'height':900},False),({'width':390,'height':844},True)]:
        for theme in ['light','dark']:
            for phase in ['idle','scroll','mouse']:
                r=run(b,vp,mob,theme,phase); r['label']=label; out.append(r); print(json.dumps(r),flush=True)
    b.close()
