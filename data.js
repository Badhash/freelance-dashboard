// ============================================================
// DASHBOARD — couche données
// Parsing CSV, storage, agrégation, helpers fiscal/projection.
// Chargé en premier — aucune dépendance au DOM.
// ============================================================

// État global partagé avec render.js et main.js (script scope).
// DATASET est initialisé en bas du fichier après que loadDataset soit défini.
let DATASET;
let AGG = null;

// Formatage
const fmt = (n) => {
  if (n === 0 || n === null || n === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n) + ' €';
};
const fmtShort = (n) => {
  if (!n) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' €';
};
const fmtInt = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n));
const monthNames = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const monthNamesFull = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const fmtMonth = (mois) => {
  const [m, y] = mois.split('-');
  return monthNamesFull[parseInt(m)-1] + ' <span class="year">' + y + '</span>';
};

// ============================================================
// CLIENT RULES — config locale pour détecter les clients dans le CSV
// Chargée depuis localStorage, éditable par l'utilisateur
// Pas de client en dur dans le code pour rester générique
// Helpers console :
//   addClientRule('MOT_CLE_DESCRIPTION', 'Nom à afficher')
//   listClientRules()
//   resetClientRules()
// ============================================================
const CLIENT_RULES_KEY = 'dashboard_client_rules_v1';
function loadClientRules() {
  try {
    const raw = localStorage.getItem(CLIENT_RULES_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}
let CLIENT_RULES = loadClientRules();
window.addClientRule = function(match, label) {
  CLIENT_RULES.push({ match, label });
  localStorage.setItem(CLIENT_RULES_KEY, JSON.stringify(CLIENT_RULES));
  console.log('Règle ajoutée. Le dashboard va se rafraîchir.');
  if (typeof render === 'function') render();
};
window.resetClientRules = function() {
  CLIENT_RULES = [];
  localStorage.removeItem(CLIENT_RULES_KEY);
  if (typeof render === 'function') render();
};
window.listClientRules = function() {
  console.table(CLIENT_RULES);
};


// ============================================================
// STORAGE — localStorage pour persistance entre sessions
// ============================================================
const STORAGE_KEY = 'reecho_dataset_v1';
const META_KEY = 'reecho_meta_v1';

function loadDataset() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Load error', e);
    return [];
  }
}
function saveDataset(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  localStorage.setItem(META_KEY, JSON.stringify({
    lastImport: new Date().toISOString(),
    count: rows.length
  }));
}
function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// CSV PARSING
// ============================================================
function parseCSV(text) {
  // Enlève BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { current.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || current.length > 0) {
          current.push(field);
          lines.push(current);
          current = [];
          field = '';
        }
        if (c === '\r' && text[i+1] === '\n') i++;
      }
      else field += c;
    }
  }
  if (field !== '' || current.length > 0) {
    current.push(field);
    lines.push(current);
  }

  if (lines.length === 0) return [];
  const headers = lines[0].map(h => h.trim());

  // Trouver les index des colonnes (avec ou sans arrow_drop_up/down)
  const findCol = (patterns) => {
    for (let p of patterns) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(p.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const colDate = findCol(['DATE arrow_drop', 'DATE ', 'Date']);
  const colMois = findCol(['MOIS', 'Mois']);
  const colRef = findCol(['RÉFÉRENCE', 'REFERENCE', 'Référence']);
  const colDesc = findCol(['DESCRIPTION', 'Description']);
  const colNature = findCol(['NATURE arrow_drop', 'NATURE', 'Nature']);
  const colMontant = findCol(['MONTANT HT', 'MONTANT', 'Montant']);
  const colStatut = findCol(['ENCAISSÉ', 'STATUT', 'Statut']);
  const colDatePay = findCol(['DATE PAIEMENT arrow_drop', 'DATE PAIEMENT', 'date paiement', 'paiement']);

  if (colRef === -1 || colNature === -1 || colMontant === -1) {
    throw new Error('Colonnes manquantes dans le CSV. Vérifiez le format.');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i];
    if (L.length < 2) continue; // ligne vide
    const row = {
      date: (L[colDate] || '').trim(),
      mois: (L[colMois] || '').trim(),
      reference: (L[colRef] || '').trim(),
      description: (L[colDesc] || '').trim(),
      nature: (L[colNature] || '').trim(),
      montant: parseAmount(L[colMontant] || '0'),
      statut: (L[colStatut] || '').trim(),
      datePaiement: (L[colDatePay] || '').trim()
    };
    if (row.nature && row.mois) rows.push(row);
  }
  return rows;
}

function parseAmount(s) {
  if (typeof s === 'number') return s;
  return parseFloat(String(s).replace(/\s/g, '').replace(/\u00a0/g, '').replace(',', '.')) || 0;
}

// ============================================================
// MERGE INTELLIGENT
// ============================================================
// Clé unique = reference + nature + description + montant
// Permet de détecter les doublons et de mettre à jour le statut/date de paiement
function rowKey(r) {
  return [r.reference, r.nature, r.description, r.montant.toFixed(2)].join('||');
}

function mergeDatasets(existing, incoming) {
  const map = new Map();
  existing.forEach(r => map.set(rowKey(r), r));

  const addedRows = [];
  const updatedRows = [];
  let unchanged = 0;

  incoming.forEach(r => {
    const k = rowKey(r);
    if (map.has(k)) {
      const prev = map.get(k);
      // Mise à jour si statut ou date paiement différents
      if (prev.statut !== r.statut || prev.datePaiement !== r.datePaiement) {
        map.set(k, r);
        updatedRows.push({ prev: { ...prev }, next: r });
      } else {
        unchanged++;
      }
    } else {
      map.set(k, r);
      addedRows.push(r);
    }
  });

  return {
    rows: Array.from(map.values()),
    stats: { added: addedRows.length, updated: updatedRows.length, unchanged },
    changes: { addedRows, updatedRows }
  };
}

// ============================================================
// AGRÉGATIONS (toutes dérivées du DATASET)
// ============================================================
function aggregate() {
  const byMois = {};
  const clients = {};
  const delaisCA = [];
  const delaisPS = [];
  let totals = {
    ca: 0, ca_paye: 0, ca_non_paye: 0,
    salaire_net: 0,
    profit_share_total: 0, profit_share_paye: 0, profit_share_non_paye: 0,
    provision_conges_total: 0, provision_conges_payee: 0,
    cooptation_revenu_total: 0, cooptation_revenu_paye: 0,
    cooptation_credit_paye: 0,
    refacturation_paye: 0,
    commission: 0, commission_paye: 0,
    charges_salaire: 0, charges_salaire_paye: 0,
    charges_ps: 0, charges_ps_paye: 0,
    impot_france: 0,
    charges_diverses_paye: 0,
    notes_frais: 0,
    tickets_resto: 0,
    total_operations: 0
  };

  DATASET.forEach(r => {
    totals.total_operations++;
    const m = r.mois;
    if (!byMois[m]) {
      byMois[m] = {
        mois: m,
        facturation: 0, facturation_payee: false, facturation_date_paiement: '',
        commission_portage: 0, charges_diverses: 0,
        salaire_net: 0, charges_salaire: 0, provision_conges: 0, impot_france: 0,
        notes_frais: 0, tickets_resto: 0,
        charges_profit_share: 0,
        profit_share_total: 0, profit_share_paye: 0, profit_share_non_paye: 0,
        profit_share_paye_annee: {},
        cooptation_credit: 0, cooptation_revenu: 0, cooptation_revenu_paye: 0,
        details_cooptation: [],
        details_profit_share: [],
        details_salaire: [],
        details_notes_frais: [],
        details_tickets_resto: [],
        jours_travailles: 0, tjm: 0
      };
    }
    const d = byMois[m];
    const isPaid = r.statut === 'Payé';
    const yearOfPayment = r.datePaiement && r.datePaiement.includes('/') ? r.datePaiement.split('/')[2] : null;

    switch (r.nature) {
      case 'Crédit - Facturation': {
        d.facturation += r.montant;
        if (isPaid) { totals.ca_paye += r.montant; d.facturation_payee = true; d.facturation_date_paiement = r.datePaiement; }
        else totals.ca_non_paye += r.montant;
        totals.ca += r.montant;
        const match = r.description.match(/\(([\d.]+)\s*\*\s*([\d.]+)\)/);
        if (match) { d.tjm = parseFloat(match[1]); d.jours_travailles += parseFloat(match[2]); }
        // Client
        let clientName = 'Autre';
        // Détection client depuis config localStorage (éditable par l'utilisateur)
        for (const rule of CLIENT_RULES) {
          if (r.description.toLowerCase().includes(rule.match.toLowerCase())) {
            clientName = rule.label;
            break;
          }
        }
        if (!clients[clientName]) clients[clientName] = { ca: 0, jours: 0, mois: new Set() };
        clients[clientName].ca += r.montant;
        if (match) clients[clientName].jours += parseFloat(match[2]);
        clients[clientName].mois.add(m);
        // Délai paiement
        if (isPaid && r.date && r.datePaiement) {
          const delta = daysBetween(r.date, r.datePaiement);
          if (delta !== null) delaisCA.push(delta);
        }
        break;
      }
      case 'Charges - Commission Portage': d.commission_portage += r.montant; totals.commission += r.montant; if (isPaid) totals.commission_paye += r.montant; break;
      case 'Charges - Charges': d.charges_diverses += r.montant; if (isPaid) totals.charges_diverses_paye += r.montant; break;
      case 'Revenu - Salaire NET (Après impot)':
        d.salaire_net += r.montant; totals.salaire_net += r.montant;
        d.details_salaire.push({ montant: r.montant, date_emission: r.date, date_paiement: r.datePaiement, statut: r.statut });
        break;
      case 'Charges - Salaire': d.charges_salaire += r.montant; totals.charges_salaire += r.montant; if (isPaid) totals.charges_salaire_paye += r.montant; break;
      case 'Revenu - Provision Congés':
        d.provision_conges += r.montant;
        totals.provision_conges_total += r.montant;
        if (isPaid) totals.provision_conges_payee += r.montant;
        break;
      case 'Charges - Impot France': d.impot_france += r.montant; totals.impot_france += r.montant; break;
      case 'Revenu - Note de frais':
      case 'Revenu - Note de frais (Refacturation Client)':
        d.notes_frais += r.montant; totals.notes_frais += r.montant;
        d.details_notes_frais.push({ montant: r.montant, date_emission: r.date, date_paiement: r.datePaiement, statut: r.statut });
        break;
      case 'Revenu - Ticket Restaurant':
        d.tickets_resto += r.montant; totals.tickets_resto += r.montant;
        d.details_tickets_resto.push({ montant: r.montant, date_emission: r.date, date_paiement: r.datePaiement, statut: r.statut });
        break;
      case 'Charges - Profit Share':
        d.charges_profit_share += r.montant; totals.charges_ps += r.montant;
        if (isPaid) totals.charges_ps_paye += r.montant;
        break;
      case 'Revenu - Profit Share': {
        d.profit_share_total += r.montant;
        totals.profit_share_total += r.montant;
        d.details_profit_share.push({
          montant: r.montant, date_emission: r.date, date_paiement: r.datePaiement, statut: r.statut
        });
        if (isPaid) {
          d.profit_share_paye += r.montant;
          totals.profit_share_paye += r.montant;
          if (yearOfPayment) {
            d.profit_share_paye_annee[yearOfPayment] = (d.profit_share_paye_annee[yearOfPayment] || 0) + r.montant;
          }
          if (r.date && r.datePaiement) {
            const delta = daysBetween(r.date, r.datePaiement);
            if (delta !== null) delaisPS.push(delta);
          }
        } else {
          d.profit_share_non_paye += r.montant;
          totals.profit_share_non_paye += r.montant;
        }
        break;
      }
      case 'Crédit - Cooptation': d.cooptation_credit += r.montant; if (isPaid) totals.cooptation_credit_paye += r.montant; break;
      case 'Revenu - Dividendes - Cooptation':
        d.cooptation_revenu += r.montant;
        totals.cooptation_revenu_total += r.montant;
        d.details_cooptation.push({
          montant: r.montant, date_emission: r.date, date_paiement: r.datePaiement, statut: r.statut
        });
        if (isPaid) { d.cooptation_revenu_paye += r.montant; totals.cooptation_revenu_paye += r.montant; }
        break;
      case 'Crédit - Refacturation Client':
        if (isPaid) totals.refacturation_paye += r.montant;
        break;
    }
  });

  // Tri des mois
  const sortedMonths = Object.keys(byMois).sort((a, b) => {
    const [ma, ya] = a.split('-'); const [mb, yb] = b.split('-');
    return ya.localeCompare(yb) || ma.localeCompare(mb);
  });

  // Timeseries pour graphs
  const timeseries = sortedMonths.map(m => {
    const d = byMois[m];
    return {
      mois: m,
      ca: d.facturation,
      profit_share: d.profit_share_total,
      salaire_net: d.salaire_net,
      charges_salaire: d.charges_salaire,
      jours: d.jours_travailles
    };
  });

  // Années couvertes
  const years = [...new Set(sortedMonths.map(m => m.split('-')[1]))].sort();

  // Stats délais
  const stats = (arr) => {
    if (!arr.length) return { min: 0, max: 0, avg: 0, median: 0, count: 0 };
    const sorted = [...arr].sort((a,b) => a-b);
    return {
      min: sorted[0], max: sorted[sorted.length-1],
      avg: arr.reduce((a,b)=>a+b,0) / arr.length,
      median: sorted[Math.floor(sorted.length/2)],
      count: arr.length
    };
  };

  // Clients array
  const clientsArr = Object.entries(clients).map(([client, v]) => ({
    client, ca: v.ca, jours: v.jours, nb_mois: v.mois.size
  }));

  return {
    months: sortedMonths.map(m => byMois[m]),
    monthsByKey: byMois,
    timeseries, totals, clients: clientsArr,
    delaisCA: stats(delaisCA), delaisPS: stats(delaisPS),
    delaisPSList: delaisPS,
    years
  };
}

function daysBetween(d1Str, d2Str) {
  try {
    const parts1 = d1Str.split('/'); const parts2 = d2Str.split('/');
    if (parts1.length !== 3 || parts2.length !== 3) return null;
    const d1 = new Date(+parts1[2], +parts1[1]-1, +parts1[0]);
    const d2 = new Date(+parts2[2], +parts2[1]-1, +parts2[0]);
    return Math.round((d2 - d1) / 86400000);
  } catch (e) { return null; }
}

// ============================================================
// DATES — utilitaires
// ============================================================
function parseDate(str) {
  if (!str) return null;
  const p = str.split('/');
  if (p.length !== 3) return null;
  return new Date(+p[2], +p[1]-1, +p[0]);
}

function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ============================================================
// FISCAL
// ============================================================

// Barème IR 2025 (tranches pour 1 part)
const BAREME_IR_2025 = [
  { up_to: 11497,   rate: 0 },
  { up_to: 29315,   rate: 0.11 },
  { up_to: 83823,   rate: 0.30 },
  { up_to: 180294,  rate: 0.41 },
  { up_to: Infinity, rate: 0.45 }
];

const TAX_PARTS_KEY = 'reecho_tax_parts_v1';
function getTaxParts() {
  const v = parseFloat(localStorage.getItem(TAX_PARTS_KEY));
  return (isNaN(v) || v < 1) ? 1 : v;
}
function saveTaxParts(n) {
  localStorage.setItem(TAX_PARTS_KEY, String(n));
}

// Calcul de l'IR avec quotient familial
function calculIR(revenuImposable, parts) {
  const quotient = revenuImposable / parts;
  let tranches = [];
  let ir_par_part = 0;
  let previous = 0;

  for (const t of BAREME_IR_2025) {
    if (quotient <= previous) {
      tranches.push({ from: previous, to: t.up_to, rate: t.rate, base: 0, tax: 0, active: false });
    } else {
      const upperBound = Math.min(quotient, t.up_to);
      const base = upperBound - previous;
      const tax = base * t.rate;
      ir_par_part += tax;
      tranches.push({ from: previous, to: t.up_to, rate: t.rate, base, tax, active: true });
    }
    previous = t.up_to;
    if (t.up_to === Infinity || quotient <= t.up_to) break;
  }

  const ir_total = ir_par_part * parts;
  const tmi = BAREME_IR_2025.find(t => quotient <= t.up_to).rate;

  return { ir_total, ir_par_part, quotient, tmi, tranches, parts };
}

// ============================================================
// PROJECTION JUSQU'À FIN D'ANNÉE
// ============================================================

// Stockage overrides jours par mois (pour que l'utilisateur puisse modifier)
const PROJ_OVERRIDES_KEY = 'reecho_proj_overrides_v1';
function loadProjOverrides() {
  try { return JSON.parse(localStorage.getItem(PROJ_OVERRIDES_KEY) || '{}'); }
  catch { return {}; }
}
function saveProjOverrides(o) {
  localStorage.setItem(PROJ_OVERRIDES_KEY, JSON.stringify(o));
}

// Calcul de Pâques (Butcher)
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19*a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2*e + 2*i - h - k) % 7;
  const m_ = Math.floor((a + 11*h + 22*l) / 451);
  const month = Math.floor((h + l - 7*m_ + 114) / 31);
  const day = ((h + l - 7*m_ + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function feriesFR(year) {
  const e = easter(year);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  return [
    new Date(year, 0, 1),    // Jour de l'an
    addDays(e, 1),           // Lundi de Pâques
    new Date(year, 4, 1),    // Fête du Travail
    new Date(year, 4, 8),    // Victoire 1945
    addDays(e, 39),          // Ascension
    addDays(e, 50),          // Lundi de Pentecôte
    new Date(year, 6, 14),   // Fête nationale
    new Date(year, 7, 15),   // Assomption
    new Date(year, 10, 1),   // Toussaint
    new Date(year, 10, 11),  // Armistice
    new Date(year, 11, 25)   // Noël
  ].map(d => d.toDateString());
}

function joursOuvres(year, month) {
  const feries = feriesFR(year);
  let count = 0;
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !feries.includes(d.toDateString())) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Coefficients empiriques basés sur les mois récents à TJM constant
// Ces valeurs sont dérivées du dataset (mois 01-2026 à 03-2026)
const PROJ_COEFFS = {
  // Fixes par mois (indépendants des jours)
  salaire_net_fixe: 1964.42,
  charges_salaire_fixe: 1405.67,
  // Variables selon jours
  tr_per_jour: 13.25,
  // Commission = 6% du CA
  commission_pct: 0.06,
  // Charges PS = approximativement 3% du CA
  charges_ps_pct: 0.03
};

function projectMonth(year, month, jours, tjm) {
  const ca = jours * tjm;
  const commission = ca * PROJ_COEFFS.commission_pct;
  const charges_ps = ca * PROJ_COEFFS.charges_ps_pct;
  const salaire_net = jours > 0 ? PROJ_COEFFS.salaire_net_fixe : 0;
  const charges_salaire = jours > 0 ? PROJ_COEFFS.charges_salaire_fixe : 0;
  const salaire_brut = salaire_net + charges_salaire;
  const tickets = jours * PROJ_COEFFS.tr_per_jour;
  // Profit share = ce qui reste après toutes les sorties
  const profit_share = ca - commission - salaire_brut - charges_ps - tickets;
  return {
    year, month, jours, tjm,
    ca, commission, salaire_net, charges_salaire, charges_ps,
    tickets, profit_share,
    total_percu: salaire_net + profit_share + tickets
  };
}

// État global initialisé après que toutes les fonctions soient définies (cf. déclaration en haut du fichier).
DATASET = loadDataset();
