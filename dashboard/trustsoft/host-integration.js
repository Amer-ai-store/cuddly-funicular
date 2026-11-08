(() => {
 'use strict';
 const button=document.getElementById('trustsoft-toggle');
 const container=document.getElementById('trustsoft-container');
 const frame=document.getElementById('trustsoft-frame');
 if(!button||!container||!frame)return;
 function close(){
  container.hidden=true;frame.removeAttribute('src');
  button.setAttribute('aria-expanded','false');button.textContent='فتح لوحة TrustSoft هنا';
 }
 button.addEventListener('click',()=>{
  if(!container.hidden){close();return;}
  container.hidden=false;frame.src='./trustsoft/';
  button.setAttribute('aria-expanded','true');button.textContent='إغلاق TrustSoft ومسح جلسة العرض';
 });
 window.addEventListener('hashchange',()=>{if(location.hash!=='#jawafa-trustsoft')close();});
 window.addEventListener('pagehide',close);
 const section=button.closest('section.view');
 if(section)new MutationObserver(()=>{if(section.hidden)close();}).observe(section,{attributes:true,attributeFilter:['hidden']});
})();
