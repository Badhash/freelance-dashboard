// ============================================================
// DASHBOARD — rendu des listes mensuelles (onglet "Détail mensuel")
// Cartes profit shares en attente + accordéons mois par mois.
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
  const currentYear = String(new Date().getFullYear());
  AGG.years.forEach(year => {
    const target = document.getElementById('months-' + year);
    if (!target) return;
    const months = AGG.months.filter(m => m.mois.endsWith('-' + year)).reverse();
    target.innerHTML = months.map(renderMonth).join('');
    // Met à jour le year-tag avec le nombre de mois (et statut en cours / clôturé)
    const tag = document.querySelector(`[data-year-tag="${year}"]`);
    if (tag) {
      const n = months.length;
      const enCours = year === currentYear && n < 12;
      tag.textContent = `${n} mois ${enCours ? 'en cours' : 'clôturé' + (n > 1 ? 's' : '')}`;
    }
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
