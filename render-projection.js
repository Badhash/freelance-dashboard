// ============================================================
// DASHBOARD — rendu de la projection éditable mois par mois
// Tableau "Projection jusqu'à fin d'année" dans l'onglet Détail mensuel.
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

  // Dernier mois "réalisé" = dernier mois ayant une facturation > 0.
  // Les mois sans CA (ex : avril 2026 avec uniquement de la cooptation) restent projetables.
  let lastBilledIdx = -1;
  for (let i = AGG.months.length - 1; i >= 0; i--) {
    if (AGG.months[i].facturation > 0) { lastBilledIdx = i; break; }
  }
  const lastBilledMois = lastBilledIdx >= 0 ? AGG.months[lastBilledIdx].mois : AGG.months[AGG.months.length - 1]?.mois;
  if (!lastBilledMois) return;
  const [lkM, lkY] = lastBilledMois.split('-').map(Number);

  // Projection : du dernier mois facturé jusqu'à décembre de l'année en cours.
  const projYear = lkY;
  const startMonth = lkM;
  const endMonth = 12;

  const overrides = loadProjOverrides();

  // Construction lignes : mois facturés (figés) + mois projetables (avec ou sans data partielle)
  const rows = [];
  for (let mo = startMonth; mo <= endMonth; mo++) {
    const moisKey = String(mo).padStart(2,'0') + '-' + projYear;
    const realMonth = AGG.monthsByKey[moisKey];
    // "Réalisé" = mois avec CA facturé. Cooptation seule ou frais seuls n'empêchent pas la projection.
    const isKnown = realMonth !== undefined && realMonth.facturation > 0;
    const jOuvres = joursOuvres(projYear, mo);

    let jours;
    if (isKnown) {
      jours = realMonth.jours_travailles;
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
      realData: realMonth || null
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
      <div class="sub">${futurRows.length} × ${fmtInt(PROJ_COEFFS.salaire_net_fixe)} € env.</div>
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
