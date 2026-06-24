// ============================================================
// DASHBOARD — rendu de la section "Statistiques d'activité"
// Section repliable. Affiche des indicateurs globaux puis une
// répartition par année et par client (jours, CA, TJM, congés).
// ============================================================
function renderActivityStats() {
  if (!AGG) return;
  const t = AGG.totals;
  const months = AGG.months;
  const byYear = AGG.statsByYear || [];

  // --- Agrégats globaux ---
  const joursFactures = months.reduce((a, m) => a + (m.jours_travailles || 0), 0);
  const moisFactures = months.filter(m => m.jours_travailles > 0).length;
  const joursParMois = moisFactures ? joursFactures / moisFactures : 0;
  const tjmMoyen = joursFactures ? t.ca / joursFactures : 0;
  const congesAcquis = moisFactures * 2.5;           // 2,5 j ouvrables / mois travaillé (FR)
  const provCongesRestante = t.provision_conges_total - t.provision_conges_payee;

  // Total affiché dans l'en-tête repliable
  const headAmount = document.querySelector('.activity-head-total .amount');
  if (headAmount) headAmount.innerHTML = `${fmtInt(joursFactures)}<span class="unit"> j</span>`;

  const dec = (n) => n.toFixed(1).replace('.', ',');

  // value : chaîne déjà formatée · unit : suffixe · accent : classe couleur optionnelle
  const tile = (value, unit, label, hint, accent) => `
    <div class="stat-tile${accent ? ' ' + accent : ''}">
      <div class="stat-value">${value}<span class="stat-unit">${unit}</span></div>
      <div class="stat-label">${label}</div>
      ${hint ? `<div class="stat-hint">${hint}</div>` : ''}
    </div>
  `;

  // --- Tuiles globales ---
  const grid = document.querySelector('.activity-grid');
  if (grid) {
    grid.innerHTML = [
      tile(fmtInt(joursFactures), ' j', 'Jours facturés', `Sur ${moisFactures} mois d'activité`),
      tile(dec(joursParMois), ' j', 'Jours / mois', 'Moyenne sur les mois facturés'),
      tile(fmtInt(tjmMoyen), ' €', 'TJM moyen', 'CA facturé ÷ jours facturés', 'accent'),
      tile(dec(congesAcquis), ' j', 'Congés acquis', '2,5 j ouvrables / mois travaillé', 'info'),
      tile(fmtInt(provCongesRestante), ' €', 'Provision congés', 'Mise de côté · pas encore versée', 'info'),
      tile(fmtInt(t.ca), ' €', 'CA total facturé', `${months.length} mois au total`)
    ].join('');
  }

  // --- Répartition par année / par client ---
  const yearsEl = document.querySelector('.activity-years');
  if (yearsEl) {
    // Années les plus récentes en premier
    const ordered = [...byYear].sort((a, b) => b.year.localeCompare(a.year));
    yearsEl.innerHTML = ordered.map(y => {
      const maxCa = Math.max(1, ...y.clients.map(c => c.ca));
      const clientRows = y.clients.length
        ? y.clients.map(c => `
            <div class="client-row">
              <span class="c-name">${c.client}</span>
              <span class="c-bar"><i style="width:${Math.round((c.ca / maxCa) * 100)}%"></i></span>
              <span class="c-val">${fmtInt(c.jours)} j · ${fmtInt(c.ca)} €</span>
            </div>
          `).join('')
        : '<div class="client-row empty">Aucune facturation client cette année</div>';

      return `
        <div class="year-block">
          <div class="year-block-head">
            <span class="year-name">${y.year}</span>
            <span class="year-meta">${y.moisActifs} mois · ${fmtInt(y.jours)} j facturés</span>
          </div>
          <div class="activity-grid compact">
            ${tile(fmtInt(y.jours), ' j', 'Jours facturés', `${y.moisActifs} mois actifs`)}
            ${tile(fmtInt(y.tjm), ' €', 'TJM moyen', 'CA ÷ jours', 'accent')}
            ${tile(fmtInt(y.ca), ' €', 'CA facturé', "Sur l'année")}
            ${tile(dec(y.congesAcquis), ' j', 'Congés acquis', '2,5 j / mois', 'info')}
          </div>
          <div class="client-split">
            <div class="client-split-title">Répartition par client</div>
            <div class="client-rows">${clientRows}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}
