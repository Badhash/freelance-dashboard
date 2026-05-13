// ============================================================
// DASHBOARD — rendu de l'onglet "Fiscal & Forecast"
// Pilote les 3 scénarios fiscaux, la projection pluriannuelle,
// la simulation auto-entrepreneur 2027, la jauge de risque,
// la deadline pill du header et la checklist modale.
// ============================================================

// Données d'entrée pour une année donnée (règle BNC : encaissement, peu importe l'année d'émission)
function fiscalInputsForYear(year) {
  const t = aggregateRealYear(String(year));
  return {
    year,
    salaireNet: t.salaire_net,
    impotPAS: t.impot_pas,
    profitShareEncaisse: t.ps_encaisse
  };
}

function renderFiscal() {
  const cfg = loadFiscalConfig();
  const yearStr = String(cfg.anneeDeclaration);

  // Synchronise les contrôles de config
  renderFiscalConfig(cfg);

  // Données pour l'année de déclaration choisie
  const inputs = fiscalInputsForYear(yearStr);
  const scen = computeScenarios({
    salaireNet: inputs.salaireNet,
    impotPAS: inputs.impotPAS,
    profitShareEncaisse: inputs.profitShareEncaisse,
    parts: cfg.parts
  });

  // Tag année dans le header de section
  const tag = document.getElementById('fiscal-section-tag');
  if (tag) {
    const deadlineYr = cfg.anneeDeclaration === 2025 ? '04/06/2026' : '~ juin 2027';
    tag.textContent = `Année ${cfg.anneeDeclaration} · Deadline ${deadlineYr}`;
  }

  renderFiscalDeclaration(cfg, inputs, scen);
  renderFiscalTax(cfg, inputs, scen);
  renderFiscalScenarios(cfg, inputs, scen);
  renderForecast(cfg);
  renderRiskGauge(cfg);
}

// ---- Config : binding + state des contrôles
function renderFiscalConfig(cfg) {
  // Scénario actif
  document.querySelectorAll('input[name="fc-scenario"]').forEach(inp => {
    inp.checked = inp.value === cfg.scenarioActif;
    const wrap = inp.closest('.fc-scenario');
    if (wrap) wrap.classList.toggle('active', inp.checked);
  });
  // Statut familial
  const statutSel = document.getElementById('fc-statut');
  if (statutSel) statutSel.value = cfg.statutFamilial;
  // Enfants
  const enfantsInp = document.getElementById('fc-enfants');
  if (enfantsInp) enfantsInp.value = cfg.enfants;
  // Parts (manuel — préséance utilisateur)
  const partsInp = document.getElementById('tax-parts-input');
  if (partsInp) partsInp.value = cfg.parts;
  // Année
  const anneeSel = document.getElementById('fc-annee');
  if (anneeSel) anneeSel.value = String(cfg.anneeDeclaration);
  // Hint sur les parts dérivées
  const hint = document.getElementById('fc-parts-hint');
  if (hint) {
    const derived = computeParts(cfg.statutFamilial, cfg.enfants);
    if (Math.abs(derived - cfg.parts) > 0.01) {
      hint.innerHTML = `Suggestion : ${derived} parts (${cfg.statutFamilial === 'celibataire' ? 'célibataire' : 'couple'} · ${cfg.enfants} enfant${cfg.enfants > 1 ? 's' : ''}). <button type="button" class="fc-mini-btn" id="fc-apply-derived">Appliquer</button>`;
      const btn = document.getElementById('fc-apply-derived');
      if (btn) btn.onclick = () => {
        const c = loadFiscalConfig();
        c.parts = derived;
        saveFiscalConfig(c);
        renderFiscal();
      };
    } else {
      hint.textContent = `${derived} parts dérivées de ta situation`;
    }
  }
}

// ---- 1. Éléments à déclarer
function renderFiscalDeclaration(cfg, inputs, scen) {
  const note = document.getElementById('fiscal-decla-note');
  const grid = document.getElementById('fiscal-grid-declaration');
  if (!grid) return;
  const sa = scen[cfg.scenarioActif];

  if (note) {
    note.innerHTML = ({
      A: `Scénario A — seul le salaire est à déclarer (case 1AJ pré-remplie). Le profit share encaissé en ${cfg.anneeDeclaration} relève de l'exercice comptable ${cfg.anneeDeclaration}-${cfg.anneeDeclaration+1} de la société versante et sera déclaré sur la déclaration ${cfg.anneeDeclaration+2}.`,
      B: `Scénario B — déclaration complète : salaire (1AJ) + profit share étranger en BNC (5XJ) + annexe 2047 + report du crédit d'impôt étranger (8TK) qui neutralise l'IR sur la quote-part.`,
      C: `Scénario C — projection du worst case si l'administration rejette le crédit d'impôt 8TK et requalifie : IR au barème + prélèvements sociaux 17,2 % + pénalités.`
    })[cfg.scenarioActif];
  }

  const bncRow = cfg.scenarioActif === 'A'
    ? `<div class="fiscal-row">
         <div class="label">Profit share étranger encaissé</div>
         <div class="big ok">0 € à déclarer</div>
         <div class="detail">Reporté à l'exercice comptable<br>${cfg.anneeDeclaration}-${cfg.anneeDeclaration+1} · décla. ${cfg.anneeDeclaration+2}<br>Encaissé réel : ${fmtInt(inputs.profitShareEncaisse)} €</div>
       </div>`
    : `<div class="fiscal-row">
         <div class="label">Profit share étranger encaissé</div>
         <div class="big warn">${fmtInt(inputs.profitShareEncaisse)} €</div>
         <div class="detail"><span class="case-ref">5XJ</span>À déclarer en BNC<br>Régime déclaration contrôlée</div>
       </div>`;

  const creditRow = cfg.scenarioActif === 'B'
    ? `<div class="fiscal-row">
         <div class="label">Crédit d'impôt étranger</div>
         <div class="big ok">${fmtInt(scen.B.credit)} €</div>
         <div class="detail"><span class="case-ref">8TK</span>Report depuis annexe 2047<br>Élimine la double imposition</div>
       </div>`
    : cfg.scenarioActif === 'C'
      ? `<div class="fiscal-row">
           <div class="label">Crédit d'impôt étranger</div>
           <div class="big danger">Refusé</div>
           <div class="detail">Hypothèse worst case<br>requalification du montage</div>
         </div>`
      : `<div class="fiscal-row">
           <div class="label">Crédit d'impôt étranger</div>
           <div class="big">—</div>
           <div class="detail">Pas applicable<br>(rien à déclarer cette année)</div>
         </div>`;

  grid.innerHTML = `
    <div class="fiscal-row">
      <div class="label">Salaire imposable ${cfg.anneeDeclaration}</div>
      <div class="big info">${fmtInt(scen.salaireImposable)} €</div>
      <div class="detail"><span class="case-ref">1AJ</span>Pré-rempli par l'employeur<br>Net ${fmtInt(inputs.salaireNet)} € + PAS ${fmtInt(inputs.impotPAS)} €</div>
    </div>
    ${bncRow}
    ${creditRow}
    <div class="fiscal-row">
      <div class="label">PAS déjà prélevé</div>
      <div class="big">${fmtInt(inputs.impotPAS)} €</div>
      <div class="detail">Prélèvement à la source<br>sur salaire ${cfg.anneeDeclaration}</div>
    </div>
  `;
}

// ---- 2. Estimation d'impôt selon scénario
function renderFiscalTax(cfg, inputs, scen) {
  const note = document.getElementById('fiscal-tax-note');
  const grid = document.getElementById('fiscal-grid-tax');
  const breakdown = document.getElementById('tax-breakdown');
  if (!grid) return;
  const sa = scen[cfg.scenarioActif];
  const calc = sa.calc;

  if (note) {
    note.textContent = `Calculé au barème progressif 2025 avec ${cfg.parts} part${cfg.parts > 1 ? 's' : ''}. Bascule entre les scénarios pour comparer.`;
  }

  if (cfg.scenarioActif === 'C') {
    // Worst case : décomposition différente
    grid.innerHTML = `
      <div class="fiscal-row">
        <div class="label">IR supplémentaire</div>
        <div class="big warn">${fmtInt(scen.C.irSupp)} €</div>
        <div class="detail">Différentiel IR avec BNC<br>(sans crédit 8TK)</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Prélèvements sociaux 17,2 %</div>
        <div class="big warn">${fmtInt(scen.C.psSociaux)} €</div>
        <div class="detail">CSG-CRDS + PS<br>sur ${fmtInt(scen.C.bnc)} €</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Pénalités min (bonne foi)</div>
        <div class="big">${fmtInt(scen.C.penalitesMin)} €</div>
        <div class="detail">10 % de l'assiette<br>(${fmtInt(scen.C.sousTotal)} €)</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Pénalités max (fraude)</div>
        <div class="big danger">${fmtInt(scen.C.penalitesMax)} €</div>
        <div class="detail">80 % de l'assiette<br>manœuvres frauduleuses</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Total risque</div>
        <div class="big danger">${fmtInt(scen.C.totalMin)} → ${fmtInt(scen.C.totalMax)} €</div>
        <div class="detail">Provision recommandée<br>${fmtInt(scen.C.provision)} €</div>
      </div>
    `;
  } else {
    const ir = sa.irNet;
    const solde = sa.solde;
    grid.innerHTML = `
      <div class="fiscal-row">
        <div class="label">Revenu imposable total</div>
        <div class="big">${fmtInt(calc.quotient * calc.parts)} €</div>
        <div class="detail">Salaire après abattement 10 %<br>${cfg.scenarioActif === 'B' ? '+ profit share BNC' : 'profit share non déclaré'}</div>
      </div>
      <div class="fiscal-row">
        <div class="label">IR brut</div>
        <div class="big ${cfg.scenarioActif === 'B' ? 'warn' : ''}">${fmtInt(sa.irBrut)} €</div>
        <div class="detail">TMI ${(calc.tmi * 100).toFixed(0)} %<br>Quotient ${fmtInt(calc.quotient)} € / part</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Crédit d'impôt</div>
        <div class="big ${sa.credit > 0 ? 'ok' : ''}">${sa.credit > 0 ? '− ' + fmtInt(sa.credit) + ' €' : '—'}</div>
        <div class="detail">${sa.credit > 0 ? 'Part d\'IR imputable<br>au profit share étranger' : 'Pas applicable'}</div>
      </div>
      <div class="fiscal-row">
        <div class="label">IR net à payer</div>
        <div class="big ${ir > 0 ? 'warn' : 'ok'}">${fmtInt(ir)} €</div>
        <div class="detail">${cfg.scenarioActif === 'A' ? 'IR sur salaire seul' : 'Après crédit 8TK'}</div>
      </div>
      <div class="fiscal-row">
        <div class="label">Solde après PAS</div>
        <div class="big ${solde > 0 ? 'warn' : 'ok'}">${solde >= 0 ? '' : '+'}${fmtInt(Math.abs(solde))} €</div>
        <div class="detail">${solde >= 0 ? 'Reste à payer en sept.' : 'Remboursement attendu'}<br>Après prélèvements à la source</div>
      </div>
    `;
  }

  // Breakdown des tranches (sur le calcul retenu)
  if (breakdown) {
    const tranches = calc.tranches;
    const fmtRange = (t) => {
      if (t.to === Infinity) return `> ${fmtInt(t.from)} €`;
      if (t.from === 0) return `≤ ${fmtInt(t.to)} €`;
      return `${fmtInt(t.from)} → ${fmtInt(t.to)} €`;
    };
    breakdown.innerHTML = `
      <div class="tax-breakdown-title">Décomposition par tranches — quotient ${fmtInt(calc.quotient)} € × ${cfg.parts} part${cfg.parts > 1 ? 's' : ''}</div>
      <div class="tax-tranches">
        ${tranches.map(t => `
          <div class="tax-tranche ${t.active ? 'active' : ''}">
            <span class="tb-range">${fmtRange(t)}</span>
            <span class="tb-rate">${(t.rate * 100).toFixed(0)} %</span>
            <span class="tb-base">${t.base > 0 ? fmtInt(t.base) + ' €' : '—'}</span>
            <span class="tb-tax">${t.tax > 0 ? fmtInt(t.tax * cfg.parts) + ' €' : '—'}</span>
          </div>
        `).join('')}
        <div class="tax-tranche total">
          <span class="tb-range">Total IR brut</span>
          <span class="tb-rate">TMI ${(calc.tmi * 100).toFixed(0)} %</span>
          <span class="tb-base"></span>
          <span class="tb-tax">${fmtInt(sa.irBrut)} €</span>
        </div>
      </div>
    `;
  }
}

// ---- 3. Comparaison des 3 scénarios (cards résumées)
function renderFiscalScenarios(cfg, inputs, scen) {
  const wrap = document.getElementById('scenario-cards');
  if (!wrap) return;

  const card = (key) => {
    const s = scen[key];
    const isActive = cfg.scenarioActif === key;
    let bigVal, bigCls, lines;
    if (key === 'A') {
      bigVal = fmtInt(s.solde) + ' €';
      bigCls = s.solde > 0 ? 'warn' : 'ok';
      lines = [
        ['BNC déclaré', '0 €'],
        ['IR sur salaire seul', fmtInt(s.irNet) + ' €'],
        ['Risque', 'Moyen · valider avec avocat'],
        ['Documents requis', 'Attestation comptable · relevés bancaires']
      ];
    } else if (key === 'B') {
      bigVal = fmtInt(s.solde) + ' €';
      bigCls = s.solde > 0 ? 'warn' : 'ok';
      lines = [
        ['BNC déclaré', fmtInt(s.bnc) + ' €'],
        ['Crédit 8TK', '− ' + fmtInt(s.credit) + ' €'],
        ['Risque', 'Faible si note du cabinet fiscaliste'],
        ['Cases', '1AJ · 5XJ · 2047 · 8TK']
      ];
    } else {
      bigVal = fmtInt(s.totalMin) + ' → ' + fmtInt(s.totalMax) + ' €';
      bigCls = 'danger';
      lines = [
        ['IR supplémentaire', fmtInt(s.irSupp) + ' €'],
        ['PS 17,2 %', fmtInt(s.psSociaux) + ' €'],
        ['Pénalités', fmtInt(s.penalitesMin) + ' → ' + fmtInt(s.penalitesMax) + ' €'],
        ['Provision', fmtInt(s.provision) + ' €']
      ];
    }
    return `
      <div class="scenario-card ${isActive ? 'active' : ''}" data-sc="${key}">
        <div class="sc-head">
          <span class="sc-tag">Scénario ${key}</span>
          ${isActive ? '<span class="sc-pin">actif</span>' : ''}
        </div>
        <div class="sc-title">${s.label}</div>
        <div class="sc-big ${bigCls}">${bigVal}</div>
        <div class="sc-sub">${key === 'C' ? 'Coût total estimé du redressement' : 'Solde IR à payer après PAS'}</div>
        <div class="sc-lines">
          ${lines.map(([l, v]) => `<div class="sc-line"><span>${l}</span><span class="v">${v}</span></div>`).join('')}
        </div>
        ${isActive ? '' : `<button type="button" class="sc-activate" data-sc-activate="${key}">Activer ce scénario</button>`}
      </div>
    `;
  };

  wrap.innerHTML = ['A', 'B', 'C'].map(card).join('');

  wrap.querySelectorAll('[data-sc-activate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = loadFiscalConfig();
      c.scenarioActif = btn.dataset.scActivate;
      saveFiscalConfig(c);
      renderFiscal();
    });
  });
}

// ============================================================
// FORECAST PLURIANNUEL — 2025 / 2026 / 2027 AE
// ============================================================
function renderForecast(cfg) {
  const tbody = document.getElementById('forecast-tbody');
  const notesEl = document.getElementById('forecast-notes');
  if (!tbody) return;

  // TJM actuel pour projeter 2026
  let tjm = 0;
  for (let i = AGG.months.length - 1; i >= 0; i--) {
    if (AGG.months[i].tjm > 0) { tjm = AGG.months[i].tjm; break; }
  }

  // Année 2025 — données réelles
  const real2025 = aggregateRealYear('2025');
  const inp2025 = fiscalInputsForYear('2025');
  const scen2025 = computeScenarios({
    salaireNet: inp2025.salaireNet,
    impotPAS: inp2025.impotPAS,
    profitShareEncaisse: inp2025.profitShareEncaisse,
    parts: cfg.parts
  });

  // Année 2026 — réel + projeté
  const real2026 = aggregateRealYear('2026');
  const proj2026 = projectYearFromNow(2026, tjm);
  const inp2026 = {
    year: '2026',
    salaireNet: real2026.salaire_net + proj2026.salaire_net,
    impotPAS: real2026.impot_pas, // pas de PAS projeté futur (inconnu) — borne basse
    profitShareEncaisse: real2026.ps_encaisse + proj2026.ps_encaisse
  };
  const scen2026 = computeScenarios({
    salaireNet: inp2026.salaireNet,
    impotPAS: inp2026.impotPAS,
    profitShareEncaisse: inp2026.profitShareEncaisse,
    parts: cfg.parts
  });

  // Année 2027 — auto-entrepreneur (paramétrable)
  const aeCfg = loadAEConfig();
  const ae = forecastAE(2027, aeCfg.tjm, aeCfg.jours);

  // Trésorerie projetée fin d'année = somme cumulée des encaissements nets - charges
  const treso2025 = real2025.salaire_net + real2025.ps_encaisse;
  const treso2026 = inp2026.salaireNet + inp2026.profitShareEncaisse;
  const irAE = aeCfg.optionFiscale === 'vl' ? ae.ir_vl : calculIR(ae.baseProgressive, cfg.parts).ir_total;
  const treso2027 = ae.ca_ht - ae.urssaf - ae.cfe - irAE;

  const sA = scen2025[cfg.scenarioActif];
  const sB = scen2026[cfg.scenarioActif];

  const rows = [
    ['CA / facturation HT',           fmtInt(real2025.ca),                                fmtInt(real2026.ca + proj2026.ca),                                 fmtInt(ae.ca_ht)],
    ['Salaire net annuel',            fmtInt(real2025.salaire_net),                       fmtInt(inp2026.salaireNet),                                        '—'],
    ['Profit share généré',           fmtInt(real2025.ps_emis),                           fmtInt(real2026.ps_emis + proj2026.ps_emis),                       '—'],
    ['Profit share encaissé',         fmtInt(real2025.ps_encaisse),                       fmtInt(inp2026.profitShareEncaisse),                               '—'],
    ['BNC à déclarer (scénario ' + cfg.scenarioActif + ')', fmtInt(sA.bnc || 0),          fmtInt(sB.bnc || 0),                                               '—'],
    ['IR estimé',                     fmtInt(cfg.scenarioActif === 'C' ? scen2025.C.totalMin : sA.irNet || sA.irBrut), fmtInt(cfg.scenarioActif === 'C' ? scen2026.C.totalMin : sB.irNet || sB.irBrut), fmtInt(irAE)],
    ['Trésorerie estimée',            fmtInt(treso2025),                                  fmtInt(treso2026),                                                 fmtInt(treso2027)]
  ];

  tbody.innerHTML = rows.map(([label, c25, c26, c27]) => `
    <tr>
      <td class="left">${label}</td>
      <td>${c25}</td>
      <td>${c26}</td>
      <td>${c27}</td>
    </tr>
  `).join('');

  if (notesEl) {
    const notes = [
      '<strong>2025</strong> — données réelles importées · scénario ' + cfg.scenarioActif + ' appliqué.',
      `<strong>2026</strong> — ${real2026.mois_connus} mois réel${real2026.mois_connus > 1 ? 's' : ''} + projection à TJM ${fmtInt(tjm)} € sur les mois restants.`,
      ae.seuilDepasse
        ? `<strong>2027 (AE)</strong> — <span style="color: var(--warn)">CA prévu ${fmtInt(ae.ca_ht)} € &gt; seuil micro-BNC 77 700 €</span> · risque de bascule régime réel.`
        : `<strong>2027 (AE)</strong> — Régime micro-BNC (CA &lt; 77 700 €) · option fiscale : ${aeCfg.optionFiscale === 'vl' ? 'versement libératoire 2,2 %' : 'barème progressif après abattement 34 %'}.`
    ];
    notesEl.innerHTML = '<ul>' + notes.map(n => '<li>' + n + '</li>').join('') + '</ul>';
  }

  // Rendu détaillé de la simulation AE
  renderAEDetails(ae, aeCfg, irAE);
}

function renderAEDetails(ae, aeCfg, irAE) {
  const grid = document.getElementById('ae-grid');
  if (!grid) return;
  const tjmInp = document.getElementById('ae-tjm');
  const joursInp = document.getElementById('ae-jours');
  const optSel = document.getElementById('ae-option');
  if (tjmInp) tjmInp.value = aeCfg.tjm;
  if (joursInp) joursInp.value = aeCfg.jours;
  if (optSel) optSel.value = aeCfg.optionFiscale;

  const netFinal = ae.ca_ht - ae.urssaf - ae.cfe - irAE;
  grid.innerHTML = `
    <div class="fiscal-row">
      <div class="label">CA HT prévisionnel</div>
      <div class="big info">${fmtInt(ae.ca_ht)} €</div>
      <div class="detail">${ae.jours} jours × ${fmtInt(ae.tjm)} €<br>${ae.seuilDepasse ? '<span style="color:var(--warn)">⚠ Au-delà du seuil micro</span>' : 'Sous le seuil micro-BNC'}</div>
    </div>
    <div class="fiscal-row">
      <div class="label">URSSAF 22,2 %</div>
      <div class="big warn">− ${fmtInt(ae.urssaf)} €</div>
      <div class="detail">Cotisations<br>professions libérales BNC</div>
    </div>
    <div class="fiscal-row">
      <div class="label">CFE forfaitaire</div>
      <div class="big warn">− ${fmtInt(ae.cfe)} €</div>
      <div class="detail">Cotisation foncière<br>des entreprises</div>
    </div>
    <div class="fiscal-row">
      <div class="label">IR ${aeCfg.optionFiscale === 'vl' ? '(VL 2,2 %)' : '(barème, abat. 34 %)'}</div>
      <div class="big warn">− ${fmtInt(irAE)} €</div>
      <div class="detail">${aeCfg.optionFiscale === 'vl' ? 'Versement libératoire' : 'Base imposable ' + fmtInt(ae.baseProgressive) + ' €'}</div>
    </div>
    <div class="fiscal-row">
      <div class="label">Net après charges &amp; IR</div>
      <div class="big ok">${fmtInt(netFinal)} €</div>
      <div class="detail">Taux net effectif<br>${((netFinal / ae.ca_ht) * 100).toFixed(0)} % du CA</div>
    </div>
  `;
}

// ============================================================
// JAUGE DE RISQUE — adaptée au scénario actif
// ============================================================
function renderRiskGauge(cfg) {
  const marker = document.getElementById('risk-marker');
  const sub = document.getElementById('risk-gauge-sub');
  const grid = document.getElementById('risk-grid');
  if (!marker || !grid) return;

  const profile = {
    A: { pos: 45, why: 'Position défendable mais non testée · attribution comptable par exercice étranger', mit: 'Attestation du portage + traçabilité bancaire', action: 'Faire valider la position par un avocat fiscaliste avant la deadline' },
    B: { pos: 30, why: 'Méthode historique du cabinet fiscaliste · structure connue', mit: 'Note juridique 2025 dédiée + déclaration dans les délais', action: 'Obtenir la note du cabinet fiscaliste 2025 auprès du portage' },
    C: { pos: 80, why: 'Hypothèse d\'un rejet du crédit 8TK · scénario worst case', mit: 'Provision pré-constituée + dossier juridique complet', action: 'Provisionner 20-25 k€ jusqu\'à validation' }
  };
  const p = profile[cfg.scenarioActif];
  marker.style.left = p.pos + '%';
  if (sub) sub.textContent = `Évaluation du risque pour le scénario ${cfg.scenarioActif} — ${cfg.scenarioActif === 'C' ? 'simulation' : 'projection'} basée sur ta config actuelle.`;
  grid.innerHTML = `
    <div>
      <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">Pourquoi ce niveau</div>
      <div style="font-size: 13px; color: var(--text-dim); line-height: 1.5;">${p.why}</div>
    </div>
    <div>
      <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">Facteur atténuant</div>
      <div style="font-size: 13px; color: var(--text-dim); line-height: 1.5;">${p.mit}</div>
    </div>
    <div>
      <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">Action prioritaire</div>
      <div style="font-size: 13px; color: var(--text-dim); line-height: 1.5;">${p.action}</div>
    </div>
  `;
}

// ============================================================
// DEADLINE FISCALE — badge header + ouverture checklist
// ============================================================
function renderDeadline() {
  const pill = document.getElementById('header-deadline');
  if (!pill) return;
  const info = deadlineInfo();
  if (info.jours == null) { pill.style.display = 'none'; return; }
  pill.style.display = 'inline-flex';
  pill.dataset.niveau = info.niveau;
  pill.innerHTML = `
    <span class="dp-jours">${info.jours} j</span>
    <span class="dp-lbl">avant deadline ${info.anneeRevenus}</span>
  `;
  if (!pill.dataset.bound) {
    pill.dataset.bound = '1';
    pill.addEventListener('click', openChecklist);
  }
}

// ============================================================
// CHECKLIST MODAL
// ============================================================
function openChecklist() {
  const modal = document.getElementById('checklist-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderChecklist();
}
function closeChecklist() {
  const modal = document.getElementById('checklist-modal');
  if (modal) modal.style.display = 'none';
}
function renderChecklist() {
  const cfg = loadFiscalConfig();
  const state = loadChecklist();
  const items = defaultChecklist().filter(it => it.scenarios.includes(cfg.scenarioActif));
  const info = deadlineInfo();

  const sub = document.getElementById('checklist-sub');
  if (sub) {
    sub.innerHTML = info.jours != null
      ? `Scénario <strong>${cfg.scenarioActif}</strong> · ${info.jours} jours avant la deadline déclaration ${info.anneeRevenus}`
      : `Scénario <strong>${cfg.scenarioActif}</strong>`;
  }

  const done = items.filter(it => state[it.id]).length;
  const summary = document.getElementById('checklist-summary');
  if (summary) {
    summary.innerHTML = `
      <div class="audit-stat"><span class="num">${done}/${items.length}</span><span class="lbl">actions complétées</span></div>
      <div class="audit-stat"><span class="num" style="color:${info.niveau === 'red' ? 'var(--danger)' : info.niveau === 'amber' ? 'var(--warn)' : 'var(--ok)'}">${info.jours != null ? info.jours + ' j' : '—'}</span><span class="lbl">avant deadline</span></div>
    `;
  }

  const list = document.getElementById('checklist-list');
  if (list) {
    list.innerHTML = items.map(it => `
      <label class="checklist-row ${state[it.id] ? 'done' : ''}">
        <input type="checkbox" data-cl-id="${it.id}" ${state[it.id] ? 'checked' : ''} />
        <span class="cl-label">${it.label}</span>
      </label>
    `).join('');
    list.querySelectorAll('input[data-cl-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const s = loadChecklist();
        s[cb.dataset.clId] = cb.checked;
        saveChecklist(s);
        renderChecklist();
      });
    });
  }
}
