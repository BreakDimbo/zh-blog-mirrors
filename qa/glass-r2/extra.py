# extra.py BASE -> tabs/search/list view/entrance/hit-tests (books not covered by canvas), month grouping; 1440 & 390, both themes
import sys
from playwright.sync_api import sync_playwright
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8741/'
IGN='GPU stall due to ReadPixels'; bad=0
def P(ok,*a):
    global bad; bad+=not ok; print('OK ' if ok else 'BAD',*a,flush=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for w,h,mob in [(1440,900,False),(390,844,True)]:
      for th in ['light','dark']:
        ctx=b.new_context(viewport={'width':w,'height':h},is_mobile=mob,has_touch=mob,color_scheme=th)
        ctx.add_init_script(f"try{{localStorage.setItem('zbm-theme','{th}');localStorage.removeItem('zbm-view')}}catch(e){{}}")
        pg=ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and IGN not in m.text else None)
        pg.goto(base,wait_until='domcontentloaded'); pg.wait_for_timeout(250)
        pre=pg.evaluate("document.documentElement.getAttribute('data-theme')")
        P(pre==th,w,th,'theme applied pre-paint attr=',pre)
        pg.wait_for_load_state('networkidle')
        # entrance: first shelf slots move right->left, staggered
        if not mob: pg.evaluate("scrollTo(0,0)")
        pg.wait_for_timeout(5000)
        # hit test: book centres hit the tape, never canvas
        pg.evaluate("document.querySelector('.shelf .track').scrollIntoView({block:'center'})"); pg.wait_for_timeout(2500)
        hits=pg.evaluate("""(()=>{const out=[],miss=[];document.querySelectorAll('.shelf .tape').forEach((t,i)=>{const tr=t.closest('.track').getBoundingClientRect(),r=t.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;if(cx<tr.left+24||cx>tr.right-24||cy<0||cy>innerHeight)return;const e=document.elementFromPoint(cx,cy);const ok=!!(e&&t.contains(e));out.push(ok);if(!ok)miss.push(e&&(e.tagName+'.'+e.className))});return [out.length,out.filter(x=>!x).length,miss.slice(0,4)]})()""")
        P(hits[0]>0 and hits[1]==0,w,th,'visible book centres hit their tape',hits)
        z=pg.evaluate("[...document.querySelectorAll('canvas')].map(c=>getComputedStyle(c).zIndex+'/'+getComputedStyle(c).pointerEvents)")
        P(all(x.startswith('-1/none') for x in z),w,th,'canvases below content',z)
        bf=pg.evaluate("[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return (s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none')}).map(e=>e.className)")
        P(True,w,th,'elements with backdrop-filter:',bf)
        n0=pg.evaluate("document.querySelectorAll('.shelf .tape').length")
        # category chip
        chips=pg.evaluate("[...document.querySelectorAll('.chips button')].map(b=>b.textContent)")
        pg.click('.chips button:nth-child(2)'); pg.wait_for_timeout(1500)
        vis=pg.evaluate("[...document.querySelectorAll('.shelf .tape')].filter(t=>t.offsetParent&&getComputedStyle(t).display!=='none').length")
        P(True,w,th,'chips',chips,'tapes all=',n0,'visible after chip2=',vis)
        pg.click('.chips button:nth-child(1)'); pg.wait_for_timeout(800)
        # month tab
        pg.click('.seg button[data-g=month]'); pg.wait_for_timeout(1800)
        ms=pg.evaluate("[document.querySelectorAll('.shelf').length,document.querySelectorAll('.bookend.div').length,document.querySelector('.seg button[data-g=month]').getAttribute('aria-pressed')]")
        P(ms[2]=='true' and ms[0]>0,w,th,'month grouping shelves/dividers/pressed',ms)
        pg.screenshot(path=f'/workspace/hub-preview-shots/hub-glass-r2/iter/month-{w}-{th}.png')
        pg.click('.seg button[data-g=type]'); pg.wait_for_timeout(1500)
        # search
        pg.fill('#q','Claude'); pg.wait_for_timeout(1200)
        sv=pg.evaluate("[...document.querySelectorAll('.shelf .tape, .flat a')].filter(t=>t.getClientRects().length&&getComputedStyle(t).visibility!=='hidden').length")
        P(sv>0 and sv<n0+200,w,th,'search Claude visible items',sv)
        pg.fill('#q',''); pg.wait_for_timeout(800)
        # list view toggle
        pg.click('#view'); pg.wait_for_timeout(800)
        lv=pg.evaluate("[document.documentElement.classList.contains('list-view'),getComputedStyle(document.querySelector('#flat')).display,localStorage.getItem('zbm-view')]")
        P(lv[0] and lv[1]!='none',w,th,'list view on',lv)
        pg.click('#view'); pg.wait_for_timeout(800)
        lv2=pg.evaluate("document.documentElement.classList.contains('list-view')")
        P(not lv2,w,th,'list view off')
        P(not errs,w,th,'page errors',errs)
        ctx.close()
    b.close()
print('BAD',bad)
