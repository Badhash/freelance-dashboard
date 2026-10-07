// ============================================================
// AURORA — projection jusqu'à fin d'année (#projection-widget).
// Logique recopiée À L'IDENTIQUE de l'ancien render-projection.js
// (lignes réalisées / projetées, overrides dashboard_proj_overrides_v1,
// projectMonth, joursOuvres, PROJ_COEFFS). Seul l'affichage change :
// titre-phrase, total à venir, tuiles, cumul perçu N vs N-1 (réalisé plein,
// projeté pointillé), compteurs ± 0,5 j avec mini-barre par mois, tableau.
// Compteurs : champ texte décimal (« 18,5 » comme « 18.5 »), recalcul à chaque
// frappe sans jamais recréer le champ en cours de saisie (patchKeeping).
// ============================================================

let PROJ = null;

function projModel() {
  const tjm = VM.tjm; // dernier TJM > 0 (render.js, même règle que l'ancienne boucle)
  if (!tjm) return null;
  let lastBilledIdx = -1;
  for (let i = AGG.months.length - 1; i >= 0; i--) { if (AGG.months[i].facturation > 0) { lastBilledIdx = i; break; } }
  const lastBilledMois = lastBilledIdx >= 0 ? AGG.months[lastBilledIdx].mois : (AGG.months[AGG.months.length - 1] || {}).mois;
  if (!lastBilledMois) return null;
  const [lkM, lkY] = lastBilledMois.split('-').map(Number);
  const projYear = lkY;
  const overrides = loadProjOverrides();
  const rows = [];
  for (let mo = lkM; mo <= 12; mo++) {
    const moisKey = String(mo).padStart(2, '0') + '-' + projYear;
    const realMonth = AGG.monthsByKey[moisKey];
    const isKnown = realMonth !== undefined && realMonth.facturation > 0;
    const jOuvres = joursOuvres(projYear, mo);
    let jours;
    if (isKnown) jours = realMonth.jours_travailles;
    else if (Number.isFinite(Number(overrides[moisKey]))) {
      // Valeur stockée (ou restaurée du cloud) : forcée en nombre et bornée, jamais réinjectée telle quelle.
      jours = Math.min(jOuvres, Math.max(0, Number(overrides[moisKey])));
    }
    else jours = jOuvres;
    const proj = projectMonth(projYear, mo, jours, tjm);
    const r = { ...proj, moisKey, isKnown, joursOuvres: jOuvres, realData: realMonth || null };
    r.ca = isKnown ? realMonth.facturation : proj.ca;
    r.sn = isKnown ? realMonth.salaire_net : proj.salaire_net;
    r.ps = isKnown ? realMonth.profit_share_total : proj.profit_share;
    r.tr = isKnown ? realMonth.tickets_resto : proj.tickets;
    r.total = r.sn + r.ps + r.tr;
    r.joursAff = isKnown ? realMonth.jours_travailles : r.jours;
    r.conges = Math.max(0, r.joursOuvres - r.joursAff);
    rows.push(r);
  }
  const totals = rows.reduce((a, r) => { a.jours += r.joursAff; a.joursOuvres += r.joursOuvres; a.conges += r.conges; a.ca += r.ca; a.sn += r.sn; a.ps += r.ps; a.tr += r.tr; return a; },
    { jours: 0, joursOuvres: 0, conges: 0, ca: 0, sn: 0, ps: 0, tr: 0 });
  totals.total = totals.sn + totals.ps + totals.tr;
  const fut = rows.filter((r) => !r.isKnown);
  const ft = fut.reduce((a, r) => { a.ca += r.ca; a.sn += r.salaire_net; a.ps += r.profit_share; a.tr += r.tickets; a.jours += r.jours; return a; }, { ca: 0, sn: 0, ps: 0, tr: 0, jours: 0 });
  ft.total = ft.sn + ft.ps + ft.tr;
  // Cumul « perçu » par mois d'activité (même définition que la colonne Total perçu : salaire net + profit share + tickets).
  const percu = (m) => (m ? m.salaire_net + m.profit_share_total + m.tickets_resto : 0);
  const cur = [], prev = [];
  let c = 0, p = 0;
  const prevY = String(projYear - 1);
  for (let mo = 1; mo <= 12; mo++) {
    const row = rows.find((r) => r.month === mo);
    c += row ? row.total : percu(AGG.monthsByKey[String(mo).padStart(2, '0') + '-' + projYear]);
    cur.push({ mo, v: c, est: row ? !row.isKnown : false });
    const pm = AGG.monthsByKey[String(mo).padStart(2, '0') + '-' + prevY];
    p += percu(pm);
    prev.push(pm ? p : null);
  }
  return { tjm, projYear, rows, totals, fut, ft, cur, prev, prevY: AGG.years.includes(prevY) ? prevY : null };
}

// Champ texte et non type="number" : un champ number ignore la virgule hors
// navigateur en français (« 18,5 » y devient 185). Rôle spinbutton et flèches
// haut / bas conservent le comportement clavier d'un champ numérique.
function stepperHtml(r, compact) {
  const name = UI.MF[r.month - 1].toLowerCase();
  return `<span class="stepper">
    <button type="button" data-step="down" data-mois="${r.moisKey}" aria-label="Retirer une demi-journée en ${name}">${icon('minus')}</button>
    <input type="text" inputmode="decimal" autocomplete="off" role="spinbutton" aria-valuemin="0" aria-valuemax="${r.joursOuvres}" aria-valuenow="${r.jours}" aria-valuetext="${UI.num1(r.jours)} jours" value="${UI.num1(r.jours)}" data-mois="${r.moisKey}" aria-label="Jours facturés en ${name}">
    ${compact ? '' : '<span class="u" aria-hidden="true">j</span>'}
    <button type="button" data-step="up" data-mois="${r.moisKey}" aria-label="Ajouter une demi-journée en ${name}">${icon('plus')}</button>
  </span>`;
}

// keepFocus : contrôle de compteur à l'origine du recalcul (bouton ou champ). Un champ
// en cours de saisie est conservé tel quel, un bouton retrouve le focus après rendu.
function renderProjection(keepFocus) {
  const host = document.getElementById('projection-widget');
  PROJ = projModel();
  if (!PROJ) { host.innerHTML = ''; return; }
  // Recalcul par un compteur : les animations d'entrée (barres, tracé) ne rejouent pas.
  PROJ.still = !!keepFocus;
  const { rows, fut, ft, totals, tjm, projYear, cur } = PROJ;
  const tableOpen = !!(document.getElementById('proj-table') && document.getElementById('proj-table').classList.contains('is-open'));
  const oldScroll = host.querySelector('.table-scroll');
  const scrollX = oldScroll ? oldScroll.scrollLeft : 0;
  const yearTotal = cur[11].v;
  const daysTxt = fut.map((r) => `${UI.num1(r.jours)} j en ${UI.MF[r.month - 1].toLowerCase()}`);
  const daysSentence = daysTxt.length > 1 ? daysTxt.slice(0, -1).join(', ') + ' et ' + daysTxt[daysTxt.length - 1] : daysTxt.join('');
  const known = rows.filter((r) => r.isKnown);
  const maxRow = Math.max(1, ...rows.map((r) => r.total));
  const bar = (r) => `<span class="pbar${PROJ.still ? ' still' : ''}" aria-hidden="true" style="width:${r.total / maxRow * 100}%">${[['sn', 'var(--c-sal)'], ['ps', 'var(--c-ps)'], ['tr', 'var(--c-extra)']].filter(([k]) => r[k] > 0).map(([k, c]) => `<i style="flex:${r[k]} 1 0;background:${c}"></i>`).join('')}</span>`;
  const dayRows = rows.map((r) => `
    <div class="day-row${r.isKnown ? ' known' : ''}">
      <span class="dn">${UI.MF[r.month - 1]}</span>
      <span class="dh">${r.isKnown ? `${UI.num1(r.joursAff)} j facturés sur ${r.joursOuvres}` : `${r.joursOuvres} jours ouvrés · ${UI.num1(r.conges)} j de congés`}</span>
      <span class="dr">${r.isKnown ? UI.pill('ok', 'Réalisé', 'check') : stepperHtml(r)}</span>
      <span class="db">${bar(r)}<span class="dt tab">${r.isKnown ? '' : '≈ '}${UI.eur0(r.total)}</span></span>
    </div>`).join('');
  const tbody = rows.map((r) => `
    <tr class="${r.isKnown ? 'known' : 'future'}">
      <th scope="row"><span class="mo">${UI.MF[r.month - 1]}</span>${r.isKnown ? UI.pill('ok', 'Réalisé', 'check') : UI.pill('accent', 'À venir')}</th>
      <td>${r.joursOuvres}</td>
      <td>${r.isKnown ? UI.num1(r.joursAff) : stepperHtml(r, true)}</td>
      <td>${UI.num1(r.conges)}</td>
      <td>${UI.eur0z(r.ca)}</td><td>${UI.eur0z(r.sn)}</td><td>${UI.eur0z(r.ps)}</td><td>${UI.eur0z(r.tr)}</td>
      <td class="hl">${UI.eur0(r.total)}</td>
    </tr>`).join('');
  const knownNoPs = known.find((r) => r.ca > 0 && !r.ps);
  const ghost = knownNoPs && VM.ghosts.find((g) => g.mois === knownNoPs.moisKey);
  const html = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('sparkles')}Projection fin ${projYear}</span>
        <h2 id="projection-title">Tes jours d’ici au 31 décembre te rapporteront encore <b>≈ ${UI.eur0(ft.total)}</b>.</h2>
        <p>${fut.length ? `Avec ${daysSentence}, au TJM de ${UI.eur0(tjm)}. Versés au fil des mois suivants${UI.NBP}: le salaire début du mois d’après, le profit share environ ${VM.med ? `${VM.med} jours` : 'trois mois'} après son émission. Ajuste tes jours${UI.NBP}: tout se recalcule aussitôt.` : 'Plus aucun mois à projeter cette année.'}</p>
      </div>
    </header>
    <article class="card proj" aria-labelledby="projection-title">
      <span class="edge" aria-hidden="true"></span>
      <div class="proj-top">
        <div class="proj-hero">
          <span class="eyebrow">Total projeté à venir</span>
          <div class="v" id="projection-total">${UI.money(ft.total)}</div>
          <p>${fut.length} mois · salaire, profit share et tickets · ${UI.eur0(yearTotal)} sur toute l’année ${projYear}</p>
        </div>
        <div class="proj-tiles" id="projection-summary">
          <div class="tile"><div class="tv tab">${UI.eur0(ft.sn)}</div><div class="tl"><span class="sw" style="background:var(--c-sal)"></span>Salaire net à venir</div><div class="th">${fut.length} × ${UI.eur0(PROJ_COEFFS.salaire_net_fixe)} env.</div></div>
          <div class="tile"><div class="tv tab">${UI.eur0(ft.ps)}</div><div class="tl"><span class="sw" style="background:var(--c-ps)"></span>Profit share à venir</div><div class="th">${UI.num1(ft.jours)} jours × ${UI.eur0(tjm)}, moins les charges</div></div>
          <div class="tile"><div class="tv tab">${UI.eur0(ft.ca)}</div><div class="tl"><span class="sw" style="background:var(--c-ink)"></span>CA à facturer</div><div class="th">Brut, d’ici fin ${projYear}</div></div>
        </div>
      </div>
      <div class="proj-main">
        <div class="proj-chart">
          <header class="card-head"><div class="grow"><h3>Ce que ton activité ${projYear} t’aura rapporté</h3><p>Cumul salaire net + profit shares + tickets, compté au mois d’activité (pas à la date de versement)</p></div></header>
          <div class="legend"><span><i class="lk" style="background:var(--c-ink)"></i>${projYear} réalisé</span><span><i class="lk dash" style="color:var(--c-ink)"></i>${projYear} projeté</span>${PROJ.prevY ? `<span><i class="lk" style="background:var(--c-prev)"></i>${PROJ.prevY}</span>` : ''}</div>
          <div class="chart" id="chart-proj"></div>
          ${knownNoPs ? `<p class="card-foot">${icon('info')}<span>${UI.MF[knownNoPs.month - 1]} ne compte que ${UI.eur0(knownNoPs.total)}${UI.NBP}: son profit share n’est pas encore émis${ghost ? ` (vers le ${UI.dShort(ghost.emit)})` : ''}, il s’ajoutera alors.</span></p>` : ''}
        </div>
        <div class="days">
          <h3>Tes jours facturés</h3>
          <p>Par défaut${UI.NBP}: tous les jours ouvrés. Mets tes jours réels attendus.</p>
          <div class="day-legend legend" aria-hidden="true"><span><i class="lk box" style="background:var(--c-sal)"></i>Salaire</span><span><i class="lk box" style="background:var(--c-ps)"></i>Profit share</span><span><i class="lk box" style="background:var(--c-extra)"></i>Tickets</span></div>
          ${dayRows}
        </div>
      </div>
      <div class="proj-table-wrap">
        <button class="link-btn" type="button" id="proj-table-btn" ${UI.toggleAttrs('proj-table', tableOpen)}>${icon('table')}Tableau détaillé${icon('chevron')}</button>
        <div class="fold-body${tableOpen ? ' is-open' : ''}" id="proj-table" role="region" aria-labelledby="proj-table-btn"><div>
          <div class="pt-frame">
            <div class="table-scroll" data-qa-scroll tabindex="0" role="region" aria-label="Tableau de projection, défilable horizontalement">
              <table class="pt">
                <thead><tr><th scope="col">Mois</th><th scope="col">Jours ouvrés</th><th scope="col">Jours facturés</th><th scope="col">Congés</th><th scope="col">CA facturé</th><th scope="col">Salaire net</th><th scope="col">Profit share</th><th scope="col">Tickets resto</th><th scope="col">Total perçu</th></tr></thead>
                <tbody id="projection-tbody">${tbody}</tbody>
                <tfoot id="projection-tfoot"><tr><th scope="row">Total ${UI.MS[rows[0].month - 1]}–${UI.MS[rows[rows.length - 1].month - 1]} ${projYear}</th><td>${totals.joursOuvres}</td><td>${UI.num1(totals.jours)}</td><td>${UI.num1(totals.conges)}</td><td>${UI.eur0(totals.ca)}</td><td>${UI.eur0(totals.sn)}</td><td>${UI.eur0(totals.ps)}</td><td>${UI.eur0(totals.tr)}</td><td class="ledger-total">${UI.eur0(totals.total)}</td></tr></tfoot>
              </table>
            </div>
          </div>
        </div></div>
      </div>
    </article>`;
  const sel = keepFocus ? projCtrlSel(keepFocus) : null;
  if (keepFocus && keepFocus.tagName === 'INPUT' && host.contains(keepFocus)) patchKeeping(host, html, keepFocus);
  else host.innerHTML = html;
  // Un tableau recréé reprend son défilement horizontal (le compteur actionné reste visible).
  const sc = host.querySelector('.table-scroll');
  if (sc !== oldScroll) sc.scrollLeft = scrollX;
  bindProjection();
  UI.chart('proj', drawProjCumul);
  if (sel && !host.contains(document.activeElement)) { const el = host.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
}

// Sélecteur stable d'un contrôle de compteur (panneau .days ou tableau), pour le retrouver après rendu.
function projCtrlSel(el) {
  return `${el.closest('table') ? 'table ' : '.days '}${el.dataset.step ? `[data-step="${el.dataset.step}"]` : 'input'}[data-mois="${el.dataset.mois}"]`;
}

// Remplace le contenu de host par html sans jamais détacher keep (le champ en cours de
// saisie : valeur brute, curseur, focus et clavier virtuel intacts). Les ancêtres de keep
// sont conservés, keep reçoit les attributs de son jumeau, tout le reste est remplacé.
// La structure ne dépend que des mois projetés : identique d'un recalcul à l'autre.
function patchKeeping(host, html, keep) {
  const next = document.createElement('div');
  next.innerHTML = html;
  (function walk(cur, nxt) {
    const a = Array.from(cur.childNodes), b = Array.from(nxt.childNodes);
    if (a.length !== b.length) { cur.replaceChildren(...b); return; }
    a.forEach((node, i) => {
      if (node === keep) { for (const { name, value } of b[i].attributes) if (node.getAttribute(name) !== value) node.setAttribute(name, value); }
      else if (node.contains(keep)) walk(node, b[i]);
      else cur.replaceChild(b[i], node);
    });
  })(host, next);
}

// Saisie « 18,5 » ou « 18.5 » (le clavier décimal français tape une virgule).
// NaN tant que la saisie n'est pas un nombre positif complet (champ vide, « , », lettres).
function parseDays(s) {
  const t = String(s).trim().replace(',', '.');
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

// Borné à [0, jours ouvrés], au dixième (précision affichée) : une saisie « 18,3 » est retenue telle quelle
// (comme en v1) ; le pas d'un demi-jour est celui des boutons +/−. Renvoie false si rien ne change.
function setProjDays(moisKey, v) {
  const row = PROJ.rows.find((r) => r.moisKey === moisKey);
  if (!row) return false;
  v = Math.min(row.joursOuvres, Math.max(0, Math.round(v * 10) / 10 || 0));
  if (v === row.jours) return false;
  const ov = loadProjOverrides();
  ov[moisKey] = v;
  saveProjOverrides(ov);
  return true;
}
function stepProjDays(moisKey, delta) {
  const row = PROJ.rows.find((r) => r.moisKey === moisKey);
  return !!row && setProjDays(moisKey, row.jours + delta);
}
// Le champ affiche la valeur retenue (bornée).
function showProjDays(inp) {
  const row = PROJ.rows.find((r) => r.moisKey === inp.dataset.mois);
  if (row) inp.value = UI.num1(row.jours);
}

// Délégation sur #projection-widget (stable d'un rendu à l'autre) : handlers nommés,
// donc jamais ajoutés deux fois. Quitter un champ ne re-rend rien : Tab, Maj+Tab et un
// clic sur +/− juste après une saisie atteignent bien leur cible.
function bindProjection() {
  const host = document.getElementById('projection-widget');
  host.addEventListener('click', onProjStep);
  host.addEventListener('input', onProjInput);
  host.addEventListener('keydown', onProjKey);
  host.addEventListener('change', onProjCommit);
  const sc = host.querySelector('.table-scroll');
  sc.addEventListener('scroll', onProjScroll, { passive: true });
  if (PROJ_RO) { PROJ_RO.disconnect(); PROJ_RO.observe(sc); PROJ_RO.observe(sc.firstElementChild); }
  tableHint(sc, true);
}
function onProjStep(e) {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  e.preventDefault();
  if (stepProjDays(b.dataset.mois, b.dataset.step === 'up' ? 0.5 : -0.5)) renderProjection(b);
}
function onProjInput(e) {
  const inp = e.target;
  if (!inp.matches('input[data-mois]')) return;
  const v = parseDays(inp.value);
  // Champ vidé ou saisie incomplète : rien n'est retenu, la valeur revient en quittant le champ.
  if (!isNaN(v) && setProjDays(inp.dataset.mois, v)) renderProjection(inp);
}
function onProjKey(e) {
  const inp = e.target;
  if (!inp.matches('input[data-mois]') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  if (stepProjDays(inp.dataset.mois, e.key === 'ArrowUp' ? 0.5 : -0.5)) renderProjection(inp);
  showProjDays(inp);
}
function onProjCommit(e) { if (e.target.matches('input[data-mois]')) showProjDays(e.target); }

// Indices de défilement du tableau : ombre à droite tant que des colonnes restent cachées,
// ombre au bord de la colonne Mois collante dès qu'on a défilé. measure (rendu,
// redimensionnement) recale cette ombre sur la largeur réelle de la colonne collante.
const PROJ_RO = 'ResizeObserver' in window ? new ResizeObserver((es) => es.forEach((en) => tableHint(en.target.closest('.table-scroll'), true))) : null;
function onProjScroll(e) { tableHint(e.currentTarget); }
function tableHint(sc, measure) {
  const frame = sc.parentElement;
  if (measure) frame.style.setProperty('--pt-stick', sc.clientLeft + sc.querySelector('thead th').offsetWidth + 'px');
  frame.classList.toggle('more-left', sc.scrollLeft > 1);
  frame.classList.toggle('more-right', sc.scrollLeft < sc.scrollWidth - sc.clientWidth - 1);
}

function drawProjCumul() {
  const el = document.getElementById('chart-proj');
  if (!el || !PROJ) return;
  el.innerHTML = '';
  const { cur, prev, projYear, prevY } = PROJ;
  const W = Math.max(260, el.clientWidth);
  const narrow = W < 480;
  const H = Math.max(narrow ? 220 : 256, Math.min(420, el.clientHeight || 0));
  const P = { l: 46, r: narrow ? 74 : 96, t: 22, b: 28 };
  const max = Math.max(1, ...cur.map((c) => c.v), ...prev.filter((v) => v != null));
  const { top, ticks } = UI.scaleY(max, 4);
  const x = (i) => P.l + i / 11 * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const firstEst = cur.findIndex((c) => c.est);
  const lastReal = firstEst > 0 ? firstEst - 1 : (firstEst === -1 ? 11 : 0);
  let g = '';
  if (firstEst > 0) {
    const xa = x(lastReal) + (x(firstEst) - x(lastReal)) / 2;
    g += `<rect x="${xa}" y="${P.t - 8}" width="${W - P.r + 8 - xa}" height="${H - P.b - P.t + 8}" rx="10" style="fill:var(--accent-soft);opacity:.7"/>`;
    g += `<text class="g-sub" x="${xa + 8}" y="${H - P.b - 10}">Projection</text>`;
  }
  g += `<g class="g-grid">${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r + 8}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
  g += ticks.map((v) => `<text class="g-tick" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${UI.esc(UI.kEur(v))}</text>`).join('');
  for (let i = 0; i < 12; i += narrow ? 3 : 2) g += `<text class="g-tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${UI.MS[i]}</text>`;
  const path = (arr, from, to) => { let d = ''; for (let i = from; i <= to; i++) { const v = arr[i]; if (v == null) continue; d += (d ? 'L' : 'M') + x(i) + ',' + y(v); } return d; };
  const cv = cur.map((c) => c.v);
  if (prevY) g += `<path class="g-line" d="${path(prev, 0, 11)}" style="stroke:var(--c-prev)"/>`;
  g += `<path d="${path(cv, 0, lastReal)}L${x(lastReal)},${y(0)}L${x(0)},${y(0)}Z" style="fill:var(--c-ink-wash)"/>`;
  g += `<path class="g-line${PROJ.still ? '' : ' g-draw'}" d="${path(cv, 0, lastReal)}" style="stroke:var(--c-ink)"/>`;
  if (firstEst > 0) g += `<path class="g-line est" d="${path(cv, lastReal, 11)}" style="stroke:var(--c-ink)"/>`;
  g += `<circle class="g-dot" cx="${x(lastReal)}" cy="${y(cv[lastReal])}" r="4.5" style="fill:var(--c-ink)"/>`;
  g += `<circle cx="${x(11)}" cy="${y(cv[11])}" r="5" style="fill:var(--surface-solid);stroke:var(--c-ink);stroke-width:2"/>`;
  const endP = prev[11];
  const yCur = y(cv[11]), yPrev = endP != null ? y(endP) : null;
  let dy1 = 0, dy2 = 0;
  if (yPrev != null && Math.abs(yCur - yPrev) < 30) { if (yCur < yPrev) { dy1 = -10; dy2 = 10; } else { dy1 = 10; dy2 = -10; } }
  g += `<text class="g-lbl halo" x="${x(11) + 10}" y="${yCur + dy1 - 2}">≈ ${UI.esc(UI.eur0(cv[11]))}</text><text class="g-sub halo" x="${x(11) + 10}" y="${yCur + dy1 + 12}">${projYear}</text>`;
  if (endP != null) {
    g += `<circle class="g-dot" cx="${x(11)}" cy="${yPrev}" r="4" style="fill:var(--c-prev)"/>`;
    g += `<text class="g-lbl halo" x="${x(11) + 10}" y="${yPrev + dy2 + 10}" style="fill:var(--text-2)">${UI.esc(UI.eur0(endP))}</text><text class="g-sub halo" x="${x(11) + 10}" y="${yPrev + dy2 + 24}">${prevY}</text>`;
  }
  g += `<line class="g-cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" style="opacity:0"/>`;
  g += `<rect class="g-hit" x="${P.l - 10}" y="${P.t}" width="${W - P.l - P.r + 20}" height="${H - P.t - P.b}" tabindex="0" aria-label="Lire le cumul perçu mois par mois${UI.NBP}: survol, ou flèches gauche et droite"/>`;
  el.innerHTML = UI.svg(W, H, g, `Perçu cumulé ${projYear}${UI.NBP}: environ ${UI.eur0(cv[11])} fin décembre${endP != null ? `, contre ${UI.eur0(endP)} en ${prevY}` : ''}`)
    + UI.srTable('Perçu cumulé par mois', ['Mois', `${projYear}`, 'Statut', prevY || ''], cur.map((c, i) => [UI.MF[i], UI.eur0(c.v), c.est ? 'projeté' : 'réalisé', prev[i] != null ? UI.eur0(prev[i]) : '—']));
  const hit = el.querySelector('.g-hit'), cross = el.querySelector('.g-cross');
  let idx = lastReal;
  const show = (i, cx, cy) => {
    idx = Math.max(0, Math.min(11, i));
    cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.style.opacity = '1';
    const row = PROJ.rows.find((r) => r.month === idx + 1);
    let html = UI.ttTitle(`Fin ${UI.MF[idx].toLowerCase()} ${projYear}${cur[idx].est ? ' · projeté' : ''}`);
    html += UI.ttRow('var(--c-ink)', projYear + (cur[idx].est ? ' (estimé)' : ''), (cur[idx].est ? '≈ ' : '') + UI.eur0(cur[idx].v));
    if (prevY) html += UI.ttRow('var(--c-prev)', prevY, prev[idx] != null ? UI.eur0(prev[idx]) : '—');
    if (row) html += UI.ttRow('', 'Dont ce mois', UI.eur0(row.total) + (row.isKnown ? '' : ' · ' + UI.num1(row.jours) + ' j'));
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
