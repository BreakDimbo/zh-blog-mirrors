# compare.py -> before-after-{desktop,mobile}.png : live homepage (before) vs hub-glass-r2 (after), light over dark
from PIL import Image,ImageDraw,ImageFont
D='/workspace/hub-preview-shots/hub-glass-r2'
try: F=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
except Exception: F=ImageFont.load_default()
def comp(kind,scale,suf=''):
    rows=[]
    for th in ['light','dark']:
        a=Image.open(f'{D}/before/{kind}-{th}{suf}.png').convert('RGB'); b=Image.open(f'{D}/{kind}-{th}{suf}.png').convert('RGB')
        a=a.resize((int(a.width*scale),int(a.height*scale))); b=b.resize((int(b.width*scale),int(b.height*scale)))
        rows.append((a,b,th))
    w=rows[0][0].width; h=rows[0][0].height; pad=24; top=44
    im=Image.new('RGB',(w*2+pad*3,(h+top)*2+pad*2),(236,232,224)); d=ImageDraw.Draw(im)
    for r,(a,b,th) in enumerate(rows):
        y=pad+r*(h+top+pad//2)
        for c,(x,lab) in enumerate([(a,'BEFORE  live main  ·  '+th),(b,'AFTER  hub-glass-r2  ·  '+th)]):
            X=pad+c*(w+pad); d.text((X,y+8),lab,fill=(40,36,30),font=F); im.paste(x,(X,y+top))
    im.save(f'{D}/before-after-{kind}{suf}.png'); print(kind,im.size)
comp('desktop',0.5); comp('mobile',0.5); comp('mobile',0.5,'-shelves')
