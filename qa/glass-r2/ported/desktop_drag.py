# 1440 mouse: press-and-drag in empty water draws a trail (no selection, no native drag); drag on text selects; books still click
import asyncio
from playwright.async_api import async_playwright
B='http://127.0.0.1:8741/'; IGN='GPU stall due to ReadPixels'
async def main():
    bad=0
    async with async_playwright() as p:
        for label,args in [('real',[]),('nowebgl',['--disable-webgl','--disable-webgl2'])]:
          b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=args)
          for th in ['light','dark']:
            ctx=await b.new_context(viewport={'width':1440,'height':900})
            await ctx.add_init_script(f'localStorage.setItem("zbm-theme","{th}")')
            await ctx.add_init_script('window.__drag=0;addEventListener("dragstart",()=>window.__drag++,true)')
            pg=await ctx.new_page(); errs=[]
            pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type in('error','warning') and IGN not in m.text else None)
            await pg.goto(B,wait_until='networkidle'); await pg.wait_for_timeout(2500)
            # empty water: right part of the hero, away from text
            x0,y0=1180,140
            el=await pg.evaluate(f'(()=>{{const e=document.elementFromPoint({x0},{y0});return e.tagName+"."+e.className}})()')
            await pg.mouse.move(x0,y0); await pg.mouse.down(); mx=0
            for i in range(1,31):
                await pg.mouse.move(x0-i*12,y0+i*3); await pg.wait_for_timeout(16)
                mx=max(mx,await pg.evaluate('window.__zbmFish.stats.trail'))
            await pg.mouse.up(); await pg.wait_for_timeout(200)
            r=await pg.evaluate('({sel:getSelection().toString(),drag:window.__drag,url:location.href,water:window.__zbmFish.water})')
            ok=mx>2 and r['sel']=='' and r['drag']==0 and r['url']==B; bad+=not ok
            print('OK ' if ok else 'BAD',label,th,'empty-water drag from',el,'trail pts',mx,r)
            # a drag from the bare side margin (body) doesn't select either
            await pg.mouse.move(40,500); await pg.mouse.down(); await pg.mouse.move(400,520,steps=12); await pg.mouse.up()
            sel2=await pg.evaluate('getSelection().toString()'); ok=sel2==''; bad+=not ok
            print('OK ' if ok else 'BAD',label,th,'margin drag selection',repr(sel2[:20]))
            # drag across the intro text selects it
            bb=await pg.evaluate('(()=>{const b=document.querySelector("header.hero .intro").getBoundingClientRect();return [b.left+4,b.top+10,b.left+b.width*0.6]})()')
            await pg.mouse.move(bb[0],bb[1]); await pg.mouse.down(); await pg.mouse.move(bb[2],bb[1],steps=12); await pg.mouse.up()
            sel=await pg.evaluate('getSelection().toString()'); ok=len(sel)>5; bad+=not ok
            print('OK ' if ok else 'BAD',label,th,'text drag selects:',repr(sel[:20]))
            # a click on bare water still clears that selection, and blurs a focused search box
            await pg.mouse.click(1180,140); cleared=await pg.evaluate('getSelection().isCollapsed')
            await pg.focus('#q'); await pg.mouse.click(1180,140); blurred=await pg.evaluate('document.activeElement.id!=="q"')
            ok=cleared and blurred; bad+=not ok; print('OK ' if ok else 'BAD',label,th,'bare-water click clears selection',cleared,'blurs search',blurred)
            # click a book: first click pulls it out (case shown), second enters the article
            t=pg.locator('.tape').nth(3); await t.scroll_into_view_if_needed(); await pg.wait_for_timeout(600)
            await t.click(); await pg.wait_for_timeout(900)
            shown=await pg.evaluate('!document.getElementById("case").hidden')
            href=await pg.evaluate('document.querySelector(".case-go").getAttribute("href")')
            await t.click(); await pg.wait_for_timeout(1500)
            ok=shown and pg.url.rstrip('/').endswith(href.rstrip('/').split('/')[-1]); bad+=not ok
            print('OK ' if ok else 'BAD',label,th,'book click: case shown',shown,'-> navigated',pg.url,'expected',href)
            ok=not errs; bad+=not ok; print('OK ' if ok else 'BAD',label,th,'errors',errs)
            await ctx.close()
          await b.close()
    print('BAD',bad)
asyncio.run(main())
