// ============================================================
// AURORA — orchestration du rendu (render.js en production).
// render() : bascule état vide / contenu, en-tête, pied, modèle de vue VM,
// audit silencieux (badge), puis délègue à chaque section :
//   render-balance.js    -> renderBalanceWidget()   #hero #arrivals #balance-widget
//   render-stats.js      -> renderActivityStats()   #kpis #activity-widget
//   render-months.js     -> renderPendingTrack()    #pending
//                           renderMonthsLists()     #tab-detail
//   render-projection.js -> renderProjection()      #projection-widget
//   render-overlays.js   -> runAudit, showToast, showConfirm, showImportDiff…
// ============================================================

// Modèle de vue partagé, recalculé à chaque render(). Lecture seule pour les sections.
let VM = null;

function buildViewModel() {
  const t = AGG.totals;
  // === Formules recopiées À L'IDENTIQUE de l'ancien render-balance.js ===
  const soldeFacture = t.profit_share_non_paye
    + (t.provision_conges_total - t.provision_conges_payee)
    + (t.cooptation_revenu_total - t.cooptation_revenu_paye);
  const creditsEncaisses = t.ca_paye + t.cooptation_credit_paye + t.refacturation_paye;
  const chargesPayees = t.commission_paye + t.charges_diverses_paye + t.impot_france + t.charges_ps_paye + t.charges_salaire_paye;
  const versementsRecus = t.salaire_net + t.notes_frais + t.tickets_resto + t.profit_share_paye + t.cooptation_revenu_paye;
  const soldeEncaisse = creditsEncaisses - chargesPayees - versementsRecus;

  const psPending = [];
  AGG.months.forEach((m) => m.details_profit_share.forEach((ps) => { if (ps.statut !== 'Payé') psPending.push({ mois: m.mois, ...ps }); }));
  psPending.sort(UI.byMois);
  const psSum = UI.sum(psPending, 'montant');
  const provRest = t.provision_conges_total - t.provision_conges_payee;
  const provMois = AGG.months.filter((m) => m.provision_conges > 0).length;
  const provPer = provMois ? t.provision_conges_total / provMois : 0;
  const coopPending = [];
  AGG.months.forEach((m) => { const d = m.cooptation_revenu - m.cooptation_revenu_paye; if (d > 0.01) coopPending.push({ mois: m.mois, montant: d }); });
  const coopRest = t.cooptation_revenu_total - t.cooptation_revenu_paye;

  let tjm = 0;
  for (let i = AGG.months.length - 1; i >= 0; i--) { if (AGG.months[i].tjm > 0) { tjm = AGG.months[i].tjm; break; } }

  const today = todayDate();
  const med = AGG.delaisPS.median || 0;
  const medCA = AGG.delaisCA.median || 0;
  // Arrivée estimée d'un profit share = date d'émission + délai médian constaté (dérivée d'affichage)
  const arrivals = psPending.map((ps) => {
    const emit = parseDate(ps.date_emission);
    const eta = emit && med ? UI.addDays(emit, med) : null;
    return { ...ps, emit, eta, waited: emit ? UI.daysDiff(emit, today) : null, left: eta ? UI.daysDiff(today, eta) : null };
  }).sort((a, b) => (a.eta || 0) - (b.eta || 0));

  // Profit shares pas encore émis : mois facturés sans aucune ligne de PS, émission
  // habituelle le 16 du mois suivant (règle déjà utilisée par l'audit).
  const ghosts = AGG.months.filter((m) => m.facturation > 0 && m.details_profit_share.length === 0).map((m) => {
    const { m: mo, y } = UI.mk(m.mois);
    const emit = new Date(y, mo, 16);
    return { mois: m.mois, facturation: m.facturation, emit, eta: med ? UI.addDays(emit, med) : null };
  }).filter((g) => UI.daysDiff(g.emit, today) < 45);

  // Côté client : factures émises par le portage, pas encore réglées par le client (hors total)
  const clientPending = DATASET.filter((r) => r.nature === 'Crédit - Facturation' && r.statut !== 'Payé').map((r) => {
    const emit = parseDate(r.date);
    const eta = emit && medCA ? UI.addDays(emit, medCA) : null;
    const waited = emit ? UI.daysDiff(emit, today) : null;
    return { mois: r.mois, montant: r.montant, date: r.date, reference: r.reference, emit, eta, waited, late: eta ? UI.daysDiff(eta, today) : null };
  }).sort((a, b) => (a.emit || 0) - (b.emit || 0));

  const years = AGG.years;
  const curY = years[years.length - 1];
  const prevY = years.length > 1 ? years[years.length - 2] : null;
  const billedCur = AGG.months.filter((m) => m.mois.endsWith('-' + curY) && m.facturation > 0);
  const lastM = billedCur.length ? Math.max(...billedCur.map((m) => UI.mk(m.mois).m)) : 12;
  const ytd = (y) => AGG.months.filter((m) => m.mois.endsWith('-' + y) && UI.mk(m.mois).m <= lastM);
  const sy = Object.fromEntries(AGG.statsByYear.map((s) => [s.year, s]));

  return {
    t, today, soldeFacture, soldeEncaisse, creditsEncaisses, chargesPayees, versementsRecus,
    psPending, psSum, provRest, provMois, provPer, coopPending, coopRest, tjm, med, medCA,
    arrivals, ghosts, clientPending, curY, prevY, lastM, sy,
    caCur: UI.sum(ytd(curY), 'facturation'), caPrev: prevY ? UI.sum(ytd(prevY), 'facturation') : 0,
    jCur: UI.sum(ytd(curY), 'jours_travailles'), jPrev: prevY ? UI.sum(ytd(prevY), 'jours_travailles') : 0
  };
}

// ---------------------------------------------------------------- en-tête et pied
function renderChrome(meta) {
  const tjmEl = document.getElementById('header-tjm');
  if (tjmEl) tjmEl.textContent = VM && VM.tjm ? 'TJM ' + UI.eur0(VM.tjm) : '';
  const info = document.getElementById('last-import-info');
  const foot = document.getElementById('footer-text');
  if (meta && DATASET.length) {
    const d = new Date(meta.lastImport);
    const hh = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (info) info.innerHTML = `<span class="im-long">Import du ${UI.dShort(d)} à ${hh} · ${UI.int(meta.count)} lignes</span><span class="im-short">Import ${UI.dShort(d)}, ${hh}</span>`;
    if (foot) foot.textContent = `${UI.int(meta.count)} opérations analysées · dernière synchronisation le ${UI.dLong(d)} à ${hh}`;
  } else {
    if (info) info.textContent = 'Aucun import pour l’instant';
    if (foot) foot.textContent = 'Aucune donnée : importe un CSV pour démarrer';
  }
}

function renderFooterAudit(result) {
  const b = document.getElementById('footer-audit');
  if (!b) return;
  if (!result) { b.hidden = true; return; }
  const s = result.stats;
  const n = s.danger + s.warn;
  b.hidden = false;
  b.innerHTML = `<i class="ldot" style="background:${s.danger ? 'var(--danger)' : n ? 'var(--warn)' : 'var(--ok)'}"></i>Audit : ${s.danger} critique${s.danger > 1 ? 's' : ''} · ${s.warn} point${s.warn > 1 ? 's' : ''} d’attention`;
  b.setAttribute('aria-label', `Ouvrir l’audit : ${s.danger} critique, ${s.warn} points d’attention`);
}

// ---------------------------------------------------------------- navigation de sections (scroll-spy)
let SPY = null;
function setupSpy() {
  if (SPY) SPY.disconnect();
  const map = { overview: 'overview', 'balance-widget': 'overview', pending: 'overview', 'activity-widget': 'activity', 'projection-widget': 'projection', 'tab-detail': 'months' };
  const setCur = (k) => UI.$$('[data-nav]').forEach((a) => a.setAttribute('aria-current', String(a.dataset.nav === k)));
  setCur('overview');
  if (!('IntersectionObserver' in window)) return;
  SPY = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) setCur(map[e.target.id]); });
  }, { rootMargin: '-35% 0px -60% 0px' });
  Object.keys(map).forEach((id) => { const el = document.getElementById(id); if (el) SPY.observe(el); });
}

// ---------------------------------------------------------------- rendu principal
function render() {
  const meta = loadMeta();
  const hasData = Array.isArray(DATASET) && DATASET.length > 0;
  document.body.classList.toggle('is-empty', !hasData);
  document.getElementById('empty-state').hidden = hasData;
  document.getElementById('main-content').hidden = !hasData;
  UI.$$('.needs-data').forEach((el) => { el.hidden = !hasData; });
  UI.resetCharts();

  if (!hasData) {
    AGG = null; VM = null;
    ['hero', 'arrivals', 'kpis', 'balance-widget', 'pending', 'activity-widget', 'projection-widget', 'tab-detail'].forEach((id) => {
      const el = document.getElementById(id); if (el) el.innerHTML = '';
    });
    renderChrome(meta);
    renderFooterAudit(null);
    if (typeof updateAuditBadge === 'function') updateAuditBadge(null);
    hydrateIcons();
    return;
  }

  AGG = aggregate();
  refreshProjCoeffs();
  VM = buildViewModel();
  renderChrome(meta);
  const audit = typeof runAudit === 'function' ? runAudit({ silent: true }) : null;

  renderBalanceWidget();
  renderActivityStats();
  renderPendingTrack();
  renderProjection();
  renderMonthsLists();
  renderFooterAudit(audit);

  hydrateIcons();
  setupSpy();
}
