// ==UserScript==
// @name         Reecho — Export CSV Dashboard
// @namespace    https://github.com/naderhassan/reecho-dashboard
// @version      2.1.0
// @description  Ajoute un bouton pour exporter toutes les opérations du compte d'activité en CSV (format du dashboard)
// @match        https://intranet.reecho.eu/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// v2 : nouvel outil Reecho (React + shadcn/ui). L'ancien ciblait un tableau
// Material UI ; celui-ci lit l'onglet « Opérations » du compte d'activité et
// produit EXACTEMENT le format de l'ancien export, pour que parseCSV() et
// rowKey() du dashboard (data.js) retrouvent les mêmes lignes qu'avant :
//   - en-têtes historiques (avec « arrow_drop_up arrow_drop_down ») ;
//   - dates JJ/MM/AAAA (le nouvel outil affiche AAAA-MM-JJ) ;
//   - montants dans le sens naturel de leur nature, donc positifs (le nouvel
//     outil signe du point de vue du compte : crédits « + », charges et
//     revenus versés « − ») ;
//   - « — » (pas de date de paiement) exporté vide.
//
// v2.1 : intranet.reecho.eu (le script ne se chargeait pas ailleurs) ; colonne
// « Statut » (anciennement « Encaissé/Payé ») ; pagination « Pagination des
// opérations / Page suivante » ; nature lue dans l'attribut title (le tableau
// affiche « Facturation… » sans le préfixe « Crédit - ») ; libellés renommés
// ramenés aux libellés historiques que connaît le dashboard (NATURE_ALIASES).

(function () {
    'use strict';

    // Colonnes attendues par parseCSV() du dashboard, dans l'ordre de l'ancien export.
    const DASHBOARD_HEADERS = [
        'DATE arrow_drop_up arrow_drop_down',
        'MOIS',
        'RÉFÉRENCE',
        'DESCRIPTION',
        'NATURE arrow_drop_up arrow_drop_down',
        'MONTANT HT',
        'ENCAISSÉ/PAYÉ',
        'DATE PAIEMENT arrow_drop_up arrow_drop_down'
    ];

    // Intitulés normalisés du tableau Opérations (le premier trouvé gagne) -> champ exporté,
    // dans l'ordre de DASHBOARD_HEADERS.
    const COLUMNS = [
        [['date'], 'date'],
        [['mois'], 'mois'],
        [['reference'], 'reference'],
        [['description'], 'description'],
        [['nature'], 'nature'],
        [['montant ht', 'montant'], 'montant'],
        [['statut', 'encaisse/paye'], 'statut'],
        [['date paiement'], 'datePaiement']
    ];

    // Le dashboard ne reconnaît que les libellés historiques (data.js les compare à
    // l'identique). L'intranet en a renommé certains : on les ramène ici, sans toucher
    // au dashboard. Clés comparées sans accents ni casse. Toute autre nature inconnue
    // est exportée telle quelle et signalée à la fin de l'export.
    const NATURE_ALIASES = {
        'Crédit - Facturation uu': 'Crédit - Facturation',
        'Charges - Charges et frais structure': 'Charges - Salaire',
        'Charges - Frais LLP': 'Charges - Profit Share'
    };

    // Natures et statuts que data.js sait interpréter.
    const KNOWN_NATURES = [
        'Crédit - Facturation', 'Crédit - Cooptation', 'Crédit - Refacturation Client',
        'Charges - Commission Portage', 'Charges - Charges', 'Charges - Salaire',
        'Charges - Impot France', 'Charges - Profit Share',
        'Revenu - Salaire NET (Après impot)', 'Revenu - Provision Congés',
        'Revenu - Note de frais', 'Revenu - Note de frais (Refacturation Client)',
        'Revenu - Ticket Restaurant', 'Revenu - Profit Share', 'Revenu - Dividendes - Cooptation'
    ];
    const KNOWN_STATUTS = ['Payé', 'Non payé'];

    const BOM = String.fromCharCode(0xFEFF);

    // ============================================================
    // STYLES / UI
    // ============================================================
    const style = document.createElement('style');
    style.textContent = `
        #reecho-export-btn {
            position: fixed; bottom: 32px; right: 32px; z-index: 9999;
            display: inline-flex; align-items: center; gap: 10px;
            padding: 14px 22px; background: #1A1D26; color: #E4C068;
            border: 1px solid #E4C068; border-radius: 6px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.08em; cursor: pointer;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
            transition: all 0.2s; user-select: none;
        }
        #reecho-export-btn:hover {
            background: #E4C068; color: #0E0F13;
            transform: translateY(-2px);
            box-shadow: 0 12px 32px rgba(228, 192, 104, 0.3);
        }
        #reecho-export-btn:active { transform: translateY(0); }
        #reecho-export-btn.loading { pointer-events: none; opacity: 0.6; }
        #reecho-export-btn svg { width: 18px; height: 18px; flex: none; }
        #reecho-export-toast {
            position: fixed; bottom: 100px; right: 32px; z-index: 9999;
            padding: 14px 20px; background: #14161C; color: #EEF0F5;
            border-left: 4px solid #4ADE80; border-radius: 4px;
            font-family: -apple-system, sans-serif; font-size: 13px; line-height: 1.45;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            opacity: 0; transform: translateY(20px); pointer-events: none;
            transition: all 0.3s; max-width: 420px; white-space: pre-line;
        }
        #reecho-export-toast.visible { opacity: 1; transform: translateY(0); }
        #reecho-export-toast.warn { border-left-color: #E4C068; }
        #reecho-export-toast.error { border-left-color: #EF5A5A; }
    `;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'reecho-export-btn';
    btn.type = 'button';
    btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>' +
        '<span class="re-txt">Exporter CSV</span>';
    btn.style.display = 'none';
    btn.addEventListener('click', handleExport);
    document.body.appendChild(btn);

    const toast = document.createElement('div');
    toast.id = 'reecho-export-toast';
    document.body.appendChild(toast);

    // kind : '' (succès), 'warn' (export fait, à vérifier) ou 'error' (export annulé).
    function showToast(msg, kind = '') {
        toast.textContent = msg;
        toast.classList.toggle('warn', kind === 'warn');
        toast.classList.toggle('error', kind === 'error');
        toast.classList.add('visible');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => toast.classList.remove('visible'), kind ? 12000 : 5000);
    }

    function setLoading(loading, text) {
        btn.classList.toggle('loading', loading);
        btn.querySelector('.re-txt').textContent = text || 'Exporter CSV';
    }

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    // Application monopage : le bouton n'apparaît que là où se trouve le compte d'activité.
    let exporting = false;
    function refreshVisibility() {
        if (exporting) return;
        btn.style.display = (findOperationsTab() || findOperationsTable()) ? '' : 'none';
    }
    refreshVisibility();
    setInterval(refreshVisibility, 1000);

    // ============================================================
    // LECTURE DU DOM
    // ============================================================
    const norm = (s) => String(s || '')
        .normalize('NFD').replace(/\p{M}/gu, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();

    const cellText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

    // Le tableau raccourcit certaines cellules à l'écran (la nature perd son préfixe
    // « Crédit - », « Charges - »...) ; l'attribut title porte le libellé complet.
    function fullText(td) {
        const text = cellText(td);
        const title = (td.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        return title && norm(title).includes(norm(text)) ? title : text;
    }

    const NATURE_BY_KEY = new Map(Object.entries(NATURE_ALIASES).map(([from, to]) => [norm(from), to]));
    const KNOWN_NATURE_KEYS = new Set(KNOWN_NATURES.map(norm));
    const KNOWN_STATUT_KEYS = new Set(KNOWN_STATUTS.map(norm));

    // Libellé de nature tel que le dashboard le connaît.
    const dashboardNature = (nature) => NATURE_BY_KEY.get(norm(nature)) || nature;

    // Portée de la lecture : l'onglet Opérations (les autres onglets ont leurs propres compteurs).
    function operationsScope() {
        const found = findOperationsTable();
        return (found && found.table.closest('[role="tabpanel"]')) || document;
    }

    function findOperationsTab() {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        return tabs.find(t => /-trigger-operations$/.test(t.id)) ||
               tabs.find(t => norm(t.textContent) === 'operations') || null;
    }

    function findOperationsTable() {
        for (const table of document.querySelectorAll('table')) {
            const heads = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent));
            if (heads.includes('nature') && (heads.includes('montant ht') || heads.includes('montant'))) return { table, heads };
        }
        return null;
    }

    function columnIndexes(heads) {
        const idx = {};
        const missing = [];
        for (const [labels, field] of COLUMNS) {
            const i = labels.map(l => heads.indexOf(l)).find(n => n !== -1);
            if (i === undefined) missing.push(labels[0]);
            idx[field] = i;
        }
        if (missing.length) throw new Error('Colonnes introuvables dans le tableau : ' + missing.join(', '));
        return idx;
    }

    // Lignes de la page affichée, déjà converties au format du dashboard.
    function readPageRows() {
        const found = findOperationsTable();
        if (!found) throw new Error('Tableau des opérations introuvable');
        const idx = columnIndexes(found.heads);
        const out = [];
        for (const tr of found.table.querySelectorAll('tbody tr')) {
            const cells = tr.querySelectorAll('td');
            // Ligne de détail dépliée ou état vide (colspan) : pas une opération.
            if (cells.length !== found.heads.length) continue;
            const raw = {};
            for (const field in idx) raw[field] = fullText(cells[idx[field]]);
            if (!raw.nature || !raw.mois) continue;
            out.push([
                toFrDate(raw.date),
                toDashboardMonth(raw.mois),
                raw.reference,
                raw.description,
                dashboardNature(raw.nature),
                formatAmount(toNaturalAmount(parseDisplayedAmount(raw.montant), raw.nature)),
                raw.statut,
                toFrDate(raw.datePaiement)
            ]);
        }
        return out;
    }

    // ============================================================
    // CONVERSIONS
    // ============================================================
    // "2026-09-30" -> "30/09/2026" ; "—" -> "" ; tout autre format est laissé tel quel.
    function toFrDate(text) {
        const t = (text || '').trim();
        const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
        return /\d/.test(t) ? t : '';
    }

    // Le dashboard groupe par "MM-AAAA" ; on accepte aussi "AAAA-MM" par prudence.
    function toDashboardMonth(text) {
        const t = (text || '').trim();
        const ym = t.match(/^(\d{4})-(\d{2})$/);
        return ym ? `${ym[2]}-${ym[1]}` : t;
    }

    // "+ 13 420,00 €" -> 13420 ; "− 805,20 €" (signe moins U+2212) -> -805.2
    function parseDisplayedAmount(text) {
        const t = (text || '').trim();
        const first = t.charCodeAt(0);
        const negative = first === 0x2d || first === 0x2212 || first === 0x2013;
        const value = parseFloat(t.replace(/[^\d,]/g, '').replace(',', '.'));
        if (Number.isNaN(value)) throw new Error(`Montant illisible : "${text}"`);
        return negative ? -value : value;
    }

    // Sens naturel de la nature : un « Crédit » est positif quand il entre, une
    // « Charge » ou un « Revenu » est positif quand il sort. Une régularisation
    // (signe inverse de l'habitude) reste donc négative, comme dans l'ancien export.
    function toNaturalAmount(signed, nature) {
        return norm(nature).startsWith('credit') ? signed : -signed;
    }

    function formatAmount(n) {
        return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
    }

    // ============================================================
    // NAVIGATION (onglet, filtres, pagination)
    // ============================================================
    // Les onglets Radix s'activent sur mousedown, pas sur click.
    function pressTab(el) {
        const opts = { bubbles: true, cancelable: true, button: 0 };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.click();
    }

    async function waitFor(check, timeoutMs, errorMsg) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const v = check();
            if (v) return v;
            await wait(150);
        }
        throw new Error(errorMsg);
    }

    async function ensureOperationsTab() {
        const tab = findOperationsTab();
        if (tab && tab.getAttribute('aria-selected') !== 'true') {
            pressTab(tab);
            await waitFor(() => findOperationsTab()?.getAttribute('aria-selected') === 'true',
                5000, "Impossible d'ouvrir l'onglet Opérations");
        }
        await waitFor(() => findOperationsTable(), 10000, 'Tableau des opérations introuvable');
        await wait(300);
    }

    // "239 / 239 opération(s)" : un écart veut dire recherche ou filtre actif.
    function getFilterCounter() {
        for (const el of operationsScope().querySelectorAll('span')) {
            const m = cellText(el).match(/^(\d+)\s*\/\s*(\d+)\s+op/i);
            if (m) return { shown: +m[1], total: +m[2] };
        }
        return null;
    }

    // "1–25 sur 239 opérations"
    function getRangeInfo() {
        for (const el of operationsScope().querySelectorAll('span')) {
            const m = cellText(el).match(/^(\d+)\s*[^\d\s]\s*(\d+)\s+sur\s+(\d+)\s+op/i);
            if (m) return { from: +m[1], to: +m[2], total: +m[3], text: m[0] };
        }
        return null;
    }

    // « Pagination des opérations » (ou « pagination » pour le composant shadcn par défaut).
    function paginationNav() {
        return operationsScope().querySelector('nav[aria-label*="pagination" i]');
    }

    // Boutons « Page suivante » / « Page précédente » : icône seule, donc repérés par aria-label.
    function findPagerLink(kind) {
        const nav = paginationNav();
        if (!nav) return null;
        const re = kind === 'next' ? /suivant|next/i : /pr[eé]c[eé]dent|previous/i;
        return [...nav.querySelectorAll('a, button')].find(a =>
            re.test(a.getAttribute('aria-label') || '') || re.test(a.textContent)) || null;
    }

    function findPageLink(n) {
        const nav = paginationNav();
        if (!nav) return null;
        return [...nav.querySelectorAll('a, button')].find(a => cellText(a) === String(n)) || null;
    }

    function isDisabled(el) {
        return !el || el.disabled ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('pointer-events-none');
    }

    // Empreinte de la page affichée : la plage "x-y" et la première ligne.
    function pageSignature() {
        const range = getRangeInfo();
        const found = findOperationsTable();
        const first = found && found.table.querySelector('tbody tr');
        return (range ? range.text : '') + '::' + (first ? cellText(first) : '');
    }

    async function clickAndWaitForPage(el, label) {
        const before = pageSignature();
        el.click();
        await waitFor(() => pageSignature() !== before, 10000,
            `Timeout : la page ${label} ne s'est pas chargée`);
        await wait(300);
    }

    async function goToFirstPage() {
        for (let guard = 0; guard < 100; guard++) {
            const range = getRangeInfo();
            if (!range || range.from <= 1) return;
            const target = findPageLink(1) || findPagerLink('previous');
            if (isDisabled(target)) return;
            await clickAndWaitForPage(target, '1');
        }
    }

    // Valeurs que data.js ignorerait (nature) ou compterait comme non payées (statut) :
    // mieux vaut le dire que laisser un total faux sans explication.
    function unknownValues(rows) {
        const tally = (col, known) => {
            const counts = new Map();
            for (const r of rows) {
                if (r[col] && !known.has(norm(r[col]))) counts.set(r[col], (counts.get(r[col]) || 0) + 1);
            }
            return [...counts].map(([v, n]) => `« ${v} » (${n})`).join(', ');
        };
        const lines = [];
        const natures = tally(4, KNOWN_NATURE_KEYS);
        if (natures) lines.push(`Natures inconnues du dashboard (lignes ignorées dans ses totaux) : ${natures}.`);
        const statuts = tally(6, KNOWN_STATUT_KEYS);
        if (statuts) lines.push(`Statuts inconnus (comptés comme non payés) : ${statuts}.`);
        return lines;
    }

    function downloadCSV(rows) {
        const escape = (v) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = [DASHBOARD_HEADERS, ...rows].map(r => r.map(escape).join(','));
        const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reecho_tableau_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ============================================================
    // HANDLER PRINCIPAL
    // ============================================================
    async function handleExport() {
        if (exporting) return;
        exporting = true;
        try {
            setLoading(true, 'Analyse...');
            await ensureOperationsTab();

            // Le dashboard traite l'export comme un état complet des mois couverts :
            // un export filtré ferait passer les lignes masquées pour supprimées.
            const counter = getFilterCounter();
            if (counter && counter.shown < counter.total) {
                throw new Error(`Recherche ou filtre actif (${counter.shown}/${counter.total} opérations affichées). Retire-le puis relance l'export.`);
            }

            const startRange = getRangeInfo();
            await goToFirstPage();

            // Une entrée par page, indexée par le début de sa plage : relire une page
            // ne crée pas de doublon, et aucune ligne légitime n'est dédupliquée.
            const pages = new Map();
            let expected = null;
            let pageSize = null;
            for (let guard = 0; guard < 500; guard++) {
                const range = getRangeInfo();
                if (range) expected = range.total;
                if (range && pageSize === null) pageSize = range.to - range.from + 1;
                pages.set(range ? range.from : guard + 1, readPageRows());
                const read = [...pages.values()].reduce((n, r) => n + r.length, 0);
                setLoading(true, expected ? `${read}/${expected}...` : `${read} lignes...`);

                const next = findPagerLink('next');
                if (isDisabled(next) || (range && range.to >= range.total)) break;
                await clickAndWaitForPage(next, `suivante (après ${range ? range.to : '?'})`);
            }

            const rows = [...pages.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, r]) => r);
            console.log(`[Reecho] ${rows.length} lignes lues, ${expected ?? '?'} attendues`);
            if (rows.length === 0) throw new Error('Aucune opération trouvée');
            if (expected !== null && rows.length !== expected) {
                throw new Error(`${rows.length}/${expected} lignes lues : export annulé pour ne pas importer un état incomplet (détails dans la console).`);
            }

            downloadCSV(rows);
            const warnings = unknownValues(rows);
            showToast([`${rows.length} lignes exportées.`, ...warnings].join('\n'), warnings.length ? 'warn' : '');

            // Retour sur la page de départ (la lecture s'arrête sur la dernière), sans bloquer.
            if (startRange && pageSize) {
                const page = Math.floor((startRange.from - 1) / pageSize) + 1;
                const here = getRangeInfo();
                const link = here && here.from === startRange.from ? null : findPageLink(page);
                if (link) clickAndWaitForPage(link, String(page)).catch(() => {});
            }
        } catch (err) {
            console.error('[Reecho Export] Erreur :', err);
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
            exporting = false;
        }
    }
})();
