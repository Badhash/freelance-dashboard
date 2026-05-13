// ============================================================
// DASHBOARD — rendu du widget solde de compte
// Lit AGG.totals + AGG.months pour remplir l'encart en haut de page.
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
  const provCongesPerMois = provCongesMois ? t.provision_conges_total / provCongesMois : 0;
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
            <span class="line-hint">${provCongesMois} mois × ${fmtInt(provCongesPerMois)} € · jamais versés</span>
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
