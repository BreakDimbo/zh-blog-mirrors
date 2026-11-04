import asyncio,sys
from playwright.async_api import async_playwright
# usage: smoke.py [real|nowebgl]   real = default headless Chromium (WebGL2 via SwiftShader); nowebgl = WebGL disabled -> flat fallback
MODE=sys.argv[1] if len(sys.argv)>1 else 'real'
ARGS=[] if MODE=='real' else ['--disable-webgl','--disable-webgl2']
IGN='GPU stall due to ReadPixels'
ST='''(()=>{const f=window.__zbmFish,c=document.querySelectorAll('canvas');return {mounted:!!f,water:f&&f.water,canvases:[...c].map(x=>{const s=getComputedStyle(x);return x.className+' pe='+s.pointerEvents+' pos='+s.position+' z='+s.zIndex+' disp='+s.display+' op='+s.opacity}),fish:f&&f.fish&&f.fish.length,ink:getComputedStyle(document.body).getPropertyValue('--ink-fish-ink')}})()'''
HIT='''(()=>{const out=[];for(const [x,y] of [[.5,.5],[.15,.2],[.85,.3],[.5,.85],[.95,.95]]){const e=document.elementFromPoint(innerWidth*x,innerHeight*y);if(!e||e.tagName==='CANVAS')out.push(x+','+y+':'+(e&&e.className))}return out})()'''
async def main():
    bad=0
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=ARGS)
        for w,h,mob in [(1440,900,False),(390,844,True)]:
          for th in ['light','dark']:
            ctx=await b.new_context(viewport={'width':w,'height':h},is_mobile=mob,has_touch=mob,color_scheme=th)
            await ctx.add_init_script(f'localStorage.setItem("zbm-theme","{th}")')
            pg=await ctx.new_page(); errs=[]; ign=[0]
            def con(m):
                if m.type in('error','warning'):
                    if IGN in m.text: ign[0]+=1
                    else: errs.append(m.type+':'+m.text)
            pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',con)
            await pg.goto('http://127.0.0.1:8741/',wait_until='networkidle'); await pg.wait_for_timeout(700)
            early=await pg.evaluate(ST)
            for i in range(15): await pg.mouse.move(w*0.55+i*12,h*0.2); await pg.wait_for_timeout(30)
            await pg.wait_for_timeout(3000)
            r=await pg.evaluate(ST); hits=await pg.evaluate(HIT)
            await pg.evaluate('scrollTo(0,1200)'); await pg.wait_for_timeout(400); hits+=await pg.evaluate(HIT)
            fixedOK=all(('pe=none' in c and 'pos=fixed' in c) for c in r['canvases'])
            ok=r['mounted'] and fixedOK and not hits and not errs and (MODE=='real' or r['water']!='real')
            bad+=not ok
            print('OK ' if ok else 'BAD',MODE,w,th,'water@0.7s',early['water'],'water@4s',r['water'],r,'canvas-hits',hits,'errs',errs,'ignored ReadPixels warnings',ign[0],flush=True)
            await ctx.close()
        await b.close()
    print('BAD',bad)
asyncio.run(main())
