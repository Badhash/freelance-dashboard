// ============================================================
// AURORA — « En attente de versement » (#pending) : piste des profit shares
// (écoulé plein, reste pointillé, échéance, trait d’aujourd’hui),
// profit share pas encore émis (carte fantôme), côté client hors total.
// « Mois par mois » (#tab-detail) : journal compact (voyants + micro-barre),
// détail déplié (cascade ligne à ligne, arrivé / en attente / prélevé).
// ============================================================

// État d'affichage (mois et années ouverts, groupe « Côté client »). Il vaut pour un jeu de données :
// quand une section repart d'un hôte vide (premier rendu, ou retour de l'état vide après
// « Tout supprimer », que render() vide), on revient aux valeurs par défaut de la spec.
const OPEN_MONTHS = new Set();
const OPEN_YEARS = new Set();
// Ouvertures par défaut (mois de référence et son année), tant que l'utilisateur n'y a pas touché :
// quand un réimport apporte un nouveau mois de référence, elles le suivent.
const AUTO_OPEN = new Set();
let REF_MOIS = null;
let TRK_CLIENT_OPEN = false;

// Typographie française : espace insécable avant « : » et « ; » (jamais de retour à la ligne devant).
const MO_NB = UI.NBP;
// Accord sur le montant affiché (arrondi à l'euro) : pluriel à partir de 2 €.
const moMany = (v) => Math.round(Math.abs(v)) >= 2;
const moAuditLink = () => `<button class="text-link" type="button" data-act="audit">${icon('shield')}Voir l’audit</button>`;

// ---------------------------------------------------------------- utilitaires mois
function detSplit(arr) {
  const paid = UI.sum((arr || []).filter((d) => d.statut === 'Payé'), 'montant');
  const pend = UI.sum((arr || []).filter((d) => d.statut !== 'Payé'), 'montant');
  return { paid, pend, n: (arr || []).length };
}
// Émission habituelle d'un profit share : le 16 du mois suivant (règle de l'audit et de VM.ghosts).
function monthPsDue(mois) { const { m, y } = UI.mk(mois); return new Date(y, m, 16); }
// Dérivées d'affichage d'un mois (aucun calcul métier modifié : sommes des lignes d'AGG).
function monthFlows(m) {
  const sal = detSplit(m.details_salaire), tr = detSplit(m.details_tickets_resto), ndf = detSplit(m.details_notes_frais);
  const ps = detSplit(m.details_profit_share), coop = detSplit(m.details_cooptation);
  const prel = m.commission_portage + m.charges_salaire + m.charges_profit_share + m.impot_france + m.charges_diverses;
  const prov = m.provision_conges;
  const pourToi = m.salaire_net + m.tickets_resto + m.notes_frais + m.profit_share_total + prov;
  const reste = m.facturation - prel - pourToi;
  // Arrivé / en attente : versements issus du facturé (salaire, tickets, frais, profit share).
  // La cooptation, hors facturation, a sa propre ligne : elle n'entre ni dans ces montants ni dans le % du facturé.
  const arrived = sal.paid + tr.paid + ndf.paid + ps.paid;
  const pending = sal.pend + tr.pend + ndf.pend + ps.pend;
  // Facture client : payée, partiellement payée (une facture réglée, une autre non) ou en attente.
  const invUnpaid = UI.sum(VM.clientPending.filter((c) => c.mois === m.mois), 'montant');
  const invPaid = m.facturation - invUnpaid;
  const invoice = Math.abs(m.facturation) <= 0.005 ? 'none' : invUnpaid <= 0.005 ? 'paid' : m.facturation_payee && invPaid > 0.5 ? 'partial' : 'unpaid';
  // Mois facturé sans aucune ligne de profit share : « pas encore émis » jusqu'à l'émission habituelle
  // (le 16 du mois suivant), puis manquant, comme la règle 7 de l'audit qui le signale en critique.
  const noPs = m.facturation > 0 && ps.n === 0;
  const ghost = noPs ? VM.ghosts.find((g) => g.mois === m.mois) || null : null;
  // Montants affichés (en-tête, tuiles) : dans un mois sans facture, la cooptation est le seul flux,
  // on la compte ; dans un mois facturé, elle reste hors du % du facturé.
  const shownArrived = m.facturation ? arrived : arrived + coop.paid;
  const shownPending = m.facturation ? pending : pending + coop.pend;
  return { sal, tr, ndf, ps, coop, prel, prov, pourToi, reste, arrived, pending, shownArrived, shownPending, invoice, invPaid, invUnpaid, ghost,
    psNotIssued: noPs && !!ghost && !ghost.late, psMissing: noPs && (!ghost || ghost.late) };
}
// Entrée de l'audit (dernier passage, silencieux à chaque rendu) d'une catégorie donnée pour ce mois.
function monthAuditIssue(mois, category) {
  const a = typeof LAST_AUDIT !== 'undefined' ? LAST_AUDIT : null;
  return a ? a.issues.find((i) => i.category === category && i.title.endsWith(' ' + mois)) || null : null;
}
// Reste du CA non réparti (facturé − prélevé − pour toi), qualifié comme la règle 12 de l'audit
// (écart de clôture au-delà de 20 €, mois à prime exclus) : la cascade ne renvoie à l'audit que
// pour un écart qu'il signale vraiment.
function monthGap(m, f) {
  const v = f.reste;
  if (!m.facturation || Math.abs(v) <= 0.5) return null;
  if (v > 0 && f.psNotIssued) return { kind: 'ps', k: 'Pas encore réparti', seg: 'Pas encore réparti (profit share à venir)' };
  if (v > 0 && f.psMissing) return { kind: 'missing', k: 'Non réparti', seg: 'Non réparti (profit share manquant)' };
  const audited = typeof LAST_AUDIT !== 'undefined' && LAST_AUDIT ? !!monthAuditIssue(m.mois, 'equation') : Math.abs(v) > 20;
  if (audited) return { kind: 'audit', k: v < 0 ? 'Écart de clôture (sorties > CA)' : 'Écart de clôture', seg: 'Écart de clôture (voir l’audit)' };
  if (monthAuditIssue(m.mois, 'prime')) return { kind: 'prime', k: 'Écart de clôture', seg: 'Écart de clôture (mois à prime, non audité)' };
  return { kind: 'round', k: 'Écart d’arrondi', seg: 'Écart d’arrondi' };
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
  const gap = monthGap(m, f);
  if (gap && f.reste > 0) s.push({ label: gap.seg, v: f.reste, c: 'transparent', est: true });
  return s.filter((x) => x.v > 0.005);
}
function voyants(m, f) {
  const st = (state, label) => {
    const icn = state === 'ok' ? 'check' : state === 'warn' ? 'clock' : state === 'bad' ? 'alert' : 'circleDashed';
    return `<span class="vy ${state}" title="${UI.esc(label)}">${icon(icn)}</span>`;
  };
  const fact = f.invoice === 'none' ? ['none', `Facture client${MO_NB}: aucune ce mois-ci`]
    : f.invoice === 'paid' ? ['ok', `Facture client${MO_NB}: payée`]
    : f.invoice === 'partial' ? ['warn', `Facture client${MO_NB}: partiellement payée, ${UI.eur0(f.invUnpaid)} en attente`]
    : ['warn', `Facture client${MO_NB}: en attente de paiement`];
  const sal = !f.sal.n ? ['none', `Salaire${MO_NB}: aucun`] : f.sal.pend ? ['warn', `Salaire${MO_NB}: en attente`] : ['ok', `Salaire${MO_NB}: versé`];
  const ps = f.ps.n ? (f.ps.pend ? ['warn', `Profit share${MO_NB}: en attente`] : ['ok', `Profit share${MO_NB}: versé`])
    : f.psMissing ? ['bad', `Profit share${MO_NB}: manquant, voir l’audit`]
    : ['none', f.psNotIssued ? `Profit share${MO_NB}: pas encore émis` : `Profit share${MO_NB}: aucun`];
  return `<span class="vys" role="img" aria-label="${UI.esc([fact[1], sal[1], ps[1]].join(MO_NB + '; '))}">${st(...fact)}${st(...sal)}${st(...ps)}</span>`;
}
function psPillFor(m, f) {
  if (f.psMissing) return UI.pill('danger', 'Manquant', 'alert');
  if (f.psNotIssued) return `<span class="pill muted est">${icon('circleDashed')}Pas encore émis</span>`;
  if (!f.ps.n) return '';
  if (f.ps.pend) return UI.pill('warn', 'En attente', 'clock');
  return UI.pill('ok', 'Versé', 'check');
}

// ---------------------------------------------------------------- piste des profit shares
// Jours écoulés depuis l'émission, rapportés au délai médian quand il est connu.
const moElapsed = (waited, med) => (waited == null ? '' : `${waited} j écoulés${med ? ` sur ~${med}` : ''}`);
// Fin du titre de la piste : « tout devrait être arrivé vers le … » seulement si toutes les
// échéances sont connues et à venir ; sinon on nomme les retards et les échéances inconnues.
function pendingTail(last, n) {
  const late = VM.psLate, undated = VM.psUndated;
  if (late.length || undated.length) {
    const parts = [];
    if (late.length) parts.push(`${late.length > 1 ? `${late.length} en retard` : n > 1 ? '1 en retard' : 'en retard'} (<b>${UI.eur0(UI.sum(late, 'montant'))}</b>)`);
    if (undated.length) parts.push(`${undated.length > 1 ? `${undated.length} sans échéance connue` : n > 1 ? '1 sans échéance connue' : 'sans échéance connue'}`);
    return n > 1 ? `, dont ${parts.join(' et ')}` : `, ${parts.join(', ')}`;
  }
  return last ? `, ${n > 1 ? 'tout devrait être arrivé' : 'attendu'} vers le <b>${UI.dLong(last.eta)}</b>` : '';
}
function renderPendingTrack() {
  const host = document.getElementById('pending');
  if (!host.firstElementChild) TRK_CLIENT_OPEN = false;
  const items = VM.arrivals;
  const ghosts = VM.ghosts;
  const clients = VM.clientPending;
  const last = items.filter((a) => a.eta).slice(-1)[0];
  const n = items.length;
  const head = n
    ? `${n} profit share${n > 1 ? 's' : ''} ${n > 1 ? 'sont' : 'est'} en route vers toi${MO_NB}: <b>${UI.eur0(VM.psSum)}</b>${pendingTail(last, n)}.`
    : VM.psEver ? `Aucun profit share en attente${MO_NB}: tout ce qui a été émis t’a été versé.`
      : `Aucun profit share émis pour l’instant${ghosts.length ? `${MO_NB}: le premier est attendu vers le <b>${UI.dLong(ghosts[0].emit)}</b>` : ''}.`;
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
  // Dates manquantes (émission inconnue, pas encore de délai médian) : on ne trace que ce qui est daté.
  const lane = (o) => {
    const parts = [`<span class="trk-today" style="left:${tx}%"></span>`];
    const clipped = o.emit && o.emit.getTime() < t0;
    if (clipped) parts.push(`<span class="trk-clip">${icon('chevronRight')}</span>`);
    if (o.ghost) {
      if (o.emit && o.eta) parts.push(`<span class="trk-rest ghost" style="left:${pos(o.emit)}%;width:${pos(o.eta) - pos(o.emit)}%"></span>`);
      else if (o.emit) parts.push(`<span class="trk-emit ghost" style="left:${pos(o.emit)}%"></span>`);
    } else if (o.emit) {
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
    const sev = a.waited >= 130 ? 'danger' : a.waited >= 100 || late ? 'warn' : a.left == null ? 'muted' : 'accent';
    // Sans délai médian (aucun profit share encore payé), pas d'échéance : on montre l'attente si elle dépasse les seuils d'audit.
    const longWait = a.left == null && a.waited >= 100;
    const pillTxt = late ? `En retard · +${-a.left} j`
      : a.left == null ? (longWait ? `${a.waited} j d’attente` : 'Échéance inconnue')
      : a.left === 0 ? 'Aujourd’hui' : `J−${a.left}`;
    const emitted = a.date_emission ? `Émis le ${UI.esc(a.date_emission)}` : 'Date d’émission inconnue';
    return `<li class="trk-row${late ? ' late' : ''}">
      <div class="trk-lab"><span class="trk-n"><span class="sw" style="background:var(--c-ps)"></span>Profit share ${UI.monthLower(a.mois)}</span><span class="trk-h">${emitted}${a.eta ? ` · ${late ? 'était attendu' : 'attendu'} vers le ${UI.dShort(a.eta)}` : ''}</span><span class="trk-h trk-h2">${moElapsed(a.waited, VM.med)}</span></div>
      ${lane({ emit: a.emit, eta: a.eta, kind: 'ps', tip: { t: `Profit share ${UI.monthLower(a.mois)}`, v: UI.eur2(a.montant), rows: [['Émis le', a.date_emission || '—'], ['Échéance estimée', a.eta ? UI.dLong(a.eta) : '—'], ['Écoulé', a.waited == null ? '—' : `${a.waited} j${VM.med ? ` sur ~${VM.med}` : ''}`]] } })}
      <div class="trk-val"><span class="v tab">${UI.eur2(a.montant)}</span>${UI.pill(sev, pillTxt, late || longWait ? 'alert' : 'clock')}</div>
    </li>`;
  };
  const ghostRow = (g) => `<li class="trk-row ghost${g.late ? ' late' : ''}">
      <div class="trk-lab"><span class="trk-n"><span class="sw est"></span>Profit share ${UI.monthLower(g.mois)}</span><span class="trk-h">${g.late ? `Pas émis · l’émission était attendue le ${UI.dShort(g.emit)}` : `Pas encore émis · émission habituelle vers le ${UI.dShort(g.emit)}`}</span><span class="trk-h trk-h2">${g.eta ? `Arrivée estimée vers le ${UI.dShort(g.eta)}` : ''}</span></div>
      ${lane({ emit: g.emit, eta: g.eta, ghost: true, tip: { t: `Profit share ${UI.monthLower(g.mois)} (pas encore émis)`, v: 'Montant connu à l’émission', rows: [['Émission habituelle', UI.dLong(g.emit)], ['Arrivée estimée', g.eta ? UI.dLong(g.eta) : '—']] } })}
      <div class="trk-val"><span class="v muted">Montant connu à l’émission</span>${g.late ? UI.pill('danger', 'Émission en retard', 'alert') : `<span class="pill muted est">${icon('circleDashed')}Pas encore émis</span>`}</div>
    </li>`;
  const clientRow = (c) => {
    const late = c.late != null && c.late > 0;
    const emitted = c.date ? `Émise le ${UI.esc(c.date)}` : 'Date d’émission inconnue';
    const pill = late ? UI.pill(c.late > 30 ? 'danger' : 'warn', `+${c.late} j de retard`, 'alert')
      : UI.pill('muted', c.late == null ? 'Échéance inconnue' : c.late === 0 ? 'Aujourd’hui' : `J−${-c.late}`, 'clock');
    return `<li class="trk-row client${late ? ' late' : ''}">
      <div class="trk-lab"><span class="trk-n"><span class="sw" style="background:var(--c-ink)"></span>Facture ${UI.monthLower(c.mois)}</span><span class="trk-h">${emitted}${c.eta ? ` · paiement ${late ? 'était attendu' : 'attendu'} vers le ${UI.dShort(c.eta)}` : ''}</span><span class="trk-h trk-h2">${moElapsed(c.waited, VM.medCA)}</span></div>
      ${lane({ emit: c.emit, eta: c.eta, kind: 'client', tip: { t: `Facture ${UI.monthLower(c.mois)} (hors total)`, v: UI.eur2(c.montant), rows: [['Émise le', c.date || '—'], ['Paiement attendu', c.eta ? UI.dLong(c.eta) : '—'], [late ? 'Retard' : 'Écoulé', late ? `+${c.late} j` : c.waited == null ? '—' : `${c.waited} j${VM.medCA ? ` sur ~${VM.medCA}` : ''}`]] } })}
      <div class="trk-val"><span class="v tab">${UI.eur2(c.montant)}</span>${pill}</div>
    </li>`;
  };
  const clientTot = UI.sum(clients, 'montant');
  const lateN = clients.filter((c) => c.late > 0).length;
  host.innerHTML = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('route')}En attente de versement</span>
        <h2 id="pending-title">${head}</h2>
        <p>Chaque piste part de l’émission. En plein, le temps déjà écoulé${MO_NB}; en pointillé, ce qu’il reste jusqu’à l’échéance estimée (${VM.med ? `émission + ${VM.med} j, le délai médian constaté` : 'connue dès qu’un premier profit share aura été payé, qui donnera le délai médian'}).</p>
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
          <p class="trk-note">Ce que ton client doit encore à ton portage. Ce n’est pas compté dans ce qu’on te doit${MO_NB}: une fois payées, ces factures alimenteront tes prochains profit shares.</p>
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
        [...items.map((a) => [`Profit share ${UI.monthLower(a.mois)}`, UI.eur2(a.montant), a.date_emission || '—', a.eta ? UI.dLong(a.eta) : '—', a.waited == null ? '—' : String(a.waited)]),
         ...ghosts.map((g) => [`Profit share ${UI.monthLower(g.mois)} (pas encore émis)`, '—', 'vers le ' + UI.dLong(g.emit), g.eta ? UI.dLong(g.eta) : '—', '—']),
         ...clients.map((c) => [`Facture client ${UI.monthLower(c.mois)} (hors total)`, UI.eur2(c.montant), c.date || '—', c.eta ? UI.dLong(c.eta) : '—', c.waited == null ? '—' : String(c.waited)])])}
    </article>`;
  UI.$$('.trk-lane[data-tip]', host).forEach((el) => {
    const d = tipData[+el.dataset.tip];
    if (d) UI.bindTip(el, () => UI.ttTitle(d.t) + `<div class="tt-big">${UI.esc(d.v)}</div>` + d.rows.map((r) => UI.ttRow('', r[0], r[1])).join(''));
  });
  host.addEventListener('ui:toggle', onTrackToggle);
}
function onTrackToggle(e) { if (e.target.id === 'trk-client-t') TRK_CLIENT_OPEN = e.detail.open; }

// ---------------------------------------------------------------- mois par mois
// « 22 j × 610 € » n'est écrit que si la multiplication donne bien le facturé ; sinon (plusieurs
// factures à des TJM différents, avoir) on donne le TJM moyen. Sans motif (TJM * jours) : jours inconnus.
function monthDays(m, long) {
  if (!m.jours_travailles) return m.facturation ? 'Jours non précisés' : 'Sans facturation';
  const j = UI.num1(m.jours_travailles);
  const exact = Math.abs(m.jours_travailles * m.tjm - m.facturation) < 1;
  if (long) return exact ? `${j} jours à ${UI.eur0(m.tjm)}` : `${j} jours (TJM moyen ${UI.eur0(m.facturation / m.jours_travailles)})`;
  return exact ? `${j} j × ${UI.eur0(m.tjm)}` : `${j} j · TJM moy. ${UI.eur0(m.facturation / m.jours_travailles)}`;
}
function monthStory(m, f) {
  const { m: mo, y } = UI.mk(m.mois);
  const name = UI.MF[mo - 1] + ' ' + y;
  const arrivedTxt = f.arrived > 0.5
    ? `<b>${UI.eur0(f.arrived)}</b> ${moMany(f.arrived) ? 'sont déjà arrivés' : 'est déjà arrivé'} chez toi`
    : 'Rien n’est encore arrivé chez toi';
  if (!m.facturation) {
    // Mois sans facture : versements et cooptation (hors facturation) arrivés ou en attente.
    const parts = (v, c) => [v > 0.5 ? `<b>${UI.eur0(v)}</b> de versements` : '', c > 0.5 ? `<b>${UI.eur0(c)}</b> de cooptation` : ''].filter(Boolean);
    const got = parts(f.arrived, f.coop.paid), wait = parts(f.pending, f.coop.pend);
    let s0 = `<b>${name}</b>${MO_NB}: aucune facturation ce mois-ci`;
    if (got.length) s0 += `, mais ${got.join(' et ')} ${moMany(f.arrived + f.coop.paid) ? 'arrivés' : 'arrivé'} chez toi`;
    if (wait.length) s0 += `${got.length ? ', et' : ', mais'} ${wait.join(' et ')} en attente`;
    return s0 + '.';
  }
  let s = `<b>${name}</b>${MO_NB}: ${m.jours_travailles ? `<b>${monthDays(m, true)}</b>, soit ` : ''}<b>${UI.eur0(m.facturation)}</b> ${moMany(m.facturation) ? 'facturés' : 'facturé'}`;
  const paidOn = m.facturation_date_paiement ? ' le ' + UI.esc(m.facturation_date_paiement) : '';
  if (f.invoice === 'paid') s += `, réglés par le client${paidOn}. `;
  else if (f.invoice === 'partial') s += `${MO_NB}: <b>${UI.eur0(f.invPaid)}</b> réglés par le client${paidOn}, <b>${UI.eur0(f.invUnpaid)}</b> encore en attente. `;
  else s += ', pas encore réglés par le client. ';
  s += `${arrivedTxt}${f.pending > 0.5 ? `, <b>${UI.eur0(f.pending)}</b> ${moMany(f.pending) ? 'sont' : 'est'} en attente` : ''}.`;
  if (f.psNotIssued) {
    s += ` Le profit share n’est pas encore émis${MO_NB}: il devrait l’être vers le ${UI.endDot(UI.dShort(f.ghost.emit))}`;
  } else if (f.psMissing) {
    s += ` Aucun profit share n’a été émis alors qu’il était attendu vers le ${UI.dLong(monthPsDue(m.mois))}${MO_NB}: l’audit le signale comme manquant.`;
  } else if (f.ps.pend) {
    // Échéance la plus tardive des profit shares en attente du mois (VM.arrivals est trié par échéance).
    const a = VM.arrivals.filter((x) => x.mois === m.mois && x.eta).slice(-1)[0];
    const amt = `Le profit share de <b>${UI.eur0(f.ps.pend)}</b>`;
    if (!a) s += ` ${amt} est en attente.`;
    else if (a.left < 0) s += ` ${amt} était attendu vers le ${UI.dShort(a.eta)}${MO_NB}: en retard de <b>${-a.left} j</b>.`;
    else if (a.left === 0) s += ` ${amt} est attendu aujourd’hui.`;
    else s += ` ${amt} est attendu vers le ${UI.endDot(UI.dShort(a.eta))}`;
  } else if (f.ps.paid) {
    // « Soldé » seulement si rien n'est en attente ET si l'équation de clôture tombe juste.
    const gap = monthGap(m, f);
    if (gap && gap.kind !== 'round') s += ` Profit share versé, mais un écart de clôture de <b>${UI.eur0(Math.abs(f.reste))}</b> reste à expliquer (voir l’audit).`;
    else s += f.invoice === 'paid' && f.pending <= 0.5 ? ` Profit share versé${MO_NB}: ce mois est soldé.` : ' Profit share versé.';
  }
  return s;
}

// Statut d'une nature de versement (salaire, tickets, frais, profit share, cooptation). Un versement :
// sa pastille et sa date d'émission. Plusieurs : pastille de synthèse (« 1 payé · 1 en attente »)
// et une sous-ligne par versement (montant, statut, émission), comme l'ancien détail.
function monthVersements(arr) {
  const list = arr || [];
  const emit = (it) => (it.date_emission ? `Émis le ${UI.esc(it.date_emission)}` : '');
  if (list.length <= 1) return { pill: list[0] ? UI.statusPill(list[0]) : '', meta: list[0] ? emit(list[0]) : '', subs: null };
  const p = list.filter((d) => d.statut === 'Payé').length;
  const q = list.length - p;
  const pill = !q ? UI.pill('ok', `${list.length} versements payés`, 'check')
    : !p ? UI.pill('warn', `${list.length} versements en attente`, 'clock')
    : UI.pill('warn', `${p} payé${p > 1 ? 's' : ''} · ${q} en attente`, 'clock');
  return { pill, meta: '', subs: list.map((it) => ({ v: it.montant, pill: UI.statusPill(it), meta: emit(it) })) };
}

function cascadeRows(m, f) {
  const fact = m.facturation;
  const rows = [];
  const invPill = f.invoice === 'paid' ? UI.pill('ok', 'Payée · ' + (m.facturation_date_paiement || '?'), 'check')
    : f.invoice === 'partial' ? UI.pill('warn', 'Partiellement payée', 'clock') : UI.pill('warn', 'Facture en attente', 'clock');
  const invMeta = f.invoice === 'partial' ? `${UI.eur0(f.invPaid)} réglés${m.facturation_date_paiement ? ' le ' + UI.esc(m.facturation_date_paiement) : ''} · ${UI.eur0(f.invUnpaid)} en attente` : '';
  rows.push({ k: 'CA facturé', v: fact, c: 'var(--c-ink)', pill: invPill, meta: invMeta, head: true });
  // Prélèvements : une valeur négative est une régularisation, affichée avec son signe.
  [['Commission portage', m.commission_portage], ['Charges sociales salaire', m.charges_salaire], ['Charges sur profit share', m.charges_profit_share], ['Impôt à la source (PAS)', m.impot_france], ['Charges diverses', m.charges_diverses]]
    .forEach(([k, v]) => { if (Math.abs(v) > 0.005) rows.push({ k, v, c: 'var(--c-charge)', group: 'prel', pill: v < 0 ? `<span class="pill muted">Régularisation</span>` : '' }); });
  const nat = (k, v, arr, pend, full, tint) => { if (Math.abs(v) > 0.005) rows.push({ k, v, c: pend ? tint : full, ...monthVersements(arr) }); };
  nat('Salaire net (après PAS)', m.salaire_net, m.details_salaire, f.sal.pend, 'var(--c-sal)', 'var(--c-sal-tint)');
  if (m.provision_conges) rows.push({ k: 'Provision congés', v: m.provision_conges, c: 'var(--c-sal-tint)', pill: `<span class="pill muted">${icon('umbrella')}Provisionnée</span>` });
  nat('Tickets restaurant', m.tickets_resto, m.details_tickets_resto, f.tr.pend, 'var(--c-extra)', 'var(--c-extra-tint)');
  nat('Notes de frais', m.notes_frais, m.details_notes_frais, f.ndf.pend, 'var(--c-extra)', 'var(--c-extra-tint)');
  nat('Profit share', m.profit_share_total, m.details_profit_share, f.ps.pend, 'var(--c-ps)', 'var(--c-ps-tint)');
  const gap = monthGap(m, f);
  if (gap) {
    const pill = gap.kind === 'ps' ? `<span class="pill muted est">${icon('circleDashed')}Profit share à venir</span>`
      : gap.kind === 'missing' ? UI.pill('danger', 'Profit share manquant', 'alert') + moAuditLink()
      : gap.kind === 'audit' ? moAuditLink()
      : gap.kind === 'prime' ? `<span class="pill muted">${icon('info')}Mois à prime, non audité</span>` : '';
    rows.push({ k: gap.k, v: f.reste, est: true, pill, last: true });
  }
  // Barres flottantes : chaque poste part du reste courant ; une valeur négative (régularisation,
  // écart quand les sorties dépassent le CA) remonte. L'échelle couvre le CA et ce qui passe sous zéro.
  let run = fact, lo = 0, hi = fact;
  rows.forEach((r) => {
    if (r.head) { r.from = 0; r.to = fact; return; }
    const next = run - r.v;
    r.from = Math.min(run, next); r.to = Math.max(run, next); run = next;
    lo = Math.min(lo, r.from); hi = Math.max(hi, r.to);
  });
  return { rows, lo, hi };
}

function monthDetail(m, f) {
  const fact = m.facturation;
  const pct = (v) => (fact ? v / fact * 100 : 0);
  const signed = (v, fmt) => (v < -0.005 ? '−' + fmt(-v) : fmt(v));
  let casc = '<p class="muted">Aucune facturation ce mois-ci.</p>';
  if (fact > 0) {
    const { rows, lo, hi } = cascadeRows(m, f);
    const x = (v) => (v - lo) / ((hi - lo) || 1) * 100;
    const meta = (t) => (t ? `<span class="c-meta">${t}</span>` : '');
    const sub = (s) => `<div class="casc-r sub" role="row">
        <span class="c-k" role="cell"><span class="sr-only">Versement${MO_NB}: </span>${s.pill}${meta(s.meta)}</span>
        <span class="c-bar" role="presentation"></span>
        <span class="c-v tab" role="cell">${UI.eur2(s.v)}</span>
        <span class="c-pct" role="cell"></span>
      </div>`;
    casc = `
    <div class="casc" role="table" aria-label="Où sont partis les ${UI.esc(UI.eur0(fact))} facturés en ${UI.esc(UI.monthLower(m.mois))}">
      <div class="casc-h" role="row"><span role="columnheader">Où sont partis les ${UI.eur0(fact)} facturés</span><span role="columnheader" class="c-pct">% du CA</span></div>
      ${rows.map((r, i) => `<div class="casc-r${r.head ? ' head' : ''}${r.est ? ' est' : ''}${r.v < -0.005 ? ' neg' : ''}${r.group === 'prel' && (!rows[i - 1] || rows[i - 1].group !== 'prel') ? ' first-prel' : ''}" role="row">
        <span class="c-k" role="cell"><span class="c-n">${UI.esc(r.k)}</span>${r.pill || ''}${meta(r.meta)}</span>
        <span class="c-bar" role="presentation"><i style="left:${x(r.from)}%;width:${Math.max(.5, x(r.to) - x(r.from))}%;${r.est ? '' : `background:${r.c};`}animation-delay:${i * 40}ms"></i></span>
        <span class="c-v tab${r.head ? ' ledger-total' : ''}" role="cell">${signed(r.v, UI.eur2)}</span>
        <span class="c-pct tab" role="cell">${signed(pct(r.v), UI.pct1)}</span>
      </div>${r.subs ? r.subs.map(sub).join('') : ''}`).join('')}
    </div>`;
  }
  const coopV = monthVersements(m.details_cooptation);
  const coop = m.cooptation_revenu > 0.005 ? `<div class="md-extra"><span class="sw" style="background:var(--c-extra)"></span><span>Hors facturation${MO_NB}: cooptation <b>${UI.eur2(m.cooptation_revenu)}</b></span>${coopV.subs
    ? coopV.subs.map((s) => `<span class="md-v">${s.pill}<span class="c-meta">${UI.eur2(s.v)}${s.meta ? ' · ' + s.meta : ''}</span></span>`).join('')
    : `${coopV.pill}${coopV.meta ? `<span class="c-meta">${coopV.meta}</span>` : ''}`}</div>` : '';
  const regul = [m.commission_portage, m.charges_salaire, m.charges_profit_share, m.impot_france, m.charges_diverses].some((v) => v < -0.005);
  const due = f.psMissing ? monthPsDue(m.mois) : null;
  const g = f.ghost;
  return `
    <p class="story">${monthStory(m, f)}</p>
    <div class="md-grid">
      ${casc}
      <div class="md-side">
        <div class="md-tile ok"><span class="mt-l">${icon('check')}Arrivé chez toi</span><span class="mt-v tab">${UI.eur2(f.shownArrived)}</span><span class="mt-h">${fact ? UI.pct0(f.arrived / fact * 100) + ' du facturé · ' : ''}versements payés uniquement</span></div>
        <div class="md-tile warn"><span class="mt-l">${icon('clock')}Encore en attente</span><span class="mt-v tab">${UI.eur2(f.shownPending)}</span><span class="mt-h">${f.prov ? `+ ${UI.eur0(f.prov)} de provision congés, comptés dans ton total à récupérer` : 'émis, pas encore versés'}</span></div>
        <div class="md-tile"><span class="mt-l">${icon('receipt')}Prélevé</span><span class="mt-v tab">${UI.eur2(f.prel)}</span><span class="mt-h">commission, charges sociales, PAS${regul ? ', net des régularisations' : ''}</span></div>
        ${f.psNotIssued ? `<div class="md-ghost"><span class="mt-l">${icon('circleDashed')}Profit share ${UI.esc(UI.monthLower(m.mois))}</span><span class="mt-h">Pas encore émis. Émission habituelle vers le <b>${UI.dShort(g.emit)}</b>${g.eta ? `, arrivée estimée vers le <b>${UI.dShort(g.eta)}</b>` : ''}</span></div>` : ''}
        ${f.psMissing ? `<div class="md-ghost bad"><span class="mt-l">${icon('alert')}Profit share ${UI.esc(UI.monthLower(m.mois))}</span><span class="mt-h">Manquant${MO_NB}: rien n’a été émis alors que l’émission était attendue vers le <b>${UI.dLong(due)}</b>.</span>${moAuditLink()}</div>` : ''}
        ${coop}
      </div>
    </div>`;
}

function monthRow(m) {
  const { m: mo, y } = UI.mk(m.mois);
  const f = monthFlows(m);
  const open = OPEN_MONTHS.has(m.mois);
  const segs = monthSegs(m, f);
  // MOIS est validé avant tout rendu (render.js) ; échappé ici en défense en profondeur.
  const id = UI.esc(m.mois);
  const arrPct = m.facturation ? f.arrived / m.facturation * 100 : null;
  const split = m.facturation > 0
    ? `<span class="mini-split" aria-hidden="true">${segs.map((s) => `<span class="${s.est ? 'est' : ''}" style="flex:${s.v} 1 0;background:${s.c}"></span>`).join('')}</span><span class="mini-cap">${UI.pct0(arrPct)} arrivé chez toi</span>`
    : m.cooptation_revenu > 0.005 ? `<span class="mini-cap">Cooptation ${UI.eur0(m.cooptation_revenu)} · hors facturation</span>` : '';
  return `
    <div class="mrow${open ? ' is-open' : ''}" data-mois="${id}" data-fold-root>
      <button class="mhead" type="button" id="mh-${id}" ${UI.toggleAttrs('md-' + id, open)}>
        ${voyants(m, f)}
        <span class="m-n"><span class="mname">${UI.MF[mo - 1]} <small>${y}</small></span><span class="mdays">${monthDays(m)}</span></span>
        <span class="m-s">${split}</span>
        <span class="mcol m-v"><span class="k">Facturé</span><span class="x">${m.facturation ? UI.eur0(m.facturation) : '—'}</span></span>
        <span class="mcol m-r"><span class="k">Arrivé chez toi</span><span class="x${f.shownArrived ? '' : ' dim'}">${f.shownArrived ? UI.eur0(f.shownArrived) : '—'}</span></span>
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
  // Section vide : premier rendu ou nouveau jeu après « Tout supprimer » : état par défaut
  // (dernier mois ouvert, année en cours ouverte, années clôturées repliées).
  // Mois de référence (titre, mois ouvert par défaut) : le dernier mois facturé (VM.curY / VM.lastM,
  // comme les KPI et la constellation), pas un mois final qui n'aurait que des lignes annexes ;
  // à défaut de toute facturation, le dernier mois de l'historique.
  const refM = AGG.monthsByKey[UI.key(VM.lastM, VM.curY)] || AGG.months[AGG.months.length - 1];
  if (!host.firstElementChild) {
    OPEN_MONTHS.clear(); OPEN_YEARS.clear(); AUTO_OPEN.clear(); REF_MOIS = null;
  }
  if (refM.mois !== REF_MOIS) {
    AUTO_OPEN.forEach((k) => { OPEN_MONTHS.delete(k); OPEN_YEARS.delete(k); });
    AUTO_OPEN.clear();
    OPEN_MONTHS.add(refM.mois); OPEN_YEARS.add(VM.curY);
    AUTO_OPEN.add(refM.mois); AUTO_OPEN.add(VM.curY);
    REF_MOIS = refM.mois;
  }
  const rf = monthFlows(refM);
  const anyMissing = AGG.months.some((m) => monthFlows(m).psMissing);
  host.innerHTML = `
    <header class="section-head">
      <div>
        <span class="eyebrow">${icon('list')}Mois par mois</span>
        <h2 id="months-title">${UI.esc(UI.monthLabel(refM.mois))}${MO_NB}: ${refM.facturation ? `<b>${UI.eur0(refM.facturation)}</b> ${moMany(refM.facturation) ? 'facturés' : 'facturé'}` : 'aucune facturation'}, ${rf.shownArrived > 0.5 ? `<b>${UI.eur0(rf.shownArrived)}</b> déjà ${moMany(rf.shownArrived) ? 'arrivés' : 'arrivé'} chez toi` : 'rien n’est encore arrivé chez toi'}.</h2>
        <p>Ouvre un mois pour voir où est parti chaque euro facturé, et ce qui est payé ou non.</p>
      </div>
    </header>
    <div class="m-legend" aria-hidden="true">
      <span class="ml-g"><span class="ml-k">État (facture · salaire · profit share)</span><span class="ml-i"><span class="vy ok">${icon('check')}</span>Payé</span><span class="ml-i"><span class="vy warn">${icon('clock')}</span>En attente</span><span class="ml-i"><span class="vy none">${icon('circleDashed')}</span>Pas encore émis</span>${anyMissing ? `<span class="ml-i"><span class="vy bad">${icon('alert')}</span>Manquant (voir l’audit)</span>` : ''}</span>
      <span class="ml-g"><span class="ml-k">Répartition</span><span class="ml-i"><i class="sw" style="background:var(--c-charge)"></i>Prélevé</span><span class="ml-i"><i class="sw" style="background:var(--c-sal)"></i>Salaire</span><span class="ml-i"><i class="sw" style="background:var(--c-extra)"></i>Frais, tickets</span><span class="ml-i"><i class="sw" style="background:var(--c-ps)"></i>Profit share</span><span class="ml-i"><i class="sw" style="background:var(--c-ps-tint)"></i>Teinte${MO_NB}: en attente</span><span class="ml-i"><i class="sw est"></i>Pas encore réparti</span></span>
    </div>
    ${years.map((y) => {
      const ms = AGG.months.filter((m) => m.mois.endsWith('-' + y)).reverse();
      const st = VM.sy[y];
      const n = ms.length;
      const enCours = y === todayY && n < 12;
      const open = OPEN_YEARS.has(y);
      const ye = UI.esc(y);
      return `<div class="year-block${open ? ' is-open' : ''}" id="months-${ye}" data-year-block="${ye}" data-fold-root>
        <h3 class="fold-h"><button class="year-head" type="button" id="yh-${ye}" ${UI.toggleAttrs('yl-' + ye, open)}>
          <span class="y">${ye}</span><span class="chip${enCours ? ' accent' : ''}">${n} mois ${enCours ? 'en cours' : 'clôturé' + (n > 1 ? 's' : '')}</span>
          <span class="ym"><b>${UI.eur0(st.ca)}</b> facturés · <b>${UI.num1(st.jours)} j</b> · TJM moyen <b>${UI.eur0(st.tjm)}</b></span>
          <span class="yh-more" aria-hidden="true">${n > 1 ? `Voir les ${n} mois` : 'Voir le mois'}</span><span class="chev">${icon('chevron')}</span>
        </button></h3>
        <div class="fold-body${open ? ' is-open' : ''}" id="yl-${ye}" role="region" aria-labelledby="yh-${ye}"><div>
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
    UI.$$('.mini-split > span', row).forEach((sp, i) => sp.setAttribute('title', `${segs[i].label}${MO_NB}: ${UI.eur2(segs[i].v)}`));
  });
}
function onMonthsToggle(e) {
  const b = e.target;
  const row = b.closest('.mrow');
  if (row && b.classList.contains('mhead')) {
    const k = row.dataset.mois;
    AUTO_OPEN.delete(k);
    if (e.detail.open) {
      OPEN_MONTHS.add(k);
      const inner = row.querySelector('.md-in');
      if (inner && !inner.innerHTML.trim()) { const m = AGG.monthsByKey[k]; inner.innerHTML = monthDetail(m, monthFlows(m)); }
    } else OPEN_MONTHS.delete(k);
    return;
  }
  const yb = b.closest('.year-block');
  if (yb && b.classList.contains('year-head')) {
    AUTO_OPEN.delete(yb.dataset.yearBlock);
    if (e.detail.open) OPEN_YEARS.add(yb.dataset.yearBlock); else OPEN_YEARS.delete(yb.dataset.yearBlock);
  }
}
