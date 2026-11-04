import asyncio
from playwright.async_api import async_playwright
B='http://127.0.0.1:8741/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome'); fails=0
        for w,h,mob in [(1440,900,False),(390,844,True)]:
            ctx=await b.new_context(viewport={'width':w,'height':h},is_mobile=mob,has_touch=mob,device_scale_factor=2 if mob else 1)
            errs=[]
            async def setup():
                pg=await ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)[:150]))
                await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(1200); return pg
            pg=await setup()
            n=await pg.evaluate('document.querySelectorAll(".shelf:not([hidden]) .tape:not([hidden])").length')
            picks=await pg.evaluate('''(()=>{const out=[];document.querySelectorAll(".shelf:not([hidden])").forEach((sh,k)=>{const t=[...sh.querySelectorAll(".tape:not([hidden])")];[1,3].forEach(j=>{if(t[j]&&out.length<6)out.push(+t[j].dataset.i)})});return out})()''')
            await pg.close()
            for k,i in enumerate(picks):
                pg=await setup()
                t=pg.locator(f'.tape[data-i="{i}"]')
                await t.scroll_into_view_if_needed(); await pg.wait_for_timeout(500)
                if mob: await t.tap()
                else: await t.click()
                await pg.wait_for_timeout(900)
                st=await pg.evaluate(f'({{exp:document.querySelector(\'.tape[data-i="{i}"]\').getAttribute("aria-expanded"),hidden:document.getElementById("case").hidden,href:document.querySelector("#case .open").getAttribute("href"),url:location.href}})')
                exp=st['href'].lstrip('./')
                mode=['tape','cover','text','enter','tape','cover'][k]
                if mode=='tape':
                    await t.scroll_into_view_if_needed()
                    if mob: await t.tap()
                    else: await t.click()
                elif mode=='cover':
                    c=pg.locator('#case .case-go'); await c.scroll_into_view_if_needed()
                    if mob: await c.tap()
                    else: await c.click()
                elif mode=='text':
                    c=pg.locator('#case .case-d'); await c.scroll_into_view_if_needed()
                    if mob: await c.tap()
                    else: await c.click()
                else:
                    await t.focus(); await pg.keyboard.press('Enter')
                try: await pg.wait_for_url(f'**/{exp}*',timeout=5000); ok=True
                except Exception: ok=False
                fails+=not ok
                print(w,'book',i,'step1',st['exp'],'case shown',not st['hidden'],'| step2',mode,'->',pg.url.replace(B,'/'),'expected /'+exp,'OK' if ok else 'FAIL')
                await pg.close()
            # drag must not count as a click (mouse) / not navigate
            pg=await setup()
            i=picks[0]; t=pg.locator(f'.tape[data-i="{i}"]'); await t.scroll_into_view_if_needed(); await pg.wait_for_timeout(400)
            if mob: await t.tap()
            else: await t.click()
            await pg.wait_for_timeout(900)
            bb=await t.bounding_box(); x,y=bb['x']+bb['width']/2,bb['y']+bb['height']/2
            if not mob:
                await pg.mouse.move(x,y); await pg.mouse.down(); await pg.mouse.move(x+8,y,steps=4); await pg.mouse.up()
                c=await pg.locator('#case .case-go').bounding_box(); cx,cy=c['x']+c['width']/2,c['y']+c['height']/2
                await pg.mouse.move(cx,cy); await pg.mouse.down(); await pg.mouse.move(cx+7,cy+3,steps=3); await pg.mouse.up()
            else:
                cdp=await ctx.new_cdp_session(pg)
                for (sx,sy) in [(x,y)]:
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':sx,'y':sy}]})
                    for d in range(1,8): await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':sx-d*6,'y':sy}]})
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            await pg.wait_for_timeout(1500)
            still=pg.url.split('#')[0]==B
            print(w,'drag on expanded book -> stays on shelf:',still); fails+=not still
            # middle-click on the cover opens a new tab
            if not mob:
                pops=[]; ctx.on('page',lambda q:pops.append(q))
                await pg.locator('#case .case-go').click(button='middle'); await pg.wait_for_timeout(1200)
                print(w,'middle-click cover -> new tab:',[q.url.replace(B,'/') for q in pops],'shelf still',pg.url.split('#')[0]==B)
            await pg.close()
            print(w,'page errors',errs); fails+=len(errs)
            await ctx.close()
        await b.close(); print('FAILS',fails)
asyncio.run(main())
