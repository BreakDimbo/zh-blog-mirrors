(function(){
  var root=document.documentElement,q=document.getElementById('q'),grid=document.getElementById('grid'),cnt=document.getElementById('count'),empty=document.getElementById('empty');
  var cards=[].slice.call(document.querySelectorAll('.card')),filter='',sort='date',shown=cards.length;
  var T={zh:function(n){return n+' 件作品';},en:function(n){return n+(n===1?' work':' works');}};
  function lang(){return root.dataset.lang==='en'?'en':'zh';}
  function setLang(l,persist){
    root.dataset.lang=l;root.lang=l==='zh'?'zh-CN':'en';
    document.querySelectorAll('[data-i18n-attr]').forEach(function(el){el.setAttribute(el.dataset.i18nAttr,el.dataset[l]);});
    document.querySelectorAll('[data-setlang]').forEach(function(a){a.classList.toggle('on',a.dataset.setlang===l);});
    cnt.textContent=T[l](shown);
    if(persist){try{localStorage.setItem('mg-lang',l);var u=new URL(location.href);u.searchParams.set('lang',l);history.replaceState(null,'',u);}catch(e){}}
  }
  document.querySelectorAll('[data-setlang]').forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();setLang(a.dataset.setlang,true);});});
  function apply(){
    var terms=(q.value||'').trim().toLowerCase().split(/\s+/).filter(Boolean),n=0;
    cards.forEach(function(c){
      var ok=terms.every(function(t){return c.dataset.search.indexOf(t)>-1;});
      if(filter.indexOf('type:')===0)ok=ok&&c.dataset.type===filter.slice(5);
      if(filter.indexOf('tool:')===0)ok=ok&&('|'+c.dataset.tools+'|').indexOf('|'+filter.slice(5)+'|')>-1;
      c.hidden=!ok;if(ok)n++;
    });
    shown=n;cnt.textContent=T[lang()](n);empty.hidden=n>0;
  }
  function order(){
    cards.slice().sort(function(a,b){return sort==='likes'?(b.dataset.likes-a.dataset.likes)||(b.dataset.date-a.dataset.date):b.dataset.date-a.dataset.date;})
      .forEach(function(c){grid.appendChild(c);});
  }
  q.addEventListener('input',apply);
  document.querySelectorAll('[data-f]').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('[data-f]').forEach(function(x){x.classList.toggle('on',x===b);});filter=b.dataset.f;apply();});});
  document.querySelectorAll('[data-s]').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('[data-s]').forEach(function(x){x.classList.toggle('on',x===b);});sort=b.dataset.s;order();});});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}});
  document.getElementById('theme').addEventListener('click',function(){
    var dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('mg-theme',root.dataset.theme);}catch(e){}
  });
  // lightbox: embed the original X post (video plays from X; nothing re-hosted)
  var lb=document.getElementById('lb'),body=document.getElementById('lbb'),open=document.getElementById('lbo'),wjs=false;
  function isDark(){return root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;}
  cards.forEach(function(c){c.querySelector('.poster').addEventListener('click',function(){
    var url=c.dataset.url.replace('https://x.com/','https://twitter.com/'),img=c.querySelector('img');
    body.innerHTML='';var bq=document.createElement('blockquote');bq.className='twitter-tweet';bq.setAttribute('data-theme',isDark()?'dark':'light');
    bq.setAttribute('data-dnt','true');bq.setAttribute('data-conversation','none');bq.setAttribute('data-lang',lang()==='zh'?'zh-cn':'en');
    var a=document.createElement('a');a.href=url;var im=document.createElement('img');im.src=img.src;im.alt=img.alt;a.appendChild(im);bq.appendChild(a);body.appendChild(bq);
    open.href=c.dataset.url;
    if(lb.showModal)lb.showModal();else lb.setAttribute('open','');
    if(window.twttr&&twttr.widgets)twttr.widgets.load(body);
    else if(!wjs){wjs=true;var s=document.createElement('script');s.async=true;s.src='https://platform.twitter.com/widgets.js';document.body.appendChild(s);}
  });});
  function close(){lb.close?lb.close():lb.removeAttribute('open');body.innerHTML='';}
  document.getElementById('lbx').addEventListener('click',close);
  lb.addEventListener('click',function(e){if(e.target===lb)close();});
  lb.addEventListener('close',function(){body.innerHTML='';});
  setLang(lang(),false);apply();
})();
