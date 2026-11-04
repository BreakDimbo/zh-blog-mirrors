import asyncio
from playwright.async_api import async_playwright
B='http://127.0.0.1:8741/'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome'); bad=0
        for th in ['light','dark']:
            ctx=await b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2,color_scheme=th)
            await ctx.add_init_script(f'localStorage.setItem("zbm-theme","{th}")')
            errs=[]
            for i in [1,8,14]:
                pg=await ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)[:120]))
                await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(1200)
                t=pg.locator(f'.tape[data-i="{i}"]'); await t.scroll_into_view_if_needed(); await pg.wait_for_timeout(400)
                cdp=await ctx.new_cdp_session(pg)
                async def drag(x,y,dx,dy):
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
                    for k in range(1,5): await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*k/4,'y':y+dy*k/4}]}); await asyncio.sleep(0.016)
                    await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                await t.tap(); await pg.wait_for_timeout(900)
                exp=await t.get_attribute('aria-expanded'); href=(await pg.get_attribute('#case .open','href')).lstrip('./')
                res=[]
                for name,loc in [('spine',t),('cover',pg.locator('#case .case-go'))]:
                    await loc.scroll_into_view_if_needed(); await pg.wait_for_timeout(300)
                    bb=await loc.bounding_box(); x,y=bb['x']+bb['width']/2,bb['y']+bb['height']/2
                    for (dx,dy) in [(8,0),(0,8)]:
                        await drag(x,y,dx,dy); await pg.wait_for_timeout(1200)
                        stay=pg.url.split('#')[0]==B and await t.get_attribute('aria-expanded')=='true'
                        res.append(f'{name} drag{dx},{dy}:{"stay" if stay else "LEFT "+pg.url}'); bad+=not stay
                        if pg.url.split('#')[0]!=B: await pg.goto(B); break
                # second tap enters
                await t.scroll_into_view_if_needed(); await t.tap()
                try: await pg.wait_for_url(f'**/{href}*',timeout=5000); ok=True
                except Exception: ok=False
                bad+=not ok or exp!='true'
                print(th,'book',i,'tap->expanded',exp,'|',' '.join(res),'| 2nd tap ->',pg.url.replace(B,'/'),'OK' if ok else 'FAIL')
                await pg.close()
            # an 8px drag on a collapsed book doesn't expand it
            pg=await ctx.new_page(); await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(1000)
            t=pg.locator('.tape[data-i="3"]'); await t.scroll_into_view_if_needed(); bb=await t.bounding_box()
            cdp=await ctx.new_cdp_session(pg)
            x,y=bb['x']+bb['width']/2,bb['y']+bb['height']/2
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            for k in range(1,5): await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y+2*k}]})
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); await pg.wait_for_timeout(900)
            print(th,'8px drag on collapsed book -> expanded:',await t.get_attribute('aria-expanded'))
            await pg.close()
            print(th,'errors',errs); bad+=len(errs); await ctx.close()
        await b.close(); print('BAD',bad)
asyncio.run(main())
