// ============================================================
// AURORA — orchestration du rendu.
// render() : écarte les lignes au mois illisible, bascule état vide / contenu,
// en-tête, pied, modèle de vue VM, audit silencieux (badge), puis délègue à
// chaque section :
//   render-balance.js    -> renderBalanceWidget()   #hero #arrivals #balance-widget
//   render-stats.js      -> renderActivityStats()   #kpis #activity-widget
//   render-months.js     -> renderPendingTrack()    #pending
//                           renderMonthsLists()     #tab-detail
//   render-projection.js -> renderProjection()      #projection-widget
//   render-overlays.js   -> runAudit, showToast, showConfirm, showImportDiff…
// ============================================================

// Modèle de vue partagé, recalculé à chaque render(). Lecture seule pour les sections.
let VM = null;

// ---------------------------------------------------------------- validation du mois
// MOIS (MM-AAAA) sert d'identifiant dans les gabarits (id, aria-controls, data-*) et l'année qui
// en dérive dans les titres : une valeur hors format n'est jamais rendue. Contrôlé à l'import
// (main.js) et avant chaque rendu, quelle que soit la provenance (stockage local, cloud).
const MOIS_RE = /^(0[1-9]|1[0-2])-\d{4}$/;
const isValidMois = (m) => typeof m === 'string' && MOIS_RE.test(m);

// Écarte les lignes au mois illisible, persiste le nettoyage (sans changer la date du dernier
// import) et le signale. Renvoie le nombre de lignes retirées.
function dropInvalidRows() {
  if (!Array.isArray(DATASET)) return 0;
  const keep = DATASET.filter((r) => r && isValidMois(r.mois));
  const n = DATASET.length - keep.length;
  if (!n) return 0;
  const meta = loadMeta();
  DATASET = keep;
  try {
    saveDataset(DATASET);
    if (meta) localStorage.setItem(META_KEY, JSON.stringify({ ...meta, count: keep.length }));
  } catch (e) { console.warn('Nettoyage non enregistré :', e); }
  if (typeof showToast === 'function') {
    const p = n > 1;
    showToast({
      title: p ? `${n} lignes ignorées` : '1 ligne ignorée',
      body: `Mois illisible (format attendu MM-AAAA)${UI.NBP}: ${p ? 'ces lignes ont été retirées' : 'cette ligne a été retirée'} des données.`,
      ok: false
    });
  }
  return n;
}

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
    // late : la date d'émission habituelle est passée, l'audit (règle 7) le signale déjà en critique.
    return { mois: m.mois, facturation: m.facturation, emit, eta: med ? UI.addDays(emit, med) : null, late: UI.daysDiff(emit, today) >= 0 };
  }).filter((g) => UI.daysDiff(g.emit, today) < 45);

  // Côté client : factures émises par le portage, pas encore réglées par le client (hors total)
  const clientPending = DATASET.filter((r) => r.nature === 'Crédit - Facturation' && r.statut !== 'Payé').map((r) => {
    const emit = parseDate(r.date);
    const eta = emit && medCA ? UI.addDays(emit, medCA) : null;
    const waited = emit ? UI.daysDiff(emit, today) : null;
    return { mois: r.mois, montant: r.montant, date: r.date, reference: r.reference, emit, eta, waited, late: eta ? UI.daysDiff(eta, today) : null };
  }).sort((a, b) => (a.emit || 0) - (b.emit || 0));

  // Année affichée : la dernière qui compte au moins un mois facturé. En janvier, tant que la
  // première facture n'est pas émise, la nouvelle année n'a que des lignes annexes : on reste sur N.
  const years = AGG.years;
  const billed = (y) => AGG.months.filter((m) => m.mois.endsWith('-' + y) && m.facturation > 0);
  const billedYears = years.filter((y) => billed(y).length);
  const curY = billedYears.length ? billedYears[billedYears.length - 1] : years[years.length - 1];
  const prevY = years[years.indexOf(curY) - 1] || null;
  const billedCur = billed(curY);
  const lastM = billedCur.length ? Math.max(...billedCur.map((m) => UI.mk(m.mois).m)) : 12;
  const cumul = (y, from, f) => UI.sum(AGG.months.filter((m) => {
    const k = UI.mk(m.mois);
    return k.y === +y && k.m >= from && k.m <= lastM;
  }), f);
  const sy = Object.fromEntries(AGG.statsByYear.map((s) => [s.year, s]));

  // Comparaison « même période » : uniquement sur les mois que l'historique couvre dans les deux
  // années. Une première année partielle (portage commencé en juin) ne se compare que de juin à
  // lastM ; si l'historique commence après lastM, aucune comparaison n'est possible (cmp = null).
  const start = UI.mk(AGG.months[0].mois);
  const from = !prevY ? null : +prevY > start.y ? 1 : start.m;
  const cmp = from && from <= lastM ? {
    from, to: lastM, full: from === 1,
    caCur: cumul(curY, from, 'facturation'), caPrev: cumul(prevY, from, 'facturation'),
    jCur: cumul(curY, from, 'jours_travailles'), jPrev: cumul(prevY, from, 'jours_travailles')
  } : null;

  return {
    t, today, soldeFacture, soldeEncaisse, creditsEncaisses, chargesPayees, versementsRecus,
    psPending, psSum, provRest, provMois, provPer, coopPending, coopRest, tjm, med, medCA,
    arrivals, ghosts, clientPending, curY, prevY, lastM, sy,
    // Profit shares en retard, sans échéance estimable, et « au moins un émis » (pour ne pas
    // écrire « tout ce qui a été émis t'a été versé » quand rien n'a encore été émis).
    psLate: arrivals.filter((a) => a.left != null && a.left < 0),
    psUndated: arrivals.filter((a) => !a.eta),
    psEver: AGG.months.some((m) => m.details_profit_share.length > 0),
    // Cumuls de janvier à lastM (chiffres affichés) ; les deltas N / N-1 se lisent dans cmp.
    caCur: cumul(curY, 1, 'facturation'), caPrev: prevY ? cumul(prevY, 1, 'facturation') : 0,
    jCur: cumul(curY, 1, 'jours_travailles'), jPrev: prevY ? cumul(prevY, 1, 'jours_travailles') : 0,
    cmp, since: UI.monthLower(AGG.months[0].mois)
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
    if (foot) foot.textContent = `Aucune donnée${UI.NBP}: importe un CSV pour démarrer`;
  }
  fitAppbar();
}

// ---------------------------------------------------------------- barre d'app : compaction progressive
// La barre est plafonnée à --maxw : selon l'état cloud (Sauvegarder affiché, libellés au-delà de
// 1480 px), la longueur du TJM ou le badge d'audit, la marque peut manquer de place et l'info
// d'import se couper. On retire alors, dans l'ordre et seulement tant qu'il le faut : les libellés
// cloud, les icônes de navigation, « CSV » du bouton d'import, l'info d'import longue, puis le
// libellé « Vérifier » (icône et badge restent, nom accessible conservé).
const BAR_FIT = ['fit-1', 'fit-2', 'fit-3', 'fit-4', 'fit-5', 'fit-6'];
function fitAppbar() {
  const bar = document.getElementById('appbar');
  const info = document.getElementById('last-import-info');
  if (!bar || !info) return;
  bar.classList.remove(...BAR_FIT);
  for (const c of BAR_FIT) {
    if (info.scrollWidth <= info.clientWidth) return;
    bar.classList.add(c);
  }
}
// Réajuste avant l'affichage quand la place change : redimensionnement, chargement des polices,
// actions modifiées (bouton cloud et son libellé posés par supabase-sync, Sauvegarder, badge
// d'audit). Les classes vivent sur #appbar, hors du sous-arbre observé : pas de boucle.
let BAR_WATCHED = false;
function watchAppbar() {
  if (BAR_WATCHED) return;
  BAR_WATCHED = true;
  addEventListener('resize', fitAppbar);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fitAppbar);
  const acts = document.querySelector('.actions');
  if (acts) new MutationObserver(fitAppbar).observe(acts, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
}

function renderFooterAudit(result) {
  const b = document.getElementById('footer-audit');
  if (!b) return;
  if (!result) { b.hidden = true; return; }
  const s = result.stats;
  const n = s.danger + s.warn;
  b.hidden = false;
  const txt = `${s.danger} critique${s.danger > 1 ? 's' : ''} · ${s.warn} point${s.warn > 1 ? 's' : ''} d’attention`;
  b.innerHTML = `<i class="ldot" style="background:${s.danger ? 'var(--danger)' : n ? 'var(--warn)' : 'var(--ok)'}"></i>Audit${UI.NBP}: ${txt}`;
  b.setAttribute('aria-label', `Ouvrir l’audit${UI.NBP}: ${txt.replace(' · ', ', ')}`);
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
  dropInvalidRows();
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
  let audit = null;
  safeRender('audit', () => { audit = typeof runAudit === 'function' ? runAudit({ silent: true }) : null; });

  safeRender('solde', renderBalanceWidget);
  safeRender('activité', renderActivityStats);
  safeRender('en attente', renderPendingTrack);
  safeRender('projection', () => renderProjection());
  safeRender('mois par mois', renderMonthsLists);
  renderFooterAudit(audit);

  hydrateIcons();
  setupSpy();
}

// Défense en profondeur : une section en échec est journalisée et n'emporte ni les suivantes,
// ni le pied d'audit, ni l'appelant (un import déjà enregistré reste un import réussi).
function safeRender(name, fn) {
  try { fn(); } catch (e) { console.error(`Section « ${name} » non rendue :`, e); }
}
