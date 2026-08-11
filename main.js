// ============================================================
// DASHBOARD — bootstrap
// Event listeners, theme, init. Charge en dernier.
// ============================================================

// ============================================================
// IMPORT HANDLER
// ============================================================
document.getElementById('csv-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length === 0) throw new Error('Aucune ligne valide trouvée dans le CSV');

    // L'export est un état complet : une ligne connue localement mais absente de
    // l'import, sur un mois que l'import couvre, a été supprimée ou ré-émise à la
    // source (facture corrigée). On la retire, sinon l'ancienne version se cumule
    // à la nouvelle. Confirmation demandée : un export filtré sur un seul client
    // ne doit pas effacer silencieusement le reste du mois.
    const obsoletes = supersededRows(DATASET, parsed);
    let dropMissing = true;
    if (obsoletes.length > 0) {
      const n = obsoletes.length;
      const p = n > 1;
      const apercu = obsoletes.slice(0, 5)
        .map(r => `• ${r.mois} · ${r.nature.replace(/^(Crédit|Revenu|Charges) - /, '')} · ${fmt(r.montant)}\n  ${r.description || '—'}`)
        .join('\n');
      const reste = n > 5 ? `\n• … et ${n - 5} autre${n - 5 > 1 ? 's' : ''}` : '';
      dropMissing = await showConfirm({
        title: `${n} ligne${p ? 's' : ''} absente${p ? 's' : ''} de l'export`,
        message: `${p ? 'Ces lignes sont' : 'Cette ligne est'} dans le dashboard mais plus dans le CSV, sur ${p ? 'des mois couverts' : 'un mois couvert'} par le CSV. C'est ce qui arrive quand une facture est corrigée ou ré-émise : si on ${p ? 'les' : 'la'} garde, l'ancienne version continue de se cumuler à la nouvelle et le CA du mois est faussé.\n\n${apercu}${reste}\n\n${p ? 'Les' : 'La'} supprimer ?`,
        okLabel: 'Supprimer et importer',
        cancelLabel: 'Garder et importer',
        danger: true
      });
    }

    const merged = mergeDatasets(DATASET, parsed, { dropMissing });
    DATASET = merged.rows;
    saveDataset(DATASET);

    showToast({
      title: 'Import réussi',
      body: `${parsed.length} lignes traitées depuis ${file.name}`,
      stats: merged.stats,
      ok: true
    });
    render();
    showImportDiff(file.name, merged.changes);
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Erreur d\'import',
      body: err.message,
      ok: false
    });
  }
  e.target.value = '';
});

// ============================================================
// EXPOSITIONS GLOBALES (pour onclick inline dans index.html)
// ============================================================
// Expose globalement (référencés par onclick inline dans index.html)
window.runAudit = runAudit;
window.closeAudit = closeAudit;
window.closeImportDiff = closeImportDiff;

// Bouton reset : addEventListener (pas d'onclick inline)
const resetBtnEl = document.getElementById('reset-btn');
if (resetBtnEl) resetBtnEl.addEventListener('click', resetData);

// ============================================================
// THEME TOGGLE
// ============================================================
const THEME_KEY = 'dashboard_theme_v1';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
// Charger thème sauvegardé ou fallback sur préférence système
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
  } else {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  }
})();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// ============================================================
// SERVICE WORKER (PWA) — enregistrement guardé, non bloquant.
// Un échec d'enregistrement ne doit jamais casser l'app.
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker non enregistré :', err);
    });
  });
}

// ============================================================
// INIT
// ============================================================
render();
