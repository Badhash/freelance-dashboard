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

    const merged = mergeDatasets(DATASET, parsed);
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
// INIT
// ============================================================
render();
