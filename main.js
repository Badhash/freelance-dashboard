// ============================================================
// AURORA — amorçage (main.js) : import CSV (confirmation des lignes obsolètes,
// diff), actions, bascule de thème animée, service worker, premier rendu.
// Chargé en dernier.
// ============================================================

// ---------------------------------------------------------------- import
async function importFile(file) {
  let parsed, merged;
  try {
    const text = await file.text();
    parsed = parseCSV(text);
    if (parsed.length === 0) throw new Error('Aucune ligne valide trouvée dans le CSV');
    // Un export de l'intranet n'a que des mois MM-AAAA : un fichier qui en contient d'autres
    // (MOIS sert d'identifiant à l'affichage) est refusé en bloc, rien n'est modifié.
    const bad = parsed.filter((r) => !isValidMois(r.mois));
    if (bad.length) {
      const n = bad.length, p = n > 1;
      const ex = bad[0].mois.length > 24 ? bad[0].mois.slice(0, 24) + '…' : bad[0].mois;
      showToast({
        title: 'Import refusé',
        body: `${n} ligne${p ? 's ont' : ' a'} un mois illisible (« ${ex} », format attendu MM-AAAA, par exemple 09-2026). Rien n’a été importé.`,
        ok: false
      });
      return;
    }
    // L'export est un état complet : une ligne connue localement mais absente de l'import,
    // sur un mois couvert, a été supprimée ou ré-émise à la source (facture corrigée).
    const obsoletes = supersededRows(DATASET, parsed);
    let dropMissing = true;
    if (obsoletes.length > 0) {
      const n = obsoletes.length, p = n > 1;
      const apercu = obsoletes.slice(0, 5)
        .map((r) => `• ${r.mois} · ${r.nature.replace(/^(Crédit|Revenu|Charges) - /, '')} · ${fmt(r.montant)}\n  ${r.description || '—'}`)
        .join('\n');
      const reste = n > 5 ? `\n• … et ${n - 5} autre${n - 5 > 1 ? 's' : ''}` : '';
      dropMissing = await showConfirm({
        title: `${n} ligne${p ? 's' : ''} absente${p ? 's' : ''} de l’export`,
        message: `${p ? 'Ces lignes sont' : 'Cette ligne est'} dans le dashboard mais plus dans le CSV, sur ${p ? 'des mois couverts' : 'un mois couvert'} par le CSV. C’est ce qui arrive quand une facture est corrigée ou ré-émise${UI.NBP}: si on ${p ? 'les' : 'la'} garde, l’ancienne version continue de se cumuler à la nouvelle et le CA du mois est faussé.\n\n${apercu}${reste}\n\n${p ? 'Les' : 'La'} supprimer${UI.NBP}?`,
        okLabel: 'Supprimer et importer',
        cancelLabel: 'Garder et importer',
        danger: true
      });
    }
    merged = mergeDatasets(DATASET, parsed, { dropMissing });
    DATASET = merged.rows;
    saveDataset(DATASET);
  } catch (err) {
    console.error(err);
    showToast({ title: 'Erreur d’import', body: err.message, ok: false });
    return;
  }
  // Données enregistrées : à partir d'ici, un incident d'affichage (journalisé, et déjà isolé
  // section par section dans render()) ne se lit plus comme un échec de l'import.
  try { render(); } catch (err) { console.error('Rendu après import :', err); }
  // Un événement, un seul retour : le diff porte le message de succès ; sinon, un toast.
  let opened = false, diffFailed = false;
  try { opened = showImportDiff(file.name, merged.changes, { parsed: parsed.length, stats: merged.stats }); } catch (err) { diffFailed = true; console.error('Diff d’import :', err); }
  const n = parsed.length, p = n > 1;
  if (!opened) showToast({ title: diffFailed ? 'Import réussi' : 'Import réussi, rien de neuf', body: `${n} ligne${p ? 's' : ''} traitée${p ? 's' : ''} depuis ${file.name}`, stats: merged.stats, ok: true });
}
document.getElementById('csv-file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) importFile(f);
  e.target.value = '';
});
// Les <label for="csv-file-input" role="button"> sont focalisables : Entrée / Espace ouvrent le sélecteur.
document.addEventListener('keydown', (e) => {
  const l = e.target.closest && e.target.closest('label[for="csv-file-input"][role="button"]');
  if (l && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); document.getElementById('csv-file-input').click(); }
});
// Glisser-déposer sur la zone de l'état vide
(function bindDrop() {
  const drop = document.getElementById('drop');
  if (!drop) return;
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) importFile(f); });
})();

// ---------------------------------------------------------------- actions
document.getElementById('reset-btn').addEventListener('click', resetData);
document.getElementById('audit-btn').addEventListener('click', () => runAudit());
document.getElementById('footer-audit').addEventListener('click', () => runAudit());
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'audit') runAudit();
  if (act === 'reset') resetData();
  if (act === 'cloud') { const b = document.getElementById('auth-btn'); if (b) b.click(); }
  if (act === 'open-solde') {
    const t = document.getElementById('solde-toggle');
    if (t && t.getAttribute('aria-expanded') !== 'true') UI.setOpen(t, true);
    const w = document.getElementById('balance-widget');
    if (w) w.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (t) setTimeout(() => t.focus({ preventScroll: true }), 400);
  }
});
// « Restaurer depuis le cloud » n'apparaît que si le bouton cloud est disponible
(function syncCloudCtas() {
  const b = document.getElementById('auth-btn');
  const sync = () => document.querySelectorAll('[data-needs-cloud]').forEach((el) => { el.hidden = !b || b.style.display === 'none'; });
  sync();
  if (b) new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['style'] });
})();

// ---------------------------------------------------------------- thème
const THEME_KEY = 'dashboard_theme_v1';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}
function toggleTheme() {
  const html = document.documentElement;
  const next = (html.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduce) { applyTheme(next); return; }
  // Bascule « lever d'aurore » : le nouveau thème se révèle en cercle depuis le bouton.
  const r = document.getElementById('theme-toggle').getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  html.style.setProperty('--vt-x', x + 'px');
  html.style.setProperty('--vt-y', y + 'px');
  html.style.setProperty('--vt-r', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px');
  html.classList.add('vt-theme');
  const vt = document.startViewTransition(() => applyTheme(next));
  vt.finished.finally(() => html.classList.remove('vt-theme'));
}
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// ---------------------------------------------------------------- service worker (PWA), non bloquant
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non enregistré :', err));
  });
}

// ---------------------------------------------------------------- init
UI.init();
ModalCtl.init();
hydrateIcons();
watchAppbar();
render();
