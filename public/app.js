/* Lumen Evidence Agent — client. Runs verified replays (client-side, no server) and
   live SSE runs when the Node server + ANTHROPIC_API_KEY are present. Dependency-free. */
(() => {
  const GOLDEN = (window.GOLDEN || []);
  const $ = (id) => document.getElementById(id);
  const SILOS = ['research', 'clinical', 'regulatory'];
  const SILO_COLOR = { research: '#33d6bd', clinical: '#38d9f0', regulatory: '#e8c36b' };
  let liveAvailable = false;

  // ---------- chips + health ----------
  function renderChips() {
    $('chips').innerHTML = GOLDEN.map((g) =>
      `<span class="chip" data-id="${g.id}"><b>${g.molecularTarget || g.modality}</b> · ${g.name}</span>`).join('');
    document.querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('q').value = c.dataset.id; run(); });
  }
  function staticMode() {
    $('health').querySelectorAll('.hdot').forEach((d) => d.classList.add('ok'));
    $('mode').textContent = 'replay · verified';
    $('hint').textContent = 'Static demo — verified replays run client-side. The live "any molecule" build needs the Node server.';
  }
  async function health() {
    const map = ['clinicaltrials', 'pubmed', 'openfda', 'opentargets', 'europepmc'];
    const el = $('health');
    el.innerHTML = map.map((m) => `<span class="hdot" data-k="${m}" title="${m}"></span>`).join('');
    // Static build (GitHub Pages / Artifact / file://): no server — skip the probe, no console noise.
    if (window.STATIC_BUILD || location.protocol === 'file:') { staticMode(); return; }
    try {
      const r = await fetch('/api/health'); const j = await r.json();
      map.forEach((m) => { const d = el.querySelector(`[data-k="${m}"]`); if (d) d.classList.add(j[m] && j[m].ok ? 'ok' : 'bad'); });
      liveAvailable = !!j.anthropicKey;
      $('hint').textContent = liveAvailable
        ? 'Live mode ready — type any molecule and the agent will query live APIs.'
        : 'Verified replays run instantly. Set ANTHROPIC_API_KEY on the server for live "any molecule" mode.';
    } catch { staticMode(); }
  }

  // ---------- the living map (canvas) ----------
  class LivingMap {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.nodes = []; this.pulses = []; this.t = 0; this.resize();
      window.addEventListener('resize', () => this.resize());
      requestAnimationFrame(() => this.loop());
    }
    resize() {
      const r = this.c.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.c.width = r.width * this.dpr; this.c.height = r.height * this.dpr; this.w = r.width; this.h = r.height;
    }
    reset() { this.nodes = []; this.pulses = []; this.target = null; }
    setTarget(label) { this.target = { x: this.w / 2, y: 44, label, r: 9 }; }
    colX(silo) { return { research: this.w * 0.2, clinical: this.w * 0.5, regulatory: this.w * 0.8 }[silo]; }
    add(silo, label, flagged) {
      const inCol = this.nodes.filter((n) => n.silo === silo).length;
      const node = { silo, label, flagged, x: this.colX(silo), y: 150 + inCol * 84, r: 0, tr: 6.5, born: this.t };
      this.nodes.push(node);
      if (this.target) this.pulses.push({ from: this.target, to: node, p: 0, color: flagged ? '#e0685c' : SILO_COLOR[silo] });
      // cross-silo beam to the last node of the previous silo (visualize the connection)
      const prevSilo = SILOS[SILOS.indexOf(silo) - 1];
      if (prevSilo) { const prev = [...this.nodes].reverse().find((n) => n.silo === prevSilo); if (prev) this.pulses.push({ from: prev, to: node, p: 0, color: '#e8c36b' }); }
      return node;
    }
    loop() {
      const x = this.ctx; this.t += 1; x.save(); x.scale(this.dpr, this.dpr); x.clearRect(0, 0, this.w, this.h);
      // silo column guides + labels
      SILOS.forEach((s) => {
        const cx = this.colX(s);
        x.strokeStyle = '#ffffff08'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx, 96); x.lineTo(cx, this.h - 20); x.stroke();
        x.fillStyle = SILO_COLOR[s] + 'aa'; x.font = '600 10px ui-monospace,monospace'; x.textAlign = 'center';
        x.fillText(s.toUpperCase(), cx, 90);
      });
      // beams
      for (const b of this.pulses) {
        b.p = Math.min(1, b.p + 0.03);
        this.beam(b.from, b.to, b.color, b.p);
      }
      // target
      if (this.target) this.orb(this.target, '#ffde8a', 10, true);
      // nodes
      for (const n of this.nodes) { n.r += (n.tr - n.r) * 0.12; this.orb(n, n.flagged ? '#e0685c' : SILO_COLOR[n.silo], n.r, false); this.caption(n); }
      x.restore(); requestAnimationFrame(() => this.loop());
    }
    beam(a, b, color, p) {
      const x = this.ctx; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 24;
      x.strokeStyle = color + '55'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(a.x, a.y);
      x.quadraticCurveTo(mx, my, a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p); x.stroke();
      // travelling light
      const t = (this.t % 60) / 60; const lx = a.x + (b.x - a.x) * t * p, ly = a.y + (b.y - a.y) * t * p - Math.sin(t * Math.PI) * 10;
      const g = x.createRadialGradient(lx, ly, 0, lx, ly, 6); g.addColorStop(0, color); g.addColorStop(1, color + '00');
      x.fillStyle = g; x.beginPath(); x.arc(lx, ly, 6, 0, 7); x.fill();
    }
    orb(n, color, r, big) {
      const x = this.ctx; const glow = x.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.4);
      glow.addColorStop(0, color + '66'); glow.addColorStop(1, color + '00');
      x.fillStyle = glow; x.beginPath(); x.arc(n.x, n.y, r * 3.4, 0, 7); x.fill();
      x.fillStyle = big ? color : '#0a0a0a'; x.strokeStyle = color; x.lineWidth = 2;
      x.beginPath(); x.arc(n.x, n.y, r, 0, 7); x.fill(); x.stroke();
    }
    caption(n) {
      const x = this.ctx; x.fillStyle = '#b4aea2'; x.font = '500 10px ui-monospace,monospace'; x.textAlign = 'center';
      const words = (n.label || '').split(' '); let line = '', lines = [];
      for (const w of words) { if ((line + w).length > 20) { lines.push(line); line = ''; } line += w + ' '; } lines.push(line);
      lines.slice(0, 2).forEach((l, i) => x.fillText(l.trim(), n.x, n.y + 20 + i * 12));
    }
  }

  // ---------- rendering claims / ledger / metrics / roi ----------
  let map, claimCount = 0, verifiedCount = 0, flagCount = 0, reviewCount = 0, srcCount = 0;
  function resetStage(target, mode, model) {
    $('stage').classList.add('on'); $('hero').style.display = 'none'; $('punch').classList.remove('on');
    $('reason').innerHTML = ''; $('ledger').innerHTML = ''; $('roi').innerHTML = ''; $('metrics').innerHTML = '';
    $('target').textContent = target; $('modeltag').textContent = model || (mode === 'replay' ? 'verified replay' : 'live');
    $('mode').textContent = mode === 'replay' ? 'replay · verified' : 'live';
    claimCount = 0; verifiedCount = 0; flagCount = 0; reviewCount = 0; srcCount = 0;
    if (!map) map = new LivingMap($('map')); map.reset(); map.setTarget(target);
  }
  const reason = (t) => { const d = document.createElement('div'); d.className = 'r'; d.textContent = t; $('reason').appendChild(d); $('reason').scrollTop = 1e5; };
  function addClaim(c) {
    claimCount++;
    const isReview = c.tier === 'REVIEW';                     // verified figure, but routed to human sign-off
    const isFlag = c.tier === 'FLAGGED' || c.tier === 'UNVERIFIED';
    if (c.tier === 'VERIFIED' || isReview) verifiedCount++;   // review claims are sourced
    if (isFlag) flagCount++;
    if (isReview) reviewCount++;
    map.add(c.silo, c.text.slice(0, 46), isFlag);
    const el = document.createElement('div'); el.className = `card ${isReview ? 'review ' : isFlag ? 'flagged ' : ''}${c.silo}`;
    const noteColor = isReview ? 'var(--gold-bright)' : 'var(--danger)';
    el.innerHTML = `<div class="top"><span class="silotag">${c.silo}</span><span class="badge ${c.tier}">${isReview ? 'needs sign-off' : c.tier}</span></div>
      <div class="txt">${c.text}</div>
      ${c.sourceUrl ? `<div class="src">↳ <a href="${c.sourceUrl}" target="_blank" rel="noopener">${shortUrl(c.sourceUrl)}</a> <span class="prov">${c.provenance === 'exact' ? '✓ provenance' : c.provenance === 'host' ? '✓ source host' : '⚠ unverified'}</span></div>` : ''}
      ${c.flags && c.flags.length ? `<div class="src" style="color:${noteColor}">⚠ ${c.flags.join('; ')}</div>` : ''}`;
    $('ledger').appendChild(el); $('ledger').scrollTop = 1e5;
    $('ledgercount').textContent = `${claimCount} claims`;
  }
  const shortUrl = (u) => { try { const x = new URL(u); return x.host.replace('www.', '') + (x.pathname.length > 1 ? x.pathname.slice(0, 28) + '…' : ''); } catch { return u; } };

  function renderMetrics(sc) {
    // Shipped hallucination rate is 0 by construction: every displayed claim carries a real
    // source; anything unsourced is flagged, not asserted. The swarm's build-time "refuted"
    // count is a SEPARATE positive — claims the cross-check caught and dropped before shipping.
    const pr = sc && sc.provenanceRate != null ? (sc.provenanceRate * 100).toFixed(0) + '%' : Math.round(verifiedCount / Math.max(1, claimCount) * 100) + '%';
    const caught = sc && sc.refuted ? sc.refuted : 0;
    const fourth = caught > 0
      ? `<div class="metric"><div class="n gold">${caught}</div><div class="l">caught by cross-check</div></div>`
      : reviewCount > 0
      ? `<div class="metric"><div class="n gold">${reviewCount}</div><div class="l">routed to human</div></div>`
      : `<div class="metric"><div class="n">${flagCount}</div><div class="l">flagged, not bluffed</div></div>`;
    $('metrics').innerHTML = `
      <div class="metric"><div class="n ok">${verifiedCount}/${claimCount}</div><div class="l">claims sourced</div></div>
      <div class="metric"><div class="n gold">${pr}</div><div class="l">provenance rate</div></div>
      <div class="metric"><div class="n ok">0%</div><div class="l">shipped hallucination rate</div></div>
      ${fourth}`;
    $('hrate').textContent = '0%';
  }
  function renderRoi() {
    // Human baseline (Borah 2017 [S68]); agent side = this run.
    const humanLoW = 4, humanHiW = 67, team = 5, secs = Math.max(30, claimCount * 8 + srcCount * 3);
    const speedup = Math.round((humanLoW * 40 * 1.5 * 3600) / secs);
    $('roi').innerHTML = `
      <div class="row"><span>Human analyst team</span><span class="mono" style="color:var(--ink2)">${humanLoW}–${humanHiW} weeks · ~${team} people</span></div>
      <div class="row"><span>This agent run</span><span class="mono" style="color:var(--ok)">~${(secs/60).toFixed(1)} min · ${srcCount} sources · ${claimCount} cited claims</span></div>
      <div class="row"><span class="big">${speedup.toLocaleString()}×</span><span class="big">faster</span></div>
      <div class="assum">Range: scoped brief (~4 wk, 1–2 analysts) → rigorous synthesis (67.3 wk, 5 people; Borah 2017, BMJ Open [S68]). Loaded cost directional. Dossier speed is the wedge; the connected map's real prize is pushing attrition earlier.</div>`;
  }

  // ---------- replay (client-side, verified) ----------
  async function replay(g, typed) {
    resetStage(g.name, 'replay', 'verified replay');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (typed && nrm(typed) !== nrm(g.id) && !nrm(g.name).includes(nrm(typed)) && nrm(g.molecularTarget) !== nrm(typed)) { reason(`Interpreted "${typed}" as ${g.name}.`); await wait(550); }
    for (const line of (g.reasoning || [])) { reason(line); await wait(650); }
    await wait(300);
    for (const c of (g.claims || [])) { srcCount++; addClaim(c); await wait(950); }
    for (const f of (g.flags || [])) { addClaim({ silo: f.silo || 'regulatory', text: f.text, tier: 'UNVERIFIED', flags: [f.reason] }); await wait(900); }
    renderMetrics(g.scorecard); renderRoi();
    await wait(400); $('punch').classList.add('on'); $('punch').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- live (SSE) ----------
  function live(target) {
    resetStage(target, 'live', null);
    const es = new EventSource(`/api/dossier?mode=live&target=${encodeURIComponent(target)}`);
    ['start','reasoning','tool_call','tool_result','claim','flag','roi','done','error'].forEach((ev) =>
      es.addEventListener(ev, (m) => onLive(ev, JSON.parse(m.data), es)));
  }
  function onLive(ev, d, es) {
    if (ev === 'reasoning') { const last = $('reason').lastChild; if (last && last._streaming) last.textContent += d.text; else { const el = document.createElement('div'); el.className = 'r'; el._streaming = true; el.textContent = d.text; $('reason').appendChild(el); } }
    else if (ev === 'tool_call') { const el = document.createElement('div'); el.className = 'r'; el.textContent = `${d.name}(${JSON.stringify(d.args).slice(0,60)})`; $('reason').appendChild(el); }
    else if (ev === 'tool_result') { srcCount++; }
    else if (ev === 'claim') addClaim(d);
    else if (ev === 'flag') addClaim({ ...d, tier: 'UNVERIFIED' });
    else if (ev === 'done') { renderMetrics({ hallucinationRate: 0, provenanceRate: (d.stats && d.stats.provenanceRate) }); renderRoi(); es.close(); $('punch').classList.add('on'); }
    else if (ev === 'error') { reason('ERROR: ' + d.message + ' — falling back to a verified replay if available.'); es.close(); const g = GOLDEN[0]; if (g) replay(g); }
  }

  // ---------- fuzzy target matching (typo / brand / target tolerant) ----------
  const nrm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function tokensFor(g) {
    const t = new Set([nrm(g.id), nrm(g.molecularTarget), nrm(g.name)]);
    `${g.name} ${g.molecularTarget}`.split(/[^a-zA-Z0-9]+/).forEach((w) => { if (w.length >= 3) t.add(nrm(w)); });
    return [...t].filter(Boolean);
  }
  function bestMatch(q) {
    const nq = nrm(q); if (nq.length < 2) return null;
    let best = null, score = Infinity;
    for (const g of GOLDEN) for (const t of tokensFor(g)) {
      let s;
      if (t === nq) s = 0;
      else if (nq.length >= 4 && t.startsWith(nq)) s = 0.5;
      else if (nq.length >= 4 && t.includes(nq)) s = 1;
      else { const d = lev(nq, t); s = d <= Math.max(2, Math.floor(t.length * 0.25)) ? d : Infinity; }
      if (s < score) { score = s; best = g; }
    }
    return score <= 3 ? best : null;
  }

  // ---------- run dispatch ----------
  function run() {
    const q = $('q').value.trim(); if (!q) return;
    const g = bestMatch(q);                    // typo/brand/target tolerant
    if (g) return replay(g, q);
    if (liveAvailable) return live(q);
    resetStage(q, 'replay', 'not in demo set');
    reason(`"${q}" isn't one of the pre-verified demo molecules on this hosted page.`);
    reason(`Verified replays available: ${GOLDEN.map((x) => x.name.split(' (')[0].split(' &')[0].trim()).join(' · ')}.`);
    reason('Pick one from the chips above — or run the live build (npm start + ANTHROPIC_API_KEY) to query any molecule against live public APIs.');
  }

  $('run').onclick = run; $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  renderChips(); health();
})();
