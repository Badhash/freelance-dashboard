// ============================================================
// DASHBOARD — couche affichage
// Toutes les fonctions render*, audit, modals.
// Charge après data.js (utilise aggregate, fmt, AGG, DATASET, etc.).
// ============================================================

// ============================================================
// CONFIRM MODAL — remplace confirm() natif (bloqué en iframe)
// ============================================================
function showConfirm({ title = 'Confirmation', message, okLabel = 'Confirmer', cancelLabel = 'Annuler', danger = true } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    const backdrop = modal.querySelector('.confirm-backdrop');

    titleEl.textContent = title;
    msgEl.textContent = message;
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.classList.toggle('danger', !!danger);

    const cleanup = (value) => {
      modal.classList.remove('visible');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      backdrop.onclick = null;
      document.removeEventListener('keydown', keyHandler);
      resolve(value);
    };
    const keyHandler = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    backdrop.onclick = () => cleanup(false);
    document.addEventListener('keydown', keyHandler);

    modal.classList.add('visible');
    // Focus sur bouton annuler par sécurité
    setTimeout(() => cancelBtn.focus(), 50);
  });
}

async function resetData() {
  const confirmed = await showConfirm({
    title: 'Réinitialiser le dashboard ?',
    message: 'Toutes les données importées et les préférences seront supprimées :\n\n• Opérations importées (dataset)\n• Projections personnalisées\n• Préférence de thème\n\nCette action est irréversible.',
    okLabel: 'Tout supprimer',
    cancelLabel: 'Annuler',
    danger: true
  });
  if (!confirmed) return;

  // Toutes les clés localStorage utilisées par le dashboard
  const allKeys = [
    'dashboard_dataset_v1',
    'dashboard_meta_v1',
    'dashboard_proj_overrides_v1',
    'dashboard_theme_v1',
    'dashboard_client_rules_v1'
  ];
  allKeys.forEach(k => localStorage.removeItem(k));

  DATASET = [];

  const auditModal = document.getElementById('audit-modal');
  if (auditModal) auditModal.style.display = 'none';
  document.body.style.overflow = '';

  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute('data-theme', prefersLight ? 'light' : 'dark');

  render();
}

// ============================================================
// TOAST notification
// ============================================================
function showToast({ title, body, stats, ok = true }) {
  const t = document.getElementById('toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-body').textContent = body;
  const s = document.getElementById('toast-stats');
  if (stats) {
    s.innerHTML = `
      <span><span class="s-label">Ajoutées</span><span class="s-value ok">${stats.added}</span></span>
      <span><span class="s-label">Mises à jour</span><span class="s-value warn">${stats.updated}</span></span>
      <span><span class="s-label">Déjà à jour</span><span class="s-value">${stats.unchanged}</span></span>
    `;
    s.style.display = 'flex';
  } else {
    s.style.display = 'none';
  }
  t.classList.remove('error');
  if (!ok) t.classList.add('error');
  t.classList.add('visible');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('visible'), 5000);
}

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

function runAudit() {
  if (!AGG || DATASET.length === 0) {
    showToast({ title: 'Pas de données', body: 'Importe un CSV avant de lancer la vérification.', ok: false });
    return;
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
    if (r.nature === 'Crédit - Facturation' && r.description.match(/\([\d.]+\s*\*\s*[\d.]+\)/)) {
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

  // === 10. DOUBLONS EXACTS ===
  const seen = {};
  DATASET.forEach(r => {
    const k = `${r.reference}|${r.nature}|${r.description}|${r.montant.toFixed(2)}`;
    seen[k] = (seen[k] || 0) + 1;
  });
  const duplicates = Object.entries(seen).filter(([k, v]) => v > 1);
  duplicates.forEach(([k, v]) => {
    const parts = k.split('|');
    addIssue('danger', 'duplicate', `Ligne en double`,
      `Une ligne apparaît ${v} fois avec exactement les mêmes caractéristiques.`,
      `${parts[1]} · ${parts[2]} · ${parts[3]} € · réf ${parts[0]}`);
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
  const clientsByMois = {};
  DATASET.forEach(r => {
    if (r.nature !== 'Crédit - Facturation') return;
    if (!clientsByMois[r.mois]) clientsByMois[r.mois] = new Set();
    // Détection client via description
    let clientLabel = 'Autre';
    if (r.description.includes('CLIENT_A')) clientLabel = 'CLIENT_A';
    else if (r.description.includes('Client B')) clientLabel = 'Client B';
    else {
      // Extraction générique : premier mot capitalisé après "Facturation"
      const m = r.description.match(/Facturation\s+([A-Z][A-Za-z\s]+?)\s*\(/);
      if (m) clientLabel = m[1].trim();
    }
    clientsByMois[r.mois].add(clientLabel);
  });
  Object.entries(clientsByMois).forEach(([mois, clientsSet]) => {
    if (clientsSet.size >= 2) {
      const clients = [...clientsSet].join(' + ');
      addIssue('info', 'multi_clients', `Mois multi-clients ${mois}`,
        `Deux missions facturées en parallèle ce mois-ci. Les ratios (TR/jour, charges) peuvent sembler atypiques car les jours facturés cumulés dépassent le nombre de jours ouvrés.`,
        `Clients : ${clients}`);
    }
  });

  // === 14. JOURS FACTURÉS EXCESSIFS (> 23/mois, physiquement improbable) ===
  Object.entries(clientsByMois).forEach(([mois, clientsSet]) => {
    const moisData = AGG.monthsByKey[mois];
    if (!moisData) return;
    const jours = moisData.jours_travailles;
    if (jours > 23) {
      const severity = clientsSet.size >= 2 ? 'info' : 'warn';
      const contextMsg = clientsSet.size >= 2
        ? `Lié à la facturation multi-clients de ce mois. Chaque client facturé séparément = jours cumulés. À confirmer.`
        : `Ce volume dépasse le maximum physique d'un mois (23 jours ouvrés max). Probable facturation rétroactive ou erreur.`;
      addIssue(severity, 'volume', `${jours} jours facturés ${mois}`,
        contextMsg,
        `Max théorique : 23 jours ouvrés/mois`);
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

  displayAuditResults(issues, stats);
}

function displayAuditResults(issues, stats) {
  const modal = document.getElementById('audit-modal');
  const listEl = document.getElementById('audit-list');
  const summaryEl = document.getElementById('audit-summary');
  const subEl = document.getElementById('audit-sub');

  const total = stats.danger + stats.warn + stats.info;
  subEl.textContent = total === 0
    ? `Aucune anomalie sur ${DATASET.length} opérations analysées`
    : `${total} point${total>1?'s':''} d'attention sur ${DATASET.length} opérations analysées`;

  summaryEl.innerHTML = `
    <div class="audit-summary-card danger">
      <div class="n">${stats.danger}</div>
      <div class="l">Critique</div>
    </div>
    <div class="audit-summary-card warn">
      <div class="n">${stats.warn}</div>
      <div class="l">Attention</div>
    </div>
    <div class="audit-summary-card info">
      <div class="n">${stats.info}</div>
      <div class="l">Info</div>
    </div>
    <div class="audit-summary-card ok">
      <div class="n">${stats.ok > 0 ? '✓' : (DATASET.length - total)}</div>
      <div class="l">${stats.ok > 0 ? 'Tout OK' : 'OK'}</div>
    </div>
  `;

  // Tri : danger > warn > info > ok
  const order = { danger: 0, warn: 1, info: 2, ok: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  // Groupement par sévérité
  const grouped = { danger: [], warn: [], info: [], ok: [] };
  issues.forEach(i => grouped[i.severity].push(i));

  const labels = {
    danger: 'Anomalies critiques',
    warn: 'Points d\'attention',
    info: 'Informations utiles',
    ok: 'Conformité'
  };

  let html = '';
  ['danger', 'warn', 'info', 'ok'].forEach(sev => {
    if (grouped[sev].length === 0) return;
    html += `<div class="audit-section-title">${labels[sev]} (${grouped[sev].length})</div>`;
    grouped[sev].forEach(i => {
      html += `
        <div class="audit-item ${i.severity}">
          <div class="bar"></div>
          <div class="body">
            <div class="title">${i.title}</div>
            <div class="desc">${i.desc}</div>
            ${i.detail ? `<div class="detail">${i.detail}</div>` : ''}
          </div>
          <div class="right">${i.category}</div>
        </div>
      `;
    });
  });

  listEl.innerHTML = html;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Mettre à jour le badge du bouton
  updateAuditBadge(stats);
}

function updateAuditBadge(stats) {
  const badge = document.getElementById('audit-badge');
  if (!badge) return;
  const n = stats.danger + stats.warn;
  if (n === 0) {
    badge.style.display = 'none';
  } else {
    badge.textContent = n;
    badge.className = stats.danger > 0 ? 'audit-badge' : 'audit-badge warn';
    badge.style.display = 'inline-flex';
  }
}

function closeAudit() {
  document.getElementById('audit-modal').style.display = 'none';
  document.body.style.overflow = '';
}

// ============================================================
// IMPORT DIFF MODAL — affiche ce qui a changé depuis le dernier import
// ============================================================
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showImportDiff(fileName, changes) {
  if (!changes) return;
  const addedRows = changes.addedRows || [];
  const updatedRows = changes.updatedRows || [];
  if (addedRows.length === 0 && updatedRows.length === 0) return;

  const modal = document.getElementById('diff-modal');
  const subEl = document.getElementById('diff-sub');
  const summaryEl = document.getElementById('diff-summary');
  const listEl = document.getElementById('diff-list');

  // Catégorisation des nouvelles lignes
  const newInvoices     = addedRows.filter(r => r.nature === 'Crédit - Facturation');
  const newProfitShares = addedRows.filter(r => r.nature === 'Revenu - Profit Share');
  const otherRevenus    = addedRows.filter(r => r.nature.startsWith('Revenu') && r.nature !== 'Revenu - Profit Share');
  const newCharges      = addedRows.filter(r => r.nature.startsWith('Charges'));
  const otherAdded      = addedRows.filter(r =>
    r.nature !== 'Crédit - Facturation' &&
    !r.nature.startsWith('Revenu') &&
    !r.nature.startsWith('Charges')
  );

  // Catégorisation des mises à jour
  const nowPaid     = updatedRows.filter(({ prev, next }) => prev.statut !== 'Payé' && next.statut === 'Payé');
  const nowUnpaid   = updatedRows.filter(({ prev, next }) => prev.statut === 'Payé' && next.statut !== 'Payé');
  const dateChanges = updatedRows.filter(({ prev, next }) =>
    prev.statut === next.statut && prev.datePaiement !== next.datePaiement
  );

  const sum = arr => arr.reduce((s, r) => s + (r.montant || 0), 0);
  const encaisseAmount = nowPaid.reduce((s, { next }) => s + next.montant, 0);
  const newCaAmount = sum(newInvoices);

  // Sous-titre
  const parts = [];
  if (fileName) parts.push(fileName);
  parts.push(`${addedRows.length} ajout${addedRows.length > 1 ? 's' : ''}`);
  parts.push(`${updatedRows.length} mise${updatedRows.length > 1 ? 's' : ''} à jour`);
  subEl.textContent = parts.join(' · ');

  // Cartes résumé : focus sur l'info "cash" = encaissé + nouveau CA
  summaryEl.innerHTML = `
    <div class="audit-summary-card ok">
      <div class="n">${encaisseAmount > 0 ? fmtShort(encaisseAmount) : '—'}</div>
      <div class="l">Encaissé</div>
    </div>
    <div class="audit-summary-card info">
      <div class="n">${newCaAmount > 0 ? fmtShort(newCaAmount) : '—'}</div>
      <div class="l">Nouveau CA</div>
    </div>
    <div class="audit-summary-card">
      <div class="n">${addedRows.length}</div>
      <div class="l">Ajoutées</div>
    </div>
    <div class="audit-summary-card">
      <div class="n">${updatedRows.length}</div>
      <div class="l">Modifiées</div>
    </div>
  `;

  const sections = [];

  if (nowPaid.length) {
    sections.push({
      title: `Encaissements (${nowPaid.length}) · ${fmt(encaisseAmount)}`,
      severity: 'ok',
      items: nowPaid.map(({ next }) => ({
        title: `${fmt(next.montant)} — ${next.nature.replace(/^(Crédit|Revenu|Charges) - /, '')}`,
        desc: next.description || '—',
        right: next.datePaiement || 'Payé',
        detail: `Mois ${next.mois}${next.reference ? ` · ${next.reference}` : ''}`
      }))
    });
  }

  if (newInvoices.length) {
    sections.push({
      title: `Nouvelles factures (${newInvoices.length}) · ${fmt(newCaAmount)}`,
      severity: 'info',
      items: newInvoices.map(r => ({
        title: `${fmt(r.montant)} — ${r.statut === 'Payé' ? 'Payée' : 'En attente'}`,
        desc: r.description || '—',
        right: r.date || '—',
        detail: `Mois ${r.mois}${r.reference ? ` · ${r.reference}` : ''}`
      }))
    });
  }

  if (newProfitShares.length) {
    sections.push({
      title: `Profit shares ajoutés (${newProfitShares.length}) · ${fmt(sum(newProfitShares))}`,
      severity: 'info',
      items: newProfitShares.map(r => ({
        title: `${fmt(r.montant)} — ${r.statut === 'Payé' ? 'Payé' : 'En attente'}`,
        desc: r.description || '—',
        right: r.date || '—',
        detail: `Mois ${r.mois}`
      }))
    });
  }

  if (otherRevenus.length) {
    sections.push({
      title: `Autres revenus (${otherRevenus.length}) · ${fmt(sum(otherRevenus))}`,
      severity: 'info',
      items: otherRevenus.map(r => ({
        title: `${fmt(r.montant)} — ${r.nature.replace(/^Revenu - /, '')}`,
        desc: r.description || '—',
        right: r.date || '—',
        detail: `Mois ${r.mois}`
      }))
    });
  }

  if (newCharges.length) {
    sections.push({
      title: `Charges (${newCharges.length}) · ${fmt(sum(newCharges))}`,
      severity: 'warn',
      items: newCharges.map(r => ({
        title: `${fmt(r.montant)} — ${r.nature.replace(/^Charges - /, '')}`,
        desc: r.description || '—',
        right: r.date || '—',
        detail: `Mois ${r.mois}`
      }))
    });
  }

  if (otherAdded.length) {
    sections.push({
      title: `Autres lignes (${otherAdded.length})`,
      severity: 'info',
      items: otherAdded.map(r => ({
        title: `${fmt(r.montant)} — ${r.nature}`,
        desc: r.description || '—',
        right: r.date || '—',
        detail: `Mois ${r.mois}`
      }))
    });
  }

  if (dateChanges.length) {
    sections.push({
      title: `Dates de paiement modifiées (${dateChanges.length})`,
      severity: 'info',
      items: dateChanges.map(({ prev, next }) => ({
        title: `${fmt(next.montant)} — ${next.description || next.nature}`,
        desc: `${prev.datePaiement || '—'}  →  ${next.datePaiement || '—'}`,
        right: next.mois || '',
        detail: ''
      }))
    });
  }

  if (nowUnpaid.length) {
    sections.push({
      title: `Paiements annulés (${nowUnpaid.length})`,
      severity: 'danger',
      items: nowUnpaid.map(({ prev, next }) => ({
        title: `${fmt(next.montant)} — ${next.description || next.nature}`,
        desc: `Statut "Payé" → "${next.statut || 'non payé'}"`,
        right: next.mois || '',
        detail: ''
      }))
    });
  }

  let html = '';
  sections.forEach(s => {
    html += `<div class="audit-section-title">${escapeHtml(s.title)}</div>`;
    s.items.forEach(i => {
      html += `
        <div class="audit-item ${s.severity}">
          <div class="bar"></div>
          <div class="body">
            <div class="title">${escapeHtml(i.title)}</div>
            <div class="desc">${escapeHtml(i.desc)}</div>
            ${i.detail ? `<div class="detail">${escapeHtml(i.detail)}</div>` : ''}
          </div>
          <div class="right">${escapeHtml(i.right)}</div>
        </div>
      `;
    });
  });

  listEl.innerHTML = html;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeImportDiff() {
  document.getElementById('diff-modal').style.display = 'none';
  document.body.style.overflow = '';
}

// ============================================================
// MAIN RENDER
// ============================================================
function render() {
  const meta = loadMeta();
  const hasData = DATASET.length > 0;

  document.getElementById('empty-state').style.display = hasData ? 'none' : 'block';
  document.getElementById('main-content').style.display = hasData ? 'block' : 'none';
  document.getElementById('reset-btn').style.display = hasData ? 'inline-flex' : 'none';
  const auditBtn = document.getElementById('audit-btn');
  if (auditBtn) auditBtn.style.display = hasData ? 'inline-flex' : 'none';

  // Info dernier import
  if (meta) {
    const d = new Date(meta.lastImport);
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('last-import-info').innerHTML = `Dernier import · <span class="val">${dateStr}</span> · ${meta.count} lignes`;
    document.getElementById('footer-text').textContent = `${meta.count} opérations analysées · dernière synchronisation ${dateStr}`;
  } else {
    document.getElementById('last-import-info').textContent = '';
    document.getElementById('footer-text').textContent = 'Aucune donnée — importe un CSV pour démarrer';
  }

  if (!hasData) {
    // Vider tout le contenu dynamique pour ne rien laisser en mémoire DOM
    AGG = null;
    const containersToEmpty = [
      'months-2025', 'months-2026',
      'projection-tbody', 'projection-tfoot', 'projection-summary',
      'projection-total', 'last-import-info',
      'audit-list', 'audit-summary'
    ];
    containersToEmpty.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Vider les zones internes du widget balance + stats d'activité
    document.querySelectorAll('.balance-lines, .ledger-content, .activity-grid, .activity-years').forEach(el => el.innerHTML = '');
    document.querySelectorAll('.activity-head-total .amount').forEach(el => el.innerHTML = '');
    document.querySelectorAll('.balance-subtotal, .balance-total .amount, .official-value, .ledger-value').forEach(el => el.innerHTML = '');

    // Vider pending zone
    const pendingList = document.querySelector('.pending-zone .pending-list');
    if (pendingList) pendingList.innerHTML = '';

    // Reset TJM header
    const headerTjmEl = document.getElementById('header-tjm');
    if (headerTjmEl) headerTjmEl.textContent = '—';

    // Reset badge audit
    const badge = document.getElementById('audit-badge');
    if (badge) badge.style.display = 'none';

    return;
  }

  AGG = aggregate();
  refreshProjCoeffs();   // dérive salaire/charges/TR/commission depuis les derniers mois

  // TJM dynamique dans le header : dernier TJM connu depuis le CSV
  const headerTjmEl = document.getElementById('header-tjm');
  if (headerTjmEl) {
    let currentTjm = 0;
    for (let i = AGG.months.length - 1; i >= 0; i--) {
      if (AGG.months[i].tjm > 0) { currentTjm = AGG.months[i].tjm; break; }
    }
    headerTjmEl.textContent = currentTjm > 0 ? `TJM ${fmtInt(currentTjm)} €` : '';
  }

  renderBalanceWidget();
  renderActivityStats();
  renderProjection();
  renderMonthsLists();
}
