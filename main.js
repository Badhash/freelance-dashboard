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
window.openChecklist = openChecklist;
window.closeChecklist = closeChecklist;

// Bouton reset : addEventListener (pas d'onclick inline)
const resetBtnEl = document.getElementById('reset-btn');
if (resetBtnEl) resetBtnEl.addEventListener('click', resetData);

// ============================================================
// CONFIG FISCALE — listeners (bound une fois au boot)
// ============================================================
function bindFiscalControls() {
  // Radio scénarios
  document.querySelectorAll('input[name="fc-scenario"]').forEach(inp => {
    inp.addEventListener('change', () => {
      const c = loadFiscalConfig();
      c.scenarioActif = inp.value;
      saveFiscalConfig(c);
      if (typeof renderFiscal === 'function') renderFiscal();
    });
  });

  // Statut familial
  const statut = document.getElementById('fc-statut');
  if (statut) statut.addEventListener('change', () => {
    const c = loadFiscalConfig();
    c.statutFamilial = statut.value;
    saveFiscalConfig(c);
    renderFiscal();
  });

  // Enfants (input + steppers)
  const enfants = document.getElementById('fc-enfants');
  if (enfants) enfants.addEventListener('input', () => {
    const c = loadFiscalConfig();
    let v = parseInt(enfants.value); if (isNaN(v) || v < 0) v = 0; if (v > 10) v = 10;
    c.enfants = v;
    saveFiscalConfig(c);
    renderFiscal();
  });
  document.querySelectorAll('.days-stepper[data-fc-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.fcTarget);
      if (!target) return;
      let v = parseInt(target.value) || 0;
      v += (btn.dataset.fcAction === 'up' ? 1 : -1);
      if (v < 0) v = 0; if (v > 10) v = 10;
      target.value = v;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Année de déclaration
  const annee = document.getElementById('fc-annee');
  if (annee) annee.addEventListener('change', () => {
    const c = loadFiscalConfig();
    c.anneeDeclaration = parseInt(annee.value);
    saveFiscalConfig(c);
    renderFiscal();
  });

  // Nombre de parts (manuel)
  const parts = document.getElementById('tax-parts-input');
  if (parts) {
    parts.addEventListener('input', () => {
      const c = loadFiscalConfig();
      let v = parseFloat(parts.value); if (isNaN(v) || v < 1) v = 1; if (v > 10) v = 10;
      c.parts = v;
      saveFiscalConfig(c);
      renderFiscal();
    });
    document.querySelectorAll('.days-stepper[data-tax-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = loadFiscalConfig();
        let v = c.parts;
        v += (btn.dataset.taxAction === 'up' ? 0.25 : -0.25);
        if (v < 1) v = 1; if (v > 10) v = 10;
        c.parts = v;
        saveFiscalConfig(c);
        renderFiscal();
      });
    });
  }

  // Paramètres auto-entrepreneur 2027
  ['ae-tjm', 'ae-jours'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const c = loadAEConfig();
      const v = parseFloat(el.value);
      if (id === 'ae-tjm') c.tjm = isNaN(v) ? 0 : v;
      else c.jours = isNaN(v) ? 0 : v;
      saveAEConfig(c);
      renderFiscal();
    });
  });
  const aeOpt = document.getElementById('ae-option');
  if (aeOpt) aeOpt.addEventListener('change', () => {
    const c = loadAEConfig();
    c.optionFiscale = aeOpt.value;
    saveAEConfig(c);
    renderFiscal();
  });
}
bindFiscalControls();

// ============================================================
// TABS
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

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
