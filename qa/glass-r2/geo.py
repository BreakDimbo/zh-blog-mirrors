import sys
from playwright.sync_api import sync_playwright
url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8741/'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for vp in [(1440,900),(390,844)]:
        pg=b.new_page(viewport={'width':vp[0],'height':vp[1]}); pg.goto(url,wait_until='networkidle'); pg.wait_for_timeout(1500)
        print(vp,pg.evaluate("""(()=>{const q=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.top),Math.round(r.bottom)]};
        return {hero:q('header.hero'),today:q('.today'),bar:q('.bar'),sh:q('.shelf .sh'),track:q('.shelf .track'),unit:q('.shelf .unit'),board:q('.shelf .board'),ledge:q('.shelf .ledge')}})()"""))
    b.close()
