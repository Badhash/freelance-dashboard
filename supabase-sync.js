// ============================================================
// SUPABASE — SYNC (module dédié, couche optionnelle)
// ============================================================
// Auth email/mot de passe + MFA TOTP (2e facteur), sauvegarde "miroir"
// du dataset + réglages vers la BDD, et chargement auto au login.
//
// Couche STRICTEMENT optionnelle posée par-dessus le flux localStorage :
//   - non configuré (placeholders) ou non connecté → comportement actuel inchangé ;
//   - connecté (+ MFA validée = niveau aal2) → bouton "Sauvegarder" + chargement auto.
//
// Charge APRÈS render.js (utilise render, showConfirm, showToast, escapeHtml,
// DATASET, saveDataset, rowKey, parseAmount, CLIENT_RULES, loadFiscalConfig,
// loadAEConfig) et AVANT main.js. Scripts en fin de <body> → le DOM existe déjà.
//
// Dépendances globales (script scope partagé) :
//   - window.supabase           (SDK chargé via CDN)
//   - window.SUPABASE_CONFIG     (supabase-config.js)
//   - DATASET / CLIENT_RULES     (let de data.js, réassignables ici)
//   - saveDataset, rowKey, parseAmount, loadFiscalConfig, loadAEConfig  (data.js)
//   - render, showConfirm, showToast, escapeHtml                        (render.js)
// ============================================================

(function () {
  'use strict';

  // --- Réglages synchronisés (clés app_settings ↔ clés localStorage) -------
  // Le thème (dashboard_theme_v1) reste volontairement LOCAL à l'appareil.
  const SETTINGS_KEYS = [
    { key: 'fiscal_config',  ls: 'dashboard_fiscal_config_v1',    fallback: () => safeLoad(loadFiscalConfig, {}) },
    { key: 'checklist',      ls: 'dashboard_fiscal_checklist_v1', fallback: () => ({}) },
    { key: 'ae_config',      ls: 'dashboard_ae_config_v1',        fallback: () => safeLoad(loadAEConfig, {}) },
    { key: 'proj_overrides', ls: 'dashboard_proj_overrides_v1',   fallback: () => ({}) },
    { key: 'client_rules',   ls: 'dashboard_client_rules_v1',     fallback: () => [] }
  ];

  // Colonnes lues sur la table transactions (ordre = mapping 1:1)
  const TX_COLS = 'date_emission,mois,reference,description,nature,montant,statut,date_paiement';

  // --- État interne du module ----------------------------------------------
  let client = null;
  let currentUser = null;
  let aal2 = false;              // true une fois le 2e facteur validé
  let enrollMode = 'primary';    // 'primary' | 'backup'
  let pendingEnroll = null;      // { factorId } pendant un enrôlement

  // ============================================================
  // CONFIG / GARDES
  // ============================================================
  function isConfigured() {
    const c = window.SUPABASE_CONFIG || {};
    return !!(c.url && c.publishableKey)
      && !/PLACEHOLDER/i.test(c.url)
      && !/PLACEHOLDER/i.test(c.publishableKey)
      && !!(window.supabase && typeof window.supabase.createClient === 'function');
  }

  function safeLoad(fn, dflt) {
    try { return (typeof fn === 'function') ? fn() : dflt; } catch (e) { return dflt; }
  }

  // ============================================================
  // MAPPING BDD <-> APP  (1:1 avec la structure de ligne en mémoire)
  // ============================================================
  function appRowToDb(r) {
    return {
      date_emission: r.date || '',
      mois:          r.mois || '',
      reference:     r.reference || '',
      description:   r.description || '',
      nature:        r.nature || '',
      montant:       (typeof r.montant === 'number') ? r.montant : parseAmount(r.montant),
      statut:        r.statut || '',
      date_paiement: r.datePaiement || ''
    };
  }
  // Recoercion de `montant` en Number → identique au parseFloat local,
  // quel que soit le sérialiseur PostgREST (number ou string).
  // Les champs texte sont .trim()'és EXACTEMENT comme dans parseCSV (data.js),
  // pour que rowKey() (qui inclut description) reste cohérent entre une ligne
  // venue d'un import CSV et une ligne rechargée du cloud — la fusion
  // (mergeDatasets) fonctionne donc identiquement après un round-trip BDD.
  function dbRowToApp(d) {
    const m = Number(d.montant);
    const t = (v) => (v == null ? '' : String(v).trim());
    return {
      date:         t(d.date_emission),
      mois:         t(d.mois),
      reference:    t(d.reference),
      description:  t(d.description),
      nature:       t(d.nature),
      montant:      isNaN(m) ? 0 : m,
      statut:       t(d.statut),
      datePaiement: t(d.date_paiement)
    };
  }

  // Signature complète d'un dataset (les 8 champs) — sert à détecter toute
  // divergence cloud/local AVANT un écrasement. rowKey() couvre déjà
  // reference/nature/description/montant ; on ajoute date, mois, statut et
  // datePaiement pour qu'aucune modification d'un seul champ ne passe inaperçue.
  function datasetSignature(rows) {
    return rows
      .map(r => [rowKey(r), r.date || '', r.mois || '', r.statut || '', r.datePaiement || ''].join('|'))
      .sort()
      .join('\n');
  }
  function sameDataset(a, b) {
    return a.length === b.length && datasetSignature(a) === datasetSignature(b);
  }

  // ============================================================
  // PETITS HELPERS DOM
  // ============================================================
  const $ = (id) => document.getElementById(id);
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt || ''; }
  function setError(id, txt) { const el = $(id); if (el) el.textContent = txt || ''; }
  function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  function setBusy(id, busy) {
    const el = $(id);
    if (!el) return;
    el.disabled = !!busy;
    el.classList.toggle('busy', !!busy);
  }

  function showView(name) {
    ['login', 'enroll', 'challenge', 'account'].forEach(v => {
      show($('auth-view-' + v), v === name);
    });
  }
  function openModal(view) {
    const m = $('auth-modal');
    if (!m) return;
    if (view) showView(view);
    m.classList.add('visible');
  }
  function closeModal() {
    const m = $('auth-modal');
    if (m) m.classList.remove('visible');
  }

  function updateAuthButton() {
    const btn = $('auth-btn');
    const label = $('auth-btn-label');
    if (!btn) return;
    show(btn, isConfigured());
    btn.classList.remove('connected', 'mfa');
    if (!currentUser) {
      if (label) label.textContent = 'Se connecter';
      btn.title = 'Connecte-toi pour synchroniser tes données (cloud)';
    } else if (aal2) {
      btn.classList.add('connected');
      if (label) label.textContent = 'Cloud';
      btn.title = (currentUser.email || 'Connecté') + ' · clique pour gérer / déconnexion';
    } else {
      btn.classList.add('mfa');
      if (label) label.textContent = 'MFA requise';
      btn.title = '2e facteur à valider pour accéder au cloud';
    }
  }
  function showSaveButton(on) { show($('save-btn'), on && aal2); }

  // ============================================================
  // INITIALISATION
  // ============================================================
  async function init() {
    if (!isConfigured()) {
      // Pas de cloud : on ne touche à rien, dashboard 100 % local.
      return;
    }
    try {
      client = window.supabase.createClient(
        window.SUPABASE_CONFIG.url,
        window.SUPABASE_CONFIG.publishableKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
      );
    } catch (e) {
      console.error('Supabase init échouée', e);
      return;
    }

    bindUI();
    updateAuthButton();

    // Session déjà présente (retour sur la page) ?
    try {
      const { data } = await client.auth.getSession();
      const session = data && data.session;
      if (session && session.user) {
        currentUser = session.user;
        await refreshAAL();
        updateAuthButton();
        showSaveButton(aal2);
        if (aal2) {
          // Login + MFA déjà acquis → chargement auto silencieux
          await autoLoadFromCloud({ silent: true });
        }
        // Si aal1 (facteur présent mais non rejoué), on n'impose pas de modale
        // au boot : le bouton signale "MFA requise", l'utilisateur clique quand il veut.
      }
    } catch (e) {
      console.warn('getSession', e);
    }
  }

  async function refreshAAL() {
    try {
      const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      aal2 = !!(data && data.currentLevel === 'aal2');
    } catch (e) {
      aal2 = false;
    }
  }

  // ============================================================
  // BINDINGS UI
  // ============================================================
  function bindUI() {
    const onClick = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    const onEnter = (id, fn) => {
      const el = $(id);
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
    };

    onClick('auth-btn', () => {
      if (!currentUser) { openModal('login'); setTimeout(() => { const f = $('auth-email'); if (f) f.focus(); }, 50); }
      else if (aal2) { showAccount(); }
      else { openModal(); proceedMfa(); }
    });
    onClick('save-btn', doSave);
    onClick('auth-close', closeModal);
    onClick('auth-backdrop', closeModal);

    onClick('auth-login-submit', doLogin);
    onEnter('auth-email', doLogin);
    onEnter('auth-password', doLogin);

    onClick('auth-enroll-submit', doEnrollVerify);
    onEnter('auth-enroll-code', doEnrollVerify);

    onClick('auth-challenge-submit', doChallengeVerify);
    onEnter('auth-challenge-code', doChallengeVerify);

    onClick('auth-add-backup', startBackupEnroll);
    onClick('auth-logout', doLogout);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ============================================================
  // LOGIN (1er facteur)
  // ============================================================
  async function doLogin() {
    const email = ($('auth-email') ? $('auth-email').value : '').trim();
    const password = $('auth-password') ? $('auth-password').value : '';
    setError('auth-login-error', '');
    if (!email || !password) { setError('auth-login-error', 'Email et mot de passe requis.'); return; }

    setBusy('auth-login-submit', true);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) { setError('auth-login-error', traduireErreur(error)); return; }
      currentUser = data.user;
      if ($('auth-password')) $('auth-password').value = '';
      await proceedMfa();
    } catch (e) {
      setError('auth-login-error', traduireErreur(e));
    } finally {
      setBusy('auth-login-submit', false);
    }
  }

  // Décide l'étape MFA : déjà aal2, sinon challenge (facteur existant) ou enroll.
  async function proceedMfa() {
    let levels;
    try {
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      levels = data;
    } catch (e) {
      setError('auth-login-error', traduireErreur(e));
      return;
    }
    const { currentLevel, nextLevel } = levels || {};
    if (currentLevel === 'aal2') { aal2 = true; await afterAuthenticated(); return; }
    if (nextLevel === 'aal2') {
      // Un facteur vérifié existe → on rejoue le 2e facteur
      showView('challenge');
      setTimeout(() => { const f = $('auth-challenge-code'); if (f) { f.value = ''; f.focus(); } }, 50);
      return;
    }
    // Aucun facteur vérifié → enrôlement du facteur principal
    enrollMode = 'primary';
    await startEnroll('Authenticator principal');
  }

  // ============================================================
  // MFA — ENRÔLEMENT (principal + secours)
  // ============================================================
  async function listFactors() {
    try {
      const { data } = await client.auth.mfa.listFactors();
      return (data && data.totp) || [];
    } catch (e) { return []; }
  }

  // Supprime les facteurs TOTP non vérifiés (tentatives d'enrôlement abandonnées)
  async function cleanupUnverified() {
    try {
      const { data } = await client.auth.mfa.listFactors();
      const all = (data && data.all) || [];
      for (const f of all) {
        if (f.factor_type === 'totp' && f.status !== 'verified') {
          try { await client.auth.mfa.unenroll({ factorId: f.id }); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function uniqueFactorName(base, existing) {
    const names = new Set(existing.map(f => f.friendly_name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(base + ' ' + i)) i++;
    return base + ' ' + i;
  }

  async function startEnroll(friendlyName) {
    setError('auth-enroll-error', '');
    if ($('auth-enroll-code')) $('auth-enroll-code').value = '';
    await cleanupUnverified();
    try {
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName });
      if (error) { setError('auth-enroll-error', traduireErreur(error)); openModal('enroll'); return; }
      pendingEnroll = { factorId: data.id };
      const qr = $('auth-qr');
      if (qr) {
        // DOM API plutôt qu'innerHTML : on n'injecte pas la data-URI dans du HTML.
        qr.innerHTML = '';
        const img = document.createElement('img');
        img.alt = 'QR code MFA';
        img.src = (data.totp && data.totp.qr_code) || '';
        qr.appendChild(img);
      }
      setText('auth-secret', (data.totp && data.totp.secret) || '');
      openModal('enroll');
      setTimeout(() => { const f = $('auth-enroll-code'); if (f) f.focus(); }, 50);
    } catch (e) {
      setError('auth-enroll-error', traduireErreur(e));
      openModal('enroll');
    }
  }

  async function startBackupEnroll() {
    enrollMode = 'backup';
    const existing = await listFactors();
    await startEnroll(uniqueFactorName('Authenticator de secours', existing));
  }

  async function doEnrollVerify() {
    if (!pendingEnroll) { setError('auth-enroll-error', 'Relance l\'enrôlement.'); return; }
    const code = ($('auth-enroll-code') ? $('auth-enroll-code').value : '').trim();
    setError('auth-enroll-error', '');
    if (!/^\d{6}$/.test(code)) { setError('auth-enroll-error', 'Saisis le code à 6 chiffres.'); return; }

    setBusy('auth-enroll-submit', true);
    try {
      const ch = await client.auth.mfa.challenge({ factorId: pendingEnroll.factorId });
      if (ch.error) { setError('auth-enroll-error', traduireErreur(ch.error)); return; }
      const ver = await client.auth.mfa.verify({ factorId: pendingEnroll.factorId, challengeId: ch.data.id, code });
      if (ver.error) { setError('auth-enroll-error', traduireErreur(ver.error)); return; }

      pendingEnroll = null;
      aal2 = true;
      if (enrollMode === 'backup') {
        enrollMode = 'primary';
        showToast({ title: 'Facteur de secours ajouté', body: 'Ton 2e authenticator est actif.', ok: true });
        await showAccount();
      } else {
        await afterAuthenticated();
      }
    } catch (e) {
      setError('auth-enroll-error', traduireErreur(e));
    } finally {
      setBusy('auth-enroll-submit', false);
    }
  }

  // ============================================================
  // MFA — CHALLENGE (facteur déjà enrôlé)
  // ============================================================
  async function doChallengeVerify() {
    const code = ($('auth-challenge-code') ? $('auth-challenge-code').value : '').trim();
    setError('auth-challenge-error', '');
    if (!/^\d{6}$/.test(code)) { setError('auth-challenge-error', 'Saisis le code à 6 chiffres.'); return; }

    const factors = await listFactors();
    const factor = factors.find(f => f.status === 'verified') || factors[0];
    if (!factor) { setError('auth-challenge-error', 'Aucun facteur trouvé. Reconnecte-toi.'); return; }

    setBusy('auth-challenge-submit', true);
    try {
      const ch = await client.auth.mfa.challenge({ factorId: factor.id });
      if (ch.error) { setError('auth-challenge-error', traduireErreur(ch.error)); return; }
      const ver = await client.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code });
      if (ver.error) { setError('auth-challenge-error', traduireErreur(ver.error)); return; }
      aal2 = true;
      await afterAuthenticated();
    } catch (e) {
      setError('auth-challenge-error', traduireErreur(e));
    } finally {
      setBusy('auth-challenge-submit', false);
    }
  }

  // ============================================================
  // APRÈS AUTH RÉUSSIE (login + MFA = aal2)
  // ============================================================
  async function afterAuthenticated() {
    updateAuthButton();
    showSaveButton(true);
    closeModal();
    await autoLoadFromCloud({ silent: false });
  }

  // ============================================================
  // COMPTE (vue connecté : email, facteurs, secours, déconnexion)
  // ============================================================
  async function showAccount() {
    setText('auth-account-email', currentUser ? currentUser.email : '');
    const totp = await listFactors();
    const box = $('auth-factors');
    if (box) {
      box.innerHTML = totp.length
        ? '<div class="auth-factors-title">Authenticators enrôlés</div>' + totp.map(f =>
            '<div class="auth-factor"><span>' + escapeHtml(f.friendly_name || 'TOTP') + '</span>' +
            '<span class="auth-factor-status ' + (f.status === 'verified' ? 'ok' : '') + '">' +
            (f.status === 'verified' ? 'actif' : 'non vérifié') + '</span></div>').join('')
        : '<div class="auth-empty">Aucun facteur enrôlé.</div>';
    }
    openModal('account');
  }

  // ============================================================
  // CHARGEMENT AUTO DEPUIS LE CLOUD (miroir : cloud fait autorité)
  // ============================================================
  async function autoLoadFromCloud(opts) {
    opts = opts || {};
    try {
      const { data: rows, error } = await client.from('transactions').select(TX_COLS);
      if (error) throw error;

      const cloudRows = (rows || []).map(dbRowToApp);
      const localRows = Array.isArray(DATASET) ? DATASET : [];

      if (cloudRows.length === 0) {
        await loadSettingsFromCloud();
        if (localRows.length > 0) {
          showToast({ title: 'Cloud vide', body: 'Aucune donnée dans le cloud. Clique « Sauvegarder » pour l\'initialiser.', ok: true });
        } else if (!opts.silent) {
          showToast({ title: 'Connecté', body: 'Cloud vide pour le moment. Importe un CSV puis Sauvegarde.', ok: true });
        }
        return;
      }

      // Cloud non vide : il fait autorité. Garde-fou avant tout écrasement.
      if (localRows.length > 0 && !sameDataset(localRows, cloudRows)) {
        const ok = await showConfirm({
          title: 'Données cloud disponibles',
          message: 'Le cloud contient des données différentes de tes données locales.\n\n'
                 + 'Charger la version cloud (' + cloudRows.length + ' lignes) et remplacer le contenu local ?\n\n'
                 + 'Annule si tu préfères d\'abord « Sauvegarder » ta version locale.',
          okLabel: 'Charger le cloud',
          cancelLabel: 'Garder le local',
          danger: false
        });
        if (!ok) {
          showToast({ title: 'Données locales conservées', body: 'Le cloud n\'a pas été chargé.', ok: true });
          return;
        }
      }

      DATASET = cloudRows;
      saveDataset(DATASET);
      await loadSettingsFromCloud();
      render();
      showToast({ title: 'Données chargées', body: cloudRows.length + ' opérations chargées depuis le cloud.', ok: true });
    } catch (e) {
      console.error(e);
      showToast({ title: 'Erreur de chargement', body: traduireErreur(e), ok: false });
    }
  }

  async function loadSettingsFromCloud() {
    try {
      const { data, error } = await client.from('app_settings').select('key,value');
      if (error) { console.warn('app_settings', error); return; }
      (data || []).forEach(row => {
        const map = SETTINGS_KEYS.find(s => s.key === row.key);
        if (!map || row.value == null) return;
        try { localStorage.setItem(map.ls, JSON.stringify(row.value)); } catch (e) {}
        // CLIENT_RULES est mis en cache (let de data.js) → réassignation explicite.
        if (row.key === 'client_rules' && Array.isArray(row.value)) {
          try { CLIENT_RULES = row.value; } catch (e) {}
        }
      });
    } catch (e) { console.warn('loadSettings', e); }
  }

  // ============================================================
  // SAUVEGARDE (miroir : snapshot complet de l'état courant)
  // ============================================================
  function readLocalJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  async function doSave() {
    if (!aal2 || !client || !currentUser) return;
    const count = Array.isArray(DATASET) ? DATASET.length : 0;
    const ok = await showConfirm({
      title: 'Sauvegarder dans le cloud ?',
      message: 'L\'état actuel du dashboard va REMPLACER le contenu du cloud (instantané miroir) :\n\n'
             + '• ' + count + ' opération' + (count > 1 ? 's' : '') + '\n'
             + '• réglages (fiscal, checklist, projection, règles clients)',
      okLabel: 'Sauvegarder',
      cancelLabel: 'Annuler',
      danger: false
    });
    if (!ok) return;

    setBusy('save-btn', true);
    try {
      // 1) Transactions — remplacement atomique côté serveur (delete + insert)
      const payload = (Array.isArray(DATASET) ? DATASET : []).map(appRowToDb);
      const { error: e1 } = await client.rpc('replace_transactions', { p_rows: payload });
      if (e1) throw e1;

      // 2) Réglages — upsert clé/valeur (jamais null grâce aux fallbacks)
      const uid = currentUser ? currentUser.id : undefined;
      const settingsRows = SETTINGS_KEYS.map(s => {
        let value = readLocalJSON(s.ls);
        if (value == null) value = s.fallback();
        return { user_id: uid, key: s.key, value };
      });
      const { error: e2 } = await client.from('app_settings').upsert(settingsRows, { onConflict: 'user_id,key' });
      if (e2) throw e2;

      showToast({ title: 'Sauvegardé', body: count + ' opérations + réglages enregistrés dans le cloud.', ok: true });
    } catch (e) {
      console.error(e);
      showToast({ title: 'Échec de la sauvegarde', body: traduireErreur(e) + ' — tes données locales sont intactes.', ok: false });
    } finally {
      setBusy('save-btn', false);
    }
  }

  // ============================================================
  // DÉCONNEXION (retour au mode local ; les données locales restent)
  // ============================================================
  async function doLogout() {
    try { await client.auth.signOut(); } catch (e) {}
    currentUser = null;
    aal2 = false;
    pendingEnroll = null;
    showSaveButton(false);
    updateAuthButton();
    closeModal();
    showToast({ title: 'Déconnecté', body: 'Retour en mode local. Tes données locales restent disponibles.', ok: true });
  }

  // ============================================================
  // MESSAGES D'ERREUR — traduction FR des cas fréquents
  // ============================================================
  function traduireErreur(error) {
    if (!error) return 'Erreur inconnue.';
    const msg = (error.message || String(error) || '').toLowerCase();
    const code = error.code || '';
    if (code === '42501' || msg.includes('permission denied')) {
      return 'Permission refusée (grant manquant, code 42501). Ré-exécute la section GRANT de supabase_setup.sql.';
    }
    if (msg.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.';
    if (msg.includes('email not confirmed')) return 'Email non confirmé. Active « Auto Confirm » sur ton utilisateur.';
    if (msg.includes('invalid totp') || msg.includes('invalid code') || (msg.includes('code') && msg.includes('invalid'))) {
      return 'Code à 6 chiffres incorrect ou expiré. Réessaie.';
    }
    if (msg.includes('already exists') || msg.includes('friendly')) return 'Un facteur du même nom existe déjà. Réessaie.';
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network')) {
      return 'Réseau indisponible. Vérifie ta connexion et l\'URL Supabase.';
    }
    if (msg.includes('row-level security') || msg.includes('rls')) {
      return 'Accès refusé par la sécurité (RLS/MFA). Vérifie que le 2e facteur est validé.';
    }
    return error.message || 'Erreur inattendue.';
  }

  // ============================================================
  // EXPOSITION + AUTO-INIT
  // ============================================================
  window.SupabaseSync = {
    init,
    save: doSave,
    logout: doLogout,
    isConfigured,
    isAuthenticated: () => aal2,
    // utilitaires testables (mapping pur)
    _appRowToDb: appRowToDb,
    _dbRowToApp: dbRowToApp
  };

  // Auto-init : le DOM est déjà parsé (script en fin de <body>).
  init().catch(e => console.error('SupabaseSync init', e));
})();
