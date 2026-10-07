// ============================================================
// AURORA — surcouches :
// contrôleur de modales (classe .visible), toast, confirmation, réinitialisation,
// audit (règles inchangées, affichage regroupé), diff d'import.
// Toutes les modales s'ouvrent en ajoutant .visible — y compris #auth-modal,
// ouverte par supabase-sync.js : un MutationObserver applique alors le même
// verrou de défilement, le focus sur le panneau, le piège de Tab et Échap.
// ============================================================

let LAST_AUDIT = null;

// ---------------------------------------------------------------- contrôleur de modales
const ModalCtl = (() => {
  let lockY = 0;
  const stack = [];
  const visible = () => Array.from(document.querySelectorAll('.modal.visible'));
  function lock() {
    lockY = window.scrollY;
    const b = document.body;
    b.style.position = 'fixed'; b.style.top = -lockY + 'px'; b.style.left = '0'; b.style.right = '0';
    document.documentElement.classList.add('modal-open');
  }
  function unlock() {
    const b = document.body;
    b.style.position = ''; b.style.top = ''; b.style.left = ''; b.style.right = '';
    document.documentElement.classList.remove('modal-open');
    const html = document.documentElement;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, lockY);
    html.style.scrollBehavior = '';
  }
  function onOpen(m) {
    if (!stack.length) lock();
    stack.push({ m, focus: document.activeElement });
    setTimeout(() => {
      const target = m.querySelector('[data-autofocus]:not([hidden])') || m.querySelector('.modal-panel');
      if (target && m.classList.contains('visible')) target.focus({ preventScroll: true });
    }, 40);
  }
  // L'élément d'origine peut-il reprendre le focus ? Le panneau d'une modale encore ouverte, oui ;
  // sinon il doit être visible et tabulable (l'input fichier sr-only / aria-hidden ne l'est pas).
  function canTakeFocus(el) {
    if (!el || !el.focus || el === document.body || !document.contains(el)) return false;
    if (el.closest('.modal.visible')) return true;
    return el.tabIndex >= 0 && !el.closest('[aria-hidden="true"], [hidden]') && el.getClientRects().length > 0;
  }
  // Repli : un autre bouton visible pour la même action — le label « Importer » de la barre, que
  // l'origine soit l'input fichier masqué ou le label de l'état vide disparu après l'import —,
  // sinon le titre du héros, rendu focalisable par script.
  function focusFallback(el) {
    const id = el && (el.tagName === 'LABEL' ? el.htmlFor : el.id);
    const labels = id ? Array.from(document.querySelectorAll('label[for="' + id + '"]')) : [];
    const label = labels.find(canTakeFocus);
    if (label) return label;
    const title = document.getElementById('hero-title');
    if (title && title.getClientRects().length) {
      if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
      return title;
    }
    return null;
  }
  function onClose(m) {
    const i = stack.findIndex((s) => s.m === m);
    const entry = i >= 0 ? stack.splice(i, 1)[0] : null;
    if (!stack.length) {
      unlock();
      flushToast();
    }
    if (!entry) return;
    const target = canTakeFocus(entry.focus) ? entry.focus : focusFallback(entry.focus);
    if (target) target.focus({ preventScroll: true });
  }
  function init() {
    const mo = new MutationObserver((muts) => muts.forEach((mu) => {
      const m = mu.target;
      const vis = m.classList.contains('visible');
      if (vis === !!m._vis) return;
      m._vis = vis;
      if (vis) onOpen(m); else onClose(m);
    }));
    document.querySelectorAll('.modal').forEach((m) => mo.observe(m, { attributes: true, attributeFilter: ['class'] }));
    // Clic sur le fond : déclenche le bouton de fermeture de la modale (sa logique propre s'exécute)
    document.addEventListener('click', (e) => {
      const bd = e.target.closest('.modal-backdrop');
      if (!bd) return;
      const m = bd.closest('.modal');
      const x = m && m.querySelector('[data-qa-close]');
      if (x && !bd.id) x.click(); // #auth-backdrop est géré par supabase-sync.js
    });
    document.addEventListener('keydown', (e) => {
      const open = visible().pop();
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        const x = open.querySelector('[data-qa-close]');
        if (x) x.click(); else open.classList.remove('visible');
        return;
      }
      if (e.key === 'Tab') {
        const panel = open.querySelector('.modal-panel');
        const f = Array.from(open.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex="0"]'))
          .filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        const cur = document.activeElement;
        // Focus sur le panneau lui-même (posé à l'ouverture) ou hors de la modale : il précède
        // toute la séquence, Tab va donc au premier élément et Maj+Tab au dernier.
        const outside = cur === panel || !panel.contains(cur);
        if (e.shiftKey && (outside || cur === first)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (outside || cur === last)) { e.preventDefault(); first.focus(); }
      }
    });
  }
  return { init, open: (id) => document.getElementById(id).classList.add('visible'), close: (id) => document.getElementById(id).classList.remove('visible'), anyOpen: () => visible().length > 0 };
})();

// ---------------------------------------------------------------- confirmation (remplace confirm() natif)
function showConfirm({ title = 'Confirmation', message, okLabel = 'Confirmer', cancelLabel = 'Annuler', danger = true } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');
    const cleanup = (value) => {
      okBtn.onclick = null; cancelBtn.onclick = null;
      modal.classList.remove('visible');
      resolve(value);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    modal.classList.add('visible');
    setTimeout(() => cancelBtn.focus({ preventScroll: true }), 60); // focus sur Annuler, par sécurité
  });
}

async function resetData() {
  const confirmed = await showConfirm({
    title: `Réinitialiser le dashboard${UI.NBP}?`,
    message: `Toutes les données importées et les préférences seront supprimées${UI.NBP}:\n\n• Opérations importées\n• Projections personnalisées\n• Préférence de thème\n\nCette action est irréversible.`,
    okLabel: 'Tout supprimer',
    cancelLabel: 'Annuler',
    danger: true
  });
  if (!confirmed) return;
  ['dashboard_dataset_v1', 'dashboard_meta_v1', 'dashboard_proj_overrides_v1', 'dashboard_theme_v1', 'dashboard_client_rules_v1']
    .forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
  DATASET = [];
  CLIENT_RULES = []; // let de data.js, chargé une fois au démarrage : sinon le prochain import les appliquerait encore
  LAST_AUDIT = null;
  ['audit-modal', 'diff-modal'].forEach((id) => document.getElementById(id).classList.remove('visible'));
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark');
  render();
  showToast({ title: 'Dashboard réinitialisé', body: 'Toutes les données locales ont été supprimées.', ok: true });
}

// ---------------------------------------------------------------- toast
// Règle « un événement, un seul retour » : jamais par-dessus une modale ; s'il en
// arrive un pendant qu'une modale est ouverte, il attend sa fermeture.
let TOAST_QUEUE = null;
function showToast(opts) {
  if (ModalCtl.anyOpen()) { TOAST_QUEUE = opts; return; }
  const { title, body, stats, ok = true } = opts;
  const t = document.getElementById('toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-body').textContent = body || '';
  document.getElementById('toast-ic').innerHTML = icon(ok ? 'check' : 'alert');
  const s = document.getElementById('toast-stats');
  s.innerHTML = stats ? `<span>Ajoutées <b>${stats.added}</b></span><span>Mises à jour <b>${stats.updated}</b></span><span>Déjà à jour <b>${stats.unchanged}</b></span>${stats.removed ? `<span>Supprimées <b>${stats.removed}</b></span>` : ''}` : '';
  s.hidden = !stats;
  t.classList.toggle('error', !ok);
  t.setAttribute('role', ok ? 'status' : 'alert');
  t.classList.add('visible');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('visible'), ok ? 5000 : 8000);
}
function flushToast() { if (TOAST_QUEUE) { const q = TOAST_QUEUE; TOAST_QUEUE = null; setTimeout(() => showToast(q), 250); } }
function hideToast() { document.getElementById('toast').classList.remove('visible'); }

// Alias global de UI.esc (null et undefined donnent '') : supabase-sync.js l'appelle par ce nom.
const escapeHtml = UI.esc;

// ============================================================
// AUDIT — Vérification automatique des calculs portage
// ============================================================

const AUDIT_RULES = {
  COMMISSION_PCT_EXPECTED: 0.06,    // La société de portage facture exactement 6% de commission
  COMMISSION_TOLERANCE: 0.01,        // Tolérance 0,01 € sur arrondis
  TR_MIN: 10.5,                      // TR minimum (en dessous = anormal, ex: 8€/j)
  TR_MAX: 15,                        // TR maximum 15 €/jour
  PS_DSO_WARN: 100,                  // Au-delà, attention
  PS_DSO_CRITICAL: 130,              // Au-delà, fort risque d'oubli
  SALAIRE_NET_MIN: 1400,             // Seuil bas normal
  SALAIRE_NET_MAX: 2100,             // Seuil haut normal (hors bonus/13e mois)
  CHARGES_PS_PCT_MIN: 0.02,          // Charges sur PS ~3-10% typiquement
  CHARGES_PS_PCT_MAX: 0.11,          // Légèrement tolérant
  PROVISION_CONGES: 283,             // Montant standard
};

// opts.silent : calcule et met à jour le badge sans ouvrir la modale (appelé par render()).
// Les règles ci-dessous sont recopiées SANS MODIFICATION de l'ancien render.js.
function runAudit(opts) {
  const silent = !!(opts && opts.silent === true);
  if (!AGG || DATASET.length === 0) {
    if (!silent) showToast({ title: 'Pas de données', body: 'Importe un CSV avant de lancer la vérification.', ok: false });
    return null;
  }

  const issues = [];
  const addIssue = (severity, category, title, desc, detail) => {
    issues.push({ severity, category, title, desc, detail: detail || '' });
  };

  // === 1. COMMISSION PORTAGE : doit être exactement 6% du CA ===
  // On regroupe par référence pour matcher facturation et commission
  const byRef = {};
  DATASET.forEach(r => {
    if (!byRef[r.reference]) byRef[r.reference] = { facturations: [], commissions: [] };
    if (r.nature === 'Crédit - Facturation') byRef[r.reference].facturations.push(r);
    if (r.nature === 'Charges - Commission Portage') byRef[r.reference].commissions.push(r);
  });

  // Mais les commissions peuvent concerner plusieurs références (ex: ";" séparateur)
  // On regarde plutôt par MOIS agrégé
  const byMoisCommission = {};
  DATASET.forEach(r => {
    const m = r.mois;
    if (!byMoisCommission[m]) byMoisCommission[m] = { ca: 0, commission: 0 };
    if (r.nature === 'Crédit - Facturation') byMoisCommission[m].ca += r.montant;
    if (r.nature === 'Charges - Commission Portage') byMoisCommission[m].commission += r.montant;
  });
  Object.entries(byMoisCommission).forEach(([mois, v]) => {
    if (v.ca === 0) return;
    const expected = v.ca * AUDIT_RULES.COMMISSION_PCT_EXPECTED;
    const delta = Math.abs(v.commission - expected);
    if (delta > AUDIT_RULES.COMMISSION_TOLERANCE) {
      const actualPct = (v.commission / v.ca * 100).toFixed(2);
      addIssue('danger', 'commission', `Commission ${mois} hors norme`,
        `La commission portage devrait être exactement 6 % du CA facturé. Écart de ${fmt(delta)} détecté.`,
        `CA ${fmt(v.ca)} · commission ${fmt(v.commission)} (${actualPct}%) · attendu ${fmt(expected)}`);
    }
  });

  // === 2. PROFIT SHARE EN RETARD ===
  const now = todayDate();
  DATASET.forEach(r => {
    if (r.nature !== 'Revenu - Profit Share' || r.statut === 'Payé') return;
    const emitDate = parseDate(r.date);
    if (!emitDate) return;
    const daysSince = Math.round((now - emitDate) / 86400000);
    if (daysSince >= AUDIT_RULES.PS_DSO_CRITICAL) {
      addIssue('danger', 'delai', `Profit share oublié ?`,
        `Un profit share émis il y a ${daysSince} jours n'est toujours pas payé. Au-delà de 130 jours, c'est anormal.`,
        `Mois ${r.mois} · émis ${r.date} · montant ${fmt(r.montant)} · référence ${r.reference}`);
    } else if (daysSince >= AUDIT_RULES.PS_DSO_WARN) {
      addIssue('warn', 'delai', `Profit share en attente prolongée`,
        `${daysSince} jours écoulés depuis l'émission. À relancer si ça dépasse 130 jours.`,
        `Mois ${r.mois} · émis ${r.date} · montant ${fmt(r.montant)}`);
    }
  });

  // === 3. DATES DE PAIEMENT INCOHÉRENTES (uniquement pour les revenus reçus) ===
  // On ne vérifie que pour les flux entrants (facturation payée, profit share payé, cooptation reçue)
  // Les charges ont souvent une date de paiement avant émission (prélèvement auto, clôture comptable)
  const naturesRevenu = [
    'Crédit - Facturation',
    'Revenu - Profit Share',
    'Revenu - Dividendes - Cooptation',
    'Crédit - Cooptation',
    'Crédit - Refacturation Client'
  ];
  DATASET.forEach(r => {
    if (r.statut !== 'Payé') return;
    if (!naturesRevenu.includes(r.nature)) return;
    if (!r.datePaiement) {
      addIssue('warn', 'date', `Statut "Payé" sans date de paiement`,
        `La ligne est marquée comme payée mais la colonne DATE PAIEMENT est vide. Le dashboard affichera "Payé · ?" tant que la date n'est pas renseignée.`,
        `${r.nature} · ${r.description}${r.date ? ` · émis ${r.date}` : ''}`);
      return;
    }
    if (!r.date) return;
    const emit = parseDate(r.date);
    const pay = parseDate(r.datePaiement);
    if (!emit || !pay) return;
    if (pay < emit) {
      addIssue('warn', 'date', `Date de paiement antérieure à l'émission`,
        `Incohérence temporelle sur un revenu : le paiement est enregistré avant la date d'émission.`,
        `${r.nature} · ${r.description} · émis ${r.date} → payé ${r.datePaiement}`);
    }
  });

  // === 4. TICKETS RESTAURANT hors range ===
  // Note : certains mois cumulent plusieurs clients (jours > 23). Les TR restent calculés sur les jours
  // de présence réelle. On plafonne donc les jours à 23 pour ce calcul.
  const byMoisTR = {};
  DATASET.forEach(r => {
    if (r.nature !== 'Revenu - Ticket Restaurant') return;
    const m = r.mois;
    if (!byMoisTR[m]) byMoisTR[m] = { total: 0 };
    byMoisTR[m].total += r.montant;
  });
  Object.entries(byMoisTR).forEach(([mois, v]) => {
    const moisData = AGG.monthsByKey[mois];
    if (!moisData || !moisData.jours_travailles) return;
    const joursEffectifs = Math.min(moisData.jours_travailles, 23);
    const trPerJour = v.total / joursEffectifs;
    if (trPerJour < AUDIT_RULES.TR_MIN) {
      addIssue('warn', 'tr', `Tickets resto bas ${mois}`,
        `Le ratio par jour de présence (${trPerJour.toFixed(2)} €) est inférieur au seuil bas habituel (${AUDIT_RULES.TR_MIN} €).`,
        `Total TR ${fmt(v.total)} · base ${joursEffectifs} jours${moisData.jours_travailles > 23 ? ' (plafonné, ' + moisData.jours_travailles + ' facturés)' : ''}`);
    } else if (trPerJour > AUDIT_RULES.TR_MAX) {
      addIssue('info', 'tr', `Tickets resto élevés ${mois}`,
        `Le ratio par jour de présence (${trPerJour.toFixed(2)} €) dépasse le seuil haut habituel (${AUDIT_RULES.TR_MAX} €).`,
        `Total TR ${fmt(v.total)} · base ${joursEffectifs} jours`);
    }
  });

  // === DÉTECTION PRIME MACRON (PPV) ===
  // Si un salaire net dépasse largement la médiane (~1500€+), c'est probablement une prime exceptionnelle
  const salairesByMoisArr = [];
  const salairesMap = {};
  DATASET.forEach(r => {
    if (r.nature !== 'Revenu - Salaire NET (Après impot)') return;
    salairesMap[r.mois] = (salairesMap[r.mois] || 0) + r.montant;
  });
  Object.entries(salairesMap).forEach(([m, v]) => salairesByMoisArr.push({mois: m, montant: v}));
  const salairesSorted = salairesByMoisArr.map(x => x.montant).sort((a,b) => a-b);
  const medianSalaire = salairesSorted.length > 0
    ? (salairesSorted.length % 2 === 1
        ? salairesSorted[Math.floor(salairesSorted.length/2)]
        : (salairesSorted[salairesSorted.length/2 - 1] + salairesSorted[salairesSorted.length/2]) / 2)
    : 0;
  const seuilPrime = medianSalaire + 1500;
  const moisAvecPrime = new Set();
  salairesByMoisArr.forEach(x => {
    if (x.montant > seuilPrime) moisAvecPrime.add(x.mois);
  });
  // Log info de la prime détectée
  moisAvecPrime.forEach(mois => {
    const total = salairesMap[mois];
    const prime = total - medianSalaire;
    addIssue('info', 'prime', `Prime exceptionnelle détectée ${mois}`,
      `Un salaire net atypique a été versé ce mois-ci, probablement une prime (PPV / prime Macron). Les alertes sur les ratios de ce mois ont été ajustées en conséquence.`,
      `Salaire net ${fmt(total)} · hors prime ${fmt(medianSalaire)} · prime estimée ${fmt(prime)}`);
  });

  // === 5. SALAIRE NET hors range (en tenant compte des primes) ===
  Object.entries(salairesMap).forEach(([mois, total]) => {
    if (moisAvecPrime.has(mois)) return; // déjà signalé en prime
    if (total < AUDIT_RULES.SALAIRE_NET_MIN) {
      addIssue('warn', 'salaire', `Salaire net faible ${mois}`,
        `Le salaire net de ce mois (${fmt(total)}) est sous le seuil bas normal (${fmt(AUDIT_RULES.SALAIRE_NET_MIN)}).`,
        `Vérifie s'il y a eu une absence, congés non payés, ou un problème de calcul.`);
    } else if (total > AUDIT_RULES.SALAIRE_NET_MAX) {
      addIssue('info', 'salaire', `Salaire net élevé ${mois}`,
        `Le salaire net de ce mois (${fmt(total)}) dépasse le seuil haut normal (${fmt(AUDIT_RULES.SALAIRE_NET_MAX)}).`,
        `Possible bonus, 13e mois, rattrapage ou exceptionnel. À vérifier sur ta fiche de paie.`);
    }
  });

  // === 6. CHARGES SUR PROFIT SHARE : ratio anormal (neutralisé pour mois avec prime) ===
  const psByMois = {};
  DATASET.forEach(r => {
    const m = r.mois;
    if (!psByMois[m]) psByMois[m] = { ps: 0, charges_ps: 0 };
    if (r.nature === 'Revenu - Profit Share') psByMois[m].ps += r.montant;
    if (r.nature === 'Charges - Profit Share') psByMois[m].charges_ps += r.montant;
  });
  Object.entries(psByMois).forEach(([mois, v]) => {
    if (v.ps === 0) return;
    if (moisAvecPrime.has(mois)) return; // ratio faussé par la prime, on skip
    const ratio = v.charges_ps / v.ps;
    if (ratio < AUDIT_RULES.CHARGES_PS_PCT_MIN || ratio > AUDIT_RULES.CHARGES_PS_PCT_MAX) {
      addIssue('warn', 'charges_ps', `Charges sur PS ${mois} atypiques`,
        `Le ratio charges/profit share (${(ratio*100).toFixed(1)}%) sort du range attendu (${(AUDIT_RULES.CHARGES_PS_PCT_MIN*100).toFixed(0)}-${(AUDIT_RULES.CHARGES_PS_PCT_MAX*100).toFixed(0)}%).`,
        `PS ${fmt(v.ps)} · charges ${fmt(v.charges_ps)}`);
    }
  });

  // === 7. FACTURATION SANS PROFIT SHARE CORRESPONDANT ===
  const facturByMois = {};
  const psByMoisCount = {};
  DATASET.forEach(r => {
    if (r.nature === 'Crédit - Facturation' && r.description.match(/\(\s*[\d.]+\s*\*\s*[\d.]+\s*\)/)) {
      facturByMois[r.mois] = (facturByMois[r.mois] || 0) + 1;
    }
    if (r.nature === 'Revenu - Profit Share') {
      psByMoisCount[r.mois] = (psByMoisCount[r.mois] || 0) + 1;
    }
  });
  Object.keys(facturByMois).forEach(mois => {
    if (!psByMoisCount[mois]) {
      // Exception : mois récents où le PS n'est pas encore émis (normal 16 du mois suivant)
      const [m, y] = mois.split('-').map(Number);
      const moisDate = new Date(y, m-1, 16);
      const nextPSDate = new Date(y, m, 16); // émis ~le 16 du mois suivant
      if (now < nextPSDate) return; // trop tôt pour s'alarmer
      addIssue('danger', 'missing', `Profit share manquant ${mois}`,
        `Une facturation existe pour ce mois mais aucun profit share n'a été émis.`,
        `Vérifie si ta société a oublié d'émettre ton profit share. Normalement émis le 16 du mois suivant.`);
    }
  });

  // === 8. PROVISION CONGÉS PAYÉS — jamais versée ===
  let provisionsTotal = 0;
  let provisionsPaid = 0;
  let provisionsCount = 0;
  DATASET.forEach(r => {
    if (r.nature !== 'Revenu - Provision Congés') return;
    provisionsTotal += r.montant;
    provisionsCount++;
    if (r.statut === 'Payé') provisionsPaid += r.montant;
  });
  const provisionsImpayees = provisionsTotal - provisionsPaid;
  if (provisionsImpayees > 0) {
    addIssue('info', 'provision', `Provision congés payés non versée`,
      `La société accumule une provision pour congés payés mais ne la verse pas spontanément. À réclamer à la rupture conventionnelle.`,
      `${provisionsCount} mois × ~${fmt(AUDIT_RULES.PROVISION_CONGES)} = ${fmt(provisionsImpayees)} dus`);
  }

  // === 9. PAS (impôt retenu à la source) manquant ===
  const moisAvecSalaire = new Set();
  const moisAvecPAS = new Set();
  DATASET.forEach(r => {
    if (r.nature === 'Revenu - Salaire NET (Après impot)') moisAvecSalaire.add(r.mois);
    if (r.nature === 'Charges - Impot France') moisAvecPAS.add(r.mois);
  });
  // Note : le PAS peut être à 0 € si tu n'étais pas soumis, donc absence != anomalie
  // On informe juste si > 3 mois consécutifs sans PAS (taux nul signalé par la DGFiP à vérifier)
  const moisSansPAS = [...moisAvecSalaire].filter(m => !moisAvecPAS.has(m)).sort();
  if (moisSansPAS.length >= 3) {
    addIssue('info', 'pas', `Taux PAS à 0 sur ${moisSansPAS.length} mois`,
      `Plusieurs mois sans prélèvement à la source. Normal si ton taux est à 0, mais à vérifier sur impots.gouv.fr.`,
      `Mois concernés : ${moisSansPAS.slice(0, 6).join(', ')}${moisSansPAS.length > 6 ? '…' : ''}`);
  }

  // === 10. DOUBLONS ET FACTURES RÉ-ÉMISES ===
  // Un doublon EXACT ne peut pas exister : mergeDatasets déduplique sur exactement
  // cette clé (reference + nature + description + montant). Ce qu'on cherche ici,
  // c'est le QUASI-doublon — la même facture présente deux fois avec un libellé ou
  // une ventilation TJM/jours différents, qui double le CA et les jours du mois.
  const byRefNature = {};
  DATASET.forEach(r => {
    const k = `${r.reference}|${r.nature}`;
    if (!byRefNature[k]) byRefNature[k] = [];
    byRefNature[k].push(r);
  });
  Object.entries(byRefNature).forEach(([k, rows]) => {
    if (rows.length < 2) return;
    const [ref, nature] = k.split('|');

    // a) Même référence, même nature, même montant : la même ligne comptée deux fois.
    const parMontant = {};
    rows.forEach(r => {
      const cle = r.montant.toFixed(2);
      if (!parMontant[cle]) parMontant[cle] = [];
      parMontant[cle].push(r);
    });
    Object.entries(parMontant).forEach(([montant, dupes]) => {
      if (dupes.length < 2) return;
      addIssue('danger', 'duplicate', `Ligne en double ${dupes[0].mois}`,
        `${dupes.length} lignes de même montant sur la même référence et la même nature. C'est la signature d'une facture ré-émise dont l'ancienne version est restée : réimporte le CSV et accepte les suppressions proposées.`,
        `${nature} · ${fmt(parseFloat(montant))} · réf ${ref} · ${dupes.map(d => d.description || '—').join('  |  ')}`);
    });

    // b) Plusieurs facturations sur une même référence : une facture = une ligne.
    //    Deux missions facturées le même mois portent deux références distinctes.
    if (nature === 'Crédit - Facturation' && Object.keys(parMontant).length > 1) {
      addIssue('warn', 'duplicate', `Facturations multiples sur ${ref}`,
        `Plusieurs lignes de facturation partagent la même référence avec des montants différents. Vérifie s'il ne s'agit pas d'une facture corrigée dont l'ancienne version est restée dans le dashboard.`,
        rows.map(r => `${fmt(r.montant)} · ${r.description || '—'}`).join('  |  '));
    }
  });

  // === 11. COOPTATION : crédit ≠ revenu correspondant ===
  const coopByRef = {};
  DATASET.forEach(r => {
    if (r.nature === 'Crédit - Cooptation') {
      if (!coopByRef[r.reference]) coopByRef[r.reference] = {};
      coopByRef[r.reference].credit = r.montant;
    }
    if (r.nature === 'Revenu - Dividendes - Cooptation') {
      if (!coopByRef[r.reference]) coopByRef[r.reference] = {};
      coopByRef[r.reference].revenu = r.montant;
    }
  });
  Object.entries(coopByRef).forEach(([ref, v]) => {
    if (v.credit !== undefined && v.revenu !== undefined && Math.abs(v.credit - v.revenu) > 0.01) {
      addIssue('warn', 'coop', `Cooptation ${ref} : écart`,
        `Le crédit reçu et le revenu reversé ne correspondent pas. Normalement c'est à l'identique.`,
        `Crédit ${fmt(v.credit)} vs Revenu ${fmt(v.revenu)} · écart ${fmt(Math.abs(v.credit - v.revenu))}`);
    }
  });

  // === 12. ÉQUATION DE CLÔTURE MENSUELLE ===
  // CA = salaire_net + charges_salaire + commission + charges_ps + tr + PS
  //    + PAS + provision_congés + notes_de_frais + charges_diverses
  // (Les NDF sont des sommes avancées par toi, remboursées depuis ton CA)
  AGG.months.forEach(m => {
    if (m.facturation === 0) return;
    if (moisAvecPrime.has(m.mois)) return;
    const somme = m.salaire_net + m.charges_salaire + m.commission_portage
                + m.charges_profit_share + m.tickets_resto + m.profit_share_total
                + m.impot_france + m.provision_conges
                + (m.notes_frais || 0) + (m.charges_diverses || 0);
    const delta = m.facturation - somme;
    const absDelta = Math.abs(delta);
    if (absDelta > 20 && absDelta < m.facturation * 0.02) {
      addIssue('info', 'equation', `Écart de clôture ${m.mois}`,
        `Les sorties ne totalisent pas exactement le CA. Probablement lié aux arrondis cumulés.`,
        `CA ${fmt(m.facturation)} · somme sorties ${fmt(somme)} · delta ${fmt(delta)}`);
    } else if (absDelta >= m.facturation * 0.02) {
      addIssue('warn', 'equation', `Écart de clôture important ${m.mois}`,
        `L'équation de clôture ne balance pas. Il y a probablement une ligne manquante ou une erreur.`,
        `CA ${fmt(m.facturation)} · somme sorties ${fmt(somme)} · delta ${fmt(delta)} (${(delta/m.facturation*100).toFixed(1)}%)`);
    }
  });

  // === 13. MOIS MULTI-CLIENTS (info) ===
  // On mémorise aussi les RÉFÉRENCES : deux missions réellement facturées en
  // parallèle portent deux références distinctes. Deux clients sur UNE SEULE
  // référence, c'est une facture ré-émise avec un client corrigé, pas un mois
  // multi-missions — et ça ne doit surtout pas servir d'excuse en règle 14.
  const facturationByMois = {};
  DATASET.forEach(r => {
    if (r.nature !== 'Crédit - Facturation') return;
    if (!facturationByMois[r.mois]) facturationByMois[r.mois] = { clients: new Set(), refs: new Set() };
    // Détection client via description
    let clientLabel = 'Autre';
    if (r.description.includes('CLIENT_A')) clientLabel = 'CLIENT_A';
    else if (r.description.includes('Client B')) clientLabel = 'Client B';
    else {
      // Extraction générique : premier mot capitalisé après "Facturation"
      const m = r.description.match(/Facturation\s+([A-Z][A-Za-z\s]+?)\s*\(/);
      if (m) clientLabel = m[1].trim();
    }
    facturationByMois[r.mois].clients.add(clientLabel);
    facturationByMois[r.mois].refs.add(r.reference);
  });
  const estMultiMissions = (v) => v.clients.size >= 2 && v.refs.size >= 2;
  Object.entries(facturationByMois).forEach(([mois, v]) => {
    if (estMultiMissions(v)) {
      const clients = [...v.clients].join(' + ');
      addIssue('info', 'multi_clients', `Mois multi-clients ${mois}`,
        `Deux missions facturées en parallèle ce mois-ci. Les ratios (TR/jour, charges) peuvent sembler atypiques car les jours facturés cumulés dépassent le nombre de jours ouvrés.`,
        `Clients : ${clients}`);
    }
  });

  // === 14. JOURS FACTURÉS EXCESSIFS (> 23/mois, physiquement improbable) ===
  Object.entries(facturationByMois).forEach(([mois, v]) => {
    const moisData = AGG.monthsByKey[mois];
    if (!moisData) return;
    const jours = moisData.jours_travailles;
    if (jours > 23) {
      const multiMissions = estMultiMissions(v);
      const severity = multiMissions ? 'info' : 'warn';
      const contextMsg = multiMissions
        ? `Lié à la facturation multi-clients de ce mois. Chaque client facturé séparément = jours cumulés. À confirmer.`
        : `Ce volume dépasse le maximum physique d'un mois (23 jours ouvrés max). Probable facturation rétroactive, ou ligne en double laissée par une facture ré-émise.`;
      addIssue(severity, 'volume', `${jours} jours facturés ${mois}`,
        contextMsg,
        `Max théorique : 23 jours ouvrés/mois · ${v.refs.size} référence${v.refs.size > 1 ? 's' : ''} de facturation`);
    }
  });

  // === RÉSUMÉ ===
  const stats = { danger: 0, warn: 0, info: 0, ok: 0 };
  issues.forEach(i => stats[i.severity]++);
  if (issues.length === 0) {
    issues.push({
      severity: 'ok',
      category: 'clean',
      title: 'Tout est cohérent',
      desc: 'Aucune anomalie détectée sur ton historique. Les calculs sont conformes aux règles attendues.',
      detail: ''
    });
    stats.ok++;
  }

  LAST_AUDIT = { issues, stats };
  updateAuditBadge(stats);
  if (!silent) displayAuditResults(issues, stats);
  return LAST_AUDIT;
}

// ---------------------------------------------------------------- audit : affichage regroupé
function updateAuditBadge(stats) {
  const badge = document.getElementById('audit-badge');
  const btn = document.getElementById('audit-btn');
  const n = stats ? stats.danger + stats.warn : 0;
  if (badge) {
    badge.hidden = !n;
    badge.textContent = n;
    badge.classList.toggle('danger', !!(stats && stats.danger));
  }
  if (btn) btn.setAttribute('aria-label', n ? `Vérifier les calculs${UI.NBP}: ${n} point${n > 1 ? 's' : ''} d’attention` : 'Vérifier les calculs');
}

// Regroupement d'affichage (les règles ne changent pas). Le mois comptable « MM-AAAA » est un mot
// isolé du titre, où qu'il soit (« Commission 09-2025 hors norme ») : jamais l'intérieur d'une
// référence comme RC-2026-09-0070.
const AUDIT_MONTH_RE = /(^|\s)((?:0[1-9]|1[0-2])-\d{4})(?=\s|$)/;
// Règles mensuelles dont le titre porte aussi une valeur variable : libellé commun du groupe.
const AUDIT_GROUP_LABELS = { volume: 'Plus de 23 jours facturés' };
const auditMonth = (title) => (title.match(AUDIT_MONTH_RE) || [])[2] || null;
const auditMonthKey = (mm) => mm.slice(3) + mm.slice(0, 2); // « 09-2025 » → « 202509 », pour trier
const auditRuleLabel = (i) => AUDIT_GROUP_LABELS[i.category] || i.title.replace(AUDIT_MONTH_RE, '').replace(/\s{2,}/g, ' ').trim();

function displayAuditResults(issues, stats) {
  // Typographie française posée à l'affichage (insécable avant « : ; ? ! ») : les textes des
  // règles restent ceux de l'ancien render.js.
  const esc = (s) => escapeHtml(s).replace(/ ([:;?!])/g, UI.NBP + '$1');
  const total = stats.danger + stats.warn + stats.info;
  document.getElementById('audit-sub').textContent = total === 0
    ? `Aucune anomalie sur ${DATASET.length} opérations analysées`
    : `${total} point${total > 1 ? 's' : ''} d’attention sur ${DATASET.length} opérations analysées`;
  document.getElementById('audit-summary').innerHTML = `
    <div class="msum danger"><div class="n">${stats.danger}</div><div class="l">${icon('alert')}Critique</div></div>
    <div class="msum warn"><div class="n">${stats.warn}</div><div class="l">${icon('clock')}Attention</div></div>
    <div class="msum accent"><div class="n">${stats.info}</div><div class="l">${icon('info')}Info</div></div>
    <div class="msum ok"><div class="n">${stats.ok > 0 ? 'OK' : DATASET.length - total}</div><div class="l">${icon('check')}${stats.ok > 0 ? 'Tout est bon' : 'Lignes OK'}</div></div>`;
  const sevCls = { danger: 'danger', warn: 'warn', info: 'accent', ok: 'ok' };
  const labels = { danger: 'Anomalies critiques', warn: 'Points d’attention', info: 'Informations utiles', ok: 'Conformité' };
  let html = '';
  ['danger', 'warn', 'info', 'ok'].forEach((sev) => {
    const list = issues.filter((i) => i.severity === sev);
    if (!list.length) return;
    // Regroupe les alertes répétées d'une même règle (ex. 20 écarts de clôture) en une seule entrée.
    const groups = [];
    list.forEach((i) => {
      const base = auditRuleLabel(i);
      const g = groups.find((x) => x.base === base && x.cat === i.category);
      if (g) g.items.push(i); else groups.push({ base, cat: i.category, items: [i] });
    });
    html += `<section class="mgroup"><h3 class="mgroup-t"><i class="ldot ${sevCls[sev]}"></i>${labels[sev]}<b>${list.length}</b></h3>`;
    groups.forEach((g) => {
      const i = g.items[0];
      if (g.items.length >= 3) {
        // « N mois » seulement si chaque cas porte un mois (mois distincts, en puces) ; sinon « N cas ».
        const n = g.items.length;
        const found = g.items.map((x) => auditMonth(x.title));
        const months = [...new Set(found.filter(Boolean))].sort((a, b) => auditMonthKey(a).localeCompare(auditMonthKey(b)));
        const count = !found.every(Boolean) ? `${n} cas`
          : months.length === n ? `${n} mois` : `${n} cas sur ${months.length} mois`;
        // Détail : le titre seulement s'il apporte quelque chose (mois, valeur), puis le constat.
        const detail = (x) => esc(x.title === g.base ? (x.detail || x.title) : [x.title, x.detail].filter(Boolean).join(' · '));
        html += `<div class="mitem ${sevCls[sev]}"><span class="bar"></span><div><div class="t">${esc(g.base)} · ${count}</div><div class="d">${esc(i.desc)}</div>
          ${months.length ? `<div class="months">${months.map((mm) => `<span>${esc(mm)}</span>`).join('')}</div>` : ''}
          <details><summary>Voir le détail des ${n} cas</summary>${g.items.map((x) => `<div class="x">${detail(x)}</div>`).join('')}</details></div><span class="r">${esc(i.category)}</span></div>`;
      } else {
        g.items.forEach((x) => { html += `<div class="mitem ${sevCls[sev]}"><span class="bar"></span><div><div class="t">${esc(x.title)}</div><div class="d">${esc(x.desc)}</div>${x.detail ? `<div class="x">${esc(x.detail)}</div>` : ''}</div><span class="r">${esc(x.category)}</span></div>`; });
      }
    });
    html += '</section>';
  });
  document.getElementById('audit-list').innerHTML = html || '<p class="muted">Rien à signaler.</p>';
  hideToast();
  ModalCtl.open('audit-modal');
}
function closeAudit() { ModalCtl.close('audit-modal'); }

// ---------------------------------------------------------------- diff d'import
// summary (optionnel) = { parsed, stats } : le succès de l'import vit DANS la modale
// (bandeau), il n'y a pas de toast en double. Renvoie true si la modale s'est ouverte.
function showImportDiff(fileName, changes, summary) {
  if (!changes) return false;
  const esc = escapeHtml;
  const addedRows = changes.addedRows || [];
  const updatedRows = changes.updatedRows || [];
  const removedRows = changes.removedRows || [];
  if (addedRows.length === 0 && updatedRows.length === 0 && removedRows.length === 0) return false;
  const short = (n) => n.replace(/^(Crédit|Revenu|Charges) - /, '');
  const isCharge = (r) => r.nature.startsWith('Charges');
  const sum = (arr) => arr.reduce((s, r) => s + (r.montant || 0), 0);

  const newInvoices = addedRows.filter((r) => r.nature === 'Crédit - Facturation');
  const newProfitShares = addedRows.filter((r) => r.nature === 'Revenu - Profit Share');
  const otherRevenus = addedRows.filter((r) => r.nature.startsWith('Revenu') && r.nature !== 'Revenu - Profit Share');
  const newCharges = addedRows.filter(isCharge);
  const otherAdded = addedRows.filter((r) => r.nature !== 'Crédit - Facturation' && !r.nature.startsWith('Revenu') && !isCharge(r));
  const nowPaid = updatedRows.filter(({ prev, next }) => prev.statut !== 'Payé' && next.statut === 'Payé');
  // Correction sémantique : une charge qui passe à « Payé » est un prélèvement, pas un encaissement.
  const nowPaidIn = nowPaid.filter(({ next }) => !isCharge(next));
  const nowPaidCharges = nowPaid.filter(({ next }) => isCharge(next));
  const nowUnpaid = updatedRows.filter(({ prev, next }) => prev.statut === 'Payé' && next.statut !== 'Payé');
  const dateChanges = updatedRows.filter(({ prev, next }) => prev.statut === next.statut && prev.datePaiement !== next.datePaiement);
  const encaisse = nowPaidIn.reduce((s, { next }) => s + next.montant, 0);
  const newCa = sum(newInvoices);

  const parts = [];
  if (fileName) parts.push(fileName);
  parts.push(`${addedRows.length} ajout${addedRows.length > 1 ? 's' : ''}`);
  parts.push(`${updatedRows.length} mise${updatedRows.length > 1 ? 's' : ''} à jour`);
  if (removedRows.length) parts.push(`${removedRows.length} suppression${removedRows.length > 1 ? 's' : ''}`);
  document.getElementById('diff-sub').textContent = parts.join(' · ');
  const banner = document.getElementById('diff-banner');
  if (summary) {
    banner.hidden = false;
    banner.innerHTML = `${icon('check')}<span><b>Import réussi</b> · ${summary.parsed} ligne${summary.parsed > 1 ? 's' : ''} traitée${summary.parsed > 1 ? 's' : ''}, ${summary.stats.unchanged} déjà à jour${summary.stats.removed ? `, ${summary.stats.removed} supprimée${summary.stats.removed > 1 ? 's' : ''}` : ''}.</span>`;
  } else banner.hidden = true;
  document.getElementById('diff-summary').innerHTML = `
    <div class="msum ok"><div class="n">${encaisse > 0 ? UI.eur0(encaisse) : '—'}</div><div class="l">${icon('check')}Encaissé</div></div>
    <div class="msum accent"><div class="n">${newCa > 0 ? UI.eur0(newCa) : '—'}</div><div class="l">${icon('sparkles')}Nouveau CA</div></div>
    <div class="msum"><div class="n">${addedRows.length}</div><div class="l">${icon('plus')}Ajoutées</div></div>
    <div class="msum"><div class="n">${updatedRows.length}</div><div class="l">${icon('rotate')}Modifiées</div></div>`;
  const secs = [];
  if (removedRows.length) secs.push({ t: 'Lignes supprimées', sev: 'danger', tot: sum(removedRows), items: removedRows.map((r) => ({ a: r.montant, t: short(r.nature), d: r.description, r: r.mois, x: `Plus présente dans l’export${r.reference ? ' · ' + r.reference : ''}` })) });
  if (nowPaidIn.length) secs.push({ t: 'Encaissements', sev: 'ok', tot: encaisse, items: nowPaidIn.map(({ next }) => ({ a: next.montant, t: short(next.nature), d: next.description, r: next.datePaiement || 'Payé', x: `Mois ${next.mois}${next.reference ? ' · ' + next.reference : ''}` })) });
  if (nowPaidCharges.length) secs.push({ t: 'Charges réglées par ton portage', sev: 'charge', note: `Prélevées sur ton compte de portage${UI.NBP}: ce n’est pas de l’argent reçu.`, tot: nowPaidCharges.reduce((s, { next }) => s + next.montant, 0), items: nowPaidCharges.map(({ next }) => ({ a: next.montant, t: short(next.nature), d: next.description, r: next.datePaiement || 'Payé', x: `Mois ${next.mois}${next.reference ? ' · ' + next.reference : ''}` })) });
  if (newInvoices.length) secs.push({ t: 'Nouvelles factures', sev: 'accent', tot: newCa, items: newInvoices.map((r) => ({ a: r.montant, t: r.statut === 'Payé' ? 'Payée' : 'En attente', d: r.description, r: r.date, x: `Mois ${r.mois}${r.reference ? ' · ' + r.reference : ''}` })) });
  if (newProfitShares.length) secs.push({ t: 'Profit shares ajoutés', sev: 'accent', tot: sum(newProfitShares), items: newProfitShares.map((r) => ({ a: r.montant, t: r.statut === 'Payé' ? 'Payé' : 'En attente', d: r.description, r: r.date, x: `Mois ${r.mois}` })) });
  if (otherRevenus.length) secs.push({ t: 'Autres revenus', sev: 'accent', tot: sum(otherRevenus), items: otherRevenus.map((r) => ({ a: r.montant, t: short(r.nature), d: r.description, r: r.date, x: `Mois ${r.mois}` })) });
  if (newCharges.length) secs.push({ t: 'Nouvelles charges', sev: 'charge', tot: sum(newCharges), items: newCharges.map((r) => ({ a: r.montant, t: short(r.nature), d: r.description, r: r.date, x: `Mois ${r.mois}` })) });
  if (otherAdded.length) secs.push({ t: 'Autres lignes', sev: 'accent', tot: null, items: otherAdded.map((r) => ({ a: r.montant, t: r.nature, d: r.description, r: r.date, x: `Mois ${r.mois}` })) });
  if (dateChanges.length) secs.push({ t: 'Dates de paiement modifiées', sev: 'accent', tot: null, items: dateChanges.map(({ prev, next }) => ({ a: next.montant, t: next.description || next.nature, d: `${prev.datePaiement || '—'}  →  ${next.datePaiement || '—'}`, r: next.mois, x: '' })) });
  if (nowUnpaid.length) secs.push({ t: 'Paiements annulés', sev: 'danger', tot: null, items: nowUnpaid.map(({ next }) => ({ a: next.montant, t: next.description || next.nature, d: `Statut « Payé » → « ${next.statut || 'non payé'} »`, r: next.mois, x: '' })) });
  document.getElementById('diff-list').innerHTML = secs.map((sec) => `
    <section class="mgroup"><h3 class="mgroup-t"><i class="ldot ${sec.sev}"></i>${esc(sec.t)} (${sec.items.length})${sec.tot != null ? `<b>${esc(UI.eur2(sec.tot))}</b>` : ''}</h3>
    ${sec.note ? `<p class="mgroup-n">${esc(sec.note)}</p>` : ''}
    ${sec.items.map((it) => `<div class="mitem ${sec.sev}"><span class="bar"></span><div><div class="t"><b>${esc(UI.eur2(it.a))}</b> · ${esc(it.t)}</div><div class="d">${esc(it.d || '—')}</div>${it.x ? `<div class="x">${esc(it.x)}</div>` : ''}</div><span class="r">${esc(it.r || '—')}</span></div>`).join('')}
    </section>`).join('');
  hideToast();
  ModalCtl.open('diff-modal');
  return true;
}
function closeImportDiff() { ModalCtl.close('diff-modal'); }

// Fermetures des modales audit / diff (data-qa-close) et du toast
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-qa-close]');
  if (x) {
    const m = x.closest('.modal');
    if (m && m.id === 'audit-modal') closeAudit();
    if (m && m.id === 'diff-modal') closeImportDiff();
  }
  if (e.target.closest('#toast-close')) hideToast();
});
window.runAudit = runAudit;
window.closeAudit = closeAudit;
window.closeImportDiff = closeImportDiff;
