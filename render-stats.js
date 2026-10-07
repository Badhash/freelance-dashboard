// ============================================================
// AURORA — activité : rangée de 4 KPI du premier écran (#kpis) et section
// Activité (#activity-widget) : CA cumulé N vs N-1, bilan par année
// (segmenté 2026 / 2025 / Tout, clients), constellation des jours facturés.
// L'ENCRE (--c-ink) code l'activité et le temps ; jamais une nature d'argent.
// ============================================================

let YEAR_SEL = null;

function renderActivityStats() {
  renderKpis();
  renderActivity();
}

// ---------------------------------------------------------------- KPI
function qStep(j) { return !(j > 0) ? 0 : Math.min(6, Math.max(1, Math.ceil(j / 23 * 6))); }

function activityRate(y, upToMonth) {
  const ms = AGG.months.filter((m) => m.mois.endsWith('-' + y) && (!upToMonth || UI.mk(m.mois).m <= upToMonth));
  const jo = UI.sum(ms, (m) => joursOuvres(+y, UI.mk(m.mois).m));
  const jf = UI.sum(ms, 'jours_travailles');
  return { jo, jf, r: jo ? jf / jo : 0, n: ms.length };
}

function renderKpis() {
  const host = document.getElementById('kpis');
  const curMonths = AGG.months.filter((m) => m.mois.endsWith('-' + VM.curY));
  const actifs = curMonths.filter((m) => m.jours_travailles > 0).length;
  const prevTjm = VM.prevY && VM.sy[VM.prevY] ? VM.sy[VM.prevY].tjm : 0;
  const perLbl = `de janv. à ${UI.MS[VM.lastM - 1]}`;
  const rate = activityRate(VM.curY);
  const tracker = Array.from({ length: 12 }, (_, i) => {
    const mm = AGG.monthsByKey[UI.key(i + 1, VM.curY)];
    if (!mm) return '<span class="future" aria-hidden="true"></span>';
    const s = qStep(mm.jours_travailles);
    return `<span tabindex="0" data-trk="${i}" style="background:${s ? `var(--q${s})` : 'var(--surface-3)'}" aria-label="${UI.esc(UI.MF[i] + ' : ' + UI.num1(mm.jours_travailles) + ' jours facturés')}"></span>`;
  }).join('');
  host.innerHTML = `
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('coins')}CA facturé ${VM.curY}</h2>${VM.prevY ? UI.deltaPill(UI.delta(VM.caCur, VM.caPrev), 'par rapport à la même période ' + VM.prevY) : ''}</div>
      <div class="kpi-value">${UI.money(VM.caCur)}</div>
      <p class="kpi-sub">${VM.prevY ? `contre ${UI.eur0(VM.caPrev)} ${perLbl} ${VM.prevY}` : perLbl}</p>
      <div class="kpi-viz"><div class="chart" id="spark-ca"></div></div>
    </article>
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('calendar')}Jours facturés ${VM.curY}</h2>${VM.prevY ? UI.deltaPill(UI.delta(VM.jCur, VM.jPrev), 'par rapport à la même période ' + VM.prevY) : ''}</div>
      <div class="kpi-value">${UI.num1(VM.jCur)}<span class="m-cur">${UI.NB}j</span></div>
      <p class="kpi-sub">${UI.pct0(rate.r * 100)} des jours ouvrés · ${UI.num1(actifs ? VM.jCur / actifs : 0)} j par mois</p>
      <div class="kpi-viz"><div class="tracker" role="img" aria-label="Jours facturés par mois en ${VM.curY}">${tracker}</div><div class="tracker-axis" aria-hidden="true"><span>janv.</span><span>juin</span><span>déc.</span></div></div>
    </article>
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('briefcase')}TJM actuel</h2>${prevTjm ? UI.deltaPill(UI.delta(VM.tjm, prevTjm), 'par rapport au TJM moyen ' + VM.prevY) : ''}</div>
      <div class="kpi-value">${UI.money(VM.tjm)}</div>
      <p class="kpi-sub">${prevTjm ? `contre ${UI.eur0(prevTjm)} en moyenne en ${VM.prevY}` : 'Dernier TJM facturé'}</p>
      <div class="kpi-viz"><div class="chart" id="spark-tjm"></div></div>
    </article>
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('hourglass')}Délai de versement</h2></div>
      <div class="kpi-value">${VM.med}<span class="m-cur">${UI.NB}j</span></div>
      <p class="kpi-sub">Médiane entre l’émission d’un profit share et son paiement</p>
      <div class="kpi-viz"><div class="chart" id="spark-delais"></div></div>
    </article>`;
  UI.$$('[data-trk]', host).forEach((el) => {
    const i = +el.dataset.trk;
    const mm = AGG.monthsByKey[UI.key(i + 1, VM.curY)];
    const jo = joursOuvres(+VM.curY, i + 1);
    UI.bindTip(el, () => UI.ttTitle(UI.MF[i] + ' ' + VM.curY) + `<div class="tt-big">${UI.esc(UI.num1(mm.jours_travailles))} j facturés</div>` + UI.ttRow('', 'Jours ouvrés', String(jo)));
  });
  UI.chart('spark-ca', drawSparkCA);
  UI.chart('spark-tjm', drawSparkTJM);
  UI.chart('spark-delais', drawDelais);
}

function drawSparkCA() {
  const el = document.getElementById('spark-ca');
  if (!el) return;
  const W = Math.max(120, el.clientWidth), H = 50;
  const slot = W / 12, bw = Math.min(14, slot * .58);
  const max = Math.max(1, ...AGG.months.map((m) => m.facturation));
  let g = '';
  for (let i = 0; i < 12; i++) {
    const mm = AGG.monthsByKey[UI.key(i + 1, VM.curY)];
    const x0 = i * slot + (slot - bw) / 2;
    if (!mm || !mm.facturation) { g += `<rect x="${x0}" y="${H - 3}" width="${bw}" height="2" rx="1" style="fill:var(--border-strong)"/>`; continue; }
    const h = Math.max(3, mm.facturation / max * (H - 4));
    const isLast = i + 1 === VM.lastM;
    g += `<path class="g-bar" d="${UI.rtop(x0, H - h, bw, h, 4)}" style="fill:var(--c-ink);opacity:${isLast ? 1 : .32};animation-delay:${i * 40}ms"/>`;
    g += `<rect class="g-hit" data-m="${mm.mois}" x="${i * slot}" y="0" width="${slot}" height="${H}"/>`;
  }
  el.innerHTML = UI.svg(W, H, g, `CA facturé par mois en ${VM.curY}`);
  UI.$$('.g-hit', el).forEach((h) => {
    const mm = AGG.monthsByKey[h.dataset.m];
    UI.bindTip(h, () => UI.ttTitle(UI.monthLabel(mm.mois)) + `<div class="tt-big">${UI.esc(UI.eur0(mm.facturation))}</div>` + UI.ttRow('', 'Jours', UI.num1(mm.jours_travailles) + ' j'));
  });
}

function drawSparkTJM() {
  const el = document.getElementById('spark-tjm');
  if (!el) return;
  const pts = [];
  let last = 0;
  AGG.months.forEach((m) => { if (m.tjm > 0) last = m.tjm; if (last) pts.push({ mois: m.mois, v: last }); });
  if (pts.length < 2) { el.innerHTML = ''; return; }
  const W = Math.max(120, el.clientWidth), H = 54, P = { l: 4, r: 50, t: 16, b: 6 };
  const mn = Math.min(...pts.map((p) => p.v)), mx = Math.max(...pts.map((p) => p.v));
  const span = Math.max(1, mx - mn);
  const x = (i) => P.l + i / (pts.length - 1) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - mn) / span) * (H - P.t - P.b);
  let d = `M${x(0)},${y(pts[0].v)}`;
  const changes = [];
  pts.forEach((p, i) => { if (i) { d += `H${x(i)}`; if (p.v !== pts[i - 1].v) { d += `V${y(p.v)}`; changes.push(i); } } });
  const gid = UI.uid('tjm');
  let g = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-ink);stop-opacity:.14"/><stop offset="1" style="stop-color:var(--c-ink);stop-opacity:0"/></linearGradient></defs>`;
  g += `<path d="${d}V${H}H${x(0)}Z" style="fill:url(#${gid})"/>`;
  g += `<path class="g-line g-draw" d="${d}" style="stroke:var(--c-ink)"/>`;
  if (W >= 210) changes.forEach((i) => { const { m, y: yy } = UI.mk(pts[i].mois); g += `<text class="g-sub" x="${x(i)}" y="${y(pts[i].v) - 6}" text-anchor="middle" style="font-size:10.5px">${UI.MS[m - 1].replace('.', '')} ${String(yy).slice(2)}</text>`; });
  const lp = pts[pts.length - 1];
  g += `<circle class="g-dot" cx="${x(pts.length - 1)}" cy="${y(lp.v)}" r="4.5" style="fill:var(--c-ink)"/>`;
  g += `<text class="g-lbl" x="${x(pts.length - 1) + 10}" y="${y(lp.v) + 4}" style="font-size:12px">${UI.esc(UI.eur0(lp.v))}</text>`;
  if (W >= 210) g += `<text class="g-sub" x="${x(0)}" y="${y(pts[0].v) - 6}" style="font-size:10.5px">${UI.esc(UI.eur0(pts[0].v))}</text>`;
  el.innerHTML = UI.svg(W, H, g, `TJM : de ${UI.eur0(pts[0].v)} à ${UI.eur0(lp.v)}`)
    + UI.srTable('Évolution du TJM', ['Depuis', 'TJM'], [[UI.monthLabel(pts[0].mois), UI.eur0(pts[0].v)], ...changes.map((i) => [UI.monthLabel(pts[i].mois), UI.eur0(pts[i].v)])]);
}

// Instrument « délais constatés » (greffe Cockpit) : plage min–max, médiane,
// seuils d'audit profit share (100 j attention, 130 j critique).
function drawDelais() {
  const el = document.getElementById('spark-delais');
  if (!el) return;
  const W = Math.max(130, el.clientWidth);
  const roomy = W >= 140;
  const max = Math.max(150, AGG.delaisPS.max + 10, AGG.delaisCA.max + 10);
  const R = W - 2;
  const x = (v) => v / max * R;
  const rows = [
    { k: 'Facture client', s: AGG.delaisCA, audit: false },
    { k: 'Profit share', s: AGG.delaisPS, audit: true }
  ];
  const rowH = 26;
  const H = rows.length * rowH + (roomy ? 14 : 2);
  let g = '';
  rows.forEach((r, i) => {
    const yy = i * rowH;
    g += `<text class="g-sub" x="0" y="${yy + 10}" style="font-size:11px">${r.k}</text>`;
    g += `<text class="g-lbl" x="${R}" y="${yy + 10}" text-anchor="end" style="font-size:11.5px">${r.s.median} j</text>`;
    g += `<rect x="0" y="${yy + 15}" width="${R}" height="6" rx="3" style="fill:var(--surface-3)"/>`;
    g += `<rect x="${x(r.s.min)}" y="${yy + 15}" width="${Math.max(4, x(r.s.max) - x(r.s.min))}" height="6" rx="3" style="fill:var(--c-prev);opacity:.55"/>`;
    if (r.audit) [[100, 'var(--warn)'], [130, 'var(--danger)']].forEach(([v, c]) => { g += `<rect x="${x(v) - 1}" y="${yy + 12}" width="2" height="12" rx="1" style="fill:${c}"/>`; });
    g += `<rect x="${x(r.s.median) - 1.5}" y="${yy + 12}" width="3" height="12" rx="1.5" style="fill:var(--c-ink)"/>`;
  });
  if (roomy) {
    const yb = rows.length * rowH + 10;
    g += `${W >= 210 ? `<text class="g-sub" x="0" y="${yb}" style="font-size:10px">0 j</text>` : ''}<text class="g-sub" x="${x(100)}" y="${yb}" text-anchor="middle" style="font-size:10px">100</text><text class="g-sub" x="${x(130)}" y="${yb}" text-anchor="middle" style="font-size:10px">130</text>`;
  }
  el.innerHTML = UI.svg(W, H, g, `Délais constatés : facture client médiane ${AGG.delaisCA.median} jours, profit share médiane ${AGG.delaisPS.median} jours ; seuils d’audit 100 et 130 jours`)
    + UI.srTable('Délais de paiement constatés', ['Flux', 'Min', 'Médiane', 'Max', 'Paiements'], rows.map((r) => [r.k, r.s.min + ' j', r.s.median + ' j', r.s.max + ' j', String(r.s.count)]));
  el.title = 'Plage min–max, médiane (trait foncé), seuils d’audit des profit shares à 100 j (ambre) et 130 j (rouge)';
}

// ---------------------------------------------------------------- section Activité
function renderActivity() {
  const host = document.getElementById('activity-widget');
  if (!YEAR_SEL || (YEAR_SEL !== 'all' && !VM.sy[YEAR_SEL])) YEAR_SEL = VM.curY;
  const d = VM.prevY ? UI.delta(VM.caCur, VM.caPrev) : null;
  host.innerHTML = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('chart')}Activité</span>
        <h2 id="activity-title">En ${VM.curY}, <b>${UI.num1(VM.jCur)} jours</b> facturés à <b>${UI.eur0(VM.tjm)}</b>${d !== null ? ` : <b>${d >= 0 ? '+' : '−'}${UI.pct1(Math.abs(d))}</b> de chiffre d’affaires sur un an` : ''}.</h2>
        <p>Jours, TJM, chiffre d’affaires et clients${VM.prevY ? `, comparés à la même période de ${VM.prevY}` : ''}.</p>
      </div>
    </header>
    <div class="act-grid">
      <article class="card cumul" aria-labelledby="cumul-title">
        <header class="card-head"><span class="ic-tile">${icon('trending')}</span><div class="grow"><h3 id="cumul-title">Chiffre d’affaires cumulé</h3><p>${VM.prevY ? `${VM.curY} comparé à ${VM.prevY}, mois après mois` : `Cumul ${VM.curY}`}</p></div></header>
        <div class="big-delta">${d !== null ? `<span class="v ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${UI.pct1(Math.abs(d))}</span>` : ''}<span class="t"><b>${UI.eur0(VM.caCur)}</b> facturés fin ${UI.MF[VM.lastM - 1].toLowerCase()}${VM.prevY ? `, contre <b>${UI.eur0(VM.caPrev)}</b> à la même date en ${VM.prevY}` : ''}.</span></div>
        <div class="legend"><span><i class="lk" style="background:var(--c-ink)"></i>${VM.curY}</span>${VM.prevY ? `<span><i class="lk" style="background:var(--c-prev)"></i>${VM.prevY}</span><span><i class="lk ring"></i>Même date l’an dernier</span>` : ''}</div>
        <div class="chart" id="chart-cumul"></div>
      </article>
      <article class="card yearcard" id="yearcard" aria-labelledby="yearcard-title"></article>
      <article class="card cst" aria-labelledby="cst-title">
        <header class="cst-head">
          <div class="card-head"><span class="ic-tile">${icon('grip')}</span><div class="grow"><h3 id="cst-title">Chaque point, une journée facturée</h3><p>Une rangée par semaine de 5 jours ouvrés : tes mois pleins, tes congés, ce qui reste à venir</p></div></div>
          <div class="legend cst-legend"><span><i class="lk dot" style="background:var(--c-ink)"></i>Jour facturé</span><span><i class="lk ring"></i>Jour ouvré non facturé</span><span><i class="lk ring est"></i>Jour ouvré à venir</span></div>
        </header>
        <div class="cst-years" id="cst-years"></div>
      </article>
    </div>`;
  renderYearCard();
  UI.chart('cumul', drawCumul);
  UI.chart('constellation', drawConstellation);
}

// Clients : règles utilisateur (addClientRule) si présentes ; sinon détection
// automatique d'affichage depuis le libellé « Facturation NOM (… », sans toucher à data.js.
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()); }
function clientsFor(sel) {
  const base = sel === 'all' ? AGG.clients.map((c) => ({ ...c })) : ((VM.sy[sel] || {}).clients || []).map((c) => ({ ...c }));
  const onlyOther = !base.length || (base.length === 1 && base[0].client === 'Autre');
  if (!onlyOther) return { list: base.sort((a, b) => b.ca - a.ca), auto: false };
  const map = {};
  DATASET.forEach((r) => {
    if (r.nature !== 'Crédit - Facturation') return;
    if (sel !== 'all' && !r.mois.endsWith('-' + sel)) return;
    const m = r.description.match(/Facturation\s+(.+?)\s*\(/);
    const name = m ? titleCase(m[1].trim()) : 'Autre';
    const j = r.description.match(/\(\s*([\d.]+)\s*\*\s*([\d.]+)\s*\)/);
    if (!map[name]) map[name] = { client: name, ca: 0, jours: 0, mois: new Set() };
    map[name].ca += r.montant;
    if (j) map[name].jours += parseFloat(j[2]);
    map[name].mois.add(r.mois);
  });
  return { list: Object.values(map).map((c) => ({ client: c.client, ca: c.ca, jours: c.jours, nb_mois: c.mois.size })).sort((a, b) => b.ca - a.ca), auto: true };
}

function yearStats(sel) {
  if (sel === 'all') {
    const months = AGG.months;
    const jours = UI.sum(months, 'jours_travailles');
    const actifs = months.filter((m) => m.jours_travailles > 0).length;
    return { jours, ca: AGG.totals.ca, tjm: jours ? AGG.totals.ca / jours : 0, moisActifs: actifs, congesAcquis: actifs * 2.5, nMonths: months.length };
  }
  return { ...VM.sy[sel], nMonths: AGG.months.filter((m) => m.mois.endsWith('-' + sel)).length };
}

function renderYearCard() {
  const host = document.getElementById('yearcard');
  const years = [...AGG.years].reverse();
  const s = yearStats(YEAR_SEL);
  const cl = clientsFor(YEAR_SEL);
  const maxCa = Math.max(1, ...cl.list.map((c) => c.ca));
  const totCa = UI.sum(cl.list, 'ca') || 1;
  const tile = (icn, v, unit, l, h) => `<div class="tile"><div class="tv tab">${v}<small>${unit}</small></div><div class="tl">${icon(icn)}${l}</div><div class="th">${h}</div></div>`;
  host.innerHTML = `
    <div class="yc-head">
      <header class="card-head"><span class="ic-tile">${icon('users')}</span><div class="grow"><h3 id="yearcard-title">Bilan par année</h3><p>Jours, TJM moyen, congés acquis et clients</p></div></header>
      <div class="seg" role="group" aria-label="Choisir la période">${years.map((y) => `<button type="button" data-year="${y}" aria-pressed="${YEAR_SEL === y}">${y}</button>`).join('')}<button type="button" data-year="all" aria-pressed="${YEAR_SEL === 'all'}">Tout</button></div>
    </div>
    <div class="tiles">
      ${tile('calendar', UI.num1(s.jours), UI.NB + 'j', 'Jours facturés', `${s.moisActifs} mois actifs`)}
      ${tile('briefcase', UI.int(s.tjm), UI.NB + '€', 'TJM moyen', 'CA ÷ jours facturés')}
      ${tile('umbrella', UI.num1(s.congesAcquis), UI.NB + 'j', 'Congés acquis', '2,5 j ouvrables par mois travaillé')}
      ${tile('coins', UI.int(s.ca), UI.NB + '€', 'CA facturé', YEAR_SEL === 'all' ? `${s.nMonths} mois au total` : `Sur ${s.nMonths} mois`)}
    </div>
    <div class="clients">
      <h4>Répartition par client <span>${cl.list.length} client${cl.list.length > 1 ? 's' : ''}${cl.auto ? ' · détectés depuis les libellés' : ''}</span></h4>
      ${cl.list.length ? '<ul class="client-list">' + cl.list.map((c, i) => `
        <li class="client">
          <div class="client-top"><span class="client-name">${UI.esc(c.client)}</span><span class="client-val">${UI.eur0(c.ca)} <span class="client-meta">${UI.pct0(c.ca / totCa * 100)}</span></span></div>
          <div class="client-bar" role="img" aria-label="${UI.esc(c.client + ' : ' + UI.pct0(c.ca / totCa * 100) + ' du CA')}"><i style="width:${c.ca / maxCa * 100}%;animation-delay:${i * 80}ms"></i></div>
          <div class="client-meta">${c.nb_mois ? c.nb_mois + ' mois · ' : ''}${UI.num1(c.jours)} j · TJM ${UI.eur0(c.jours ? c.ca / c.jours : 0)}</div>
        </li>`).join('') + '</ul>' : '<p class="muted">Aucune facturation client sur cette période.</p>'}
    </div>`;
  UI.$$('[data-year]', host).forEach((b) => b.addEventListener('click', () => {
    YEAR_SEL = b.dataset.year;
    renderYearCard();
    const nb = host.querySelector(`[data-year="${YEAR_SEL}"]`);
    if (nb) nb.focus();
  }));
}

function drawCumul() {
  const el = document.getElementById('chart-cumul');
  if (!el) return;
  el.innerHTML = '';
  const W = Math.max(280, el.clientWidth);
  const narrow = W < 520;
  const H = Math.max(narrow ? 210 : 248, Math.min(420, el.clientHeight || 0));
  const P = { l: 46, r: narrow ? 70 : 92, t: 18, b: 28 };
  const series = (y, upTo) => {
    let c = 0; const out = [];
    for (let i = 0; i < 12; i++) {
      const mm = AGG.monthsByKey[UI.key(i + 1, y)];
      if (upTo && i + 1 > upTo) { out.push(null); continue; }
      if (!mm && upTo === undefined) { out.push(null); continue; }
      c += mm ? mm.facturation : 0;
      out.push(c);
    }
    return out;
  };
  const cur = series(VM.curY, VM.lastM);
  const prev = VM.prevY ? series(VM.prevY) : [];
  const max = Math.max(...cur.filter((v) => v != null), ...prev.filter((v) => v != null), 1);
  const { top, ticks } = UI.scaleY(max, 3);
  const x = (i) => P.l + i / 11 * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const path = (arr) => { let d = ''; arr.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + x(i) + ',' + y(v); }); return d; };
  let g = `<g class="g-grid">${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r + 8}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
  g += ticks.map((v) => `<text class="g-tick" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${UI.esc(UI.kEur(v))}</text>`).join('');
  const step = narrow ? 3 : 2;
  for (let i = 0; i < 12; i += step) g += `<text class="g-tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${UI.MS[i]}</text>`;
  const pd = path(prev);
  if (pd) g += `<path class="g-line" d="${pd}" style="stroke:var(--c-prev)"/>`;
  const cd = path(cur);
  const lastI = cur.reduce((li, v, i) => (v != null ? i : li), 0);
  g += `<path d="${cd}L${x(lastI)},${y(0)}L${x(0)},${y(0)}Z" style="fill:var(--c-ink-wash)"/>`;
  g += `<path class="g-line g-draw" d="${cd}" style="stroke:var(--c-ink)"/>`;
  if (prev[lastI] != null) g += `<circle cx="${x(lastI)}" cy="${y(prev[lastI])}" r="4.5" style="fill:var(--surface-solid);stroke:var(--c-prev);stroke-width:2"/>`;
  g += `<circle class="g-dot" cx="${x(lastI)}" cy="${y(cur[lastI])}" r="5" style="fill:var(--c-ink)"/>`;
  const lastIsEnd = lastI >= 10;
  g += lastIsEnd
    ? `<text class="g-lbl halo" x="${x(lastI) + 12}" y="${y(cur[lastI]) - 2}">${UI.esc(UI.eur0(cur[lastI]))}</text><text class="g-sub halo" x="${x(lastI) + 12}" y="${y(cur[lastI]) + 13}">${VM.curY}</text>`
    : `<text class="g-sub halo" x="${x(lastI) - 12}" y="${y(cur[lastI]) - 28}" text-anchor="end">${VM.curY}, fin ${UI.MS[lastI]}</text><text class="g-lbl halo" x="${x(lastI) - 12}" y="${y(cur[lastI]) - 12}" text-anchor="end">${UI.esc(UI.eur0(cur[lastI]))}</text>`;
  if (prev[lastI] != null && !lastIsEnd) g += `<text class="g-sub halo" x="${x(lastI) + 10}" y="${y(prev[lastI]) + 18}">${UI.esc(UI.eur0(prev[lastI]))} en ${VM.prevY}</text>`;
  const lastP = prev.reduce((li, v, i) => (v != null ? i : li), -1);
  if (lastP >= 0) {
    g += `<circle class="g-dot" cx="${x(lastP)}" cy="${y(prev[lastP])}" r="4.5" style="fill:var(--c-prev)"/>`;
    g += `<text class="g-lbl" x="${x(lastP) + 10}" y="${y(prev[lastP]) - 2}" style="fill:var(--text-2)">${UI.esc(UI.eur0(prev[lastP]))}</text><text class="g-sub" x="${x(lastP) + 10}" y="${y(prev[lastP]) + 13}">${VM.prevY}</text>`;
  }
  g += `<line class="g-cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" style="opacity:0"/>`;
  g += `<rect class="g-hit" x="${P.l - 10}" y="${P.t}" width="${W - P.l - P.r + 20}" height="${H - P.t - P.b}" tabindex="0" aria-label="Lire le cumul mois par mois : survol, ou flèches gauche et droite"/>`;
  el.innerHTML = UI.svg(W, H, g, `CA cumulé ${VM.curY} : ${UI.eur0(cur[lastI])}${VM.prevY && prev[lastI] != null ? ` ; ${UI.eur0(prev[lastI])} à la même date en ${VM.prevY}` : ''}`)
    + UI.srTable('CA cumulé par mois', ['Mois', VM.curY, VM.prevY || ''], UI.MS.map((m, i) => [m, cur[i] != null ? UI.eur0(cur[i]) : '—', prev[i] != null ? UI.eur0(prev[i]) : '—']));
  const hit = el.querySelector('.g-hit'), cross = el.querySelector('.g-cross');
  let idx = lastI;
  const show = (i, cx, cy) => {
    idx = Math.max(0, Math.min(11, i));
    cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.style.opacity = '1';
    const mC = AGG.monthsByKey[UI.key(idx + 1, VM.curY)];
    const mP = VM.prevY ? AGG.monthsByKey[UI.key(idx + 1, VM.prevY)] : null;
    let html = UI.ttTitle(`Cumul fin ${UI.MF[idx].toLowerCase()}`);
    html += UI.ttRow('var(--c-ink)', VM.curY + (mC && cur[idx] != null ? ` (+${UI.eur0(mC.facturation)})` : ''), cur[idx] != null ? UI.eur0(cur[idx]) : '—');
    if (VM.prevY) html += UI.ttRow('var(--c-prev)', VM.prevY + (mP ? ` (+${UI.eur0(mP.facturation)})` : ''), prev[idx] != null ? UI.eur0(prev[idx]) : '—');
    const r = el.getBoundingClientRect();
    UI.ttShow(html, cx != null ? cx : r.left + x(idx) / W * r.width, cy != null ? cy : r.top + 40);
  };
  hit.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; show(Math.round((px - P.l) / (W - P.l - P.r) * 11), e.clientX, e.clientY); });
  hit.addEventListener('pointerleave', () => { UI.ttHide(); cross.style.opacity = '0'; });
  hit.addEventListener('focus', () => show(idx));
  hit.addEventListener('blur', () => { UI.ttHide(); cross.style.opacity = '0'; });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
  });
}

// Constellation (greffe Solstice « une pastille = un jour », transposée en ciel) :
// 1 point plein = 1 jour facturé (fraction en part de disque), 1 anneau = 1 jour ouvré
// non facturé, anneau pointillé = jour ouvré à venir. 5 points par rangée = une semaine.
function drawConstellation() {
  const host = document.getElementById('cst-years');
  if (!host) return;
  const W = Math.max(280, host.clientWidth);
  const stacked = W < 640;
  const perRow = stacked ? 6 : 12;
  const labelW = stacked ? 0 : 150;
  const colW = (W - labelW) / perRow;
  const gap = stacked ? 3 : 4;
  const dot = Math.max(5, Math.min(10, (colW * .74 - 4 * gap) / 5));
  const step = dot + gap;
  const rowsMax = 5;
  const blockH = 18 + rowsMax * step + 20;
  const today = VM.today;
  const years = [...AGG.years].reverse();
  host.innerHTML = years.map((y) => {
    const rate = activityRate(y);
    const yr = +y;
    const lines = Math.ceil(12 / perRow);
    const H = lines * blockH;
    let g = '';
    const tableRows = [];
    for (let i = 0; i < 12; i++) {
      const m = i + 1;
      const mm = AGG.monthsByKey[UI.key(m, y)];
      const jo = joursOuvres(yr, m);
      const future = !mm && (yr > today.getFullYear() || (yr === today.getFullYear() && m >= today.getMonth() + 1));
      const billed = mm ? mm.jours_travailles : 0;
      const line = Math.floor(i / perRow), col = i % perRow;
      const x0 = labelW + col * colW + (colW - (5 * step - gap)) / 2;
      const y0 = line * blockH + 18;
      const total = Math.max(jo, Math.ceil(billed));
      const full = Math.floor(billed), frac = billed - full;
      let dots = '';
      for (let k = 0; k < total; k++) {
        const cx = x0 + (k % 5) * step + dot / 2, cy = y0 + Math.floor(k / 5) * step + dot / 2, r = dot / 2;
        if (k < full) dots += `<circle cx="${cx}" cy="${cy}" r="${r}" class="cd-f"/>`;
        else if (k === full && frac > 0.05) {
          const a = frac * 2 * Math.PI, ex = cx + r * Math.sin(a), ey = cy - r * Math.cos(a);
          dots += `<circle cx="${cx}" cy="${cy}" r="${r - .75}" class="cd-r"/><path d="M${cx},${cy}L${cx},${cy - r}A${r},${r} 0 ${frac > .5 ? 1 : 0} 1 ${ex},${ey}Z" class="cd-f"/>`;
        } else dots += `<circle cx="${cx}" cy="${cy}" r="${r - .75}" class="${future ? 'cd-e' : 'cd-r'}"/>`;
      }
      const cxm = labelW + col * colW + colW / 2;
      g += `<g class="cd-m" style="animation-delay:${i * 45}ms">${dots}</g>`;
      g += `<text class="g-lbl" x="${cxm}" y="${y0 - 6}" text-anchor="middle" style="font-size:12px${future || !billed ? ';fill:var(--muted)' : ''}">${future ? '·' : UI.num1(billed)}</text>`;
      g += `<text class="g-sub" x="${cxm}" y="${y0 + rowsMax * step + 12}" text-anchor="middle">${UI.MS[i]}</text>`;
      if (!future || mm) g += `<rect class="g-hit" data-cm="${UI.key(m, y)}" x="${labelW + col * colW}" y="${line * blockH}" width="${colW}" height="${blockH}" tabindex="0" aria-label="${UI.esc(`${UI.MF[i]} ${y} : ${UI.num1(billed)} jours facturés sur ${jo} ouvrés`)}"/>`;
      tableRows.push([UI.MF[i], future ? 'à venir' : UI.num1(billed), String(jo), future ? '—' : UI.pct0(jo ? billed / jo * 100 : 0)]);
    }
    const label = stacked ? '' : `<text class="cst-y" x="0" y="${blockH / 2 - 4}">${y}</text><text class="g-sub" x="0" y="${blockH / 2 + 16}">${UI.num1(rate.jf)} j facturés</text><text class="g-sub" x="0" y="${blockH / 2 + 32}">${UI.pct0(rate.r * 100)} des jours ouvrés</text>`;
    return `<div class="cst-year">
      ${stacked ? `<div class="cst-ylab"><b>${y}</b><span>${UI.num1(rate.jf)} j facturés · ${UI.pct0(rate.r * 100)} des jours ouvrés</span></div>` : ''}
      ${UI.svg(W, H, label + g, `Jours facturés en ${y} : ${UI.num1(rate.jf)} jours, ${UI.pct0(rate.r * 100)} des jours ouvrés`)}
      ${UI.srTable(`Jours facturés en ${y}`, ['Mois', 'Jours facturés', 'Jours ouvrés', 'Taux'], tableRows)}
    </div>`;
  }).join('');
  UI.$$('[data-cm]', host).forEach((h) => {
    const k = h.dataset.cm;
    const mm = AGG.monthsByKey[k];
    const { m, y } = UI.mk(k);
    const jo = joursOuvres(y, m);
    const j = mm ? mm.jours_travailles : 0;
    UI.bindTip(h, () => UI.ttTitle(UI.monthLabel(k)) + `<div class="tt-big">${UI.esc(UI.num1(j))} j facturés</div>` + UI.ttRow('', 'Jours ouvrés', String(jo)) + UI.ttRow('', 'Taux d’activité', UI.pct0(jo ? j / jo * 100 : 0)) + (mm ? UI.ttRow('', 'CA facturé', UI.eur0(mm.facturation)) : ''));
  });
}
