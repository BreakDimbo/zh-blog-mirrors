import asyncio
from playwright.async_api import async_playwright
B='http://127.0.0.1:8741/'
KOI='window.__zbmFish.fish.filter(x=>Object.values(x).some(v=>v&&v.name==="nishiki")).length'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome'); bad=0
        for w,h,mob in [(1440,900,False),(390,844,True)]:
            ctx=await b.new_context(viewport={'width':w,'height':h},is_mobile=mob,has_touch=mob); await ctx.add_init_script('localStorage.setItem("zbm-theme","light")')
            pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
            await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(2500)
            koi=await pg.evaluate(KOI); print(w,'painted koi',koi); bad+= koi<1
            # theme toggle: canvas pixels must change palette (sample mean luminance of non-transparent pixels is irrelevant; compare page bg + fish ink var)
            def st(): return pg.evaluate('''(()=>{const c=document.querySelector("canvas.ink-fish:not(.ink-fish--shadow)");const g=document.createElement("canvas");g.width=c.width;g.height=c.height;const x=g.getContext("2d");x.drawImage(c,0,0);const d=x.getImageData(0,0,g.width,g.height).data;let n=0,s=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>3){n++;s+=d[i]+d[i+1]+d[i+2]}return {theme:document.documentElement.dataset.theme,ink:getComputedStyle(document.body).getPropertyValue("--ink-fish-ink").trim(),lum:n?Math.round(s/n/3):null}})()''')
            a=await st(); await pg.click('#theme'); await pg.wait_for_timeout(1200); c=await st()
            print(w,'before toggle',a,'after toggle',c); bad+= not(a['lum'] is not None and c['lum'] is not None and abs(c['lum']-a['lum'])>40)
            print(w,'errors',errs); bad+=len(errs); await ctx.close()
        ctx=await b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce'); pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(2500)
        for i in range(30): await pg.mouse.move(800+i*15,200); await pg.wait_for_timeout(30)
        await pg.mouse.click(1200,250); await pg.wait_for_timeout(300)
        r=await pg.evaluate('({mounted:!!window.__zbmFish,running:window.__zbmFish&&window.__zbmFish.running,fish:window.__zbmFish&&window.__zbmFish.fish.length})')
        print('reduced motion',r,'errors',errs); bad+=len(errs)
        print('BAD',bad); await b.close()
asyncio.run(main())
