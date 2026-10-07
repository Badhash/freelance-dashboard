// ============================================================
// AURORA — héros « Ton portage te doit », prochains versements (escalier),
// détail du solde (créances, provisions, cascade et grand livre).
// Points de montage : #hero, #arrivals, #balance-widget. Lit VM (render.js).
// ============================================================

function renderBalanceWidget() {
  renderHero();
  renderArrivals();
  renderSoldeDetail();
}

// Composition du total dû : la couleur suit la NATURE de l'argent.
function heroSegments() {
  return [
    { label: 'Profit shares en attente', v: VM.psSum, c: 'var(--c-ps)' },
    { label: 'Provision congés', v: VM.provRest, c: 'var(--c-sal)' },
    { label: 'Cooptation', v: VM.coopRest, c: 'var(--c-extra)' }
  ].filter((s) => s.v > 0.005);
}

function whenTxt(left) {
  if (left == null) return '';
  return left > 1 ? `dans ${left} jours` : left === 1 ? 'demain' : left === 0 ? 'aujourd’hui' : `en retard de ${-left} j`;
}

function renderHero() {
  const el = document.getElementById('hero');
  const segs = heroSegments();
  const total = VM.soldeFacture;
  const next = VM.arrivals.find((a) => a.eta);
  const lastEta = VM.arrivals.filter((a) => a.eta).slice(-1)[0];
  const note = next
    ? `Prochain versement : <b>${UI.eur0(next.montant)} vers le ${UI.dShort(next.eta)}</b>, ${whenTxt(next.left)}.${lastEta && lastEta !== next ? ` Les profit shares déjà émis devraient tous être arrivés vers le ${UI.endDot(UI.dShort(lastEta.eta))}` : ''}`
    : 'Aucun profit share en attente : tout ce qui a été émis t’a été versé.';
  el.innerHTML = `
    <span class="hero-noise" aria-hidden="true"></span><span class="edge" aria-hidden="true"></span>
    <div class="hero-top">
      <span class="eyebrow"><span class="live-dot" aria-hidden="true"></span>Total à récupérer<span class="hide-s"> · solde sur facturé</span></span>
      <span class="chip">${icon('calendar')}Au ${UI.dLong(VM.today)}</span>
    </div>
    <h1 class="hero-title" id="hero-title">Ton portage te doit</h1>
    <p class="hero-amount" aria-labelledby="hero-title hero-amount-sr"><span aria-hidden="true">${UI.money(total, true)}</span><span class="sr-only" id="hero-amount-sr">${UI.eur2(total)}</span></p>
    <p class="hero-note">${note}</p>
    ${segs.length ? `<div class="hero-split">
      ${UI.splitBar(segs, 'Composition du total à récupérer')}
      ${UI.legendList(segs, total)}
    </div>` : ''}
    <div class="hero-solde">
      <span class="ic-tile">${icon('wallet')}</span>
      <span class="hs-text"><span class="hs-l">Déjà sur ton compte de portage</span><span class="hs-h">Solde sur encaissé : reçu par ton portage, pas encore reversé</span></span>
      <span class="hs-v tab">${UI.money(VM.soldeEncaisse, true)}</span>
      <button class="text-link hs-link" type="button" data-act="open-solde">Voir le calcul${icon('arrowRight')}</button>
    </div>`;
  UI.bindSplit(el, segs, total, 'Total à récupérer');
}

// ---------------------------------------------------------------- prochains versements
function renderArrivals() {
  const el = document.getElementById('arrivals');
  const items = VM.arrivals.filter((a) => a.eta);
  const tot = UI.sum(items, 'montant');
  const last = items[items.length - 1];
  const next = items[0];
  const ghost = VM.ghosts[VM.ghosts.length - 1];
  el.innerHTML = `
    <header class="card-head">
      <span class="ic-tile">${icon('calendarClock')}</span>
      <div class="grow"><h2 class="h3">Prochains versements</h2><p>Profit shares en attente, cumulés à leur date estimée</p></div>
    </header>
    ${items.length ? `
      <div class="arr-big"><span class="v tab">${UI.money(tot)}</span><span class="t">attendus d’ici le ${UI.dShort(last.eta)}</span></div>
      <div class="arr-next">${icon('arrowDown')}<span>Prochain : <b>${UI.eur0(next.montant)}</b> · profit share ${UI.MF[UI.mk(next.mois).m - 1].toLowerCase()} · vers le ${UI.dShort(next.eta)}</span><span class="pill accent">${icon('clock')}${next.left > 0 ? 'J−' + next.left : whenTxt(next.left)}</span></div>
      <div class="chart" id="chart-arrivals"></div>
      <p class="card-foot">${icon('info')}<span>Date estimée = émission + délai médian constaté (${VM.med} j sur ${AGG.delaisPS.count} profit shares payés).${ghost ? ` Le profit share de ${UI.monthLower(ghost.mois)}, pas encore émis, n’y figure pas.` : ''}</span></p>`
    : `<div class="arr-big"><span class="v">0${UI.NB}€</span><span class="t">rien en attente</span></div><p class="card-foot">${icon('check')}<span>Tous les profit shares émis t’ont été versés.</span></p>`}`;
  if (items.length) UI.chart('arrivals', drawArrivals);
}

function drawArrivals() {
  const el = document.getElementById('chart-arrivals');
  if (!el) return;
  const items = VM.arrivals.filter((a) => a.eta);
  el.innerHTML = '';
  const W = Math.max(260, el.clientWidth);
  const H = Math.max(W < 480 ? 196 : 206, Math.min(330, el.clientHeight || 0));
  const P = { l: 46, r: 14, t: 46, b: 28 };
  const t0 = VM.today.getTime();
  const lastEta = Math.max(t0 + 30 * UI.DAY, ...items.map((a) => a.eta.getTime()));
  const le = new Date(lastEta);
  const t1 = Math.max(new Date(le.getFullYear(), le.getMonth() + 1, 0).getTime(), lastEta + 10 * UI.DAY);
  const total = UI.sum(items, 'montant');
  const { top, ticks } = UI.scaleY(total, 3);
  const x = (t) => P.l + (t - t0) / (t1 - t0) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const gid = UI.uid('arr');
  let g = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-ps);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--c-ps);stop-opacity:0"/></linearGradient></defs>`;
  g += `<g class="g-grid">${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>`;
  g += ticks.map((v) => `<text class="g-tick" x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${UI.esc(UI.kEur(v))}</text>`).join('');
  const d0 = new Date(t0);
  for (let mth = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); mth.getTime() <= t1; mth = new Date(mth.getFullYear(), mth.getMonth() + 1, 1)) {
    const xx = x(mth.getTime());
    if (xx > W - P.r - 14) continue;
    g += `<line class="g-axis" x1="${xx}" x2="${xx}" y1="${H - P.b}" y2="${H - P.b + 5}"/>`;
    g += `<text class="g-tick" x="${xx}" y="${H - 8}" text-anchor="middle">${UI.MS[mth.getMonth()]}</text>`;
  }
  g += `<line class="g-today" x1="${x(t0)}" x2="${x(t0)}" y1="${P.t - 14}" y2="${H - P.b}"/>`;
  g += `<text class="g-sub" x="${x(t0) + 6}" y="${P.t - 18}">Aujourd’hui</text>`;
  let cum = 0;
  let d = `M${x(t0)},${y(0)}`;
  const pts = [];
  items.forEach((a) => { d += `H${x(a.eta.getTime())}`; cum += a.montant; d += `V${y(cum)}`; pts.push({ a, cx: x(a.eta.getTime()), cy: y(cum), cum }); });
  d += `H${x(t1)}`;
  g += `<path d="${d}V${y(0)}H${x(t0)}Z" style="fill:url(#${gid})"/>`;
  g += `<path class="g-line g-draw" d="${d}" style="stroke:var(--c-ps)"/>`;
  g += `<line class="g-axis" x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  pts.forEach((p, i) => {
    let anchor = 'middle', lx = p.cx;
    if (p.cx - 36 < P.l) { anchor = 'start'; lx = p.cx - 6; }
    if (p.cx + 36 > W) { anchor = 'end'; lx = p.cx + 6; }
    g += `<text class="g-sub halo" x="${lx}" y="${p.cy - 28}" text-anchor="${anchor}">${UI.esc(UI.dShort(p.a.eta))}</text>`;
    g += `<text class="g-lbl halo" x="${lx}" y="${p.cy - 12}" text-anchor="${anchor}">+${UI.esc(UI.eur0(p.a.montant))}</text>`;
    g += `<circle class="g-dot" cx="${p.cx}" cy="${p.cy}" r="5" style="fill:var(--c-ps)"/>`;
    g += `<rect class="g-hit" data-i="${i}" x="${p.cx - 18}" y="${p.cy - 18}" width="36" height="36" rx="10" tabindex="0" aria-label="${UI.esc(`Profit share ${UI.monthLower(p.a.mois)} : ${UI.eur2(p.a.montant)}, attendu vers le ${UI.dLong(p.a.eta)}`)}"/>`;
    g += `<circle class="g-focus" cx="${p.cx}" cy="${p.cy}" r="10"/>`;
  });
  el.innerHTML = UI.svg(W, H, g, `Profit shares attendus : ${UI.eur0(total)} cumulés d’ici le ${UI.dShort(new Date(lastEta))}`)
    + UI.srTable('Prochains versements estimés', ['Profit share', 'Montant', 'Date estimée', 'Cumul'], pts.map((p) => [UI.monthLabel(p.a.mois), UI.eur2(p.a.montant), UI.dLong(p.a.eta), UI.eur0(p.cum)]));
  UI.$$('.g-hit', el).forEach((h) => {
    const p = pts[+h.dataset.i];
    UI.bindTip(h, () => UI.ttTitle(`Vers le ${UI.dLong(p.a.eta)} (estimé)`) + `<div class="tt-big">+${UI.esc(UI.eur2(p.a.montant))}</div>`
      + UI.ttRow('', 'Profit share', UI.monthLabel(p.a.mois)) + UI.ttRow('', 'Émis le', p.a.date_emission) + UI.ttRow('var(--c-ps)', 'Cumul', UI.eur0(p.cum)));
  });
}

// ---------------------------------------------------------------- détail du solde
function renderSoldeDetail() {
  const host = document.getElementById('balance-widget');
  const wasOpen = host.classList.contains('is-open');
  const ledgerOpen = !!(document.getElementById('ledger-body') && document.getElementById('ledger-body').classList.contains('is-open'));
  const t = VM.t;
  const provSub = VM.provRest + VM.coopRest;
  const recv = VM.arrivals.map((a) => `<li class="line"><span class="l"><span class="n">Profit share ${UI.monthLower(a.mois)}</span><span class="h">Émis le ${UI.esc(a.date_emission)}${a.eta ? ` · attendu vers le ${UI.dShort(a.eta)}` : ''}</span></span><span class="v">${UI.eur2(a.montant)}</span></li>`).join('')
    || '<li class="line"><span class="l"><span class="n">Aucun profit share en attente</span></span></li>';
  let adv = '';
  if (VM.provRest > 0) adv += `<li class="line"><span class="l"><span class="n">Provision congés payés</span><span class="h">${VM.provMois} mois × ${UI.eur0(VM.provPer)} · jamais versée, à récupérer à la sortie ou lors d’une prise de congés</span></span><span class="v">${UI.eur2(VM.provRest)}</span></li>`;
  VM.coopPending.forEach((c) => { adv += `<li class="line"><span class="l"><span class="n">Cooptation</span><span class="h">${UI.monthLabel(c.mois)} · en attente</span></span><span class="v">${UI.eur2(c.montant)}</span></li>`; });
  if (!adv) adv = '<li class="line"><span class="l"><span class="n">Aucune créance en attente</span></span></li>';
  const lrow = (k, v, sign) => `<div class="lrow"><span>${UI.esc(k)}</span><span>${UI.signed2(v, sign)}</span></div>`;
  host.innerHTML = `
    <button class="fold-head" type="button" id="solde-toggle" ${UI.toggleAttrs('solde-body', wasOpen)}>
      <span class="ic-tile">${icon('receipt')}</span>
      <span class="fh-t"><span class="fold-title">Détail du solde</span><span class="fold-sub">D’où viennent les ${UI.eur2(VM.soldeFacture)} qu’on te doit et les ${UI.eur2(VM.soldeEncaisse)} sur ton compte</span></span>
      <span class="fold-sums" aria-hidden="true">
        <span class="sum-chip"><span class="sw" style="background:var(--c-ps)"></span>En attente <b>${UI.eur0(VM.psSum)}</b></span>
        <span class="sum-chip"><span class="sw" style="background:var(--c-sal)"></span>Provisions<span class="hide-s"> et créances</span> <b>${UI.eur0(provSub)}</b></span>
        <span class="sum-chip"><span class="sw" style="background:var(--c-ink)"></span>Sur encaissé <b>${UI.eur0(VM.soldeEncaisse)}</b></span>
      </span>
      <span class="chev">${icon('chevron')}</span>
    </button>
    <div class="fold-body${wasOpen ? ' is-open' : ''}" id="solde-body" role="region" aria-labelledby="solde-toggle"><div><div class="fold-inner">
      <div class="solde-grid">
        <div class="sub-card">
          <div class="sub-head"><h3><span class="sw" style="background:var(--c-ps)"></span>Ils te paieront plus tard</h3><span class="chip">Délai médian ${VM.med} j</span></div>
          <div class="sub-total tab">${UI.eur2(VM.psSum)}</div>
          <ul class="lines">${recv}</ul>
        </div>
        <div class="sub-card">
          <div class="sub-head"><h3><span class="sw" style="background:var(--c-sal)"></span>Provisions et autres créances</h3></div>
          <div class="sub-total tab">${UI.eur2(provSub)}</div>
          <ul class="lines">${adv}</ul>
        </div>
        <p class="equation"><span class="eq"><b>${UI.eur2(VM.psSum)}</b> en attente + <b>${UI.eur2(provSub)}</b> de provisions et créances</span><span class="res">= <span class="ledger-total">${UI.eur2(VM.soldeFacture)}</span></span></p>
      </div>
      <div class="ledger">
        <div class="ledger-head">
          <div><h3>Calcul du solde sur encaissé</h3><p>Ce qui est entré sur ton compte de portage, moins ce qui en est sorti.</p></div>
          <button class="link-btn" type="button" id="ledger-toggle" ${UI.toggleAttrs('ledger-body', ledgerOpen)}>${icon('table')}Détail ligne à ligne${icon('chevron')}</button>
        </div>
        <div class="wf" id="wf"></div>
        <div class="fold-body${ledgerOpen ? ' is-open' : ''}" id="ledger-body"><div>
          <div class="ledger-cols">
            <div class="lcol"><h4><span class="sw" style="background:var(--c-ink)"></span>Entrées sur le compte</h4>
              ${lrow('Facturation client payée', t.ca_paye, '+')}${lrow('Cooptation encaissée', t.cooptation_credit_paye, '+')}${lrow('Refacturation client', t.refacturation_paye, '+')}
              <div class="lrow tot"><span>Sous-total</span><span class="ledger-total">+${UI.eur2(VM.creditsEncaisses)}</span></div></div>
            <div class="lcol"><h4><span class="sw" style="background:var(--c-charge)"></span>Charges payées par le portage</h4>
              ${lrow('Commission portage', t.commission_paye, '−')}${lrow('Charges sociales salaire', t.charges_salaire_paye, '−')}${lrow('Charges sur profit share', t.charges_ps_paye, '−')}${lrow('Impôts France (PAS)', t.impot_france, '−')}${lrow('Charges diverses', t.charges_diverses_paye, '−')}
              <div class="lrow tot"><span>Sous-total</span><span class="ledger-total">−${UI.eur2(VM.chargesPayees)}</span></div></div>
            <div class="lcol"><h4><span class="sw tri"></span>Versements vers toi</h4>
              ${lrow('Salaires nets', t.salaire_net, '−')}${lrow('Profit shares', t.profit_share_paye, '−')}${lrow('Notes de frais', t.notes_frais, '−')}${lrow('Tickets restaurant', t.tickets_resto, '−')}${lrow('Cooptations reversées', t.cooptation_revenu_paye, '−')}
              <div class="lrow tot"><span>Sous-total</span><span class="ledger-total">−${UI.eur2(VM.versementsRecus)}</span></div></div>
            <p class="ledger-final"><span class="lf-eq tab">${UI.eur2(VM.creditsEncaisses)} − ${UI.eur2(VM.chargesPayees)} − ${UI.eur2(VM.versementsRecus)}</span><span class="lf-res"><span class="lf-l">Solde sur encaissé</span> <span class="ledger-total">${VM.soldeEncaisse >= 0 ? '' : '−'}${UI.eur2(Math.abs(VM.soldeEncaisse))}</span></span></p>
          </div>
        </div></div>
      </div>
    </div></div></div>`;
  host.classList.toggle('is-open', wasOpen);
  renderWaterfall();
}

// Cascade du solde sur encaissé : encre = facturé/total, neutre = prélevé,
// versements vers toi découpés par nature (salaire, profit share, petits plus).
function renderWaterfall() {
  const t = VM.t;
  const C = VM.creditsEncaisses || 1;
  const S = VM.soldeEncaisse;
  const afterCharges = C - VM.chargesPayees;
  const parts = [
    { label: 'Salaires nets', v: t.salaire_net, c: 'var(--c-sal)' },
    { label: 'Profit shares', v: t.profit_share_paye, c: 'var(--c-ps)' },
    { label: 'Frais, tickets, cooptation', v: t.notes_frais + t.tickets_resto + t.cooptation_revenu_paye, c: 'var(--c-extra)' }
  ].filter((p) => p.v > 0.005);
  const pct = (v) => v / C * 100;
  const rows = [
    { k: 'Encaissements', s: 'Factures payées, cooptation, refacturation', v: '+' + UI.eur2(C), bars: [{ from: 0, w: C, c: 'var(--c-ink)', o: .85 }] },
    { k: 'Charges payées', s: 'Commission, charges sociales, PAS…', v: '−' + UI.eur2(VM.chargesPayees), bars: [{ from: afterCharges, w: VM.chargesPayees, c: 'var(--c-charge)' }] },
    { k: 'Versés vers toi', s: 'Salaires, profit shares, frais et tickets', v: '−' + UI.eur2(VM.versementsRecus), bars: (() => { let x = Math.max(0, S); return parts.map((p) => { const b = { from: x, w: p.v, c: p.c, label: p.label, val: p.v }; x += p.v; return b; }); })() },
    { k: 'Solde sur encaissé', s: 'Reste sur ton compte de portage', v: UI.eur2(S), total: true, bars: [{ from: 0, w: Math.max(0, S), c: 'var(--c-ink)' }] }
  ];
  const wf = document.getElementById('wf');
  wf.innerHTML = rows.map((r, i) => `
    <div class="wf-row${r.total ? ' is-total' : ''}">
      <div class="wf-name">${UI.esc(r.k)}<small>${UI.esc(r.s)}</small></div>
      <div class="wf-track">${r.bars.map((b, j) => `<span class="wf-bar" tabindex="0" data-wf="${i}-${j}" style="left:${pct(b.from)}%;width:${Math.max(.6, pct(b.w))}%;background:${b.c};${b.o ? `opacity:${b.o};` : ''}animation-delay:${i * 90 + j * 40}ms" aria-label="${UI.esc((b.label || r.k) + ' : ' + UI.eur2(b.val != null ? b.val : b.w))}"></span>`).join('')}</div>
      <div class="wf-val${r.total ? ' ledger-total' : ''}">${UI.esc(r.v)}</div>
    </div>`).join('') + UI.srTable('Calcul du solde sur encaissé', ['Étape', 'Montant'], rows.map((r) => [r.k, r.v]));
  UI.$$('[data-wf]', wf).forEach((el) => {
    const [i, j] = el.dataset.wf.split('-').map(Number);
    const r = rows[i], b = r.bars[j];
    UI.bindTip(el, () => UI.ttTitle(r.k) + `<div class="tt-big">${UI.esc(b.label ? UI.eur2(b.val) : r.v)}</div>` + UI.ttRow(b.c, b.label || r.s, b.label ? UI.pct1(b.val / (VM.versementsRecus || 1) * 100) + ' des versements' : ''));
  });
}
