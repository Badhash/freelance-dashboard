// ============================================================
// AURORA — « En attente de versement » (#pending) : piste des profit shares
// (greffe Cockpit : écoulé plein, reste pointillé, échéance, trait d'aujourd'hui),
// profit share pas encore émis (carte fantôme), côté client hors total.
// « Mois par mois » (#tab-detail) : journal compact (voyants + micro-barre),
// détail déplié (cascade ligne à ligne, arrivé / en attente / prélevé).
// ============================================================

const OPEN_MONTHS = new Set();
const OPEN_YEARS = new Set();
let MONTHS_INIT = false;

// ---------------------------------------------------------------- utilitaires mois
function detSplit(arr) {
  const paid = UI.sum((arr || []).filter((d) => d.statut === 'Payé'), 'montant');
  const pend = UI.sum((arr || []).filter((d) => d.statut !== 'Payé'), 'montant');
  return { paid, pend, n: (arr || []).length };
}
// Dérivées d'affichage d'un mois (aucun calcul métier modifié : sommes des lignes d'AGG).
function monthFlows(m) {
  const sal = detSplit(m.details_salaire), tr = detSplit(m.details_tickets_resto), ndf = detSplit(m.details_notes_frais);
  const ps = detSplit(m.details_profit_share), coop = detSplit(m.details_cooptation);
  const prel = m.commission_portage + m.charges_salaire + m.charges_profit_share + m.impot_france + m.charges_diverses;
  const prov = m.provision_conges;
  const pourToi = m.salaire_net + m.tickets_resto + m.notes_frais + m.profit_share_total + prov;
  const reste = m.facturation - prel - pourToi;
  const arrived = sal.paid + tr.paid + ndf.paid + ps.paid + coop.paid;
  const pending = sal.pend + tr.pend + ndf.pend + ps.pend + coop.pend;
  const unpaidInvoice = VM.clientPending.some((c) => c.mois === m.mois);
  return { sal, tr, ndf, ps, coop, prel, prov, pourToi, reste, arrived, pending, unpaidInvoice, psNotIssued: m.facturation > 0 && ps.n === 0 };
}
function monthSegs(m, f) {
  const s = [{ label: 'Prélevé (commission, charges, PAS)', v: f.prel, c: 'var(--c-charge)' }];
  if (f.sal.paid) s.push({ label: 'Salaire net versé', v: f.sal.paid, c: 'var(--c-sal)' });
  if (f.sal.pend) s.push({ label: 'Salaire net en attente', v: f.sal.pend, c: 'var(--c-sal-tint)' });
  if (f.prov) s.push({ label: 'Provision congés (provisionnée)', v: f.prov, c: 'var(--c-sal-tint)' });
  if (f.tr.paid + f.ndf.paid) s.push({ label: 'Tickets et frais versés', v: f.tr.paid + f.ndf.paid, c: 'var(--c-extra)' });
  if (f.tr.pend + f.ndf.pend) s.push({ label: 'Tickets et frais en attente', v: f.tr.pend + f.ndf.pend, c: 'var(--c-extra-tint)' });
  if (f.ps.paid) s.push({ label: 'Profit share versé', v: f.ps.paid, c: 'var(--c-ps)' });
  if (f.ps.pend) s.push({ label: 'Profit share en attente', v: f.ps.pend, c: 'var(--c-ps-tint)' });
  if (f.reste > 0.5) s.push({ label: f.psNotIssued ? 'Pas encore réparti (profit share à venir)' : 'Écart de clôture (voir l’audit)', v: f.reste, c: 'transparent', est: true });
  return s.filter((x) => x.v > 0.005);
}
function voyants(m, f) {
  const st = (state, label) => {
    const icn = state === 'ok' ? 'check' : state === 'warn' ? 'clock' : 'circleDashed';
    return `<span class="vy ${state}" title="${UI.esc(label)}">${icon(icn)}</span>`;
  };
  const fact = !m.facturation ? ['none', 'Facture client : aucune ce mois-ci'] : f.unpaidInvoice ? ['warn', 'Facture client : en attente de paiement'] : ['ok', 'Facture client : payée'];
  const sal = !f.sal.n ? ['none', 'Salaire : aucun'] : f.sal.pend ? ['warn', 'Salaire : en attente'] : ['ok', 'Salaire : versé'];
  const ps = !f.ps.n ? ['none', m.facturation ? 'Profit share : pas encore émis' : 'Profit share : aucun'] : f.ps.pend ? ['warn', 'Profit share : en attente'] : ['ok', 'Profit share : versé'];
  return `<span class="vys" role="img" aria-label="${UI.esc([fact[1], sal[1], ps[1]].join(' ; '))}">${st(...fact)}${st(...sal)}${st(...ps)}</span>`;
}
function psPillFor(m, f) {
  if (!f.ps.n) return m.facturation ? `<span class="pill muted est">${icon('circleDashed')}Pas encore émis</span>` : '';
  if (f.ps.pend) return UI.pill('warn', 'En attente', 'clock');
  return UI.pill('ok', 'Versé', 'check');
}

// ---------------------------------------------------------------- piste des profit shares
let TRK_CLIENT_OPEN = false;
function renderPendingTrack() {
  const host = document.getElementById('pending');
  const items = VM.arrivals;
  const ghosts = VM.ghosts;
  const clients = VM.clientPending;
  const last = items.filter((a) => a.eta).slice(-1)[0];
  const n = items.length;
  const head = n
    ? `${n} profit share${n > 1 ? 's' : ''} ${n > 1 ? 'sont' : 'est'} en route vers toi : <b>${UI.eur0(VM.psSum)}</b>${last ? `, ${n > 1 ? 'tout devrait être arrivé' : 'attendu'} vers le <b>${UI.dLong(last.eta).replace(/ \d{4}$/, '')}</b>` : ''}.`
    : 'Aucun profit share en attente : tout ce qui a été émis t’a été versé.';
  const today = VM.today;
  // Axe : du 1er du mois de la plus ancienne émission de profit share à la fin du mois de la dernière échéance.
  const allStarts = [...items.map((a) => a.emit), ...ghosts.map((g) => g.emit)].filter(Boolean);
  const startD = allStarts.length ? new Date(Math.min(...allStarts.map((d) => d.getTime()))) : UI.addDays(today, -90);
  const t0 = new Date(startD.getFullYear(), startD.getMonth(), 1).getTime();
  const ends = [...items.map((a) => a.eta), ...ghosts.map((g) => g.eta), ...clients.map((c) => c.eta)].filter(Boolean).map((d) => d.getTime());
  const endD = new Date(Math.max(today.getTime() + 30 * UI.DAY, ...ends));
  const t1 = new Date(endD.getFullYear(), endD.getMonth() + 1, 1).getTime();
  const pos = (d) => Math.max(0, Math.min(100, ((d.getTime ? d.getTime() : d) - t0) / (t1 - t0) * 100));
  const tx = pos(today);
  const ticks = [];
  for (let d = new Date(t0); d.getTime() < t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) ticks.push(d);
  const tipData = [];

  // Piste : écoulé (plein) de l'émission à aujourd'hui, reste (pointillé) jusqu'à l'échéance estimée,
  // dépassement (rouge) au-delà de l'échéance, losange = échéance. Clippée à gauche si l'émission précède l'axe.
  const lane = (o) => {
    const parts = [`<span class="trk-today" style="left:${tx}%"></span>`];
    const clipped = o.emit && o.emit.getTime() < t0;
    if (clipped) parts.push(`<span class="trk-clip">${icon('chevronRight')}</span>`);
    if (o.ghost) parts.push(`<span class="trk-rest ghost" style="left:${pos(o.emit)}%;width:${pos(o.eta) - pos(o.emit)}%"></span>`);
    else {
      const late = o.eta && o.eta < today;
      const doneEnd = late ? o.eta : today;
      if (!(clipped && late && o.eta.getTime() < t0)) parts.push(`<span class="trk-done ${o.kind}" style="left:${pos(o.emit)}%;width:${Math.max(.8, pos(doneEnd) - pos(o.emit))}%"></span>`);
      if (late) parts.push(`<span class="trk-over" style="left:${pos(o.eta)}%;width:${tx - pos(o.eta)}%"></span>`);
      else if (o.eta) parts.push(`<span class="trk-rest ${o.kind}" style="left:${tx}%;width:${pos(o.eta) - tx}%"></span>`);
    }
    if (o.eta && o.eta.getTime() >= t0) parts.push(`<span class="trk-eta ${o.ghost ? 'ghost' : o.kind}" style="left:${pos(o.eta)}%"></span>`);
    tipData.push(o.tip);
    return `<div class="trk-lane" data-tip="${tipData.length - 1}" aria-hidden="true">${parts.join('')}</div>`;
  };
  const psRow = (a) => {
    const late = a.left != null && a.left < 0;
    const sev = a.waited >= 130 ? 'danger' : a.waited >= 100 ? 'warn' : late ? 'warn' : 'accent';
    const pillTxt = late ? `En retard · +${-a.left} j` : a.left === 0 ? 'Aujourd’hui' : `J−${a.left}`;
    return `<li class="trk-row${late ? ' late' : ''}">
      <div class="trk-lab"><span class="trk-n"><span class="sw" style="background:var(--c-ps)"></span>Profit share ${UI.monthLower(a.mois)}</span><span class="trk-h">Émis le ${UI.esc(a.date_emission)}${a.eta ? ` · attendu vers le ${UI.dShort(a.eta)}` : ''}</span><span class="trk-h trk-h2">${a.waited} j écoulés sur ~${VM.med}</span></div>
      ${lane({ emit: a.emit, eta: a.eta, kind: 'ps', tip: { t: `Profit share ${UI.monthLower(a.mois)}`, v: UI.eur2(a.montant), rows: [['Émis le', a.date_emission], ['Échéance estimée', a.eta ? UI.dLong(a.eta) : '—'], ['Écoulé', `${a.waited} j sur ~${VM.med}`]] } })}
      <div class="trk-val"><span class="v tab">${UI.eur2(a.montant)}</span>${UI.pill(sev, pillTxt, late ? 'alert' : 'clock')}</div>
    </li>`;
  };
  const ghostRow = (g) => `<li class="trk-row ghost">
      <div class="trk-lab"><span class="trk-n"><span class="sw est"></span>Profit share ${UI.monthLower(g.mois)}</span><span class="trk-h">Pas encore émis · émission habituelle vers le ${UI.dShort(g.emit)}</span><span class="trk-h trk-h2">${g.eta ? `Arrivée estimée vers le ${UI.dShort(g.eta)}` : ''}</span></div>
      ${lane({ emit: g.emit, eta: g.eta, ghost: true, tip: { t: `Profit share ${UI.monthLower(g.mois)} (pas encore émis)`, v: 'Montant connu à l’émission', rows: [['Émission habituelle', UI.dLong(g.emit)], ['Arrivée estimée', g.eta ? UI.dLong(g.eta) : '—']] } })}
      <div class="trk-val"><span class="v muted">Montant connu à l’émission</span><span class="pill muted est">${icon('circleDashed')}Pas encore émis</span></div>
    </li>`;
  const clientRow = (c) => {
    const late = c.late != null && c.late > 0;
    return `<li class="trk-row client${late ? ' late' : ''}">
      <div class="trk-lab"><span class="trk-n"><span class="sw" style="background:var(--c-ink)"></span>Facture ${UI.monthLower(c.mois)}</span><span class="trk-h">Émise le ${UI.esc(c.date)}${c.eta ? ` · paiement attendu vers le ${UI.dShort(c.eta)}` : ''}</span><span class="trk-h trk-h2">${c.waited} j écoulés sur ~${VM.medCA}</span></div>
      ${lane({ emit: c.emit, eta: c.eta, kind: 'client', tip: { t: `Facture ${UI.monthLower(c.mois)} (hors total)`, v: UI.eur2(c.montant), rows: [['Émise le', c.date], ['Paiement attendu', c.eta ? UI.dLong(c.eta) : '—'], [late ? 'Retard' : 'Écoulé', late ? `+${c.late} j` : `${c.waited} j sur ~${VM.medCA}`]] } })}
      <div class="trk-val"><span class="v tab">${UI.eur2(c.montant)}</span>${late ? UI.pill(c.late > 30 ? 'danger' : 'warn', `+${c.late} j de retard`, 'alert') : UI.pill('muted', `J−${-c.late}`, 'clock')}</div>
    </li>`;
  };
  const clientTot = UI.sum(clients, 'montant');
  const lateN = clients.filter((c) => c.late > 0).length;
  host.innerHTML = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('route')}En attente de versement</span>
        <h2 id="pending-title">${head}</h2>
        <p>Chaque piste part de l’émission. En plein, le temps déjà écoulé ; en pointillé, ce qu’il reste jusqu’à l’échéance estimée (émission + ${VM.med} j, le délai médian constaté).</p>
      </div>
    </header>
    <article class="card track" aria-labelledby="pending-title">
      <div class="trk-axis" aria-hidden="true">
        <span></span>
        <div class="trk-ticks"><b class="trk-now" style="left:${tx}%">Auj. ${UI.dShort(today)}</b>${ticks.map((d) => `<span style="left:${pos(d)}%">${UI.MS[d.getMonth()]}${d.getMonth() === 0 ? ' ' + String(d.getFullYear()).slice(2) : ''}</span>`).join('')}</div>
        <span></span>
      </div>
      <section class="trk-group" aria-label="Profit shares vers toi">
        <h3 class="trk-gt">Vers toi <span>${n ? `${n} émis · ${UI.eur2(VM.psSum)}` : 'rien en attente'}</span></h3>
        <ul class="trk-list">${items.map(psRow).join('')}${ghosts.map(ghostRow).join('')}</ul>
      </section>
      ${clients.length ? `<section class="trk-group client${TRK_CLIENT_OPEN ? ' is-open' : ''}" data-fold-root>
        <h3 class="trk-gh"><button class="trk-toggle" type="button" id="trk-client-t" ${UI.toggleAttrs('trk-client', TRK_CLIENT_OPEN)}>
          <span class="trk-gt">Côté client · hors total <span>${clients.length} facture${clients.length > 1 ? 's' : ''} · ${UI.eur2(clientTot)}</span></span>
          ${lateN ? UI.pill('danger', `${lateN} en retard`, 'alert') : ''}
          <span class="chev">${icon('chevron')}</span>
        </button></h3>
        <div class="fold-body${TRK_CLIENT_OPEN ? ' is-open' : ''}" id="trk-client" role="region" aria-labelledby="trk-client-t"><div>
          <p class="trk-note">Ce que ton client doit encore à ton portage. Ce n’est pas compté dans ce qu’on te doit : une fois payées, ces factures alimenteront tes prochains profit shares.</p>
          <ul class="trk-list">${clients.map(clientRow).join('')}</ul>
        </div></div>
      </section>` : ''}
      <footer class="trk-legend legend">
        <span><i class="lk box" style="background:var(--c-ps)"></i>Écoulé depuis l’émission</span>
        <span><i class="lk box est-box"></i>Reste estimé</span>
        <span><i class="lk diamond"></i>Échéance estimée</span>
        <span><i class="lk vline"></i>Aujourd’hui</span>
        <span><i class="lk box" style="background:var(--danger)"></i>Dépassement</span>
      </footer>
      ${UI.srTable('Profit shares en attente et factures client', ['Élément', 'Montant', 'Émis le', 'Échéance estimée', 'Jours écoulés'],
        [...items.map((a) => [`Profit share ${UI.monthLower(a.mois)}`, UI.eur2(a.montant), a.date_emission, a.eta ? UI.dLong(a.eta) : '—', String(a.waited)]),
         ...ghosts.map((g) => [`Profit share ${UI.monthLower(g.mois)} (pas encore émis)`, '—', 'vers le ' + UI.dLong(g.emit), g.eta ? UI.dLong(g.eta) : '—', '—']),
         ...clients.map((c) => [`Facture client ${UI.monthLower(c.mois)} (hors total)`, UI.eur2(c.montant), c.date, c.eta ? UI.dLong(c.eta) : '—', String(c.waited)])])}
    </article>`;
  UI.$$('.trk-lane[data-tip]', host).forEach((el) => {
    const d = tipData[+el.dataset.tip];
    if (d) UI.bindTip(el, () => UI.ttTitle(d.t) + `<div class="tt-big">${UI.esc(d.v)}</div>` + d.rows.map((r) => UI.ttRow('', r[0], r[1])).join(''));
  });
  host.addEventListener('ui:toggle', onTrackToggle);
}
function onTrackToggle(e) { if (e.target.id === 'trk-client-t') TRK_CLIENT_OPEN = e.detail.open; }

// ---------------------------------------------------------------- mois par mois
function monthStory(m, f) {
  const { m: mo, y } = UI.mk(m.mois);
  const name = UI.MF[mo - 1] + ' ' + y;
  if (!m.facturation) return `<b>${name}</b> : aucune facturation ce mois-ci${f.arrived ? `, mais <b>${UI.eur0(f.arrived)}</b> arrivés chez toi` : ''}.`;
  let s = `<b>${name}</b> : ${m.jours_travailles ? `<b>${UI.num1(m.jours_travailles)} jours à ${UI.eur0(m.tjm)}</b>, soit ` : ''}<b>${UI.eur0(m.facturation)}</b> facturés`;
  s += f.unpaidInvoice ? ', pas encore réglés par le client. ' : `, réglés par le client${m.facturation_date_paiement ? ' le ' + UI.esc(m.facturation_date_paiement) : ''}. `;
  s += `<b>${UI.eur0(f.arrived)}</b> ${f.arrived > 1 ? 'sont' : 'est'} déjà arrivés chez toi${f.pending > 0.5 ? `, <b>${UI.eur0(f.pending)}</b> sont en attente` : ''}.`;
  if (f.psNotIssued) {
    const g = VM.ghosts.find((x) => x.mois === m.mois);
    s += ` Le profit share n’est pas encore émis${g ? ` : il devrait l’être vers le ${UI.endDot(UI.dShort(g.emit))}` : '.'}`;
  } else if (f.ps.pend) {
    const a = VM.arrivals.find((x) => x.mois === m.mois);
    s += ` Le profit share de <b>${UI.eur0(f.ps.pend)}</b> est attendu${a && a.eta ? ` vers le ${UI.endDot(UI.dShort(a.eta))}` : '.'}`;
  } else if (f.ps.paid) s += ' Profit share versé : ce mois est soldé.';
  return s;
}

function cascadeRows(m, f) {
  const fact = m.facturation;
  const st = (arr) => (!arr || !arr.length ? '' : arr.every((d) => d.statut === 'Payé') ? UI.pill('ok', 'Payé · ' + (arr[arr.length - 1].date_paiement || '?'), 'check') : UI.pill('warn', 'En attente', 'clock'));
  const rows = [];
  rows.push({ k: 'CA facturé', v: fact, c: 'var(--c-ink)', pill: f.unpaidInvoice ? UI.pill('warn', 'Facture en attente', 'clock') : UI.pill('ok', 'Payée · ' + (m.facturation_date_paiement || '?'), 'check'), head: true });
  [['Commission portage', m.commission_portage], ['Charges sociales salaire', m.charges_salaire], ['Charges sur profit share', m.charges_profit_share], ['Impôt à la source (PAS)', m.impot_france], ['Charges diverses', m.charges_diverses]]
    .forEach(([k, v]) => { if (v > 0.005) rows.push({ k, v, c: 'var(--c-charge)', group: 'prel' }); });
  if (m.salaire_net) rows.push({ k: 'Salaire net (après PAS)', v: m.salaire_net, c: f.sal.pend ? 'var(--c-sal-tint)' : 'var(--c-sal)', pill: st(m.details_salaire) });
  if (m.provision_conges) rows.push({ k: 'Provision congés', v: m.provision_conges, c: 'var(--c-sal-tint)', pill: `<span class="pill muted">${icon('umbrella')}Provisionnée</span>` });
  if (m.tickets_resto) rows.push({ k: 'Tickets restaurant', v: m.tickets_resto, c: f.tr.pend ? 'var(--c-extra-tint)' : 'var(--c-extra)', pill: st(m.details_tickets_resto) });
  if (m.notes_frais) rows.push({ k: 'Notes de frais', v: m.notes_frais, c: f.ndf.pend ? 'var(--c-extra-tint)' : 'var(--c-extra)', pill: st(m.details_notes_frais) });
  if (m.profit_share_total) rows.push({ k: 'Profit share', v: m.profit_share_total, c: f.ps.pend ? 'var(--c-ps-tint)' : 'var(--c-ps)', pill: st(m.details_profit_share) });
  if (f.reste > 0.5) rows.push({ k: f.psNotIssued ? 'Pas encore réparti' : 'Écart de clôture', v: f.reste, est: true, pill: f.psNotIssued ? `<span class="pill muted est">${icon('circleDashed')}Profit share à venir</span>` : `<button class="text-link" type="button" data-act="audit">${icon('shield')}Voir l’audit</button>`, last: true });
  let run = fact;
  rows.forEach((r) => {
    if (r.head) { r.from = 0; r.to = fact; return; }
    r.to = Math.max(0, run); r.from = Math.max(0, run - r.v); run -= r.v;
  });
  return rows;
}

function monthDetail(m, f) {
  const fact = m.facturation;
  const rows = fact > 0 ? cascadeRows(m, f) : [];
  const pct = (v) => (fact ? v / fact * 100 : 0);
  const g = VM.ghosts.find((x) => x.mois === m.mois);
  const casc = fact > 0 ? `
    <div class="casc" role="table" aria-label="Où sont partis les ${UI.esc(UI.eur0(fact))} facturés en ${UI.esc(UI.monthLower(m.mois))}">
      <div class="casc-h" role="row"><span role="columnheader">Où sont partis les ${UI.eur0(fact)} facturés</span><span role="columnheader" class="c-pct">% du CA</span></div>
      ${rows.map((r, i) => `<div class="casc-r${r.head ? ' head' : ''}${r.est ? ' est' : ''}${r.group === 'prel' && (!rows[i - 1] || rows[i - 1].group !== 'prel') ? ' first-prel' : ''}" role="row">
        <span class="c-k" role="cell"><span class="c-n">${UI.esc(r.k)}</span>${r.pill || ''}</span>
        <span class="c-bar" role="presentation"><i style="left:${pct(r.from)}%;width:${Math.max(.5, pct(r.to - r.from))}%;${r.est ? '' : `background:${r.c};`}animation-delay:${i * 40}ms"></i></span>
        <span class="c-v tab${r.head ? ' ledger-total' : ''}" role="cell">${UI.eur2(r.v)}</span>
        <span class="c-pct tab" role="cell">${UI.pct1(pct(r.v))}</span>
      </div>`).join('')}
    </div>` : '<p class="muted">Aucune facturation ce mois-ci.</p>';
  const coop = m.cooptation_revenu > 0.005 ? `<div class="md-extra"><span class="sw" style="background:var(--c-extra)"></span><span>Hors facturation : cooptation <b>${UI.eur2(m.cooptation_revenu)}</b></span>${f.coop.pend ? UI.pill('warn', 'En attente', 'clock') : UI.pill('ok', 'Payée', 'check')}</div>` : '';
  return `
    <p class="story">${monthStory(m, f)}</p>
    <div class="md-grid">
      ${casc}
      <div class="md-side">
        <div class="md-tile ok"><span class="mt-l">${icon('check')}Arrivé chez toi</span><span class="mt-v tab">${UI.eur2(f.arrived)}</span><span class="mt-h">${fact ? UI.pct0((f.arrived - f.coop.paid) / fact * 100) + ' du facturé · ' : ''}versements payés uniquement</span></div>
        <div class="md-tile warn"><span class="mt-l">${icon('clock')}Encore en attente</span><span class="mt-v tab">${UI.eur2(f.pending)}</span><span class="mt-h">${f.prov ? `+ ${UI.eur0(f.prov)} de provision congés, comptés dans ton total à récupérer` : 'émis, pas encore versés'}</span></div>
        <div class="md-tile"><span class="mt-l">${icon('receipt')}Prélevé</span><span class="mt-v tab">${UI.eur2(f.prel)}</span><span class="mt-h">commission, charges sociales, PAS</span></div>
        ${f.psNotIssued ? `<div class="md-ghost"><span class="mt-l">${icon('circleDashed')}Profit share ${UI.esc(UI.monthLower(m.mois))}</span><span class="mt-h">Pas encore émis${g ? `. Émission habituelle vers le <b>${UI.dShort(g.emit)}</b>${g.eta ? `, arrivée estimée vers le <b>${UI.dShort(g.eta)}</b>` : ''}` : ''}</span></div>` : ''}
        ${coop}
      </div>
    </div>`;
}

function monthRow(m) {
  const { m: mo, y } = UI.mk(m.mois);
  const f = monthFlows(m);
  const open = OPEN_MONTHS.has(m.mois);
  const segs = monthSegs(m, f);
  const id = m.mois;
  const arrPct = m.facturation ? (f.arrived - f.coop.paid) / m.facturation * 100 : null;
  return `
    <div class="mrow${open ? ' is-open' : ''}" data-mois="${id}" data-fold-root>
      <button class="mhead" type="button" id="mh-${id}" ${UI.toggleAttrs('md-' + id, open)}>
        ${voyants(m, f)}
        <span class="m-n"><span class="mname">${UI.MF[mo - 1]}<small>${y}</small></span><span class="mdays">${m.jours_travailles ? `${UI.num1(m.jours_travailles)} j × ${UI.eur0(m.tjm)}` : 'Sans facturation'}</span></span>
        <span class="m-s">${m.facturation > 0 ? `<span class="mini-split" aria-hidden="true">${segs.map((s) => `<span class="${s.est ? 'est' : ''}" style="flex:${s.v} 1 0;background:${s.c}"></span>`).join('')}</span><span class="mini-cap">${UI.pct0(arrPct)} arrivé chez toi</span>` : ''}</span>
        <span class="mcol m-v"><span class="k">Facturé</span><span class="x">${m.facturation ? UI.eur0(m.facturation) : '—'}</span></span>
        <span class="mcol m-r"><span class="k">Arrivé chez toi</span><span class="x${f.arrived ? '' : ' dim'}">${f.arrived ? UI.eur0(f.arrived) : '—'}</span></span>
        <span class="mcol m-ps"><span class="k">Profit share</span><span class="mps"><span class="x${m.profit_share_total ? '' : ' dim'}">${m.profit_share_total ? UI.eur0(m.profit_share_total) : '—'}</span>${psPillFor(m, f)}</span></span>
        <span class="chev">${icon('chevron')}</span>
      </button>
      <div class="fold-body${open ? ' is-open' : ''}" id="md-${id}" role="region" aria-labelledby="mh-${id}"><div><div class="md-in">${detailOrLazy(m, f, open)}</div></div></div>
    </div>`;
}
// Le détail est construit à la première ouverture (DOM léger : 21 mois × cascade).
function detailOrLazy(m, f, open) { return open ? monthDetail(m, f) : ''; }

function renderMonthsLists() {
  const host = document.getElementById('tab-detail');
  const years = [...AGG.years].reverse();
  const todayY = String(VM.today.getFullYear());
  if (!MONTHS_INIT) {
    MONTHS_INIT = true;
    OPEN_MONTHS.add(AGG.months[AGG.months.length - 1].mois);
    OPEN_YEARS.add(VM.curY);
  }
  const lastM = AGG.months[AGG.months.length - 1];
  const lf = monthFlows(lastM);
  host.innerHTML = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('list')}Mois par mois</span>
        <h2 id="months-title">${UI.esc(UI.monthLabel(lastM.mois))} : <b>${UI.eur0(lastM.facturation)}</b> facturés, <b>${UI.eur0(lf.arrived)}</b> déjà arrivés chez toi.</h2>
        <p>Ouvre un mois pour voir où est parti chaque euro facturé, et ce qui est payé ou non.</p>
      </div>
    </header>
    <div class="m-legend" aria-hidden="true">
      <span class="ml-g"><span class="ml-k">État (facture · salaire · profit share)</span><span class="ml-i"><span class="vy ok">${icon('check')}</span>Payé</span><span class="ml-i"><span class="vy warn">${icon('clock')}</span>En attente</span><span class="ml-i"><span class="vy none">${icon('circleDashed')}</span>Pas encore émis</span></span>
      <span class="ml-g"><span class="ml-k">Répartition</span><span class="ml-i"><i class="sw" style="background:var(--c-charge)"></i>Prélevé</span><span class="ml-i"><i class="sw" style="background:var(--c-sal)"></i>Salaire</span><span class="ml-i"><i class="sw" style="background:var(--c-extra)"></i>Frais, tickets</span><span class="ml-i"><i class="sw" style="background:var(--c-ps)"></i>Profit share</span><span class="ml-i"><i class="sw" style="background:var(--c-ps-tint)"></i>Teinte : en attente</span><span class="ml-i"><i class="sw est"></i>Pas encore réparti</span></span>
    </div>
    ${years.map((y) => {
      const ms = AGG.months.filter((m) => m.mois.endsWith('-' + y)).reverse();
      const st = VM.sy[y];
      const n = ms.length;
      const enCours = y === todayY && n < 12;
      const open = OPEN_YEARS.has(y);
      return `<div class="year-block${open ? ' is-open' : ''}" id="months-${y}" data-year-block="${y}" data-fold-root>
        <button class="year-head" type="button" id="yh-${y}" ${UI.toggleAttrs('yl-' + y, open)}>
          <span class="y">${y}</span><span class="chip${enCours ? ' accent' : ''}">${n} mois ${enCours ? 'en cours' : 'clôturé' + (n > 1 ? 's' : '')}</span>
          <span class="ym"><b>${UI.eur0(st.ca)}</b> facturés · <b>${UI.num1(st.jours)} j</b> · TJM moyen <b>${UI.eur0(st.tjm)}</b></span>
          <span class="yh-more" aria-hidden="true">Voir les ${n} mois</span><span class="chev">${icon('chevron')}</span>
        </button>
        <div class="fold-body${open ? ' is-open' : ''}" id="yl-${y}" role="region" aria-labelledby="yh-${y}"><div>
          <div class="card mlist">
            <div class="mlist-head" aria-hidden="true"><span>État</span><span>Mois</span><span>Répartition du facturé</span><span>Facturé</span><span>Arrivé chez toi</span><span>Profit share</span><span></span></div>
            ${ms.map(monthRow).join('')}
          </div>
        </div></div>
      </div>`;
    }).join('')}`;
  host.addEventListener('ui:toggle', onMonthsToggle);
  UI.$$('.mrow', host).forEach((row) => {
    const m = AGG.monthsByKey[row.dataset.mois];
    const segs = monthSegs(m, monthFlows(m));
    UI.$$('.mini-split > span', row).forEach((sp, i) => sp.setAttribute('title', `${segs[i].label} : ${UI.eur2(segs[i].v)}`));
  });
}
function onMonthsToggle(e) {
  const b = e.target;
  const row = b.closest('.mrow');
  if (row && b.classList.contains('mhead')) {
    const k = row.dataset.mois;
    if (e.detail.open) {
      OPEN_MONTHS.add(k);
      const inner = row.querySelector('.md-in');
      if (inner && !inner.innerHTML.trim()) { const m = AGG.monthsByKey[k]; inner.innerHTML = monthDetail(m, monthFlows(m)); }
    } else OPEN_MONTHS.delete(k);
    return;
  }
  const yb = b.closest('.year-block');
  if (yb && b.classList.contains('year-head')) { if (e.detail.open) OPEN_YEARS.add(yb.dataset.yearBlock); else OPEN_YEARS.delete(yb.dataset.yearBlock); }
}
