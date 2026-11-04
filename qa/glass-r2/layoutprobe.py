import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for base in ['http://127.0.0.1:8742/','http://127.0.0.1:8741/']:
        ctx=b.new_context(viewport={'width':1440,'height':900}); pg=ctx.new_page(); pg.goto(base,wait_until='networkidle'); pg.wait_for_timeout(3500)
        cdp=ctx.new_cdp_session(pg); cdp.send('Performance.enable')
        g=lambda: {m['name']:m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        bk=pg.evaluate("(()=>{const r=document.querySelector('.shelf .tape').getBoundingClientRect();return [r.top,r.bottom]})()")
        for name,y in [('hero',200),('aboveBooks',bk[0]-20),('books',(bk[0]+bk[1])/2),('below',bk[1]+60)]:
            m0=g()
            for i in range(40): pg.mouse.move(150+i*28,y); pg.wait_for_timeout(40)
            pg.wait_for_timeout(600); m1=g()
            print(base[-6:],name,int(y),'layouts',int(m1['LayoutCount']-m0['LayoutCount']),'recalc',int(m1['RecalcStyleCount']-m0['RecalcStyleCount']),'task',round((m1['TaskDuration']-m0['TaskDuration'])*1000))
        ctx.close()
    b.close()
