/* Native navigation for the complete AAS client hosted under this dashboard. */
(()=>{
'use strict';
const routes=new Set(['overview','orchestration','advisor','database','execution','workspaces','tasks','agents','approvals','activity','commerce','repository','integrations','settings']);
const frame=document.getElementById('aas-live-frame');let loaded=false;
function current(){const hash=location.hash.slice(1);if(!hash.startsWith('aas-'))return null;const value=hash.slice(4);return routes.has(value.split('/')[0])?value:null;}
function navigate(){const hash=current();if(!hash||!frame)return;if(!loaded){loaded=true;frame.src='./aas/index.html#'+hash;}else if(frame.contentWindow?.location.hash!=='#'+hash)frame.contentWindow.location.hash=hash;}
function theme(){const selected=document.documentElement.dataset.theme;if(['light','dark'].includes(selected))try{frame.contentWindow?.AASTheme?.set(selected);}catch{}}
frame?.addEventListener('load',()=>{theme();try{frame.contentWindow.addEventListener('hashchange',()=>{const hash=frame.contentWindow.location.hash.slice(1);if(!routes.has(hash.split('/')[0])||!current()||location.hash==='#aas-'+hash)return;location.hash='aas-'+hash;});}catch{}});
window.addEventListener('hashchange',navigate);window.addEventListener('aas:navigate',navigate);
new MutationObserver(theme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
navigate();
})();
