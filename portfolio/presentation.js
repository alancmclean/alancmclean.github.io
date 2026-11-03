(() => {
  const scenes = [...document.querySelectorAll('.scene')];
  const names = ['Introduction', 'Google Docs', 'The experience', 'Behind the work', 'Case study two', 'Continue the conversation'];
  const previous = document.querySelector('#previous');
  const next = document.querySelector('#next-chapter');
  const menu = document.querySelector('#chapter-index');
  const toggle = document.querySelector('#index-toggle');
  let current = 0;
  function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  function show() {
    const target = scenes.findIndex(s => '#' + s.id === location.hash);
    current = target < 0 ? 0 : target;
    scenes.forEach((s, i) => { s.classList.toggle('active', i === current); s.inert = i !== current; s.setAttribute('aria-hidden', String(i !== current)); });
    document.body.dataset.scene = scenes[current].id;
    document.querySelector('#page-number').textContent = String(current + 1).padStart(2, '0');
    document.querySelector('#page-label').textContent = names[current];
    document.title = names[current] + ' — Alan McLean';
    document.querySelectorAll('.progress a').forEach((a, i) => i === current ? a.setAttribute('aria-current', 'step') : a.removeAttribute('aria-current'));
    previous.disabled = current === 0; next.disabled = current === scenes.length - 1;
    closeMenu();
  }
  function go(delta) { const s = scenes[current + delta]; if (s) location.hash = s.id; }
  previous.onclick = () => go(-1); next.onclick = () => go(1);
  toggle.onclick = () => { menu.hidden = !menu.hidden; toggle.setAttribute('aria-expanded', String(!menu.hidden)); };
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && !toggle.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenu(); toggle.focus(); return; }
    if (e.target.closest('button,a,input,textarea,[role="tablist"]') || !menu.hidden) return;
    if (['ArrowRight','PageDown'].includes(e.key)) { e.preventDefault(); go(1); }
    if (['ArrowLeft','PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
    if (e.key === 'Home') location.hash = 'intro';
    if (e.key === 'End') location.hash = 'close';
  });
  window.addEventListener('hashchange', () => { show(); const heading = scenes[current].querySelector('h1,h2'); heading.tabIndex = -1; heading.focus({preventScroll:true}); });
  let start;
  document.querySelector('main').addEventListener('touchstart', e => { start = {x:e.changedTouches[0].clientX,y:e.changedTouches[0].clientY}; }, {passive:true});
  document.querySelector('main').addEventListener('touchend', e => { if (!start || e.target.closest('button,a,[role="tablist"]')) return; const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y; if(Math.abs(dx)>80 && Math.abs(dx)>Math.abs(dy)*2) go(dx<0?1:-1); start=null; }, {passive:true});
  const source = 'https://workspaceupdates.googleblog.com/2026/04/new-gemini-capabilities-in-google-docs-help-you-go-from-blank-page-to-brilliance.html';
  const states = [
    {title:'A draft grounded in context.',description:'Help me create synthesizes information from files, email, chat, and the web into a formatted first draft.',html:'<span class="micro">Illustration / Context → draft</span><h3>A starting point,<br>already connected.</h3><p>Turn a brief and relevant source material into a structured document.</p><div class="tokens"><span>Drive</span><span>Gmail</span><span>Chat</span><span>Web</span></div>'},
    {title:'The writer stays in control.',description:'Prompt from the bottom bar or side panel, or select text for a focused edit. Suggested changes remain private until approved.',html:'<span class="micro">Illustration / Private suggestion</span><h3>A clearer way to say it.</h3><p id="sample-edit"><mark>Bring the team’s ideas into one clear plan.</mark></p><button class="demo-action" id="approve">Accept illustrative edit</button><span class="approval" id="approval-status" role="status">Only visible to you until approved</span>'},
    {title:'One document. A coherent whole.',description:'Match writing style aligns tone across a document. Match doc format mirrors a source document’s formatting and structure.',html:'<span class="micro">Illustration / Style & structure</span><h3>A shared voice.<br>A familiar form.</h3><div class="tokens"><span>Consistent tone</span><span>Headings</span><span>Fonts & colors</span><span>Table columns</span></div>'}
  ];
  const tabs=[...document.querySelectorAll('[role="tab"]')];
  function select(index) {
    tabs.forEach((t,i)=>{t.setAttribute('aria-selected',String(i===index));t.tabIndex=i===index?0:-1;});
    document.querySelector('#capability-panel').setAttribute('aria-labelledby', tabs[index].id);
    document.querySelector('#capability-title').textContent=states[index].title;
    document.querySelector('#capability-description').textContent=states[index].description;
    document.querySelector('#capability-source').href=source;
    document.querySelector('#capability-video').href=['https://www.youtube.com/watch?v=5G8KoU0Sjh0','https://www.youtube.com/watch?v=-PlUaej62Sg','https://www.youtube.com/watch?v=2UF3NYT2nLU'][index];
    document.querySelector('#demo').innerHTML=states[index].html;
    const approve=document.querySelector('#approve');
    if(approve) approve.onclick=()=>{const accepted=approve.dataset.accepted==='true';approve.dataset.accepted=String(!accepted);document.querySelector('#sample-edit').innerHTML=accepted?'<mark>Bring the team’s ideas into one clear plan.</mark>':'Bring the team’s ideas into one clear plan.';document.querySelector('#approval-status').textContent=accepted?'Only visible to you until approved':'Illustrative edit accepted · This demo does not change a real document';approve.textContent=accepted?'Accept illustrative edit':'Reset illustration';};
  }
  tabs.forEach((t,i)=>{t.onclick=()=>select(i);t.onkeydown=e=>{let n;if(e.key==='ArrowRight'||e.key==='ArrowDown')n=(i+1)%3;if(e.key==='ArrowLeft'||e.key==='ArrowUp')n=(i+2)%3;if(e.key==='Home')n=0;if(e.key==='End')n=2;if(n!==undefined){e.preventDefault();e.stopPropagation();select(n);tabs[n].focus();}};});
  select(0); show();
})();
