/* zh-blog-mirrors · article helpers: sticky TOC on wide screens for long pages (>=4 h2). */
(function(){function init(){var c=document.querySelector('.za-content'),t=document.querySelector('.za-toc');if(!c||!t)return;
var hs=[].slice.call(c.querySelectorAll('h2')).filter(function(h){return !h.closest('.card,nav,aside')&&h.textContent.trim()});
if(c.querySelector('nav.toc,.toc,[class*="toc"],nav[aria-label*="目录"]'))return; /* page has its own TOC */
if(hs.length<4||c.textContent.length<4000)return;var nav=document.createElement('nav');nav.setAttribute('aria-label','目录');
nav.innerHTML='<p class="h">目录 · CONTENTS</p>';var links=[];
hs.forEach(function(h,i){if(!h.id)h.id='s-'+(i+1);var a=document.createElement('a');a.href='#'+h.id;a.textContent=h.textContent.trim().replace(/\s+/g,' ');nav.appendChild(a);links.push(a)});
t.appendChild(nav);t.classList.add('on');t.hidden=false;
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(l){l.classList.toggle('cur',l.getAttribute('href')==='#'+e.target.id)})}})},{rootMargin:'0px 0px -70% 0px'});hs.forEach(function(h){io.observe(h)})}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init()})();
