# usage: shot.py BASE OUTDIR [suffix]  -> desktop-{light,dark}.png 1440x900, mobile-{light,dark}.png 390x844 (DPR 2 / 3x?), + edge close-ups at 200%
import sys
from playwright.sync_api import sync_playwright
base=sys.argv[1]; out=sys.argv[2]; suf=sys.argv[3] if len(sys.argv)>3 else ''
EDGE='''(()=>{const u=document.querySelector('.shelf .unit');if(!u)return null;const r=u.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,b:r.bottom}})()'''
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars'])
    for dev,vp,mob in [('desktop',{'width':1440,'height':900},False),('mobile',{'width':390,'height':844},True)]:
        for theme in ['light','dark']:
            ctx=b.new_context(viewport=vp,is_mobile=mob,has_touch=mob,device_scale_factor=2 if mob else 1,color_scheme=theme)
            ctx.add_init_script(f"try{{localStorage.setItem('zbm-theme','{theme}');localStorage.removeItem('zbm-view')}}catch(e){{}}")
            pg=ctx.new_page(); errs=[]
            pg.on('pageerror',lambda e: errs.append(str(e)))
            pg.goto(base,wait_until='networkidle'); pg.wait_for_timeout(4200)
            pg.screenshot(path=f'{out}/{dev}-{theme}{suf}.png')
            if mob:
                pg.evaluate("scrollTo(0,document.querySelector('.shelf').getBoundingClientRect().top+scrollY-60)"); pg.wait_for_timeout(1500)
                pg.screenshot(path=f'{out}/{dev}-{theme}{suf}-shelves.png')
            else:
                e=pg.evaluate(EDGE)
                if e:
                    # 200% close-up of the glass edge: re-render the same spot at DPR 2
                    c2=b.new_context(viewport=vp,device_scale_factor=2,color_scheme=theme); c2.add_init_script(f"try{{localStorage.setItem('zbm-theme','{theme}')}}catch(e){{}}")
                    p2=c2.new_page(); p2.goto(base,wait_until='networkidle'); p2.wait_for_timeout(4200)
                    e=p2.evaluate(EDGE)
                    p2.screenshot(path=f'{out}/edge-{theme}{suf}-200.png',clip={'x':max(0,e['x']-40),'y':min(e['b']-150,900-230),'width':560,'height':230})
                    c2.close()
            print(dev,theme,'errors',errs,flush=True)
            ctx.close()
    b.close()
