from playwright.sync_api import sync_playwright
out='/workspace/hub-preview-shots/hub-glass-r2/iter'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for th in ['light','dark']:
        ctx=b.new_context(viewport={'width':1440,'height':900},device_scale_factor=2,color_scheme=th)
        ctx.add_init_script(f"localStorage.setItem('zbm-theme','{th}')")
        pg=ctx.new_page(); pg.goto('http://127.0.0.1:8741/',wait_until='networkidle'); pg.wait_for_timeout(3000)
        pg.evaluate("(()=>{const t=document.querySelectorAll('.shelf .track')[1];t.scrollIntoView({block:'center'});t.scrollLeft=t.scrollWidth})()"); pg.wait_for_timeout(2500)
        pg.screenshot(path=f'{out}/end-{th}.png',scale='css')
        ctx.close()
    b.close()
