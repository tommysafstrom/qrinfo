const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Internal targets resolve to hosted/<customerId>/<target>.html, so they keep the slug shape.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,30}$/;

// A code is identified by the (customerId, qid) pair. "<customerId>-<qid>".
const codeId = code => `${code.customerId}-${code.qid}`;

// Per-launch URL token — derived from the page path so all server-side
// routes get the right prefix even when the launch URL contains the token.
const PREFIX = (() => {
  const m = window.location.pathname.match(/^(\/[0-9a-f]{32})\//);
  return m ? m[1] : '';
})();
const apiPath = path => `${PREFIX}${path}`;

const state = {
  codes: [],
  // The (customerId, qid) pair being edited, or null when adding.
  editing: null,
};

function setStatus(text) { $('#status').textContent = text; }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(method, path, body) {
  const res = await fetch(apiPath(path), {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error ?? `${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function renderCodeRow(code) {
  const row = document.createElement('div');
  row.className = 'code-row';
  const id = codeId(code);
  row.dataset.customerId = code.customerId;
  row.dataset.qid = code.qid;
  const qrPath = `/api/qr/${code.customerId}/${code.qid}`;
  row.innerHTML = `
    <img class="qr-thumb" src="${apiPath(qrPath)}?format=png&size=80&target=local"
         alt="QR-preview for ${escapeHtml(id)}" width="80" height="80">
    <div class="meta">
      <div class="meta-top">
        <span class="slug">${escapeHtml(id)}</span>
        <span class="badge ${code.type}">${escapeHtml(code.type)}</span>
      </div>
      <span class="label">${escapeHtml(code.label)}</span>
      <span class="target">${escapeHtml(code.target)}</span>
    </div>
    <label class="toggle" title="Enable/disable">
      <input type="checkbox" data-action="toggle" ${code.enabled ? 'checked' : ''}>
      <span>${code.enabled ? 'enabled' : 'disabled'}</span>
    </label>
    <div class="row-actions">
      <a class="btn" href="${apiPath(qrPath)}?format=png&size=512&target=prod" download="${escapeHtml(id)}.png">PNG</a>
      <a class="btn" href="${apiPath(qrPath)}?format=svg&target=prod" download="${escapeHtml(id)}.svg">SVG</a>
      <button type="button" data-action="edit">Edit</button>
      <button type="button" class="danger" data-action="delete">Delete</button>
    </div>
  `;
  return row;
}

function renderCodes() {
  const list = $('#codes-list');
  list.innerHTML = '';
  if (state.codes.length === 0) {
    list.innerHTML = '<p class="loading">No codes yet. Click <strong>+ Add code</strong> to create one.</p>';
    return;
  }
  for (const c of state.codes) list.appendChild(renderCodeRow(c));
}

async function loadCodes() {
  const doc = await api('GET', '/api/codes');
  state.codes = doc.codes;
  renderCodes();
  setStatus(`${state.codes.length} code(s) · ${state.codes.filter(c => c.enabled).length} enabled`);
}

// ─── Dialog form ────────────────────────────────────────────────────────────

function openDialog({ mode, code }) {
  const dialog = $('#code-dialog');
  const form = $('#code-form');
  form.reset();
  clearFieldErrors();

  $('#code-form-title').textContent = mode === 'edit' ? `Edit ${codeId(code)}` : 'Add code';
  state.editing = mode === 'edit' ? { customerId: code.customerId, qid: code.qid } : null;

  const customerIdInput = form.elements.customerId;
  const qidInput = form.elements.qid;
  if (mode === 'edit') {
    customerIdInput.value = code.customerId;
    qidInput.value = code.qid;
    // Identity is immutable once created.
    customerIdInput.disabled = true;
    qidInput.disabled = true;
    form.elements.label.value = code.label;
    form.querySelector(`input[name=type][value=${code.type}]`).checked = true;
    form.elements.target.value = code.target;
    form.elements.enabled.checked = code.enabled;
  } else {
    customerIdInput.disabled = false;
    qidInput.disabled = false;
    form.elements.enabled.checked = true;
  }
  updateTargetHint();
  dialog.showModal();
  customerIdInput.focus();
}

function closeDialog() {
  state.editing = null;
  $('#code-dialog').close();
}

function clearFieldErrors() {
  $$('[data-field-error]').forEach(el => { el.hidden = true; el.textContent = ''; });
  $('#form-error').hidden = true;
}

function showFieldError(field, message) {
  const el = $(`[data-field-error="${field}"]`);
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function showFormError(message) {
  const el = $('#form-error');
  el.textContent = message;
  el.hidden = false;
}

function updateTargetHint() {
  const type = $('input[name=type]:checked', $('#code-form')).value;
  const label = type === 'external' ? 'Target URL' : 'Target page (e.g. "oak")';
  const hint = type === 'external'
    ? 'e.g. https://en.wikipedia.org/wiki/Tulip'
    : 'name of a hosted/<customerId>/<slug>.html file you author by hand';
  $('#target-label').textContent = label;
  $('#target-hint').textContent = hint;
}

function validateForm(values) {
  clearFieldErrors();
  let ok = true;
  if (!Number.isInteger(values.customerId) || values.customerId < 1) {
    showFieldError('customerId', 'must be a positive integer');
    ok = false;
  }
  if (!Number.isInteger(values.qid) || values.qid < 1) {
    showFieldError('qid', 'must be a positive integer');
    ok = false;
  }
  if (values.type === 'internal' && values.target && !SLUG_RE.test(values.target)) {
    showFieldError('target', 'internal target must match hosted/<cid>/<name>.html (lowercase letters/digits/hyphens, 3–31 chars)');
    ok = false;
  }
  if (!values.label || values.label.length > 120) {
    showFieldError('label', 'required, max 120 chars');
    ok = false;
  }
  if (!values.target) {
    showFieldError('target', 'required');
    ok = false;
  } else if (values.type === 'external') {
    try {
      const u = new URL(values.target);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        showFieldError('target', 'must be http(s)://');
        ok = false;
      }
    } catch {
      showFieldError('target', 'must be a valid URL');
      ok = false;
    }
  }
  return ok;
}

async function submitForm(ev) {
  ev.preventDefault();
  const form = ev.target;
  const values = {
    customerId: Number(form.elements.customerId.value),
    qid: Number(form.elements.qid.value),
    label: form.elements.label.value.trim(),
    type: form.elements.type.value,
    target: form.elements.target.value.trim(),
    enabled: form.elements.enabled.checked,
  };
  if (!validateForm(values)) return;

  $('#code-save').disabled = true;
  try {
    if (state.editing) {
      await api('PUT', `/api/codes/${state.editing.customerId}/${state.editing.qid}`, values);
    } else {
      await api('POST', '/api/codes', values);
    }
    closeDialog();
    await loadCodes();
  } catch (err) {
    if (err.body?.issues) {
      for (const issue of err.body.issues) {
        const field = issue.path?.[0];
        if (field) showFieldError(field, issue.message);
      }
    }
    showFormError(err.message);
  } finally {
    $('#code-save').disabled = false;
  }
}

// ─── Row actions ────────────────────────────────────────────────────────────

async function handleListClick(ev) {
  const row = ev.target.closest('.code-row');
  if (!row) return;
  const customerId = Number(row.dataset.customerId);
  const qid = Number(row.dataset.qid);
  const code = state.codes.find(c => c.customerId === customerId && c.qid === qid);
  if (!code) return;
  const id = codeId(code);

  const action = ev.target.dataset.action;
  if (action === 'edit') {
    openDialog({ mode: 'edit', code });
  } else if (action === 'delete') {
    if (!confirm(`Delete code "${id}"? This removes it from the next deploy.`)) return;
    try {
      await api('DELETE', `/api/codes/${customerId}/${qid}`);
      await loadCodes();
    } catch (err) {
      alert(`delete failed: ${err.message}`);
    }
  } else if (action === 'toggle') {
    const checkbox = ev.target;
    const desired = checkbox.checked;
    checkbox.disabled = true;
    try {
      await api('PATCH', `/api/codes/${customerId}/${qid}`, { enabled: desired });
      await loadCodes();
    } catch (err) {
      checkbox.checked = !desired;
      alert(`toggle failed: ${err.message}`);
    } finally {
      checkbox.disabled = false;
    }
  }
}

// ─── Pending changes view ───────────────────────────────────────────────────

function renderBaseline(baseline) {
  const el = $('#diff-baseline');
  if (baseline.kind === 'empty') {
    el.innerHTML = 'No releases deployed yet — every code below will be added on the first deploy.';
  } else if (baseline.kind === 'stale') {
    el.innerHTML = `Could not read codes.json at <code>${escapeHtml(baseline.commit)}</code> (${escapeHtml(baseline.error)}). Diff is against an empty baseline.`;
  } else {
    el.innerHTML = `Comparing working tree against <code>${escapeHtml(baseline.tag)}</code> @ <code>${escapeHtml(baseline.commit.slice(0, 7))}</code>.`;
  }
}

function renderDiffSummary(diff) {
  const el = $('#diff-summary');
  const total = diff.added.length + diff.modified.length + diff.removed.length;
  if (total === 0) {
    el.innerHTML = '<p class="placeholder">No pending changes. The working tree matches the current release.</p>';
  } else {
    el.innerHTML = `
      <p class="diff-counts">
        <span class="badge added">+${diff.added.length} added</span>
        <span class="badge modified">~${diff.modified.length} modified</span>
        <span class="badge removed">−${diff.removed.length} removed</span>
        <span class="badge">${diff.unchanged} unchanged</span>
      </p>
    `;
  }
}

function renderCodeMini(code) {
  return `
    <div class="diff-meta">
      <span class="slug">${escapeHtml(codeId(code))}</span>
      <span class="badge ${code.type}">${escapeHtml(code.type)}</span>
      <span class="label">${escapeHtml(code.label)}</span>
      <span class="target">${escapeHtml(code.target)}</span>
    </div>
  `;
}

function renderModified(entry) {
  const rows = entry.changes.map(field => `
    <tr>
      <th>${escapeHtml(field)}</th>
      <td class="before">${escapeHtml(String(entry.before[field]))}</td>
      <td class="after">${escapeHtml(String(entry.after[field]))}</td>
    </tr>
  `).join('');
  return `
    <article class="diff-card modified">
      <header><span class="slug">${escapeHtml(entry.id)}</span><span class="changes">${entry.changes.length} field(s) changed</span></header>
      <table class="diff-table">
        <thead><tr><th></th><th>before</th><th>after</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>
  `;
}

function renderDiffSections(diff) {
  const out = [];
  if (diff.added.length > 0) {
    out.push(`<section class="diff-section added">
      <h3>Added (${diff.added.length})</h3>
      ${diff.added.map(c => `<article class="diff-card added">${renderCodeMini(c)}</article>`).join('')}
    </section>`);
  }
  if (diff.modified.length > 0) {
    out.push(`<section class="diff-section modified">
      <h3>Modified (${diff.modified.length})</h3>
      ${diff.modified.map(renderModified).join('')}
    </section>`);
  }
  if (diff.removed.length > 0) {
    out.push(`<section class="diff-section removed">
      <h3>Removed (${diff.removed.length})</h3>
      ${diff.removed.map(c => `<article class="diff-card removed">${renderCodeMini(c)}</article>`).join('')}
    </section>`);
  }
  $('#diff-sections').innerHTML = out.join('');
}

async function loadPending() {
  try {
    const diff = await api('GET', '/api/diff');
    renderBaseline(diff.baseline);
    renderDiffSummary(diff);
    renderDiffSections(diff);
  } catch (err) {
    $('#diff-summary').innerHTML = `<p class="form-error">error loading diff: ${escapeHtml(err.message)}</p>`;
  }
}

// ─── Preview pipeline (SSE) ─────────────────────────────────────────────────

function setPhaseStatus(name, status, extra = '') {
  const phases = $('#preview-phases');
  let li = phases.querySelector(`[data-phase="${name}"]`);
  if (!li) {
    li = document.createElement('li');
    li.dataset.phase = name;
    li.innerHTML = `<span class="phase-name"></span><span class="phase-status"></span>`;
    li.querySelector('.phase-name').textContent = name;
    phases.appendChild(li);
  }
  li.dataset.status = status;
  li.querySelector('.phase-status').textContent =
    status === 'start' ? '…' : status === 'done' ? `✓ ${extra}` : `✗ ${extra}`;
}

function appendLog(line) {
  const log = $('#preview-log');
  log.textContent += line + '\n';
  log.scrollTop = log.scrollHeight;
}

async function runPreview() {
  const panel = $('#preview-progress');
  panel.hidden = false;
  $('#preview-phases').innerHTML = '';
  $('#preview-log').textContent = '';
  $('#preview-result').innerHTML = '';
  $('#preview-btn').disabled = true;

  try {
    const res = await fetch(apiPath('/api/preview'), { method: 'POST' });
    if (!res.body) throw new Error('streaming not supported');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let lastEvent = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = parseSse(block);
        if (event) {
          lastEvent = event;
          handlePreviewEvent(event);
        }
      }
    }
    if (!lastEvent || (lastEvent.event !== 'done' && lastEvent.event !== 'error')) {
      $('#preview-result').innerHTML = '<p class="form-error">stream ended unexpectedly</p>';
    }
  } catch (err) {
    $('#preview-result').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  } finally {
    $('#preview-btn').disabled = false;
  }
}

function parseSse(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try { return { event, data: JSON.parse(dataLines.join('\n')) }; }
  catch { return null; }
}

function handlePreviewEvent({ event, data }) {
  if (event === 'phase') {
    if (data.status === 'start') setPhaseStatus(data.name, 'start');
    else if (data.status === 'done') {
      const extra = data.name === 'build'
        ? `${data.enabled} codes built`
        : (data.url ?? '');
      setPhaseStatus(data.name, 'done', extra);
    }
  } else if (event === 'log') {
    appendLog(data.line);
  } else if (event === 'done') {
    const link = data.url
      ? `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener">${escapeHtml(data.url)}</a>`
      : '(no URL)';
    $('#preview-result').innerHTML =
      `<p class="good">✓ Dark site updated. Open: ${link}</p>`;
  } else if (event === 'error') {
    $('#preview-result').innerHTML =
      `<p class="form-error">✗ ${escapeHtml(data.message)}</p>`;
  }
}

// ─── Release view ───────────────────────────────────────────────────────────

const releaseState = { nextN: 1, workingClean: false };

function renderWorkingTree(wt) {
  const el = $('#working-tree-status');
  if (wt.clean) {
    el.innerHTML = '<span class="good">✓ Clean</span> — <code>codes.json</code> is committed.';
    el.classList.remove('loading');
  } else {
    el.innerHTML = `<span class="bad">✗ Dirty</span> — uncommitted changes in: <code>${wt.dirtyFiles.map(escapeHtml).join('</code>, <code>')}</code>. Commit before tagging.`;
    el.classList.remove('loading');
  }
}

function renderNextRelease(next) {
  const el = $('#next-release-preview');
  el.classList.remove('loading');
  if (!next) { el.innerHTML = ''; return; }

  if (next.firstRelease) {
    el.innerHTML = '<p class="hint">This will be the <strong>first</strong> release — the entire current site will be deployed.</p>';
    return;
  }

  const { commits, files, baseTag } = next;
  if (commits.length === 0) {
    el.innerHTML = `<p class="hint">Nothing new since <code>${escapeHtml(baseTag)}</code> — HEAD matches the live release. Commit changes first.</p>`;
    return;
  }

  // file change counts (added / modified / deleted)
  const counts = [];
  if (files.added) counts.push(`<span class="chg added">+${files.added} new</span>`);
  if (files.modified) counts.push(`<span class="chg modified">~${files.modified} changed</span>`);
  if (files.deleted) counts.push(`<span class="chg deleted">−${files.deleted} deleted</span>`);
  const countsHtml = counts.length ? counts.join(' ') : '<span class="hint">no file changes</span>';

  const commitItems = commits
    .map(c => `<li><code class="commit">${escapeHtml(c.sha)}</code> ${escapeHtml(c.subject)}</li>`)
    .join('');

  const fileItems = files.files
    .map(f => `<li><span class="status status-${escapeHtml(f.status)}">${escapeHtml(f.status)}</span> <code>${escapeHtml(f.path)}</code></li>`)
    .join('');

  el.innerHTML = `
    <div class="next-release-head">
      <strong>${commits.length} commit${commits.length === 1 ? '' : 's'}</strong>
      since <code>${escapeHtml(baseTag)}</code> (live) — ${countsHtml}
    </div>
    <details open>
      <summary>Commits (${commits.length})</summary>
      <ul class="commit-list">${commitItems}</ul>
    </details>
    <details>
      <summary>Files changed (${files.files.length})</summary>
      <ul class="file-list">${fileItems || '<li class="hint">none</li>'}</ul>
    </details>
  `;
}

function renderReleaseList(releases) {
  const el = $('#release-list');
  el.classList.remove('loading');
  if (releases.length === 0) {
    el.innerHTML = '<p class="hint">No releases tagged yet.</p>';
    return;
  }
  const rows = releases.map(r => `
    <div class="release-row" data-tag="${escapeHtml(r.tag)}">
      <code class="tag">${escapeHtml(r.tag)}</code>
      <span class="commit">${escapeHtml(r.commit)}</span>
      <span class="date">${escapeHtml(r.date)}</span>
      <button type="button" class="primary" data-action="deploy">Deploy</button>
    </div>
  `).join('');
  el.innerHTML = rows;
}

async function loadRelease() {
  try {
    const data = await api('GET', '/api/releases');
    releaseState.nextN = data.nextN;
    releaseState.workingClean = data.workingTree.clean;
    $('#next-n').textContent = data.nextN;
    $('#tag-btn').disabled = !data.workingTree.clean;
    renderWorkingTree(data.workingTree);
    renderNextRelease(data.nextRelease);
    renderReleaseList(data.releases);
  } catch (err) {
    $('#working-tree-status').innerHTML = `<span class="bad">error: ${escapeHtml(err.message)}</span>`;
  }
}

async function runDeployForTag(tag) {
  if (!confirm(`Deploy ${tag} to production?\nThe current release will move onto the previous stack.`)) return;
  const panel = $('#deploy-progress');
  panel.hidden = false;
  $('#deploy-phases').innerHTML = '';
  $('#deploy-log').textContent = '';
  $('#deploy-result').innerHTML = '';
  $('#deploy-target').textContent = tag;

  try {
    const res = await fetch(apiPath('/api/deploy'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag }),
    });
    if (!res.body) throw new Error('streaming not supported');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = parseSse(block);
        if (event) handleDeployEvent(event);
      }
    }
  } catch (err) {
    $('#deploy-result').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

function setDeployPhase(name, status, extra = '') {
  const phases = $('#deploy-phases');
  let li = phases.querySelector(`[data-phase="${name}"]`);
  if (!li) {
    li = document.createElement('li');
    li.dataset.phase = name;
    li.innerHTML = '<span class="phase-name"></span><span class="phase-status"></span>';
    li.querySelector('.phase-name').textContent = name;
    phases.appendChild(li);
  }
  li.dataset.status = status;
  li.querySelector('.phase-status').textContent =
    status === 'start' ? '…' : status === 'done' ? `✓ ${extra}` : `✗ ${extra}`;
}

function handleDeployEvent({ event, data }) {
  if (event === 'phase') {
    const extra = data.status === 'done'
      ? (data.url ?? (data.enabled !== undefined ? `${data.enabled} codes` : (data.skipped ? '(skipped — OFFLINE)' : '')))
      : (data.message ?? '');
    setDeployPhase(data.name, data.status, extra);
  } else if (event === 'log') {
    const log = $('#deploy-log');
    log.textContent += data.line + '\n';
    log.scrollTop = log.scrollHeight;
  } else if (event === 'done') {
    const link = data.url
      ? `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener">${escapeHtml(data.url)}</a>`
      : '(no URL)';
    $('#deploy-result').innerHTML =
      `<p class="good">✓ ${escapeHtml(data.tag)} is now production. ${link}</p>`;
    // refresh views that depend on state
    loadRelease().catch(() => {});
    loadPending().catch(() => {});
  } else if (event === 'error') {
    $('#deploy-result').innerHTML =
      `<p class="form-error">✗ ${escapeHtml(data.message)}</p>`;
  }
}

async function runTag() {
  const n = releaseState.nextN;
  if (!confirm(`Tag current HEAD as release/${n} and push tags?`)) return;
  $('#tag-btn').disabled = true;
  $('#tag-result').textContent = 'tagging…';
  try {
    const result = await api('POST', '/api/tag', { n });
    $('#tag-result').innerHTML = `<span class="good">✓ ${escapeHtml(result.tag)} → <code>${escapeHtml(result.commit)}</code></span>`;
    await loadRelease();
  } catch (err) {
    $('#tag-result').innerHTML = `<span class="bad">✗ ${escapeHtml(err.message)}</span>`;
    $('#tag-btn').disabled = false;
  }
}

// ─── Releases view (state machine + rollback) ───────────────────────────────

function releaseUrlHtml(entry) {
  return entry.url
    ? `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">${escapeHtml(entry.url)}</a>`
    : '(no url)';
}

function renderReleasesState(state) {
  const el = $('#releases-state');
  const mode = $('#releases-mode');
  mode.textContent = '';

  if (!state.current && state.previous.length === 0) {
    el.innerHTML = '<p class="placeholder">No deploys yet. Tag a release and deploy from the <strong>Release</strong> view to begin.</p>';
    return;
  }

  const parts = [];
  const rollbackTarget = state.previous[0] ?? null;

  // ── Live now, with a single clear rollback action ──
  if (state.current) {
    const c = state.current;
    const rollbackBtn = rollbackTarget
      ? `<button type="button" class="danger" data-action="rollback">↩ Roll back current release</button>
         <p class="rollback-hint">This replaces the live release
           <code>${escapeHtml(c.tag)}</code> with
           <code>${escapeHtml(rollbackTarget.tag)}</code> (the previous one).</p>`
      : `<p class="rollback-hint">No earlier release to roll back to.</p>`;

    parts.push(`
      <article class="live-release">
        <div class="live-badge">● LIVE NOW</div>
        <div class="live-meta">
          <code class="tag big">${escapeHtml(c.tag)}</code>
          <span class="commit">${escapeHtml(c.commit)}</span>
        </div>
        <div class="live-extra">
          <span class="date">deployed ${escapeHtml(c.deployedAt)}</span>
          <span class="url">${releaseUrlHtml(c)}</span>
        </div>
        <div class="live-action">${rollbackBtn}</div>
      </article>
    `);
  }

  // ── History: where rollbacks will walk back through, newest first ──
  if (state.previous.length > 0) {
    parts.push('<h3>Rollback history <span class="hint">(newest first — each rollback steps down one)</span></h3>');
    parts.push('<ol class="history-list">');
    state.previous.forEach((entry, i) => {
      const tag = i === 0
        ? '<span class="badge next-rollback">next rollback target</span>'
        : '';
      parts.push(`
        <li class="history-row">
          <span class="step">${i + 1}</span>
          <code class="tag">${escapeHtml(entry.tag)}</code>
          <span class="commit">${escapeHtml(entry.commit)}</span>
          <span class="date">${escapeHtml(entry.deployedAt)}</span>
          ${tag}
          <button type="button" class="ghost" data-action="deploy" data-tag="${escapeHtml(entry.tag)}">Promote to live</button>
        </li>
      `);
    });
    parts.push('</ol>');
  } else if (state.current) {
    parts.push('<p class="hint">No earlier releases recorded yet — nothing to roll back to.</p>');
  }

  el.innerHTML = parts.join('');
}

async function loadReleases() {
  try {
    const state = await api('GET', '/api/state');
    renderReleasesState(state);
  } catch (err) {
    $('#releases-state').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

async function runRollback() {
  if (!confirm('Roll back to the previous release? The current release will be dropped from the stack but its git tag remains.')) return;
  const panel = $('#rollback-progress');
  panel.hidden = false;
  $('#rollback-phases').innerHTML = '';
  $('#rollback-log').textContent = '';
  $('#rollback-result').innerHTML = '';

  try {
    const res = await fetch(apiPath('/api/rollback'), { method: 'POST' });
    if (!res.body) throw new Error('streaming not supported');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = parseSse(block);
        if (event) handleRollbackEvent(event);
      }
    }
  } catch (err) {
    $('#rollback-result').innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

function setRollbackPhase(name, status, extra = '') {
  const phases = $('#rollback-phases');
  let li = phases.querySelector(`[data-phase="${name}"]`);
  if (!li) {
    li = document.createElement('li');
    li.dataset.phase = name;
    li.innerHTML = '<span class="phase-name"></span><span class="phase-status"></span>';
    li.querySelector('.phase-name').textContent = name;
    phases.appendChild(li);
  }
  li.dataset.status = status;
  li.querySelector('.phase-status').textContent =
    status === 'start' ? '…' : status === 'done' ? `✓ ${extra}` : `✗ ${extra}`;
}

function handleRollbackEvent({ event, data }) {
  if (event === 'phase') {
    const extra = data.status === 'done'
      ? (data.url ?? data.target ?? (data.enabled !== undefined ? `${data.enabled} codes` : (data.skipped ? '(skipped — OFFLINE)' : '')))
      : (data.message ?? '');
    setRollbackPhase(data.name, data.status, extra);
  } else if (event === 'log') {
    const log = $('#rollback-log');
    log.textContent += data.line + '\n';
    log.scrollTop = log.scrollHeight;
  } else if (event === 'done') {
    const link = data.url
      ? `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener">${escapeHtml(data.url)}</a>`
      : '(no URL)';
    $('#rollback-result').innerHTML =
      `<p class="good">✓ Rolled back to ${escapeHtml(data.rolledBackTo)}. ${link}</p>`;
    loadReleases().catch(() => {});
    loadPending().catch(() => {});
    loadRelease().catch(() => {});
  } else if (event === 'error') {
    $('#rollback-result').innerHTML =
      `<p class="form-error">✗ ${escapeHtml(data.message)}</p>`;
  }
}

// ─── Routing ────────────────────────────────────────────────────────────────

const VIEW_LOADERS = {
  codes: loadCodes,
  pending: loadPending,
  release: loadRelease,
  releases: loadReleases,
};

function activateView(name) {
  $$('nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  $$('section.view').forEach(s => s.classList.toggle('active', s.dataset.view === name));
  const load = VIEW_LOADERS[name];
  if (load) load().catch(err => console.error(`load ${name} failed`, err));
}

function setupRouting() {
  const route = () => activateView(location.hash.replace(/^#/, '') || 'codes');
  window.addEventListener('hashchange', route);
  route();
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

async function main() {
  setupRouting();

  $('#add-code-btn').addEventListener('click', () => openDialog({ mode: 'create' }));
  $('#code-cancel').addEventListener('click', closeDialog);
  $('#code-form').addEventListener('submit', submitForm);
  $$('#code-form input[name=type]').forEach(r => r.addEventListener('change', updateTargetHint));
  $('#codes-list').addEventListener('click', handleListClick);
  $('#codes-list').addEventListener('change', handleListClick);
  $('#preview-btn').addEventListener('click', runPreview);
  $('#preview-close').addEventListener('click', () => { $('#preview-progress').hidden = true; });
  $('#tag-btn').addEventListener('click', runTag);
  $('#release-list').addEventListener('click', ev => {
    const row = ev.target.closest('.release-row');
    if (!row) return;
    if (ev.target.dataset.action !== 'deploy') return;
    runDeployForTag(row.dataset.tag);
  });
  $('#deploy-close').addEventListener('click', () => { $('#deploy-progress').hidden = true; });
  $('#releases-state').addEventListener('click', ev => {
    const action = ev.target.dataset.action;
    if (action === 'rollback') runRollback();
    else if (action === 'deploy') runDeployForTag(ev.target.dataset.tag);
  });
  $('#rollback-close').addEventListener('click', () => { $('#rollback-progress').hidden = true; });

  try { await loadCodes(); }
  catch (err) {
    console.error(err);
    setStatus(`error: ${err.message}`);
  }
}

main();
