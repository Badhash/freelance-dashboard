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
    message: 'Toutes les données importées et les préférences seront supprimées :\n\n• Opérations importées (dataset)\n• Projections personnalisées\n• Nombre de parts fiscales\n• Préférence de thème\n\nCette action est irréversible.',
    okLabel: 'Tout supprimer',
    cancelLabel: 'Annuler',
    danger: true
  });
  if (!confirmed) return;

  // Toutes les clés localStorage utilisées par le dashboard
  const allKeys = [
    'reecho_dataset_v1',
    'reecho_meta_v1',
    'reecho_proj_overrides_v1',
    'reecho_tax_parts_v1',
    'reecho_theme_v1',
    'dashboard_client_rules_v1'
  ];
  allKeys.forEach(k => localStorage.removeItem(k));

  DATASET = [];

  const partsInput = document.getElementById('tax-parts-input');
  if (partsInput) {
    partsInput.value = 1;
    delete partsInput.dataset.bound;
  }

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
      'fiscal-grid-declaration', 'fiscal-grid-tax', 'fiscal-grid-scenarios',
      'tax-breakdown',
      'projection-tbody', 'projection-tfoot', 'projection-summary',
      'projection-total', 'last-import-info',
      'audit-list', 'audit-summary'
    ];
    containersToEmpty.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });

    // Vider les zones internes du widget balance
    document.querySelectorAll('.balance-lines, .ledger-content').forEach(el => el.innerHTML = '');
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
  renderFiscal();
  renderProjection();
  renderMonthsLists();
}

// ============================================================
// AGRÉGATIONS PAR ANNÉE (utilisé par renderFiscal)
// ============================================================
function subTotalsForYear(year) {
  const t = { ca: 0, salaire_net: 0, profit_share_total: 0, profit_share_paye_year: 0, profit_share_paye_autre: 0, profit_share_non_paye: 0, jours: 0, nb_mois: 0 };
  AGG.months.forEach(m => {
    if (!m.mois.endsWith('-' + year)) return;
    t.nb_mois++;
    t.ca += m.facturation;
    t.salaire_net += m.salaire_net;
    t.profit_share_total += m.profit_share_total;
    t.profit_share_non_paye += m.profit_share_non_paye;
    t.jours += m.jours_travailles;
    Object.entries(m.profit_share_paye_annee).forEach(([y, v]) => {
      if (y === year) t.profit_share_paye_year += v;
      else t.profit_share_paye_autre += v;
    });
  });
  return t;
}

// ============================================================
// BALANCE WIDGET
// ============================================================
function renderBalanceWidget() {
  const t = AGG.totals;

  // Solde sur facturé = tout ce que la société me doit encore
  const soldeFacture = t.profit_share_non_paye
    + (t.provision_conges_total - t.provision_conges_payee)
    + (t.cooptation_revenu_total - t.cooptation_revenu_paye);

  // Solde sur encaissé = ce qui est effectivement sur le compte associé
  const creditsEncaisses = t.ca_paye + t.cooptation_credit_paye + t.refacturation_paye;
  const chargesPayees = t.commission_paye + t.charges_diverses_paye + t.impot_france + t.charges_ps_paye + t.charges_salaire_paye;
  const versementsRecus = t.salaire_net + t.notes_frais + t.tickets_resto + t.profit_share_paye + t.cooptation_revenu_paye;
  const soldeEncaisse = creditsEncaisses - chargesPayees - versementsRecus;

  // Mises à jour widget
  const totalEl = document.querySelector('.balance-total .amount');
  if (totalEl) totalEl.innerHTML = `${fmtInt(soldeFacture)}<span class="unit">€</span>`;

  const officialValues = document.querySelectorAll('.official-value');
  if (officialValues.length >= 2) {
    officialValues[0].innerHTML = `${fmt(soldeEncaisse).replace(' €','')}<span class="u"> €</span>`;
    officialValues[1].innerHTML = `${fmt(soldeFacture).replace(' €','')}<span class="u"> €</span>`;
  }

  // Section "Ils te paieront plus tard" — PS non payés
  const psNonPayes = [];
  AGG.months.forEach(m => {
    m.details_profit_share.forEach(ps => {
      if (ps.statut !== 'Payé') {
        psNonPayes.push({ mois: m.mois, ...ps });
      }
    });
  });
  // Tri chronologique
  psNonPayes.sort((a,b) => {
    const [ma, ya] = a.mois.split('-'); const [mb, yb] = b.mois.split('-');
    return ya.localeCompare(yb) || ma.localeCompare(mb);
  });

  const receivableEl = document.querySelector('.balance-section.receivable');
  if (receivableEl) {
    const subtotal = psNonPayes.reduce((a,p) => a + p.montant, 0);
    receivableEl.querySelector('.balance-subtotal').innerHTML = `${fmtInt(subtotal)}<span class="unit">€</span>`;
    const linesEl = receivableEl.querySelector('.balance-lines');
    linesEl.innerHTML = psNonPayes.map(ps => {
      const [m, y] = ps.mois.split('-');
      return `
        <div class="balance-line">
          <div class="line-left">
            <span class="line-name">Profit share ${monthNamesFull[parseInt(m)-1].toLowerCase()} ${y}</span>
            <span class="line-hint">Émis ${ps.date_emission} · en attente</span>
          </div>
          <span class="line-value">${fmt(ps.montant)}</span>
        </div>
      `;
    }).join('') || '<div class="balance-line"><div class="line-left"><span class="line-name">Aucun profit share en attente</span></div></div>';
  }

  // Section "Provisions & autres créances"
  const provCongesRestante = t.provision_conges_total - t.provision_conges_payee;
  const provCongesMois = AGG.months.filter(m => m.provision_conges > 0).length;
  const coopNonPayeDetails = [];
  AGG.months.forEach(m => {
    // Cherche cooptations non payées ligne par ligne (approximation : delta total - paye)
    const delta = m.cooptation_revenu - m.cooptation_revenu_paye;
    if (delta > 0.01) coopNonPayeDetails.push({ mois: m.mois, montant: delta });
  });

  const advanceEl = document.querySelector('.balance-section.advance');
  if (advanceEl) {
    const coopRestant = t.cooptation_revenu_total - t.cooptation_revenu_paye;
    const subtotal = provCongesRestante + coopRestant;
    advanceEl.querySelector('.balance-subtotal').innerHTML = `${fmtInt(subtotal)}<span class="unit">€</span>`;
    const linesEl = advanceEl.querySelector('.balance-lines');
    let html = '';
    if (provCongesRestante > 0) {
      html += `
        <div class="balance-line">
          <div class="line-left">
            <span class="line-name">Provision congés payés</span>
            <span class="line-hint">${provCongesMois} mois × 283 € · jamais versés</span>
          </div>
          <span class="line-value">${fmt(provCongesRestante)}</span>
        </div>
      `;
    }
    coopNonPayeDetails.forEach(c => {
      const [m, y] = c.mois.split('-');
      html += `
        <div class="balance-line">
          <div class="line-left">
            <span class="line-name">Cooptation</span>
            <span class="line-hint">${monthNamesFull[parseInt(m)-1]} ${y} · en attente</span>
          </div>
          <span class="line-value">${fmt(c.montant)}</span>
        </div>
      `;
    });
    linesEl.innerHTML = html || '<div class="balance-line"><div class="line-left"><span class="line-name">Aucune créance en attente</span></div></div>';
  }

  // Ledger détail
  const ledgerContent = document.querySelector('.ledger-content');
  if (ledgerContent) {
    ledgerContent.innerHTML = `
      <div class="ledger-col">
        <div class="ledger-col-title positive">Entrées — encaissements sur compte</div>
        <div class="ledger-row"><span>Facturation client payée</span><span class="v">+${fmt(t.ca_paye)}</span></div>
        <div class="ledger-row"><span>Cooptation encaissée</span><span class="v">+${fmt(t.cooptation_credit_paye)}</span></div>
        <div class="ledger-row"><span>Refacturation client</span><span class="v">+${fmt(t.refacturation_paye)}</span></div>
        <div class="ledger-row total"><span>Sous-total encaissements</span><span class="v">+${fmt(creditsEncaisses)}</span></div>
      </div>
      <div class="ledger-col">
        <div class="ledger-col-title negative">Sorties — charges payées par le portage</div>
        <div class="ledger-row"><span>Commission portage</span><span class="v">−${fmt(t.commission_paye)}</span></div>
        <div class="ledger-row"><span>Charges sociales salaire</span><span class="v">−${fmt(t.charges_salaire_paye)}</span></div>
        <div class="ledger-row"><span>Charges sur profit share</span><span class="v">−${fmt(t.charges_ps_paye)}</span></div>
        <div class="ledger-row"><span>Impôts France (PAS)</span><span class="v">−${fmt(t.impot_france)}</span></div>
        <div class="ledger-row"><span>Charges diverses</span><span class="v">−${fmt(t.charges_diverses_paye)}</span></div>
        <div class="ledger-row total"><span>Sous-total charges</span><span class="v">−${fmt(chargesPayees)}</span></div>
      </div>
      <div class="ledger-col">
        <div class="ledger-col-title negative">Sorties — versements vers toi</div>
        <div class="ledger-row"><span>Salaires nets versés</span><span class="v">−${fmt(t.salaire_net)}</span></div>
        <div class="ledger-row"><span>Profit shares versés</span><span class="v">−${fmt(t.profit_share_paye)}</span></div>
        <div class="ledger-row"><span>Notes de frais remboursées</span><span class="v">−${fmt(t.notes_frais)}</span></div>
        <div class="ledger-row"><span>Tickets restaurant</span><span class="v">−${fmt(t.tickets_resto)}</span></div>
        <div class="ledger-row"><span>Cooptations reversées</span><span class="v">−${fmt(t.cooptation_revenu_paye)}</span></div>
        <div class="ledger-row total"><span>Sous-total versements</span><span class="v">−${fmt(versementsRecus)}</span></div>
      </div>
      <div class="ledger-final">
        <span>SOLDE SUR ENCAISSÉ</span>
        <span class="v">${soldeEncaisse >= 0 ? '+' : ''}${fmt(soldeEncaisse)}</span>
      </div>
    `;
  }

  // Valeur à droite du toggle
  const ledgerValue = document.querySelector('.ledger-value');
  if (ledgerValue) ledgerValue.textContent = fmt(soldeEncaisse);
}

// ============================================================
// FISCAL — rendu
// ============================================================
function renderFiscal() {
  const t25 = subTotalsForYear('2025');

  // Données de base
  const profitSharePaye2025 = t25.profit_share_paye_year; // encaissé en 2025
  const salaireBrutAnnuel = t25.salaire_net * 1 / 0.80; // estimation grossière (salaire net -> brut) non utilisée
  const salaireNet = t25.salaire_net;
  // Le salaire imposable est approximé comme salaire net × 1.02 (CSG non déductible rajoutée, très proche en portage)
  // On va plutôt utiliser le salaire net + PAS déjà prélevé comme base imposable approximative
  // Plus simple : les fiches de paie donnent le "salaire imposable". Ici on estime à salaire net + impôt retenu à la source
  // Approximation raisonnable
  const impotPAS = AGG.totals.impot_france;
  const salaireImposable = salaireNet + impotPAS; // ordre de grandeur correct

  // === SECTION 1 : Éléments à déclarer ===
  const gridDecl = document.getElementById('fiscal-grid-declaration');
  if (gridDecl) {
    gridDecl.innerHTML = `
      <div class="fiscal-row">
        <div class="label">Salaire imposable 2025</div>
        <div class="big info">${fmtInt(salaireImposable)} €</div>
        <div class="detail"><span class="case-ref">1AJ</span>Pré-rempli par l'employeur<br>Salaire net ${fmtInt(salaireNet)} € + PAS ${fmtInt(impotPAS)} €</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Profit share LLP encaissé</div>
        <div class="big warn">${fmtInt(profitSharePaye2025)} €</div>
        <div class="detail"><span class="case-ref">5XJ</span>À déclarer en BNC<br>Régime déclaration contrôlée</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Crédit d'impôt FR-UK</div>
        <div class="big ok">${fmtInt(profitSharePaye2025)} €</div>
        <div class="detail"><span class="case-ref">8TK</span>Report depuis annexe 2047<br>Élimine la double imposition</div>
      </div>
      <div class="fiscal-row">
        <div class="label">PAS déjà prélevé</div>
        <div class="big">${fmtInt(impotPAS)} €</div>
        <div class="detail">Prélèvement à la source<br>sur salaire 2025</div>
      </div>
    `;
  }

  // === SECTION 2 : Calcul d'impôt dynamique ===
  const parts = getTaxParts();
  // Revenu imposable total : salaire (après abattement 10% ou frais réels) + BNC
  // Abattement 10% forfaitaire sur salaire (plafonné à 14 426 € en 2025)
  const abattement10 = Math.min(salaireImposable * 0.10, 14426);
  const salaireApresAbattement = salaireImposable - abattement10;
  const revenuImposableTotal = salaireApresAbattement + profitSharePaye2025;

  // Sans crédit d'impôt
  const calcSans = calculIR(revenuImposableTotal, parts);
  // Avec crédit d'impôt Cabinet fiscaliste : on enlève la part IR correspondant au BNC
  const calcSalaireSeul = calculIR(salaireApresAbattement, parts);
  const irImputableBNC = calcSans.ir_total - calcSalaireSeul.ir_total; // IR correspondant au BNC
  const creditImpot = irImputableBNC; // = montant reporté en 8TK pour éliminer double imposition
  const irNetAvecCredit = calcSans.ir_total - creditImpot;
  const resteApayer = irNetAvecCredit - impotPAS;

  const gridTax = document.getElementById('fiscal-grid-tax');
  if (gridTax) {
    gridTax.innerHTML = `
      <div class="fiscal-row">
        <div class="label">Revenu imposable total</div>
        <div class="big">${fmtInt(revenuImposableTotal)} €</div>
        <div class="detail">Salaire après abattement 10%<br>+ profit share BNC</div>
      </div>
      <div class="fiscal-row">
        <div class="label">IR brut (avant crédit)</div>
        <div class="big warn">${fmtInt(calcSans.ir_total)} €</div>
        <div class="detail">TMI ${(calcSans.tmi * 100).toFixed(0)}%<br>Quotient ${fmtInt(calcSans.quotient)} € / part</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Crédit d'impôt BNC</div>
        <div class="big ok">− ${fmtInt(creditImpot)} €</div>
        <div class="detail">Part d'IR correspondant<br>au profit share LLP</div>
      </div>
      <div class="fiscal-row">
        <div class="label">IR net à payer</div>
        <div class="big ${irNetAvecCredit > 0 ? 'warn' : 'ok'}">${fmtInt(irNetAvecCredit)} €</div>
        <div class="detail">Après crédit d'impôt<br>= IR sur le salaire uniquement</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Solde après PAS</div>
        <div class="big ${resteApayer > 0 ? 'warn' : 'ok'}">${resteApayer >= 0 ? '' : '+'}${fmtInt(Math.abs(resteApayer))} €</div>
        <div class="detail">${resteApayer >= 0 ? 'Reste à payer en sept. 2026' : 'Remboursement attendu'}<br>Après prélèvements à la source</div>
      </div>
    `;
  }

  // === Breakdown barème par tranches ===
  const breakdown = document.getElementById('tax-breakdown');
  if (breakdown) {
    const tranches = calcSans.tranches;
    const fmtRange = (t) => {
      if (t.to === Infinity) return `> ${fmtInt(t.from)} €`;
      if (t.from === 0) return `≤ ${fmtInt(t.to)} €`;
      return `${fmtInt(t.from)} → ${fmtInt(t.to)} €`;
    };
    breakdown.innerHTML = `
      <div class="tax-breakdown-title">Décomposition par tranches (quotient ${fmtInt(calcSans.quotient)} € × ${parts} part${parts > 1 ? 's' : ''})</div>
      <div class="tax-tranches">
        ${tranches.map(t => `
          <div class="tax-tranche ${t.active ? 'active' : ''}">
            <span class="tb-range">${fmtRange(t)}</span>
            <span class="tb-rate">${(t.rate * 100).toFixed(0)} %</span>
            <span class="tb-base">${t.base > 0 ? fmtInt(t.base) + ' €' : '—'}</span>
            <span class="tb-tax">${t.tax > 0 ? fmtInt(t.tax * parts) + ' €' : '—'}</span>
          </div>
        `).join('')}
        <div class="tax-tranche total">
          <span class="tb-range">Total IR brut</span>
          <span class="tb-rate">TMI ${(calcSans.tmi * 100).toFixed(0)} %</span>
          <span class="tb-base"></span>
          <span class="tb-tax">${fmtInt(calcSans.ir_total)} €</span>
        </div>
      </div>
    `;
  }

  // === SECTION 3 : Scénarios LLP ===
  const gridScen = document.getElementById('fiscal-grid-scenarios');
  if (gridScen) {
    // Scénario favorable = méthode appliquée
    // Scénario requalification = pas de crédit d'impôt + PS 17,2% + pénalités 10%
    const psEstime = Math.round(profitSharePaye2025 * 0.172);
    const totalReq = Math.round(irImputableBNC) + psEstime;
    const penalites = Math.round(totalReq * 0.10);
    const totalAvecPen = totalReq + penalites;
    const provision = Math.ceil(totalAvecPen / 5000) * 5000;

    gridScen.innerHTML = `
      <div class="fiscal-row">
        <div class="label">Méthode cabinet fiscaliste</div>
        <div class="big ok">0 €</div>
        <div class="detail">Crédit d'impôt case 8TK<br>neutralise l'IR sur le BNC</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Si requalification (IR)</div>
        <div class="big warn">${fmtInt(irImputableBNC)} €</div>
        <div class="detail">IR au barème progressif<br>sans crédit d'impôt</div>
      </div>
      <div class="fiscal-row">
        <div class="label">+ Prélèvements sociaux 17,2%</div>
        <div class="big warn">${fmtInt(psEstime)} €</div>
        <div class="detail">CSG-CRDS + PS<br>sur base ${fmtInt(profitSharePaye2025)} €</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Risque total (avec pénalités)</div>
        <div class="big danger">~${fmtInt(totalAvecPen)} €</div>
        <div class="detail">IR ${fmtInt(irImputableBNC/1000)}k + PS ${fmtInt(psEstime/1000)}k<br>+ pénalités 10% (bonne foi)</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Provision recommandée</div>
        <div class="big info">${fmtInt(provision)} €</div>
        <div class="detail">Couverture risque<br>de redressement fiscal</div>
      </div>
    `;
  }

  // Input parts listener
  const partsInput = document.getElementById('tax-parts-input');
  if (partsInput && !partsInput.dataset.bound) {
    partsInput.dataset.bound = '1';
    partsInput.value = parts;
    partsInput.addEventListener('input', () => {
      let v = parseFloat(partsInput.value);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 10) v = 10;
      saveTaxParts(v);
      renderFiscal();
    });
    document.querySelectorAll('.days-stepper[data-tax-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('tax-parts-input');
        let current = parseFloat(input.value) || 1;
        const step = 0.25;
        let next = btn.dataset.taxAction === 'up' ? current + step : current - step;
        if (next < 1) next = 1;
        if (next > 10) next = 10;
        input.value = next;
        saveTaxParts(next);
        renderFiscal();
      });
    });
  } else if (partsInput) {
    // Re-render maintien de la value sans re-bind
    partsInput.value = parts;
  }
}

// ============================================================
// MONTHS LISTS
// ============================================================
function pillFor(it) {
  return it.statut === 'Payé' ?
    `<span class="status-pill ok">✓ Payé · ${it.date_paiement || '?'}</span>` :
    `<span class="status-pill warn">⧖ En attente</span>`;
}

function renderRevenueItems(details) {
  if (!details || details.length === 0) return '';
  return details.map(it => `
      <div class="ps-item">
        <div class="left">${pillFor(it)}<span class="date">Émis ${it.date_emission}</span></div>
        <span class="amount">${fmt(it.montant)}</span>
      </div>
    `).join('');
}

function renderRevenueLine(label, total, details, alwaysShow = false) {
  if (!total && !alwaysShow) return '';
  const hasDetails = details && details.length > 0;
  const allPaid = hasDetails && details.every(d => d.statut === 'Payé');
  const cls = total > 0 && allPaid ? 'positive' : '';

  // 1 entrée : pill + émis inline avec le label. >1 entrées : fallback en sous-items.
  let inline = '';
  let itemsHtml = '';
  if (hasDetails && details.length === 1) {
    const it = details[0];
    inline = ` ${pillFor(it)}<span class="emit-date">Émis ${it.date_emission}</span>`;
  } else if (hasDetails) {
    inline = ` <span style="color: var(--text-muted)">(${details.length} versements)</span>`;
    itemsHtml = `<div class="ps-items">${renderRevenueItems(details)}</div>`;
  }
  return `
    <div class="detail-line ${cls}">
      <span class="desc">${label}${inline}</span>
      <span class="val">${fmt(total)}</span>
    </div>
    ${itemsHtml}
  `;
}

function renderMonth(m) {

  const facturation_pill = m.facturation_payee ?
    `<span class="status-pill ok">✓ Payée · ${m.facturation_date_paiement || '?'}</span>` :
    `<span class="status-pill warn">⧖ En attente</span>`;

  let psHeader = '';
  if (m.profit_share_total > 0) {
    const cls = m.profit_share_non_paye > 0 ? 'pending' : 'paid';
    psHeader = `<div class="month-value ${cls}"><span class="label">Profit share</span><span class="amount">${fmtShort(m.profit_share_total)}</span></div>`;
  } else {
    psHeader = `<div class="month-value"><span class="label">Profit share</span><span class="amount" style="color: var(--text-muted)">—</span></div>`;
  }

  const totalEncaisse = m.salaire_net + m.notes_frais + m.tickets_resto + m.profit_share_paye + m.cooptation_revenu_paye;

  return `
    <div class="month-row" data-mois="${m.mois}">
      <div class="month-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="month-label">${fmtMonth(m.mois)}</div>
        <div class="month-days">${m.jours_travailles ? `<span class="num">${m.jours_travailles}</span> jours · TJM ${m.tjm}` : ''}</div>
        <div class="month-value"><span class="label">CA facturé</span><span class="amount">${fmtShort(m.facturation)}</span></div>
        <div class="month-value paid"><span class="label">Salaire net</span><span class="amount">${fmtShort(m.salaire_net)}</span></div>
        ${psHeader}
        <div class="month-value total"><span class="label">Total encaissé</span><span class="amount">${fmtShort(totalEncaisse)}</span></div>
        <div class="chevron">›</div>
      </div>
      <div class="month-detail">
        <div class="detail-grid">
          <div class="detail-section">
            <h4>Facturation & charges</h4>
            <div class="detail-line"><span class="desc">CA facturé ${facturation_pill}</span><span class="val">${fmt(m.facturation)}</span></div>
            <div class="detail-line negative"><span class="desc">Commission portage</span><span class="val">− ${fmt(m.commission_portage)}</span></div>
            ${m.charges_diverses > 0 ? `<div class="detail-line negative"><span class="desc">Charges diverses</span><span class="val">− ${fmt(m.charges_diverses)}</span></div>` : ''}
            <div class="detail-line negative"><span class="desc">Charges sociales salaire</span><span class="val">− ${fmt(m.charges_salaire)}</span></div>
            ${m.impot_france > 0 ? `<div class="detail-line negative"><span class="desc">Impôt FR (PAS)</span><span class="val">− ${fmt(m.impot_france)}</span></div>` : ''}
            ${m.charges_profit_share > 0 ? `<div class="detail-line negative"><span class="desc">Charges sur profit share</span><span class="val">− ${fmt(m.charges_profit_share)}</span></div>` : ''}
          </div>
          <div class="detail-section">
            <h4>Revenus perçus par toi</h4>
            ${renderRevenueLine('Salaire net (après PAS)', m.salaire_net, m.details_salaire, true)}
            ${renderRevenueLine('Notes de frais', m.notes_frais, m.details_notes_frais)}
            ${renderRevenueLine('Tickets restaurant', m.tickets_resto, m.details_tickets_resto)}
            ${renderRevenueLine('Cooptation', m.cooptation_revenu, m.details_cooptation)}
            ${renderRevenueLine('Profit share', m.profit_share_total, m.details_profit_share)}
            <div class="detail-line total">
              <span class="desc">Total encaissé ce mois</span>
              <span class="val">${fmt(m.salaire_net + m.notes_frais + m.tickets_resto + m.profit_share_paye + m.cooptation_revenu_paye)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMonthsLists() {
  AGG.years.forEach(year => {
    const target = document.getElementById('months-' + year);
    if (!target) return;
    const months = AGG.months.filter(m => m.mois.endsWith('-' + year)).reverse();
    target.innerHTML = months.map(renderMonth).join('');
  });

  // Mise à jour du header des sections années (affichage conditionnel) :
  // on parcourt toutes les sections [id^="months-YYYY"] présentes dans le DOM
  // et on cache celles dont l'année n'a pas de data.
  document.querySelectorAll('[id^="months-"]').forEach(container => {
    const year = container.id.replace('months-', '');
    const sectionEl = container.closest('.section');
    if (sectionEl) sectionEl.style.display = AGG.years.includes(year) ? 'block' : 'none';
  });

  // Pending zone : profit shares non payés de l'année en cours
  const currentYear = String(new Date().getFullYear());
  const pendingList = document.querySelector('.pending-zone .pending-list');
  if (pendingList) {
    const pendingPS = [];
    AGG.months.forEach(m => {
      if (!m.mois.endsWith('-' + currentYear)) return;
      m.details_profit_share.forEach(ps => {
        if (ps.statut !== 'Payé') pendingPS.push({ mois: m.mois, ...ps });
      });
    });
    if (pendingPS.length > 0) {
      pendingList.innerHTML = pendingPS.map(ps => {
        const [m, y] = ps.mois.split('-');
        return `
          <div class="pending-card">
            <div class="month">${monthNamesFull[parseInt(m)-1]} ${y}</div>
            <div class="row"><span class="l">Profit share</span><span class="v">${fmt(ps.montant)}</span></div>
            <div class="row"><span class="l">Émis le</span><span class="v">${ps.date_emission}</span></div>
            <div class="row"><span class="l">Statut</span><span class="v" style="color: var(--warn)">En attente</span></div>
            <div class="total"><span>À recevoir</span><span class="v">${fmt(ps.montant)}</span></div>
          </div>
        `;
      }).join('');
    } else {
      pendingList.innerHTML = '<div class="pending-card"><div class="month">Aucun profit share en attente</div></div>';
    }
  }
}

// ============================================================
// PROJECTION — rendu
// ============================================================
function renderProjection() {
  const widget = document.getElementById('projection-widget');
  if (!widget) return;

  // Détermine TJM actuel (TJM du dernier mois connu avec CA)
  let tjm = 0;
  for (let i = AGG.months.length - 1; i >= 0; i--) {
    if (AGG.months[i].tjm > 0) { tjm = AGG.months[i].tjm; break; }
  }
  if (tjm === 0) return;

  // Détermine mois actuel et dernière année des données
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Dernier mois avec donnée réelle
  const lastKnownMois = AGG.months[AGG.months.length - 1]?.mois;
  if (!lastKnownMois) return;
  const [lkM, lkY] = lastKnownMois.split('-').map(Number);

  // Projection : du mois qui suit le dernier connu jusqu'à décembre de l'année en cours
  // Si dernier connu est en 2026, projection de 04-2026 à 12-2026
  // On inclut aussi les 2-3 mois passés les plus récents pour contexte
  const projYear = lkY;
  const startMonth = lkM; // on inclut le dernier mois connu comme référence
  const endMonth = 12;

  const overrides = loadProjOverrides();

  // Construction lignes : mois connus (référence) + mois futurs (projetés)
  const rows = [];
  for (let mo = startMonth; mo <= endMonth; mo++) {
    const moisKey = String(mo).padStart(2,'0') + '-' + projYear;
    const isKnown = AGG.monthsByKey[moisKey] !== undefined;
    const jOuvres = joursOuvres(projYear, mo);

    let jours;
    if (isKnown) {
      jours = AGG.monthsByKey[moisKey].jours_travailles;
    } else if (overrides[moisKey] !== undefined) {
      jours = overrides[moisKey];
    } else {
      jours = jOuvres; // défaut = max jours ouvrés
    }

    const proj = projectMonth(projYear, mo, jours, tjm);
    rows.push({
      ...proj,
      moisKey,
      isKnown,
      joursOuvres: jOuvres,
      realData: isKnown ? AGG.monthsByKey[moisKey] : null
    });
  }

  // Rendu du tableau
  const tbody = document.getElementById('projection-tbody');
  tbody.innerHTML = rows.map((r, idx) => {
    const cls = r.isKnown ? 'known' : 'future';
    const monthName = monthNamesFull[r.month - 1];
    const tag = r.isKnown
      ? '<span class="proj-tag done">Réalisé</span>'
      : '<span class="proj-tag future">À venir</span>';

    // Pour mois connu : on affiche les valeurs réelles
    // Pour mois futur : on affiche les valeurs projetées modifiables
    const ca = r.isKnown ? r.realData.facturation : r.ca;
    const sn = r.isKnown ? r.realData.salaire_net : r.salaire_net;
    const ps = r.isKnown ? r.realData.profit_share_total : r.profit_share;
    const tr = r.isKnown ? r.realData.tickets_resto : r.tickets;
    const total = sn + ps + tr;
    const joursAff = r.isKnown ? r.realData.jours_travailles : r.jours;
    const congesAff = Math.max(0, r.joursOuvres - joursAff);

    const joursCell = r.isKnown
      ? `<span>${joursAff}</span>`
      : `<div class="days-input-wrap">
           <input type="number" class="days-input" min="0" max="${r.joursOuvres}" step="0.5" value="${joursAff}" data-mois="${r.moisKey}" />
           <div class="days-steppers">
             <button type="button" class="days-stepper" data-action="up" data-mois="${r.moisKey}" aria-label="Augmenter">
               <svg viewBox="0 0 8 8"><path d="M4 1 L7 6 L1 6 Z"/></svg>
             </button>
             <button type="button" class="days-stepper" data-action="down" data-mois="${r.moisKey}" aria-label="Diminuer">
               <svg viewBox="0 0 8 8"><path d="M4 7 L1 2 L7 2 Z"/></svg>
             </button>
           </div>
         </div>`;

    return `
      <tr class="${cls}">
        <td class="left">
          <span class="mo-label">${monthName}</span><span class="mo-year">${r.year}</span>
          ${tag}
        </td>
        <td>${r.joursOuvres}</td>
        <td class="editable">${joursCell}</td>
        <td>${congesAff}</td>
        <td>${fmtShort(ca)}</td>
        <td>${fmtShort(sn)}</td>
        <td>${fmtShort(ps)}</td>
        <td>${fmtShort(tr)}</td>
        <td><strong>${fmtShort(total)}</strong></td>
      </tr>
    `;
  }).join('');

  // Totaux
  const totals = rows.reduce((acc, r) => {
    const ca = r.isKnown ? r.realData.facturation : r.ca;
    const sn = r.isKnown ? r.realData.salaire_net : r.salaire_net;
    const ps = r.isKnown ? r.realData.profit_share_total : r.profit_share;
    const tr = r.isKnown ? r.realData.tickets_resto : r.tickets;
    const jours = r.isKnown ? r.realData.jours_travailles : r.jours;
    acc.jours += jours;
    acc.joursOuvres += r.joursOuvres;
    acc.conges += Math.max(0, r.joursOuvres - jours);
    acc.ca += ca;
    acc.sn += sn;
    acc.ps += ps;
    acc.tr += tr;
    return acc;
  }, { jours: 0, joursOuvres: 0, conges: 0, ca: 0, sn: 0, ps: 0, tr: 0 });
  totals.total = totals.sn + totals.ps + totals.tr;

  document.getElementById('projection-tfoot').innerHTML = `
    <tr>
      <td class="left">Total ${projYear}</td>
      <td>${totals.joursOuvres}</td>
      <td>${totals.jours}</td>
      <td>${totals.conges}</td>
      <td>${fmtShort(totals.ca)}</td>
      <td>${fmtShort(totals.sn)}</td>
      <td>${fmtShort(totals.ps)}</td>
      <td>${fmtShort(totals.tr)}</td>
      <td class="sum-highlight">${fmtShort(totals.total)}</td>
    </tr>
  `;

  // Summary cards
  const futurRows = rows.filter(r => !r.isKnown);
  const futurTotals = futurRows.reduce((acc, r) => {
    acc.ca += r.ca;
    acc.sn += r.salaire_net;
    acc.ps += r.profit_share;
    acc.tr += r.tickets;
    acc.jours += r.jours;
    return acc;
  }, { ca: 0, sn: 0, ps: 0, tr: 0, jours: 0 });

  document.getElementById('projection-summary').innerHTML = `
    <div class="proj-summary-card">
      <div class="l">À venir · ${futurRows.length} mois</div>
      <div class="v info">${fmtInt(futurTotals.sn + futurTotals.ps + futurTotals.tr)} <span style="font-size: 14px;">€</span></div>
      <div class="sub">Total perçu projeté</div>
    </div>
    <div class="proj-summary-card">
      <div class="l">Salaire net à venir</div>
      <div class="v">${fmtInt(futurTotals.sn)} <span style="font-size: 14px;">€</span></div>
      <div class="sub">${futurRows.length} × 1 964 € env.</div>
    </div>
    <div class="proj-summary-card">
      <div class="l">Profit share à venir</div>
      <div class="v warn">${fmtInt(futurTotals.ps)} <span style="font-size: 14px;">€</span></div>
      <div class="sub">${fmtInt(futurTotals.jours)} jours × ${tjm} €</div>
    </div>
    <div class="proj-summary-card">
      <div class="l">CA à facturer</div>
      <div class="v accent">${fmtInt(futurTotals.ca)} <span style="font-size: 14px;">€</span></div>
      <div class="sub">Total brut ${projYear}</div>
    </div>
  `;

  // Mise à jour du header du widget (total visible quand collapsed)
  document.getElementById('projection-total').innerHTML = `
    <span class="lbl">Total projeté à venir</span>
    <span class="big">${fmtInt(futurTotals.sn + futurTotals.ps + futurTotals.tr)} €</span>
  `;

  // Listener sur les inputs jours
  tbody.querySelectorAll('input.days-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const moisKey = e.target.dataset.mois;
      let v = parseFloat(e.target.value);
      if (isNaN(v) || v < 0) v = 0;
      const max = parseFloat(e.target.max);
      if (v > max) v = max;
      const ov = loadProjOverrides();
      ov[moisKey] = v;
      saveProjOverrides(ov);
      renderProjection();
    });
  });

  // Listener sur les boutons stepper (+ / -)
  tbody.querySelectorAll('.days-stepper').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const moisKey = btn.dataset.mois;
      const action = btn.dataset.action;
      const input = tbody.querySelector(`input.days-input[data-mois="${moisKey}"]`);
      if (!input) return;
      const current = parseFloat(input.value) || 0;
      const max = parseFloat(input.max);
      const step = 0.5;
      let next = action === 'up' ? current + step : current - step;
      if (next < 0) next = 0;
      if (next > max) next = max;
      const ov = loadProjOverrides();
      ov[moisKey] = next;
      saveProjOverrides(ov);
      renderProjection();
    });
  });
}
