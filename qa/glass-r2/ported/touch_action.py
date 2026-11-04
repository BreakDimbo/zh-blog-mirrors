# 390 touch: touch-action placement, shelf horizontal swipe, vertical scroll, pinch-zoom, touch trail in the hero
import asyncio
from playwright.async_api import async_playwright
B='http://127.0.0.1:8741/'
IGN='GPU stall due to ReadPixels'
async def main():
    bad=0
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for th in ['light','dark']:
            ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2)
            await ctx.add_init_script(f'localStorage.setItem("zbm-theme","{th}")')
            pg=await ctx.new_page(); errs=[]
            pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type in('error','warning') and IGN not in m.text else None)
            await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(2500)
            cdp=await ctx.new_cdp_session(pg)
            ta=await pg.evaluate('''(()=>{const g=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).touchAction:'(none)'};return {html:g('html'),body:g('body'),top:g('.wrap > .top'),hero:g('header.hero'),bar:g('.bar'),shelves:g('.shelves'),track:g('.track'),tape:g('.tape'),footer:g('.wrap > footer'),docScrollX:document.documentElement.scrollWidth-document.documentElement.clientWidth}})()''')
            exp={'html':'auto','body':'auto','top':'pan-y pinch-zoom','hero':'pan-y pinch-zoom','bar':'auto','shelves':'auto','track':'auto','tape':'pan-x pan-y','footer':'pan-y pinch-zoom'}
            ok=all(ta[k]==v for k,v in exp.items()) and ta['docScrollX']==0; bad+=not ok
            print('OK ' if ok else 'BAD',th,'touch-action',ta)
            async def gesture(x,y,dx,dy):  # a real touch sequence through the input pipeline
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                for i in range(1,21):
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/20,'y':y+dy*i/20}]}); await pg.wait_for_timeout(16)
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); await pg.wait_for_timeout(700)
            async def pinch(x,y,d0,d1):
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x-d0,'y':y,'id':1},{'x':x+d0,'y':y,'id':2}]})
                for i in range(1,21):
                    d=d0+(d1-d0)*i/20
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x-d,'y':y,'id':1},{'x':x+d,'y':y,'id':2}]}); await pg.wait_for_timeout(16)
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); await pg.wait_for_timeout(700)
            # 1) shelf horizontal swipe (first track scrolled into view)
            await pg.evaluate('document.querySelector(".track").scrollIntoView({block:"center"})'); await pg.wait_for_timeout(500)
            r=await pg.evaluate('(()=>{const t=document.querySelector(".track"),b=t.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height*0.6,sl:t.scrollLeft,sy:scrollY}})()')
            await gesture(r['x']+120,r['y'],-240,0)
            r2=await pg.evaluate('({sl:document.querySelector(".track").scrollLeft,sy:scrollY,url:location.pathname,case:!document.getElementById("case").hidden})')
            ok=r2['sl']>r['sl']+60 and r2['url']=='/' ; bad+=not ok
            print('OK ' if ok else 'BAD',th,'shelf swipe scrollLeft',r['sl'],'->',r2['sl'],'url',r2['url'])
            # 2) vertical scroll starting on a shelf row and on the hero
            await gesture(r['x'],r['y'],0,-300); sy1=await pg.evaluate('scrollY')
            ok=sy1>r2['sy']+100; bad+=not ok; print('OK ' if ok else 'BAD',th,'vertical scroll from shelf',r2['sy'],'->',sy1)
            await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(300)
            await gesture(200,330,0,-300); sy2=await pg.evaluate('scrollY')
            ok=sy2>100; bad+=not ok; print('OK ' if ok else 'BAD',th,'vertical scroll from hero 0 ->',sy2)
            await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(300)
            # 3) pinch-zoom on the hero (pan-y pinch-zoom) and on a shelf
            for name,xy in [('hero',(200,330)),('footer',None)]:
                if xy is None:
                    await pg.evaluate('document.querySelector(".wrap > footer").scrollIntoView({block:"center"})'); await pg.wait_for_timeout(400)
                    xy=await pg.evaluate('(()=>{const b=document.querySelector(".wrap > footer").getBoundingClientRect();return [195,Math.round(b.top+b.height/2)]})()')
                x,y=xy
                await pinch(x,y,40,120)
                sc=await pg.evaluate('visualViewport.scale'); ok=sc>1.3; bad+=not ok
                print('OK ' if ok else 'BAD',th,'pinch-zoom on',name,'scale',round(sc,2))
                await pinch(x,y,120,40)
            await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(300)
            # 4) touch trail in the hero: a sideways drag (no hold) and a hold-then-drag; trail points counted while drawing
            async def touchdrag(x0,y0,dx,dy,hold):
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x0,'y':y0}]})
                if hold: await pg.wait_for_timeout(320)
                mx=0
                for i in range(1,21):
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x0+dx*i/20,'y':y0+dy*i/20}]}); await pg.wait_for_timeout(16)
                    mx=max(mx,await pg.evaluate('window.__zbmFish.stats.trail'))
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); await pg.wait_for_timeout(200)
                return mx
            free=await pg.evaluate('(()=>{const h=document.querySelector("header.hero").getBoundingClientRect();return [Math.round(h.left+60),Math.round(h.bottom-70)]})()')
            el=await pg.evaluate(f'(()=>{{const e=document.elementFromPoint({free[0]},{free[1]});return e.tagName+"."+e.className}})()')
            t1=await touchdrag(free[0],free[1],240,10,False); await pg.wait_for_timeout(3600)
            t2=await touchdrag(free[0],free[1],200,40,True); await pg.wait_for_timeout(3600)
            sy3=await pg.evaluate('scrollY')
            t3=await touchdrag(free[0],free[1],0,-200,False)  # vertical swipe: a scroll, no trail
            await pg.evaluate('scrollTo(0,0)'); await pg.wait_for_timeout(3600)
            # control: the same sideways drag with the default touch-action
            await pg.add_style_tag(content='.wrap > .top, header.hero, .wrap > footer{touch-action:auto}'); await pg.wait_for_timeout(200)
            t4=await touchdrag(free[0],free[1],240,10,False)
            ok=t1>2 and t2>2 and t3==0; bad+=not ok
            print('OK ' if ok else 'BAD',th,'touch trail at',free,el,'| sideways pts',t1,'| hold+drag pts',t2,'| vertical swipe pts',t3,'| control w/o pan-y sideways pts',t4)
            ok=not errs; bad+=not ok; print('OK ' if ok else 'BAD',th,'errors',errs)
            await ctx.close()
        await b.close()
    print('BAD',bad)
asyncio.run(main())
