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

// Montants signés : signe moins typographique (U+2212), comme le grand livre
// (Intl écrit un tiret ASCII). Le solde sur encaissé peut être négatif en portage.
function signedEur2(n) { return (n <= -0.005 ? '−' : '') + UI.eur2(Math.abs(n)); }
function signedEur0(n) { return (n <= -0.5 ? '−' : '') + UI.eur0(Math.abs(n)); }
function signedMoney(n, cents) { return (n <= -0.005 ? '<span class="m-int">−</span>' : '') + UI.money(Math.abs(n), cents); }

function heroNote() {
  const dated = VM.arrivals.filter((a) => a.eta);
  if (!VM.arrivals.length) return `Aucun profit share en attente${UI.NBP}: tout ce qui a été émis t’a été versé.`;
  if (!dated.length) {
    // Aucune date estimable (eta nulle) : pas encore de délai médian (aucun profit share
    // payé), ou dates d'émission absentes. On le dit, sans jamais prétendre « rien en attente ».
    const n = VM.arrivals.length;
    const why = VM.med
      ? `sans date d’émission, ${n > 1 ? 'leur' : 'son'} arrivée ne peut pas être estimée`
      : `${n > 1 ? 'leur' : 'sa'} date d’arrivée sera estimée après le premier profit share payé`;
    return `${n > 1 ? `${n} profit shares en attente` : 'Un profit share en attente'} (<b>${UI.eur0(VM.psSum)}</b>)${UI.NBP}: ${why}.`;
  }
  const next = dated[0], last = dated[dated.length - 1];
  let note = `Prochain versement${UI.NBP}: <b>${UI.eur0(next.montant)} vers le ${UI.dShort(next.eta)}</b>, ${whenTxt(next.left)}.`;
  if (last !== next) {
    note += last.left < 0
      ? ` Les profit shares déjà émis sont tous en retard${UI.NBP}: le dernier était attendu vers le ${UI.endDot(UI.dShort(last.eta))}`
      : ` Les profit shares déjà émis devraient tous être arrivés vers le ${UI.endDot(UI.dShort(last.eta))}`;
  }
  return note;
}

// Mobile (≤ 640 px, même seuil que hero.css) : le solde passe AVANT la composition.
// On déplace le nœud plutôt que d'utiliser `order`, pour que l'ordre de tabulation
// suive l'ordre visuel dans les deux dispositions.
const HERO_MOBILE = window.matchMedia ? matchMedia('(max-width: 640px)') : null;
function placeHeroSolde() {
  const el = document.getElementById('hero');
  const solde = el && el.querySelector('.hero-solde');
  const split = el && el.querySelector('.hero-split');
  if (!solde || !split) return;
  if (HERO_MOBILE && HERO_MOBILE.matches) split.before(solde);
  else split.after(solde);
}
if (HERO_MOBILE && HERO_MOBILE.addEventListener) HERO_MOBILE.addEventListener('change', placeHeroSolde);

function renderHero() {
  const el = document.getElementById('hero');
  const segs = heroSegments();
  const total = VM.soldeFacture;
  el.innerHTML = `
    <span class="hero-noise" aria-hidden="true"></span><span class="edge" aria-hidden="true"></span>
    <div class="hero-top">
      <span class="eyebrow"><span class="live-dot" aria-hidden="true"></span>Total à récupérer<span class="hide-s"> · solde sur facturé</span></span>
      <span class="chip">${icon('calendar')}Au ${UI.dLong(VM.today)}</span>
    </div>
    <h1 class="hero-title" id="hero-title">Ton portage te doit</h1>
    <p class="hero-amount" aria-labelledby="hero-title hero-amount-sr"><span aria-hidden="true">${signedMoney(total, true)}</span><span class="sr-only" id="hero-amount-sr">${signedEur2(total)}</span></p>
    <p class="hero-note">${heroNote()}</p>
    ${segs.length ? `<div class="hero-split">
      ${UI.splitBar(segs, 'Composition du total à récupérer')}
      ${UI.legendList(segs, total)}
    </div>` : ''}
    <div class="hero-solde">
      <span class="ic-tile">${icon('wallet')}</span>
      <span class="hs-text"><span class="hs-l">Déjà sur ton compte de portage</span><span class="hs-h">Solde sur encaissé${UI.NBP}: reçu par ton portage, pas encore reversé</span></span>
      <span class="hs-v tab">${signedMoney(VM.soldeEncaisse, true)}</span>
      <button class="text-link hs-link" type="button" data-act="open-solde">Voir le calcul${icon('arrowRight')}</button>
    </div>`;
  placeHeroSolde();
  UI.bindSplit(el, segs, total, 'Total à récupérer');
}

// ---------------------------------------------------------------- prochains versements
// Pastille d'échéance (même vocabulaire que la piste des versements).
function arrPill(a) {
  if (a.left < 0) return UI.pill('warn', `En retard · +${-a.left} j`, 'alert');
  return UI.pill('accent', a.left === 0 ? 'Aujourd’hui' : 'J−' + a.left, 'clock');
}

function renderArrivals() {
  const el = document.getElementById('arrivals');
  const items = VM.arrivals.filter((a) => a.eta);
  const undated = VM.arrivals.filter((a) => !a.eta);
  const ghost = VM.ghosts[VM.ghosts.length - 1];
  const ghostTxt = ghost ? ` Le profit share de ${UI.monthLower(ghost.mois)}, pas encore émis, n’y figure pas.` : '';
  let body, sub = 'Profit shares en attente, cumulés à leur date estimée';
  if (items.length) {
    const tot = UI.sum(items, 'montant');
    const last = items[items.length - 1];
    const next = items[0];
    const nU = undated.length;
    const undatedTxt = nU ? ` ${nU > 1 ? `${nU} profit shares` : 'Un profit share'} sans date d’émission (${UI.eur0(UI.sum(undated, 'montant'))}) n’y ${nU > 1 ? 'figurent' : 'figure'} pas.` : '';
    body = `
      <div class="arr-big"><span class="v tab">${UI.money(tot)}</span><span class="t">${last.left < 0 ? `en retard${UI.NBP}: attendus au plus tard le ${UI.dShort(last.eta)}` : `attendus d’ici le ${UI.dShort(last.eta)}`}</span></div>
      <div class="arr-next">${icon('arrowDown')}<span>Prochain${UI.NBP}: <b>${UI.eur0(next.montant)}</b> · profit share ${UI.MF[UI.mk(next.mois).m - 1].toLowerCase()} · vers le ${UI.dShort(next.eta)}</span>${arrPill(next)}</div>
      <div class="chart" id="chart-arrivals"></div>
      <p class="card-foot">${icon('info')}<span>Date estimée = émission + délai médian constaté (${VM.med} j sur ${AGG.delaisPS.count} profit shares payés).${undatedTxt}${ghostTxt}</span></p>`;
  } else if (undated.length) {
    // Aucune date estimable : la carte liste quand même ce qui est en attente (total = VM.psSum).
    const shown = undated.slice(0, 4);
    const rest = undated.length - shown.length;
    const line = (a) => `<li class="line"><span class="l"><span class="n">Profit share ${UI.monthLower(a.mois)}</span><span class="h">${a.emit ? `Émis le ${UI.esc(a.date_emission)}${a.waited > 0 ? ` · en attente depuis ${a.waited} j` : ''}` : 'Date d’émission inconnue'}</span></span><span class="v">${UI.eur2(a.montant)}</span></li>`;
    const why = VM.med
      ? 'Sans date d’émission, l’arrivée de ces profit shares ne peut pas être estimée.'
      : `Aucun profit share n’a encore été payé${UI.NBP}: le délai de versement n’est pas encore connu. Les dates estimées apparaîtront après le premier paiement.`;
    sub = 'Profit shares émis, pas encore versés';
    body = `
      <div class="arr-big"><span class="v tab">${UI.money(VM.psSum)}</span><span class="t">en attente, date d’arrivée encore inconnue</span></div>
      <ul class="lines arr-list">${shown.map(line).join('')}</ul>
      ${rest ? `<button class="text-link arr-more" type="button" data-act="open-solde">Et ${rest} autre${rest > 1 ? 's' : ''} dans le détail du solde${icon('arrowRight')}</button>` : ''}
      <p class="card-foot">${icon('info')}<span>${why}${ghostTxt}</span></p>`;
  } else {
    body = `<div class="arr-big"><span class="v">0${UI.NB}€</span><span class="t">rien en attente</span></div><p class="card-foot">${icon('check')}<span>Tous les profit shares émis t’ont été versés.</span></p>`;
  }
  el.innerHTML = `
    <header class="card-head">
      <span class="ic-tile">${icon('calendarClock')}</span>
      <div class="grow"><h2 class="h3">Prochains versements</h2><p>${sub}</p></div>
    </header>${body}`;
  if (items.length) UI.chart('arrivals', drawArrivals);
}

function drawArrivals() {
  const el = document.getElementById('chart-arrivals');
  if (!el) return;
  // Largeur approchée d'un libellé (Manrope, ~0,6 em par signe) : sert seulement à
  // écarter les étiquettes qui se chevaucheraient.
  const textW = (s, fs) => String(s).length * fs * 0.6;
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
  const x = (t) => P.l + (Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  // Marches : l'axe commence aujourd'hui. Les échéances déjà dépassées y sont ramenées et
  // regroupées en une seule marche « En retard » ; ensuite une marche par profit share.
  const late = items.filter((a) => a.left < 0);
  const steps = (late.length ? [{ t: t0, list: late, late: true }] : [])
    .concat(items.filter((a) => a.left >= 0).map((a) => ({ t: a.eta.getTime(), list: [a] })));
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
  const tx = x(t0);
  g += `<line class="g-today" x1="${tx}" x2="${tx}" y1="${P.t - 14}" y2="${H - P.b}"/>`;
  g += `<text class="g-sub" x="${tx + 6}" y="${P.t - 18}">Aujourd’hui</text>`;
  // Boîte du libellé « Aujourd'hui » : aucune étiquette de point ne doit la recouvrir.
  const todayBox = { x1: tx + 6, x2: tx + 6 + textW('Aujourd’hui', 11.5), y1: P.t - 28, y2: P.t - 14 };
  let cum = 0;
  let d = `M${tx},${y(0)}`;
  const pts = steps.map((s) => {
    const cx = x(s.t), sum = UI.sum(s.list, 'montant');
    d += `H${cx}`; cum += sum;
    const cy = y(cum);
    d += `V${cy}`;
    return { ...s, cx, cy, sum, cum };
  });
  d += `H${x(t1)}`;
  g += `<path d="${d}V${y(0)}H${tx}Z" style="fill:url(#${gid})"/>`;
  g += `<path class="g-line g-draw" d="${d}" style="stroke:var(--c-ps)"/>`;
  g += `<line class="g-axis" x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  pts.forEach((p, i) => {
    const sub = p.late ? 'En retard' : UI.dShort(p.list[0].eta);
    const lbl = '+' + UI.eur0(p.sum);
    const w = Math.max(textW(sub, 11.5), textW(lbl, 13));
    // Par défaut au-dessus du point, centré, recalé contre les bords (jamais sur le trait « Aujourd'hui »)
    let anchor = 'middle', lx = p.cx, ys = p.cy - 28, yl = p.cy - 12;
    if (p.cx - w / 2 < P.l) { anchor = 'start'; lx = Math.max(p.cx - 6, tx + 6); }
    else if (p.cx + w / 2 > W - 2) { anchor = 'end'; lx = p.cx + 6; }
    const x1 = anchor === 'start' ? lx : anchor === 'end' ? lx - w : lx - w / 2;
    // Chevauchement avec « Aujourd'hui » (point le plus haut tout près du trait) :
    // l'étiquette passe sous la marche, à droite de la contremarche.
    if (x1 < todayBox.x2 + 4 && x1 + w > todayBox.x1 - 4 && ys - 11 < todayBox.y2 && yl + 3 > todayBox.y1) {
      anchor = 'start'; lx = p.cx + 10; ys = p.cy + 20; yl = p.cy + 36;
    }
    g += `<text class="g-sub halo${p.late ? ' g-late' : ''}" x="${lx}" y="${ys}" text-anchor="${anchor}">${UI.esc(sub)}</text>`;
    g += `<text class="g-lbl halo" x="${lx}" y="${yl}" text-anchor="${anchor}">${UI.esc(lbl)}</text>`;
    g += `<circle class="g-dot" cx="${p.cx}" cy="${p.cy}" r="5" style="fill:var(--c-ps)"/>`;
    g += `<rect class="g-hit" data-i="${i}" x="${p.cx - 18}" y="${p.cy - 18}" width="36" height="36" rx="10" tabindex="0" aria-label="${UI.esc(stepLabel(p))}"/>`;
    g += `<circle class="g-focus" cx="${p.cx}" cy="${p.cy}" r="10"/>`;
  });
  const lateSum = UI.sum(late, 'montant');
  const lastT = Math.max(t0, items[items.length - 1].eta.getTime());
  let run = 0;
  el.innerHTML = UI.svg(W, H, g, `Profit shares attendus${UI.NBP}: ${UI.eur0(total)} cumulés d’ici le ${UI.dShort(new Date(lastT))}${late.length ? `, dont ${UI.eur0(lateSum)} en retard` : ''}`)
    + UI.srTable('Prochains versements estimés', ['Profit share', 'Montant', 'Date estimée', 'Cumul'], items.map((a) => {
      run += a.montant;
      return [UI.monthLabel(a.mois), UI.eur2(a.montant), UI.dLong(a.eta) + (a.left < 0 ? ` (en retard de ${-a.left} j)` : ''), UI.eur0(run)];
    }));
  UI.$$('.g-hit', el).forEach((h) => {
    const p = pts[+h.dataset.i];
    UI.bindTip(h, () => {
      const a = p.list[0];
      const title = !p.late ? `Vers le ${UI.dLong(a.eta)} (estimé)` : p.list.length > 1 ? `En retard · ${p.list.length} profit shares` : `En retard de ${-a.left} j (estimé)`;
      const rows = p.list.length > 1
        ? p.list.map((b) => UI.ttRow('', UI.monthLabel(b.mois), `${UI.eur0(b.montant)} · prévu le ${UI.dShort(b.eta)}`)).join('')
        : UI.ttRow('', 'Profit share', UI.monthLabel(a.mois)) + (p.late ? UI.ttRow('', 'Prévu le', UI.dLong(a.eta)) : '') + UI.ttRow('', 'Émis le', a.date_emission);
      return UI.ttTitle(title) + `<div class="tt-big">+${UI.esc(UI.eur2(p.sum))}</div>` + rows + UI.ttRow('var(--c-ps)', 'Cumul', UI.eur0(p.cum));
    });
  });
}

// Nom accessible d'une marche du graphique (un profit share, ou le groupe en retard).
function stepLabel(p) {
  const a = p.list[0];
  if (!p.late) return `Profit share ${UI.monthLower(a.mois)}${UI.NBP}: ${UI.eur2(a.montant)}, attendu vers le ${UI.dLong(a.eta)}`;
  if (p.list.length === 1) return `Profit share ${UI.monthLower(a.mois)}${UI.NBP}: ${UI.eur2(a.montant)}, était attendu vers le ${UI.dLong(a.eta)}, en retard de ${-a.left} j`;
  return `${p.list.length} profit shares en retard${UI.NBP}: ${UI.eur2(p.sum)} (${p.list.map((b) => UI.monthLower(b.mois)).join(', ')})`;
}

// ---------------------------------------------------------------- détail du solde
function renderSoldeDetail() {
  const host = document.getElementById('balance-widget');
  // État lu sur les cibles des repliables (pas sur l'ancêtre data-fold-root, partagé).
  const isOpen = (id) => { const b = document.getElementById(id); return !!(b && b.classList.contains('is-open')); };
  const wasOpen = isOpen('solde-body');
  const ledgerOpen = isOpen('ledger-body');
  const t = VM.t;
  const provSub = VM.provRest + VM.coopRest;
  // Échéance : même logique que la piste et le récit du mois (« était attendu… : en retard de N j »).
  const due = (a) => (!a.eta ? ' · date d’arrivée inconnue'
    : a.left < 0 ? ` · était attendu vers le ${UI.dShort(a.eta)}${UI.NBP}: en retard de ${-a.left}${UI.NB}j`
    : ` · attendu vers le ${UI.dShort(a.eta)}`);
  const recv = VM.arrivals.map((a) => `<li class="line"><span class="l"><span class="n">Profit share ${UI.monthLower(a.mois)}</span><span class="h">${a.date_emission ? `Émis le ${UI.esc(a.date_emission)}` : 'Date d’émission inconnue'}${due(a)}</span></span><span class="v">${UI.eur2(a.montant)}</span></li>`).join('')
    || '<li class="line"><span class="l"><span class="n">Aucun profit share en attente</span></span></li>';
  let adv = '';
  if (VM.provRest > 0) adv += `<li class="line"><span class="l"><span class="n">Provision congés payés</span><span class="h">${VM.provMois} mois × ${UI.eur0(VM.provPer)} · jamais versée, à récupérer à la sortie ou lors d’une prise de congés</span></span><span class="v">${UI.eur2(VM.provRest)}</span></li>`;
  VM.coopPending.forEach((c) => { adv += `<li class="line"><span class="l"><span class="n">Cooptation</span><span class="h">${UI.monthLabel(c.mois)} · en attente</span></span><span class="v">${UI.eur2(c.montant)}</span></li>`; });
  if (!adv) adv = '<li class="line"><span class="l"><span class="n">Aucune créance en attente</span></span></li>';
  const lrow = (k, v, sign) => `<div class="lrow"><span>${UI.esc(k)}</span><span>${UI.signed2(v, sign)}</span></div>`;
  host.innerHTML = `
    <button class="fold-head" type="button" id="solde-toggle" ${UI.toggleAttrs('solde-body', wasOpen)}>
      <span class="ic-tile">${icon('receipt')}</span>
      <span class="fh-t"><span class="fold-title">Détail du solde</span><span class="fold-sub">D’où viennent les ${UI.eur2(VM.soldeFacture)} qu’on te doit et les ${signedEur2(VM.soldeEncaisse)} sur ton compte</span></span>
      <span class="fold-sums" aria-hidden="true">
        <span class="sum-chip"><span class="sw" style="background:var(--c-ps)"></span>En attente <b>${UI.eur0(VM.psSum)}</b></span>
        <span class="sum-chip"><span class="sw" style="background:var(--c-sal)"></span><span>Provisions<span class="hide-s"> et créances</span></span> <b>${UI.eur0(provSub)}</b></span>
        <span class="sum-chip"><span class="sw" style="background:var(--c-ink)"></span>Sur encaissé <b>${signedEur0(VM.soldeEncaisse)}</b></span>
      </span>
      <span class="chev">${icon('chevron')}</span>
    </button>
    <div class="fold-body${wasOpen ? ' is-open' : ''}" id="solde-body" role="region" aria-labelledby="solde-toggle"><div><div class="fold-inner">
      <div class="solde-grid">
        <div class="sub-card">
          <div class="sub-head"><h3><span class="sw" style="background:var(--c-ps)"></span>Ils te paieront plus tard</h3><span class="chip">${VM.med ? `Délai médian ${VM.med} j` : 'Délai pas encore mesuré'}</span></div>
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
      <div class="ledger" data-fold-root>
        <div class="ledger-head">
          <div><h3>Calcul du solde sur encaissé</h3><p>Ce qui est entré sur ton compte de portage, moins ce qui en est sorti.</p></div>
          <button class="link-btn" type="button" id="ledger-toggle" ${UI.toggleAttrs('ledger-body', ledgerOpen)}>${icon('table')}Détail ligne à ligne${icon('chevron')}</button>
        </div>
        <div class="wf" id="wf"></div>
        <div class="fold-body${ledgerOpen ? ' is-open' : ''}" id="ledger-body" role="region" aria-labelledby="ledger-toggle"><div>
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
            <p class="ledger-final"><span class="lf-eq tab">${UI.eur2(VM.creditsEncaisses)} − ${UI.eur2(VM.chargesPayees)} − ${UI.eur2(VM.versementsRecus)}</span><span class="lf-res"><span class="lf-l">Solde sur encaissé</span> <span class="ledger-total">${signedEur2(VM.soldeEncaisse)}</span></span></p>
          </div>
        </div></div>
      </div>
    </div></div></div>`;
  host.classList.toggle('is-open', wasOpen);
  renderWaterfall();
}

// Cascade du solde sur encaissé : encre = facturé/total, neutre = prélevé,
// versements vers toi découpés par nature (salaire, profit share, petits plus).
// Chaque barre va d'un palier au suivant (0 → encaissé → après charges → solde) sur une
// échelle commune qui inclut les paliers négatifs : en portage, le solde passe sous zéro
// quand le salaire est versé avant le paiement client. Le zéro est alors tracé.
function renderWaterfall() {
  const t = VM.t;
  const C = VM.creditsEncaisses;
  const S = VM.soldeEncaisse;
  const afterCharges = C - VM.chargesPayees;
  const parts = [
    { label: 'Salaires nets', v: t.salaire_net, c: 'var(--c-sal)' },
    { label: 'Profit shares', v: t.profit_share_paye, c: 'var(--c-ps)' },
    { label: 'Frais, tickets, cooptation', v: t.notes_frais + t.tickets_resto + t.cooptation_revenu_paye, c: 'var(--c-extra)' }
  ].filter((p) => p.v > 0.005);
  const lo = Math.min(0, C, afterCharges, S);
  const hi = Math.max(0, C, afterCharges, S);
  const span = hi - lo || 1;
  const pos = (v) => (v - lo) / span * 100;
  // Barre de a à b (dans un sens ou dans l'autre), largeur minimale lisible, jamais hors piste
  const place = (b) => {
    const w = Math.max(.6, Math.abs(b.b - b.a) / span * 100);
    return { left: Math.min(pos(Math.min(b.a, b.b)), 100 - w), w };
  };
  let x = S;
  const versBars = parts.map((p) => { const b = { a: x, b: x + p.v, c: p.c, label: p.label, val: p.v }; x += p.v; return b; });
  const rows = [
    { k: 'Encaissements', s: 'Factures payées, cooptation, refacturation', v: '+' + UI.eur2(C), bars: [{ a: 0, b: C, c: 'var(--c-ink)', o: .85 }] },
    { k: 'Charges payées', s: 'Commission, charges sociales, PAS…', v: '−' + UI.eur2(VM.chargesPayees), bars: [{ a: afterCharges, b: C, c: 'var(--c-charge)' }] },
    { k: 'Versés vers toi', s: 'Salaires, profit shares, frais et tickets', v: '−' + UI.eur2(VM.versementsRecus), bars: versBars },
    { k: 'Solde sur encaissé', s: 'Reste sur ton compte de portage', v: signedEur2(S), total: true, bars: [{ a: 0, b: S, c: 'var(--c-ink)' }] }
  ];
  const zero = lo < -0.005 ? `<span class="wf-zero" style="left:${pos(0)}%" aria-hidden="true"></span>` : '';
  const wf = document.getElementById('wf');
  wf.innerHTML = rows.map((r, i) => `
    <div class="wf-row${r.total ? ' is-total' : ''}">
      <div class="wf-name">${UI.esc(r.k)}<small>${UI.esc(r.s)}</small></div>
      <div class="wf-track">${r.bars.map((b, j) => { const pl = place(b); return `<span class="wf-bar" tabindex="0" data-wf="${i}-${j}" style="left:${pl.left}%;width:${pl.w}%;background:${b.c};${b.o ? `opacity:${b.o};` : ''}animation-delay:${i * 90 + j * 40}ms" aria-label="${UI.esc((b.label || r.k) + UI.NBP + ': ' + (b.label ? UI.eur2(b.val) : r.v))}"></span>`; }).join('')}${zero}</div>
      <div class="wf-val${r.total ? ' ledger-total' : ''}">${UI.esc(r.v)}</div>
    </div>`).join('') + UI.srTable('Calcul du solde sur encaissé', ['Étape', 'Montant'], rows.map((r) => [r.k, r.v]));
  UI.$$('[data-wf]', wf).forEach((el) => {
    const [i, j] = el.dataset.wf.split('-').map(Number);
    const r = rows[i], b = r.bars[j];
    UI.bindTip(el, () => UI.ttTitle(r.k) + `<div class="tt-big">${UI.esc(b.label ? UI.eur2(b.val) : r.v)}</div>` + UI.ttRow(b.c, b.label || r.s, b.label ? UI.pct1(b.val / (VM.versementsRecus || 1) * 100) + ' des versements' : ''));
  });
}
