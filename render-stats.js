// ============================================================
// DASHBOARD — rendu de la section "Statistiques d'activité"
// Lit AGG.totals + AGG.months pour afficher des indicateurs
// d'activité : jours facturés, congés acquis, moyennes…
// ============================================================
function renderActivityStats() {
  if (!AGG) return;
  const t = AGG.totals;
  const months = AGG.months;

  // Jours réellement facturés (somme des jours travaillés sur tous les mois)
  const joursFactures = months.reduce((a, m) => a + (m.jours_travailles || 0), 0);
  // Mois où il y a eu de la facturation (au moins un jour travaillé)
  const moisFactures = months.filter(m => m.jours_travailles > 0).length;
  // Moyenne de jours facturés par mois actif
  const joursParMois = moisFactures ? joursFactures / moisFactures : 0;
  // TJM moyen pondéré = CA total / jours facturés
  const tjmMoyen = joursFactures ? t.ca / joursFactures : 0;

  // Congés payés acquis : 2,5 jours ouvrables par mois travaillé (règle légale FR)
  const congesAcquis = moisFactures * 2.5;
  // Provision congés mise de côté mais pas encore versée
  const provCongesRestante = t.provision_conges_total - t.provision_conges_payee;

  const grid = document.querySelector('.activity-grid');
  if (!grid) return;

  // value : chaîne déjà formatée · unit : suffixe · accent : classe couleur optionnelle
  const tile = (value, unit, label, hint, accent) => `
    <div class="stat-tile${accent ? ' ' + accent : ''}">
      <div class="stat-value">${value}<span class="stat-unit">${unit}</span></div>
      <div class="stat-label">${label}</div>
      ${hint ? `<div class="stat-hint">${hint}</div>` : ''}
    </div>
  `;

  grid.innerHTML = [
    tile(fmtInt(joursFactures), ' j', 'Jours facturés',
      `Sur ${moisFactures} mois d'activité`),
    tile(joursParMois.toFixed(1).replace('.', ','), ' j', 'Jours / mois',
      'Moyenne sur les mois facturés'),
    tile(fmtInt(tjmMoyen), ' €', 'TJM moyen',
      'CA facturé ÷ jours facturés', 'accent'),
    tile(congesAcquis.toFixed(1).replace('.', ','), ' j', 'Congés acquis',
      '2,5 j ouvrables / mois travaillé', 'info'),
    tile(fmtInt(provCongesRestante), ' €', 'Provision congés',
      'Mise de côté · pas encore versée', 'info'),
    tile(fmtInt(t.ca), ' €', 'CA total facturé',
      `${months.length} mois au total`)
  ].join('');
}
