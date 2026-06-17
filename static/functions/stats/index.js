// Permanent stats page: GET /stats
// Renders a granular per-code scan table; each row expands to a daily breakdown.
// Data comes from /stats/data (Workers Analytics Engine). All numbers are
// fetched client-side so this handler stays a static-ish shell.
//
// IMPORTANT: protect /stats/* with Cloudflare Access — it reveals scan activity.

const PAGE = /* html */ `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>QR-skanningar · statistik</title>
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
</style>
</head>
<body>
<header>
  <h1>QR-skanningar</h1>
  <label class="muted">Period
    <select id="days">
      <option value="1">24 h</option>
      <option value="7">7 dagar</option>
      <option value="30" selected>30 dagar</option>
      <option value="90">90 dagar</option>
      <option value="365">1 år</option>
    </select>
  </label>
  <span class="muted" id="summary"></span>
</header>
<main>
  <p class="muted">Klicka på en rad för att se skanningar per dag för just den koden.</p>
  <div id="body"><p class="empty">Laddar…</p></div>
</main>
<script type="module">
const $ = s => document.querySelector(s);
let labels = new Map();

async function loadLabels(){
  try {
    const r = await fetch('/codes.json', { cache:'no-store' });
    const doc = await r.json();
    labels = new Map((doc.codes||[]).map(c => [c.customerId+'-'+c.qid, c.label]));
  } catch {}
}
function labelFor(id){ return labels.get(id) || (id==='unknown' ? '(okända skanningar)' : ''); }
function fmtDate(v){ if(!v) return '—'; const d=new Date(String(v).replace(' ','T')+'Z'); return isNaN(d)?v:d.toLocaleString('sv-SE'); }

async function loadDaily(id, days, container){
  container.innerHTML = '<td colspan="6">Laddar…</td>';
  try {
    const r = await fetch('/stats/data?days='+encodeURIComponent(days)+'&code='+encodeURIComponent(id), {cache:'no-store'});
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

async function load(){
  const days = $('#days').value;
  const body = $('#body');
  body.innerHTML = '<p class="empty">Laddar…</p>';
  try {
    const r = await fetch('/stats/data?days='+encodeURIComponent(days), {cache:'no-store'});
    const d = await r.json();
    if(d.error) throw new Error(d.error);
    const rows = d.rows||[];
    const total = rows.reduce((s,x)=>s+x.scans,0);
    $('#summary').textContent = total+' skanningar · '+rows.length+' koder · '+d.days+' dagar';
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
  } catch(e){ body.innerHTML='<p class="error">Kunde inte ladda statistik: '+e.message+'</p>'; }
}

$('#days').addEventListener('change', load);
await loadLabels();
load();
</script>
</body>
</html>`;

export async function onRequestGet() {
  return new Response(PAGE, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
