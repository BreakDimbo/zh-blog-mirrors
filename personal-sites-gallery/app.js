(function(){
  var root=document.documentElement;
  var grid=document.getElementById('grid'),cards=[].slice.call(grid.querySelectorAll('.card'));
  var q=document.getElementById('q'),count=document.getElementById('count'),empty=document.getElementById('empty');
  var filter='all',sort='likes',shown=cards.length;

  /* ---------- i18n: UI strings exist as [data-l=zh]/[data-l=en] siblings (CSS hides the inactive one);
     dynamic strings + attributes live here. Choice: ?lang= > localStorage > navigator.language ---------- */
  var T={
    zh:{count:function(n){return n+' 个网站';},title:(window.PSG_TITLE||{}).zh},
    en:{count:function(n){return n+(n===1?' site':' sites');},title:(window.PSG_TITLE||{}).en}
  };
  var attrEls=[].slice.call(document.querySelectorAll('[data-i18n-attr]'));
  var toggles=[].slice.call(document.querySelectorAll('[data-setlang]'));
  function lang(){return root.dataset.lang==='zh'?'zh':'en';}
  function setLang(l,persist){
    root.dataset.lang=l;root.lang=l==='zh'?'zh-CN':'en';
    if(T[l].title)document.title=T[l].title;
    attrEls.forEach(function(el){var v=el.getAttribute('data-'+l);if(v!==null)el.setAttribute(el.getAttribute('data-i18n-attr'),v);});
    toggles.forEach(function(a){var on=a.dataset.setlang===l;a.classList.toggle('on',on);a.setAttribute('aria-current',on?'true':'false');});
    count.textContent=T[l].count(shown);
    if(persist){
      try{localStorage.setItem('psg-lang',l);}catch(e){}
      try{var u=new URL(location.href);u.searchParams.set('lang',l);history.replaceState(null,'',u);}catch(e){}
      var c=document.querySelector('link[rel=canonical]');if(c)c.href=c.href.split('?')[0]+'?lang='+l;
    }
  }
  toggles.forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();if(a.dataset.setlang!==lang())setLang(a.dataset.setlang,true);});});

  function apply(){
    var term=(q.value||'').trim().toLowerCase(),terms=term?term.split(/\s+/):[],n=0;
    cards.forEach(function(c){
      var ok=terms.every(function(t){return c.dataset.search.indexOf(t)>-1;});
      if(filter==='rec')ok=ok&&c.dataset.rec==='1';
      if(filter==='self')ok=ok&&c.dataset.rec==='0';
      c.hidden=!ok;if(ok)n++;
    });
    shown=n;count.textContent=T[lang()].count(n);empty.hidden=n>0;
  }
  function order(){
    var arr=cards.slice();
    if(sort==='date')arr.sort(function(a,b){return b.dataset.date-a.dataset.date;});
    else if(sort==='likes')arr.sort(function(a,b){return (b.dataset.likes-a.dataset.likes)||(b.dataset.date-a.dataset.date);});
    else for(var i=arr.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=arr[i];arr[i]=arr[j];arr[j]=t;}
    arr.forEach(function(c,i){c.style.setProperty('--i',i);c.style.animation='none';c.offsetHeight;c.style.animation='';grid.appendChild(c);});
  }
  q.addEventListener('input',apply);
  document.querySelectorAll('[data-f]').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('[data-f]').forEach(function(x){x.classList.toggle('on',x===b);});filter=b.dataset.f;apply();});});
  document.querySelectorAll('[data-s]').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('[data-s]').forEach(function(x){x.classList.toggle('on',x===b);});sort=b.dataset.s;order();apply();});});
  setLang(lang(),false);
  // theme
  document.getElementById('theme').addEventListener('click',function(){
    var dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('psg-theme',root.dataset.theme);}catch(e){}
  });
  // sticky shadow
  var ctr=document.getElementById('controls');
  var io=new IntersectionObserver(function(es){ctr.classList.toggle('stuck',es[0].intersectionRatio<1);},{threshold:[1],rootMargin:'-1px 0px 0px 0px'});
  io.observe(ctr);
  // "/" focuses search
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}});
})();
