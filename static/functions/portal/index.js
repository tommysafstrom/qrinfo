// Customer stats portal: GET /portal
// Renders a per-code scan table for the LOGGED-IN customer only; each row expands
// to a daily breakdown. All numbers come from /portal/data, which scopes them to
// the customer behind Cloudflare Access. This handler is just the shell.
//
// Protect /portal/* with a Cloudflare Access application (One-time PIN). The
// /portal/data endpoint also verifies the Access JWT itself (defense in depth).

const PAGE = /* html */ `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Mina QR-skanningar</title>
<style>
  :root { color-scheme: light dark; --muted:#888; --line:#8884; --bg:#fff; --fg:#111; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#14161a; --fg:#e8e8e8; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.45 system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:1rem 1.25rem; border-bottom:1px solid var(--line); display:flex;
           gap:1rem; align-items:baseline; flex-wrap:wrap; }
  h1 { font-size:1.1rem; margin:0; }
  main { padding:1rem 1.25rem; max-width:920px; }
  .muted { color:var(--muted); font-size:.85rem; }
  select { font:inherit; }
  table { width:100%; border-collapse:collapse; margin-top:.75rem; }
  th,td { text-align:left; padding:.4rem .5rem; border-bottom:1px solid var(--line); }
  th.num,td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr.code { cursor:pointer; }
  tr.code:hover { background:var(--line); }
  td.id { font-family:ui-monospace,monospace; }
  .miss { color:#c0392b; }
  tr.daily td { background:var(--line); font-size:.85rem; padding:.25rem .5rem; }
  .bar { display:inline-block; height:.7em; background:currentColor; opacity:.5; vertical-align:baseline; }
  .empty,.error { padding:1rem 0; color:var(--muted); }
  .error { color:#c0392b; }
  /* view toggle */
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .seg button { font:inherit; padding:.3rem .7rem; background:transparent; color:var(--fg);
                border:0; cursor:pointer; }
  .seg button[aria-pressed="true"] { background:var(--fg); color:var(--bg); }
  /* code filter */
  details.filter { position:relative; }
  details.filter > summary { cursor:pointer; list-style:none; padding:.3rem .6rem;
                border:1px solid var(--line); border-radius:6px; }
  details.filter > summary::-webkit-details-marker { display:none; }
  .filter-menu { position:absolute; z-index:5; margin-top:.3rem; max-height:260px; overflow:auto;
                background:var(--bg); border:1px solid var(--line); border-radius:6px;
                padding:.5rem .6rem; min-width:240px; box-shadow:0 6px 24px #0003; }
  .filter-menu label { display:flex; gap:.5rem; align-items:center; padding:.15rem 0;
                font-size:.9rem; cursor:pointer; white-space:nowrap; }
  .filter-actions { display:flex; gap:.75rem; margin:.25rem 0 .5rem; }
  .filter-actions a { font-size:.8rem; color:var(--muted); cursor:pointer; text-decoration:underline; }
  /* chart */
  .chart { margin-top:.75rem; }
  .chart svg { width:100%; height:280px; display:block; }
  .chart .axis { stroke:var(--line); }
  .chart .line { fill:none; stroke:#2b8a3e; stroke-width:2; }
  .chart .area { fill:#2b8a3e22; }
  .chart .dot { fill:#2b8a3e; }
  .chart text { fill:var(--muted); font-size:11px; }
</style>
</head>
<body>
<header>
  <h1>Mina QR-skanningar</h1>
  <span class="seg" id="view" role="group" aria-label="Vy">
    <button data-view="table" aria-pressed="true">Tabell</button>
    <button data-view="graph" aria-pressed="false">Graf</button>
  </span>
  <label class="muted">Period
    <select id="days">
      <option value="1">24 h</option>
      <option value="7">7 dagar</option>
      <option value="30" selected>30 dagar</option>
      <option value="90">90 dagar</option>
      <option value="365">1 år</option>
    </select>
  </label>
  <details class="filter" id="filter">
    <summary class="muted">Koder: <span id="filter-label">alla</span></summary>
    <div class="filter-menu">
      <div class="filter-actions">
        <a id="filter-all">Markera alla</a><a id="filter-none">Avmarkera alla</a>
      </div>
      <div id="filter-list"></div>
    </div>
  </details>
  <span class="muted" id="summary"></span>
</header>
<main>
  <p class="muted">Statistiken uppdateras varje timme. I tabellvyn: klicka på en rad för skanningar per dag. Grafen visar valda koders totala skanningar per dag.</p>
  <div id="body"><p class="empty">Laddar…</p></div>
</main>
<script type="module">
const $ = s => document.querySelector(s);
const enc = encodeURIComponent;
let labels = new Map();
let view = 'table';          // 'table' | 'graph'
let allCodeIds = [];         // every code id the customer owns (from totals)
let selected = new Set();    // currently-checked code ids (filter)

async function loadLabels(){
  // codes.json is public; we only ever look up labels for codes that already
  // appear in our own scoped data, so no other customer's labels are shown.
  try {
    const r = await fetch('/codes.json', { cache:'no-store' });
    const doc = await r.json();
    labels = new Map((doc.codes||[]).map(c => [c.customerId+'-'+c.qid, c.label]));
  } catch {}
}
function labelFor(id){ return labels.get(id) || ''; }
function nameFor(id){ const l = labelFor(id); return l ? id+' · '+l : id; }
function fmtDate(v){ if(!v) return '—'; const d=new Date(String(v).replace(' ','T')); return isNaN(d)?v:d.toLocaleString('sv-SE'); }
const daysVal = () => $('#days').value;

// ── code filter ────────────────────────────────────────────────────────────
// Built from the per-code totals so it lists exactly the customer's own codes.
function buildFilter(totals){
  allCodeIds = totals.map(x => x.id);
  if(!selected.size) allCodeIds.forEach(id => selected.add(id)); // default: all
  // drop any stale selections no longer present
  for(const id of [...selected]) if(!allCodeIds.includes(id)) selected.delete(id);
  const list = $('#filter-list');
  list.innerHTML = allCodeIds.map(id =>
    '<label><input type="checkbox" value="'+id+'"'+(selected.has(id)?' checked':'')+'>'+
    '<span>'+nameFor(id)+'</span></label>').join('') || '<p class="muted">Inga koder.</p>';
  list.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
    cb.checked ? selected.add(cb.value) : selected.delete(cb.value);
    syncFilterLabel(); if(view==='graph') render();   // graph reacts live to filtering
  }));
  syncFilterLabel();
}
function syncFilterLabel(){
  const n = selected.size, total = allCodeIds.length;
  $('#filter-label').textContent = (n===total||!total) ? 'alla' : (n+' av '+total);
}
// codes= param:
//   all selected  → omit (server uses full tenant scope)
//   some selected → explicit list
//   none selected → 'none' sentinel so the graph shows nothing
function selectedParam(){
  if(allCodeIds.length && selected.size === 0) return '&codes=none';
  if(selected.size && selected.size < allCodeIds.length) return '&codes='+enc([...selected].join(','));
  return '';
}

// ── table view ─────────────────────────────────────────────────────────────
async function loadDaily(id, days, container){
  container.innerHTML = '<td colspan="6">Laddar…</td>';
  try {
    const r = await fetch('/portal/data?days='+enc(days)+'&code='+enc(id), {cache:'no-store'});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    const rows = d.rows||[];
    if(!rows.length){ container.innerHTML='<td colspan="6" class="muted">Inga skanningar.</td>'; return; }
    const max = Math.max(...rows.map(x=>x.scans));
    container.innerHTML = '<td colspan="6">'+rows.map(x=>{
      const day = String(x.day).slice(0,10);
      const w = Math.max(2, Math.round(120*x.scans/max));
      return '<div>'+day+' &nbsp;<span class="bar" style="width:'+w+'px"></span> '+x.scans+'</div>';
    }).join('')+'</td>';
  } catch(e){ container.innerHTML='<td colspan="6" class="error">'+e.message+'</td>'; }
}

function renderTable(rows, days){
  const body = $('#body');
  if(!rows.length){ body.innerHTML='<p class="empty">Inga skanningar i perioden.</p>'; return; }
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Kod</th><th>Etikett</th><th class="num">Skanningar</th>'+
    '<th class="num">Träffar</th><th class="num">Miss</th><th>Senast</th></tr></thead>';
  const tb = document.createElement('tbody');
  for(const x of rows){
    const tr = document.createElement('tr');
    tr.className = 'code';
    tr.innerHTML = '<td class="id">'+x.id+'</td><td>'+labelFor(x.id)+'</td>'+
      '<td class="num">'+x.scans+'</td><td class="num">'+x.hits+'</td>'+
      '<td class="num '+(x.misses?'miss':'')+'">'+x.misses+'</td><td>'+fmtDate(x.lastSeen)+'</td>';
    const daily = document.createElement('tr');
    daily.className = 'daily'; daily.hidden = true;
    daily.innerHTML = '<td colspan="6"></td>';
    let loaded = false;
    tr.addEventListener('click', ()=>{
      daily.hidden = !daily.hidden;
      if(!daily.hidden && !loaded){ loaded = true; loadDaily(x.id, days, daily); }
    });
    tb.append(tr, daily);
  }
  t.append(tb);
  body.replaceChildren(t);
}

// ── graph view (dependency-free inline SVG line chart) ──────────────────────
function renderChart(rows){
  const body = $('#body');
  if(!rows.length){ body.innerHTML='<p class="empty">Inga skanningar för valda koder i perioden.</p>'; return; }
  const W=920, H=280, P={t:14,r:14,b:28,l:40};
  const iw=W-P.l-P.r, ih=H-P.t-P.b;
  const max=Math.max(1,...rows.map(r=>r.scans));
  const x=i=> rows.length>1 ? P.l + iw*i/(rows.length-1) : P.l+iw/2;
  const y=v=> P.t + ih*(1 - v/max);
  const pts=rows.map((r,i)=>[x(i),y(r.scans)]);
  const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area=line+' L'+x(rows.length-1).toFixed(1)+' '+y(0)+' L'+x(0).toFixed(1)+' '+y(0)+' Z';
  // y ticks (0, mid, max) and sparse x labels
  const yticks=[0,Math.round(max/2),max];
  const step=Math.max(1,Math.ceil(rows.length/8));
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  let svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Skanningar per dag">';
  svg+='<line class="axis" x1="'+P.l+'" y1="'+(P.t+ih)+'" x2="'+(W-P.r)+'" y2="'+(P.t+ih)+'"/>';
  svg+='<line class="axis" x1="'+P.l+'" y1="'+P.t+'" x2="'+P.l+'" y2="'+(P.t+ih)+'"/>';
  for(const v of yticks){ svg+='<text x="'+(P.l-6)+'" y="'+(y(v)+3)+'" text-anchor="end">'+v+'</text>'; }
  svg+='<path class="area" d="'+area+'"/><path class="line" d="'+line+'"/>';
  rows.forEach((r,i)=>{ if(rows.length<=60) svg+='<circle class="dot" cx="'+x(i).toFixed(1)+'" cy="'+y(r.scans).toFixed(1)+'" r="2"><title>'+esc(r.day)+': '+r.scans+'</title></circle>'; });
  rows.forEach((r,i)=>{ if(i%step===0||i===rows.length-1){ svg+='<text x="'+x(i).toFixed(1)+'" y="'+(P.t+ih+18)+'" text-anchor="middle">'+esc(String(r.day).slice(5))+'</text>'; }});
  svg+='</svg>';
  const div=document.createElement('div'); div.className='chart'; div.innerHTML=svg;
  body.replaceChildren(div);
}

// ── load + render ──────────────────────────────────────────────────────────
async function fetchJson(url){
  const r = await fetch(url, {cache:'no-store'});
  const d = await r.json();
  if(d.error) throw new Error(d.error);
  return d;
}

async function render(){
  const days = daysVal();
  const body = $('#body');
  body.innerHTML = '<p class="empty">Laddar…</p>';
  try {
    if(view==='graph'){
      const d = await fetchJson('/portal/data?series=daily&days='+enc(days)+selectedParam());
      const rows = d.rows||[];
      const total = rows.reduce((s,x)=>s+x.scans,0);
      const nSel = (selected.size && selected.size<allCodeIds.length) ? selected.size : allCodeIds.length;
      $('#summary').textContent = total+' skanningar · '+nSel+' koder · '+d.days+' dagar';
      renderChart(rows);
    } else {
      const d = await fetchJson('/portal/data?days='+enc(days));
      const rows = d.rows||[];
      buildFilter(rows);   // keep the code filter in sync with the latest totals
      const total = rows.reduce((s,x)=>s+x.scans,0);
      $('#summary').textContent = total+' skanningar · '+rows.length+' koder · '+d.days+' dagar';
      renderTable(rows, days);
    }
  } catch(e){ body.innerHTML='<p class="error">Kunde inte ladda statistik: '+e.message+'</p>'; }
}

// Ensure the code filter is populated even if the graph is the first view.
async function ensureFilter(){
  if(allCodeIds.length) return;
  try { buildFilter((await fetchJson('/portal/data?days='+enc(daysVal()))).rows||[]); } catch {}
}

// ── wiring ─────────────────────────────────────────────────────────────────
$('#view').addEventListener('click', async e=>{
  const b = e.target.closest('button[data-view]'); if(!b) return;
  view = b.dataset.view;
  $('#view').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed', String(x===b)));
  if(view==='graph') await ensureFilter();
  render();
});
$('#days').addEventListener('change', render);
$('#filter-all').addEventListener('click', ()=>{
  allCodeIds.forEach(id=>selected.add(id));
  $('#filter-list').querySelectorAll('input').forEach(cb=>cb.checked=true);
  syncFilterLabel(); if(view==='graph') render();
});
$('#filter-none').addEventListener('click', ()=>{
  selected.clear();
  $('#filter-list').querySelectorAll('input').forEach(cb=>cb.checked=false);
  syncFilterLabel(); if(view==='graph') render();
});

await loadLabels();
render();
</script>
</body>
</html>`;

export async function onRequestGet() {
  return new Response(PAGE, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
