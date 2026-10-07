// ============================================================
// AURORA — primitives partagées (namespace UI) : formats fr-FR, dates,
// petits composants HTML (pastilles, barre 100 %, légende), primitives SVG,
// infobulle unique, registre de graphiques redessinés au redimensionnement,
// repliables génériques (contrat data-qa-toggle).
// Chargé après data.js et icons.js, avant les render-*.js.
// Aucune dépendance, aucun calcul métier.
// ============================================================
const UI = (() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------------------------------------------------------------- formats
  // fr-FR sépare les milliers par U+202F (espace fine). Avec Manrope serré elle
  // disparaît presque : on la remplace par l'espace insécable U+00A0.
  const NB = ' ';
  const mkNF = (o) => { const f = new Intl.NumberFormat('fr-FR', o); return (n) => f.format(n).replace(/ /g, NB); };
  const nf0 = mkNF({ maximumFractionDigits: 0 });
  const nf1 = mkNF({ minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const nf2 = mkNF({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r0 = (n) => Math.round(n) || 0;
  const int = (n) => nf0(r0(n));
  const num1 = (n) => nf1(Math.round(n * 10) / 10 || 0);
  const eur0 = (n) => int(n) + NB + '€';
  const eur2 = (n) => nf2(n || 0) + NB + '€';
  const eur0z = (n) => (Math.abs(n) < 0.5 ? '—' : eur0(n));
  const eur2z = (n) => (Math.abs(n) < 0.005 ? '—' : eur2(n));
  const signed2 = (n, sign) => (Math.abs(n) < 0.005 ? '—' : sign + eur2(Math.abs(n)));
  const pct0 = (n) => nf0(r0(n)) + NB + '%';
  const pct1 = (n) => nf1(Math.round(n * 10) / 10 || 0) + NB + '%';
  const kEur = (n) => (n === 0 ? '0' : Math.abs(n) >= 1000 ? nf1(n / 1000) + NB + 'k€' : nf0(n) + NB + '€');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (arr, f) => arr.reduce((a, x) => a + (typeof f === 'function' ? f(x) : (f ? x[f] : x) || 0), 0);
  // Montant héros / grands montants : partie entière + décimales et € atténués.
  const money = (n, cents) => {
    const s = cents ? nf2(n) : int(n);
    const [i, d] = s.split(',');
    return `<span class="m-int">${i}</span>${cents ? `<span class="m-dec">,${d}</span>` : ''}<span class="m-cur">${NB}€</span>`;
  };

  // ---------------------------------------------------------------- dates
  const MS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MF = monthNamesFull; // data.js
  const DAY = 86400000;
  const mk = (mois) => { const p = mois.split('-'); return { m: +p[0], y: +p[1] }; };
  const key = (m, y) => String(m).padStart(2, '0') + '-' + y;
  const byMois = (a, b) => { const A = mk(a.mois), B = mk(b.mois); return A.y - B.y || A.m - B.m; };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysDiff = (a, b) => Math.round((b - a) / DAY);
  const dShort = (d) => (d.getDate() === 1 ? '1er' : d.getDate()) + NB + MS[d.getMonth()];
  const dLong = (d) => (d.getDate() === 1 ? '1er' : d.getDate()) + NB + MF[d.getMonth()].toLowerCase() + NB + d.getFullYear();
  const monthLabel = (mois) => { const { m, y } = mk(mois); return MF[m - 1] + ' ' + y; };
  const monthLower = (mois) => { const { m, y } = mk(mois); return MF[m - 1].toLowerCase() + ' ' + y; };
  const endDot = (s) => (/\.$/.test(s) ? s : s + '.');
  const deMois = (m) => (/^[aeiou]/i.test(MF[m - 1]) ? 'd’' : 'de ') + MF[m - 1].toLowerCase();

  // ---------------------------------------------------------------- composants HTML
  const pill = (kind, text, ic) => `<span class="pill ${kind}">${ic ? icon(ic) : ''}${esc(text)}</span>`;
  const statusPill = (it) => (it.statut === 'Payé'
    ? pill('ok', 'Payé · ' + (it.date_paiement || '?'), 'check')
    : pill('warn', 'En attente', 'clock'));
  const delta = (a, b) => (b ? (a - b) / b * 100 : null);
  const deltaPill = (d, title) => {
    if (d === null || !isFinite(d)) return '';
    const up = d >= 0;
    return `<span class="delta ${up ? 'up' : 'down'}" title="${esc(title || '')}">${icon(up ? 'trending' : 'trendDown')}${up ? '+' : '−'}${pct1(Math.abs(d))}<span class="sr-only"> ${esc(title || '')}</span></span>`;
  };
  // Barre 100 % : segs = [{ label, v, c (couleur CSS), est (contour pointillé) }]
  const splitBar = (segs, label, cls) => `<div class="split${cls ? ' ' + cls : ''}" role="img" aria-label="${esc(label)}">${segs.map((s, i) =>
    `<span tabindex="0" data-seg="${i}" class="${s.est ? 'est' : ''}" style="flex:${Math.max(s.v, 0)} 1 0;background:${s.c};animation-delay:${i * 80}ms" aria-label="${esc(s.label)} : ${esc(eur2(s.v))}"></span>`).join('')}</div>`;
  const bindSplit = (root, segs, total, title) => {
    $$('.split > span[data-seg]', root).forEach((el) => {
      const s = segs[+el.dataset.seg];
      bindTip(el, () => ttTitle(title) + `<div class="tt-big">${esc(eur2(s.v))}</div>` + ttRow(s.est ? '' : s.c, s.label, pct1(s.v / (total || 1) * 100)));
    });
  };
  const legendList = (segs, total) => `<ul class="split-legend">${segs.map((s) =>
    `<li><span class="sw${s.est ? ' est' : ''}" style="background:${s.c}"></span><span>${esc(s.label)}</span><span class="v">${esc(eur0(s.v))}<small>${esc(pct0(s.v / (total || 1) * 100))}</small></span></li>`).join('')}</ul>`;

  // ---------------------------------------------------------------- SVG
  const niceStep = (raw) => {
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  };
  const scaleY = (max, n) => {
    const step = niceStep((max || 1) / (n || 3));
    const top = Math.ceil((max || 1) / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-6; v += step) ticks.push(v);
    return { top, ticks };
  };
  const svg = (w, h, inner, label) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
  // rectangle à extrémité de données arrondie (haut), base carrée
  const rtop = (x, y, w, h, r) => {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };
  const uid = (() => { let i = 0; return (p) => (p || 'u') + '-' + (++i); })();
  // Tableau jumeau pour lecteurs d'écran (chaque graphique en a un)
  const srTable = (caption, head, rows) => `<div class="sr-only"><table><caption>${esc(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  // ---------------------------------------------------------------- infobulle unique (#tooltip)
  let TT = null;
  const tt = () => (TT || (TT = document.getElementById('tooltip')));
  function ttShow(html, x, y) {
    const el = tt(); if (!el) return;
    el.innerHTML = html;
    el.hidden = false;
    const r = el.getBoundingClientRect();
    let left = x + 14;
    if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 14);
    let top = y - r.height - 14;
    if (top < 8) top = y + 18;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
  function ttHide() { const el = tt(); if (el) el.hidden = true; }
  function bindTip(el, fn) {
    const show = (e) => ttShow(fn(), e.clientX, e.clientY);
    el.addEventListener('pointerenter', show);
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', ttHide);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); ttShow(fn(), r.left + r.width / 2, r.top); });
    el.addEventListener('blur', ttHide);
  }
  const ttRow = (color, label, value) => `<div class="tt-r"><span class="tt-k">${color ? `<i style="background:${color}"></i>` : ''}${esc(label)}</span><span class="tt-v">${esc(value)}</span></div>`;
  const ttTitle = (t) => `<div class="tt-t">${esc(t)}</div>`;

  // ---------------------------------------------------------------- registre de graphiques
  // Chaque section enregistre ses fonctions de dessin ; render() vide le registre,
  // le redimensionnement (largeur seulement) les rejoue toutes.
  const charts = new Map();
  function chart(k, fn) { charts.set(k, fn); try { fn(); } catch (e) { console.error('Graphique', k, e); } }
  function redraw() { charts.forEach((fn, k) => { try { fn(); } catch (e) { console.error('Graphique', k, e); } }); }
  function resetCharts() { charts.clear(); ttHide(); }

  // ---------------------------------------------------------------- repliables génériques
  // Contrat : <button type="button" data-qa-toggle aria-expanded="false" aria-controls="ID">
  // La cible #ID (classe .fold-body) reçoit .is-open ; l'ancêtre [data-fold-root] aussi.
  // Un événement « ui:toggle » (detail.open) remonte pour mémoriser l'état.
  function setOpen(b, open) {
    b.setAttribute('aria-expanded', String(open));
    const t = document.getElementById(b.getAttribute('aria-controls'));
    if (t) t.classList.toggle('is-open', open);
    const root = b.closest('[data-fold-root]');
    if (root) root.classList.toggle('is-open', open);
    b.dispatchEvent(new CustomEvent('ui:toggle', { bubbles: true, detail: { open } }));
  }
  const toggleAttrs = (id, open) => `data-qa-toggle aria-expanded="${open ? 'true' : 'false'}" aria-controls="${id}"`;

  let inited = false;
  function init() {
    if (inited) return; inited = true;
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-qa-toggle]');
      if (!b || !b.getAttribute('aria-controls')) return;
      setOpen(b, b.getAttribute('aria-expanded') !== 'true');
    });
    let rt = null, lastW = innerWidth;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (innerWidth !== lastW) { lastW = innerWidth; redraw(); } }, 120);
    });
    addEventListener('scroll', ttHide, { passive: true });
  }

  return {
    $, $$, NB, int, num1, eur0, eur2, eur0z, eur2z, signed2, pct0, pct1, kEur, esc, sum, money,
    MS, MF, DAY, mk, key, byMois, addDays, daysDiff, dShort, dLong, monthLabel, monthLower, deMois, endDot,
    pill, statusPill, delta, deltaPill, splitBar, bindSplit, legendList,
    niceStep, scaleY, svg, rtop, uid, srTable,
    ttShow, ttHide, bindTip, ttRow, ttTitle,
    chart, redraw, resetCharts, setOpen, toggleAttrs, init
  };
})();
