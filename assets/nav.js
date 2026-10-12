/* hide the library pill while scrolling down, show on scroll up */
(function(){var n=document.querySelector('.zbm-nav');if(!n)return;var y=scrollY,t=0;
addEventListener('scroll',function(){if(t)return;t=requestAnimationFrame(function(){t=0;var c=scrollY;
n.classList.toggle('zbm-hide',c>y+4&&c>120);if(c<y-4||c<120)n.classList.remove('zbm-hide');y=c;});},{passive:true});})();
