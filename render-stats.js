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
// Libellé des mois comparés (VM.cmp) : « de janv. à sept. », « d’avr. à sept. », « en sept. ».
function cmpPeriod(c) {
  const de = (m) => (/^[aeiouéâ]/.test(UI.MS[m - 1]) ? 'd’' : 'de ') + UI.MS[m - 1];
  return c.from === c.to ? `en ${UI.MS[c.to - 1]}` : `${de(c.from)} à ${UI.MS[c.to - 1]}`;
}

function qStep(j) { return !(j > 0) ? 0 : Math.min(6, Math.max(1, Math.ceil(j / 23 * 6))); }

// Statut d'un mois, partagé par le taux d'activité, le tracker et la constellation :
// 'out' avant le premier mois de l'historique (ni anneaux, ni taux) ; 'future' après le
// dernier mois facturé (VM.curY / VM.lastM, comme les KPI « de janv. à … »), ou mois à
// venir encore sans données ; sinon 'on' : compté, facturé ou non.
function monthState(y, m) {
  const first = UI.mk(AGG.months[0].mois);
  if (+y < first.y || (+y === first.y && m < first.m)) return 'out';
  // Mois en cours ou à venir : « à venir ». Le mois précédent aussi tant qu'il n'est pas facturé
  // (sa facture part en fin de mois ou au début du suivant). Un mois passé plus ancien sans facture
  // (intercontrat) compte à 0 jour dans le taux, comme dans la liste des mois.
  const t = VM.today, idx = +y * 12 + m, now = t.getFullYear() * 12 + t.getMonth() + 1;
  if (idx >= now) return 'future';
  if (idx === now - 1 && !(AGG.monthsByKey[UI.key(m, y)] || {}).facturation) return 'future';
  return 'on';
}

// Taux d'activité : Σ jours facturés / Σ jours ouvrés des mois comptés de l'année.
function activityRate(y) {
  let jo = 0, jf = 0, n = 0;
  for (let m = 1; m <= 12; m++) {
    if (monthState(y, m) !== 'on') continue;
    const mm = AGG.monthsByKey[UI.key(m, y)];
    jo += joursOuvres(+y, m);
    jf += mm ? mm.jours_travailles : 0;
    n++;
  }
  return { jo, jf, r: jo ? jf / jo : 0, n };
}

function renderKpis() {
  const host = document.getElementById('kpis');
  const cy = UI.esc(VM.curY), py = UI.esc(VM.prevY || '');
  const curMonths = AGG.months.filter((m) => m.mois.endsWith('-' + VM.curY));
  const actifs = curMonths.filter((m) => m.jours_travailles > 0).length;
  const prevTjm = VM.prevY && VM.sy[VM.prevY] ? VM.sy[VM.prevY].tjm : 0;
  const perLbl = `de janv. à ${UI.MS[VM.lastM - 1]}`;
  // Deltas N / N-1 sur les seuls mois couverts dans les deux années (VM.cmp, render.js).
  const cmp = VM.cmp;
  const dCa = cmp ? UI.delta(cmp.caCur, cmp.caPrev) : null;
  const dJ = cmp ? UI.delta(cmp.jCur, cmp.jPrev) : null;
  const vsTitle = cmp ? `par rapport à la même période ${cmp.full ? '' : cmpPeriod(cmp) + ' '}${VM.prevY}` : '';
  const caSub = !VM.prevY ? perLbl
    : !cmp ? `Pas de comparaison possible (historique depuis ${UI.esc(VM.since)})`
    : cmp.full ? `contre ${UI.eur0(VM.caPrev)} ${perLbl} ${py}`
    : `${UI.eur0(cmp.caCur)} ${cmpPeriod(cmp)}, contre ${UI.eur0(cmp.caPrev)} en ${py}`;
  // Délai de versement : pas de médiane tant qu'aucun profit share n'a été payé.
  const psMeasured = AGG.delaisPS.count > 0;
  const rate = activityRate(VM.curY);
  const trkDays = (i) => { const mm = AGG.monthsByKey[UI.key(i + 1, VM.curY)]; return mm ? mm.jours_travailles : 0; };
  const tracker = Array.from({ length: 12 }, (_, i) => {
    const st = monthState(VM.curY, i + 1);
    if (st !== 'on') return `<span class="${st}" aria-hidden="true"></span>`;
    const s = qStep(trkDays(i));
    return `<span tabindex="0" data-trk="${i}" style="background:${s ? `var(--q${s})` : 'var(--surface-3)'}" aria-label="${UI.esc(UI.MF[i] + UI.NBP + ': ' + UI.num1(trkDays(i)) + ' jours facturés')}"></span>`;
  }).join('');
  host.innerHTML = `
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('coins')}CA facturé ${cy}</h2>${UI.deltaPill(dCa, vsTitle)}</div>
      <div class="kpi-value">${UI.money(VM.caCur)}</div>
      <p class="kpi-sub">${caSub}</p>
      <div class="kpi-viz"><div class="chart" id="spark-ca"></div></div>
    </article>
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('calendar')}Jours facturés ${cy}</h2>${UI.deltaPill(dJ, vsTitle)}</div>
      <div class="kpi-value">${UI.num1(VM.jCur)}<span class="m-cur">${UI.NB}j</span></div>
      <p class="kpi-sub">${UI.pct0(rate.r * 100)} des jours ouvrés · ${UI.num1(actifs ? VM.jCur / actifs : 0)} j par mois</p>
      <div class="kpi-viz"><div class="tracker" role="img" aria-label="Jours facturés par mois en ${cy}">${tracker}</div><div class="tracker-axis" aria-hidden="true"><span>janv.</span><span>juin</span><span>déc.</span></div></div>
    </article>
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('briefcase')}TJM actuel</h2>${prevTjm ? UI.deltaPill(UI.delta(VM.tjm, prevTjm), 'par rapport au TJM moyen ' + VM.prevY) : ''}</div>
      <div class="kpi-value">${UI.money(VM.tjm)}</div>
      <p class="kpi-sub">${prevTjm ? `contre ${UI.eur0(prevTjm)} en moyenne en ${py}` : 'Dernier TJM facturé'}</p>
      <div class="kpi-viz"><div class="chart" id="spark-tjm"></div></div>
    </article>
    <article class="card kpi">
      <div class="kpi-head"><h2 class="kpi-label">${icon('hourglass')}Délai de versement</h2></div>
      <div class="kpi-value">${psMeasured ? `${VM.med}<span class="m-cur">${UI.NB}j</span>` : '—'}</div>
      <p class="kpi-sub">${psMeasured ? 'Médiane entre l’émission d’un profit share et son paiement' : `Pas encore mesuré${UI.NBP}: aucun profit share payé pour l’instant`}</p>
      <div class="kpi-viz"><div class="chart" id="spark-delais"></div></div>
    </article>`;
  UI.$$('[data-trk]', host).forEach((el) => {
    const i = +el.dataset.trk;
    const jo = joursOuvres(+VM.curY, i + 1);
    UI.bindTip(el, () => UI.ttTitle(UI.MF[i] + ' ' + VM.curY) + `<div class="tt-big">${UI.esc(UI.num1(trkDays(i)))} j facturés</div>` + UI.ttRow('', 'Jours ouvrés', String(jo)));
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
  const rows = [];
  let top = null, last = null;
  for (let i = 0; i < 12; i++) {
    const mm = AGG.monthsByKey[UI.key(i + 1, VM.curY)];
    if (monthState(VM.curY, i + 1) === 'on') rows.push([UI.MF[i], UI.eur0(mm ? mm.facturation : 0), UI.num1(mm ? mm.jours_travailles : 0) + ' j']);
    const x0 = i * slot + (slot - bw) / 2;
    if (!mm || !mm.facturation) { g += `<rect x="${x0}" y="${H - 3}" width="${bw}" height="2" rx="1" style="fill:var(--border-strong)"/>`; continue; }
    if (!top || mm.facturation > top.facturation) top = mm;
    last = mm;
    const h = Math.max(3, mm.facturation / max * (H - 4));
    const isLast = i + 1 === VM.lastM;
    g += `<path class="g-bar" d="${UI.rtop(x0, H - h, bw, h, 4)}" style="fill:var(--c-ink);opacity:${isLast ? 1 : .32};animation-delay:${i * 40}ms"/>`;
    g += `<rect class="g-hit" data-m="${UI.esc(mm.mois)}" x="${i * slot}" y="0" width="${slot}" height="${H}" tabindex="0" aria-label="${UI.esc(`${UI.monthLabel(mm.mois)}${UI.NBP}: ${UI.eur0(mm.facturation)} facturés, ${UI.num1(mm.jours_travailles)} jours`)}"/>`;
    g += `<rect class="g-focus" x="${i * slot + 1}" y="1" width="${slot - 2}" height="${H - 2}" rx="6"/>`;
  }
  const mName = (mm) => UI.MF[UI.mk(mm.mois).m - 1].toLowerCase();
  const label = !last ? `Aucun CA facturé en ${VM.curY}`
    : `CA facturé par mois en ${VM.curY}${UI.NBP}: ${UI.eur0(last.facturation)} en ${mName(last)}${top === last ? ', le plus haut de l’année' : `${UI.NBP}; le plus haut, ${UI.eur0(top.facturation)} en ${mName(top)}`}`;
  el.innerHTML = UI.svg(W, H, g, label) + UI.srTable(`CA facturé par mois en ${VM.curY}`, ['Mois', 'CA', 'Jours'], rows);
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
  el.innerHTML = UI.svg(W, H, g, `TJM${UI.NBP}: de ${UI.eur0(pts[0].v)} à ${UI.eur0(lp.v)}`)
    + UI.srTable('Évolution du TJM', ['Depuis', 'TJM'], [[UI.monthLabel(pts[0].mois), UI.eur0(pts[0].v)], ...changes.map((i) => [UI.monthLabel(pts[i].mois), UI.eur0(pts[i].v)])]);
}

// Instrument « délais constatés » : plage min–max, médiane,
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
    // Aucun paiement constaté : pas de plage ni de médiane (un « 0 j » se lirait comme une mesure).
    g += `<text class="g-lbl" x="${R}" y="${yy + 10}" text-anchor="end" style="font-size:11.5px${r.s.count ? '' : ';fill:var(--muted)'}">${r.s.count ? `${r.s.median} j` : '—'}</text>`;
    g += `<rect x="0" y="${yy + 15}" width="${R}" height="6" rx="3" style="fill:var(--surface-3)"/>`;
    if (r.s.count) g += `<rect x="${x(r.s.min)}" y="${yy + 15}" width="${Math.max(4, x(r.s.max) - x(r.s.min))}" height="6" rx="3" style="fill:var(--c-prev);opacity:.55"/>`;
    if (r.audit) [[100, 'var(--warn)'], [130, 'var(--danger)']].forEach(([v, c]) => { g += `<rect x="${x(v) - 1}" y="${yy + 12}" width="2" height="12" rx="1" style="fill:${c}"/>`; });
    if (r.s.count) g += `<rect x="${x(r.s.median) - 1.5}" y="${yy + 12}" width="3" height="12" rx="1.5" style="fill:var(--c-ink)"/>`;
  });
  if (roomy) {
    const yb = rows.length * rowH + 10;
    g += `${W >= 210 ? `<text class="g-sub" x="0" y="${yb}" style="font-size:10px">0 j</text>` : ''}<text class="g-sub" x="${x(100)}" y="${yb}" text-anchor="middle" style="font-size:10px">100</text><text class="g-sub" x="${x(130)}" y="${yb}" text-anchor="middle" style="font-size:10px">130</text>`;
  }
  const medTxt = (st) => (st.count ? `médiane ${st.median} jours` : 'pas encore mesuré');
  const jTxt = (st, v) => (st.count ? v + ' j' : '—');
  el.innerHTML = UI.svg(W, H, g, `Délais constatés${UI.NBP}: facture client ${medTxt(AGG.delaisCA)}, profit share ${medTxt(AGG.delaisPS)}${UI.NBP}; seuils d’audit 100 et 130 jours`)
    + UI.srTable('Délais de paiement constatés', ['Flux', 'Min', 'Médiane', 'Max', 'Paiements'], rows.map((r) => [r.k, jTxt(r.s, r.s.min), jTxt(r.s, r.s.median), jTxt(r.s, r.s.max), String(r.s.count)]));
  el.title = 'Plage min–max, médiane (trait foncé), seuils d’audit des profit shares à 100 j (ambre) et 130 j (rouge)';
}

// ---------------------------------------------------------------- section Activité
function renderActivity() {
  const host = document.getElementById('activity-widget');
  // Section repartie d'un hôte vide (premier rendu, ou nouveau jeu après « Tout supprimer »,
  // que render() vide) : le segmenté revient à l'année en cours.
  if (!host.firstElementChild) YEAR_SEL = null;
  if (!YEAR_SEL || (YEAR_SEL !== 'all' && !VM.sy[YEAR_SEL])) YEAR_SEL = VM.curY;
  const cy = UI.esc(VM.curY), py = UI.esc(VM.prevY || '');
  // Delta N / N-1 sur les seuls mois couverts dans les deux années (VM.cmp, render.js) :
  // une première année partielle ne se compare que sur ses mois, sinon pas de delta.
  const cmp = VM.cmp;
  const d = cmp ? UI.delta(cmp.caCur, cmp.caPrev) : null;
  const pctTxt = d !== null ? `${d >= 0 ? '+' : '−'}${UI.pct1(Math.abs(d))}` : '';
  const fin = `fin ${UI.MF[VM.lastM - 1].toLowerCase()}`;
  const vsTxt = !VM.prevY ? `<b>${UI.eur0(VM.caCur)}</b> facturés ${fin}.`
    : !cmp ? `<b>${UI.eur0(VM.caCur)}</b> facturés ${fin}${UI.NBP}; pas de comparaison possible avec ${py} (historique depuis ${UI.esc(VM.since)}).`
    : cmp.full ? `<b>${UI.eur0(VM.caCur)}</b> facturés ${fin}, contre <b>${UI.eur0(cmp.caPrev)}</b> à la même date en ${py}.`
    : `<b>${UI.eur0(cmp.caCur)}</b> facturés ${cmpPeriod(cmp)}, contre <b>${UI.eur0(cmp.caPrev)}</b> en ${py}.`;
  const ring = !!(cmp && cmp.full);
  host.innerHTML = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('chart')}Activité</span>
        <h2 id="activity-title">En ${cy}, <b>${UI.num1(VM.jCur)} jours</b> facturés à <b>${UI.eur0(VM.tjm)}</b>${d !== null ? `${UI.NBP}: <b>${pctTxt}</b> de chiffre d’affaires sur un an${cmp.full ? '' : ` (${cmpPeriod(cmp)})`}` : ''}.</h2>
        <p>Jours, TJM, chiffre d’affaires et clients${cmp ? `, comparés à la même période de ${py}` : ''}.</p>
      </div>
    </header>
    <div class="act-grid">
      <article class="card cumul" aria-labelledby="cumul-title">
        <header class="card-head"><span class="ic-tile">${icon('trending')}</span><div class="grow"><h3 id="cumul-title">Chiffre d’affaires cumulé</h3><p>${VM.prevY ? `${cy} comparé à ${py}, mois après mois` : `Cumul ${cy}`}</p></div></header>
        <div class="big-delta">${d !== null ? `<span class="v ${d >= 0 ? 'up' : 'down'}">${pctTxt}</span>` : ''}<span class="t">${vsTxt}</span></div>
        <div class="legend"><span><i class="lk" style="background:var(--c-ink)"></i>${cy}</span>${VM.prevY ? `<span><i class="lk" style="background:var(--c-prev)"></i>${py}</span>${ring ? '<span><i class="lk ring"></i>Même date l’an dernier</span>' : ''}` : ''}</div>
        <div class="chart" id="chart-cumul"></div>
      </article>
      <article class="card yearcard" id="yearcard" aria-labelledby="yearcard-title"></article>
      <article class="card cst" aria-labelledby="cst-title">
        <header class="cst-head">
          <div class="card-head"><span class="ic-tile">${icon('grip')}</span><div class="grow"><h3 id="cst-title">Chaque point, une journée facturée</h3><p>Une rangée par semaine de 5 jours ouvrés${UI.NBP}: tes mois pleins, tes congés, ce qui reste à venir</p></div></div>
          <div class="legend cst-legend"><span><i class="lk dot" style="background:var(--c-ink)"></i>Jour facturé</span><span><i class="lk ring"></i>Jour ouvré non facturé</span><span><i class="lk ring est"></i>Jour ouvré à venir</span></div>
        </header>
        <div class="cst-years" id="cst-years"></div>
      </article>
    </div>`;
  renderYearCard();
  UI.chart('cumul', drawCumul);
  UI.chart('constellation', drawConstellation);
}

// Clients : règles utilisateur (addClientRule) dès qu'elles nomment un client quelque part
// dans l'historique ; sinon détection automatique d'affichage depuis le libellé
// « Facturation NOM (… », sans toucher à data.js. Le mode est choisi une fois pour toutes
// les périodes : une même facture porte le même nom en 2025, en 2026 et dans « Tout ».
// « (TJM * jours) » dans le libellé d'une facturation : MÊME motif que aggregate() (data.js, intouchable,
// qui ne l'expose pas). À garder identique : les jours par client doivent sommer comme ceux d'AGG.
const TJM_JOURS_RE = /\(\s*([\d.]+)\s*\*\s*([\d.]+)\s*\)/;
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()); }
function clientsFor(sel) {
  if (AGG.clients.some((c) => c.client !== 'Autre')) {
    const base = sel === 'all' ? AGG.clients : ((VM.sy[sel] || {}).clients || []);
    return { list: base.map((c) => ({ ...c })).sort((a, b) => b.ca - a.ca), auto: false };
  }
  const map = {};
  DATASET.forEach((r) => {
    if (r.nature !== 'Crédit - Facturation') return;
    if (sel !== 'all' && !r.mois.endsWith('-' + sel)) return;
    const m = r.description.match(/Facturation\s+(.+?)\s*\(/);
    const name = m ? titleCase(m[1].trim()) : 'Autre';
    const j = r.description.match(TJM_JOURS_RE);
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
      <div class="seg" role="group" aria-label="Choisir la période">${years.map((y) => `<button type="button" data-year="${UI.esc(y)}" aria-pressed="${YEAR_SEL === y}">${UI.esc(y)}</button>`).join('')}<button type="button" data-year="all" aria-pressed="${YEAR_SEL === 'all'}">Tout</button></div>
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
          <div class="client-bar" role="img" aria-label="${UI.esc(c.client + UI.NBP + ': ' + UI.pct0(c.ca / totCa * 100) + ' du CA')}"><i style="width:${c.ca / maxCa * 100}%;animation-delay:${i * 80}ms"></i></div>
          <div class="client-meta">${c.nb_mois ? c.nb_mois + ' mois · ' : ''}${UI.num1(c.jours)} j · TJM ${UI.eur0(c.jours ? c.ca / c.jours : 0)}</div>
        </li>`).join('') + '</ul>' : '<p class="muted">Aucune facturation client sur cette période.</p>'}
    </div>`;
  UI.$$('[data-year]', host).forEach((b) => b.addEventListener('click', () => {
    YEAR_SEL = b.dataset.year;
    renderYearCard();
    const nb = UI.$$('[data-year]', host).find((x) => x.dataset.year === YEAR_SEL);
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
  const cy = UI.esc(VM.curY), py = UI.esc(VM.prevY || '');
  // « Même date l'an dernier » (anneau, étiquette) seulement si N-1 couvre toute la période :
  // sur une première année partielle, le cumul N-1 ne part pas de janvier.
  const sameDate = !!(VM.cmp && VM.cmp.full);
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
  if (sameDate && prev[lastI] != null) g += `<circle cx="${x(lastI)}" cy="${y(prev[lastI])}" r="4.5" style="fill:var(--surface-solid);stroke:var(--c-prev);stroke-width:2"/>`;
  g += `<circle class="g-dot" cx="${x(lastI)}" cy="${y(cur[lastI])}" r="5" style="fill:var(--c-ink)"/>`;
  const lastIsEnd = lastI >= 10;
  g += lastIsEnd
    ? `<text class="g-lbl halo" x="${x(lastI) + 12}" y="${y(cur[lastI]) - 2}">${UI.esc(UI.eur0(cur[lastI]))}</text><text class="g-sub halo" x="${x(lastI) + 12}" y="${y(cur[lastI]) + 13}">${cy}</text>`
    : `<text class="g-sub halo" x="${x(lastI) - 12}" y="${y(cur[lastI]) - 28}" text-anchor="end">${cy}, fin ${UI.MS[lastI]}</text><text class="g-lbl halo" x="${x(lastI) - 12}" y="${y(cur[lastI]) - 12}" text-anchor="end">${UI.esc(UI.eur0(cur[lastI]))}</text>`;
  if (sameDate && prev[lastI] != null && !lastIsEnd) g += `<text class="g-sub halo" x="${x(lastI) + 10}" y="${y(prev[lastI]) + 18}">${UI.esc(UI.eur0(prev[lastI]))} en ${py}</text>`;
  const lastP = prev.reduce((li, v, i) => (v != null ? i : li), -1);
  if (lastP >= 0) {
    g += `<circle class="g-dot" cx="${x(lastP)}" cy="${y(prev[lastP])}" r="4.5" style="fill:var(--c-prev)"/>`;
    g += `<text class="g-lbl" x="${x(lastP) + 10}" y="${y(prev[lastP]) - 2}" style="fill:var(--text-2)">${UI.esc(UI.eur0(prev[lastP]))}</text><text class="g-sub" x="${x(lastP) + 10}" y="${y(prev[lastP]) + 13}">${py}</text>`;
  }
  g += `<line class="g-cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" style="opacity:0"/>`;
  g += `<rect class="g-hit" x="${P.l - 10}" y="${P.t}" width="${W - P.l - P.r + 20}" height="${H - P.t - P.b}" tabindex="0" aria-label="Lire le cumul mois par mois${UI.NBP}: survol, ou flèches gauche et droite"/>`;
  el.innerHTML = UI.svg(W, H, g, `CA cumulé ${VM.curY}${UI.NBP}: ${UI.eur0(cur[lastI])}${sameDate && prev[lastI] != null ? `${UI.NBP}; ${UI.eur0(prev[lastI])} à la même date en ${VM.prevY}` : ''}`)
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
  hit.addEventListener('focus', () => UI.ttFocus(hit, () => show(idx)));
  hit.addEventListener('blur', () => { UI.ttHide(); cross.style.opacity = '0'; });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
  });
}

// Constellation « une pastille = un jour » (un ciel étoilé en sombre) :
// 1 point plein = 1 jour facturé (fraction en part de disque), 1 anneau = 1 jour ouvré
// non facturé, anneau pointillé = jour ouvré à venir. 5 points par rangée = une semaine.
// Les mois d'avant l'historique restent vides (« hors historique »), comme dans le taux.
function drawConstellation() {
  const host = document.getElementById('cst-years');
  if (!host) return;
  const W = Math.max(280, host.clientWidth);
  // 12 mois en ligne seulement si, au plus petit diamètre, chaque colonne garde un vide net
  // entre deux mois (3 fois l'écart entre deux points) ; sinon 2 lignes de 6, points plus gros.
  const minDot = 5, rowGap = 4, monthGap = 12, rowLabelW = 150;
  const stacked = (W - rowLabelW) / 12 < 5 * minDot + 4 * rowGap + monthGap;
  const perRow = stacked ? 6 : 12;
  const labelW = stacked ? 0 : rowLabelW;
  const colW = (W - labelW) / perRow;
  const gap = stacked ? 3 : rowGap;
  const dot = Math.max(minDot, Math.min(10, (colW * .74 - 4 * gap) / 5));
  const step = dot + gap;
  const rowsMax = 5;
  const blockH = 18 + rowsMax * step + 20;
  const years = [...AGG.years].reverse();
  host.innerHTML = years.map((y) => {
    const rate = activityRate(y);
    const yr = +y;
    const lines = Math.ceil(12 / perRow);
    const H = lines * blockH;
    let g = '';
    const tableRows = [];
    const outPerLine = Array(lines).fill(0);
    for (let i = 0; i < 12; i++) {
      const m = i + 1;
      const st = monthState(y, m);
      const mm = AGG.monthsByKey[UI.key(m, y)];
      const jo = joursOuvres(yr, m);
      const billed = st === 'on' && mm ? mm.jours_travailles : 0;
      const line = Math.floor(i / perRow), col = i % perRow;
      const x0 = labelW + col * colW + (colW - (5 * step - gap)) / 2;
      const y0 = line * blockH + 18;
      const total = st === 'out' ? 0 : Math.max(jo, Math.ceil(billed));
      const full = Math.floor(billed), frac = billed - full;
      let dots = '';
      for (let k = 0; k < total; k++) {
        const cx = x0 + (k % 5) * step + dot / 2, cy = y0 + Math.floor(k / 5) * step + dot / 2, r = dot / 2;
        if (k < full) dots += `<circle cx="${cx}" cy="${cy}" r="${r}" class="cd-f"/>`;
        else if (k === full && frac > 0.05) {
          const a = frac * 2 * Math.PI, ex = cx + r * Math.sin(a), ey = cy - r * Math.cos(a);
          dots += `<circle cx="${cx}" cy="${cy}" r="${r - .75}" class="cd-r"/><path d="M${cx},${cy}L${cx},${cy - r}A${r},${r} 0 ${frac > .5 ? 1 : 0} 1 ${ex},${ey}Z" class="cd-f"/>`;
        } else dots += `<circle cx="${cx}" cy="${cy}" r="${r - .75}" class="${st === 'future' ? 'cd-e' : 'cd-r'}"/>`;
      }
      const cxm = labelW + col * colW + colW / 2;
      const head = st === 'on' ? UI.num1(billed) : st === 'future' ? '·' : '–';
      const tone = st === 'out' ? ';fill:var(--faint)' : st === 'future' || !billed ? ';fill:var(--muted)' : '';
      if (dots) g += `<g class="cd-m" style="animation-delay:${i * 45}ms">${dots}</g>`;
      g += `<text class="g-lbl" x="${cxm}" y="${y0 - 6}" text-anchor="middle" style="font-size:12px${tone}">${head}</text>`;
      g += `<text class="g-sub" x="${cxm}" y="${y0 + rowsMax * step + 12}" text-anchor="middle"${st === 'out' ? ' style="fill:var(--faint)"' : ''}>${UI.MS[i]}</text>`;
      if (st === 'out') outPerLine[line]++;
      if (st === 'on') {
        const hx = labelW + col * colW, hy = line * blockH;
        g += `<rect class="g-hit" data-cm="${UI.esc(UI.key(m, y))}" x="${hx}" y="${hy}" width="${colW}" height="${blockH}" tabindex="0" aria-label="${UI.esc(`${UI.MF[i]} ${y}${UI.NBP}: ${UI.num1(billed)} jours facturés sur ${jo} ouvrés`)}"/>`;
        g += `<rect class="g-focus" x="${hx + 2}" y="${hy + 1}" width="${colW - 4}" height="${blockH - 2}" rx="12"/>`;
      }
      tableRows.push([UI.MF[i], st === 'on' ? UI.num1(billed) : st === 'future' ? 'à venir' : 'hors historique', String(jo), st === 'on' ? UI.pct0(jo ? billed / jo * 100 : 0) : '—']);
    }
    // Mois d'avant l'historique (toujours en tête de rangée) : mention dans le vide s'il y a la place
    outPerLine.forEach((n, line) => {
      if (n * colW < 104) return;
      g += `<text class="g-sub" x="${labelW + n * colW / 2}" y="${line * blockH + 18 + (rowsMax * step - gap) / 2 + 4}" text-anchor="middle" style="fill:var(--faint)">hors historique</text>`;
    });
    // Année encore sans mois compté (lignes annexes avant la première facture) : pas de taux
    const rateTxt = rate.n ? `${UI.pct0(rate.r * 100)} des jours ouvrés` : 'tout est à venir';
    const label = stacked ? '' : `<text class="cst-y" x="0" y="${blockH / 2 - 4}">${UI.esc(y)}</text><text class="g-sub" x="0" y="${blockH / 2 + 16}">${UI.num1(rate.jf)} j facturés</text><text class="g-sub" x="0" y="${blockH / 2 + 32}">${rateTxt}</text>`;
    return `<div class="cst-year">
      ${stacked ? `<div class="cst-ylab"><b>${UI.esc(y)}</b><span>${UI.num1(rate.jf)} j facturés · ${rateTxt}</span></div>` : ''}
      ${UI.svg(W, H, label + g, `Jours facturés en ${y}${UI.NBP}: ${UI.num1(rate.jf)} jours, ${rateTxt}`)}
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
