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
//   - window.SupabaseCrypto      (supabase-crypto.js — chiffrement E2E, chargé AVANT)
//   - DATASET / CLIENT_RULES     (let de data.js, réassignables ici)
//   - saveDataset, rowKey, parseAmount, loadFiscalConfig, loadAEConfig  (data.js)
//   - render, showConfirm, showToast, escapeHtml                        (render.js)
//
// CHIFFREMENT : les transactions et réglages partent CHIFFRÉS (AES-GCM, clé
// dérivée du mot de passe) et sont déchiffrés au chargement. La frontière de
// chiffrement est ICI (insert/select) ; le localStorage reste EN CLAIR.
// ============================================================

(function () {
  'use strict';

  // --- Réglages synchronisés (clés app_settings ↔ clés localStorage) -------
  // Le thème (dashboard_theme_v1) reste volontairement LOCAL à l'appareil.
  const SETTINGS_KEYS = [
    // typeof-guard : loadFiscalConfig/loadAEConfig peuvent être ABSENTS (feature
    // fiscale retirée pour reconstruction). On ne référence donc l'identifiant
    // que s'il existe → pas de ReferenceError, et la synchro reprend telle quelle
    // dès que la feature est reconstruite.
    { key: 'fiscal_config',  ls: 'dashboard_fiscal_config_v1',    fallback: () => (typeof loadFiscalConfig === 'function' ? safeLoad(loadFiscalConfig, {}) : {}) },
    { key: 'checklist',      ls: 'dashboard_fiscal_checklist_v1', fallback: () => ({}) },
    { key: 'ae_config',      ls: 'dashboard_ae_config_v1',        fallback: () => (typeof loadAEConfig === 'function' ? safeLoad(loadAEConfig, {}) : {}) },
    { key: 'proj_overrides', ls: 'dashboard_proj_overrides_v1',   fallback: () => ({}) },
    { key: 'client_rules',   ls: 'dashboard_client_rules_v1',     fallback: () => [] }
  ];

  // Clés méta de chiffrement dans app_settings (EN CLAIR, exclues de la synchro)
  const CRYPTO_SALT_KEY = 'crypto_salt';   // { salt: base64, iterations, v }
  const CRYPTO_CHECK_KEY = 'crypto_check'; // { enc } — vérificateur de mot de passe
  const PBKDF2_ITERS = 600000;

  // --- État interne du module ----------------------------------------------
  let client = null;
  let currentUser = null;
  let aal2 = false;              // true une fois le 2e facteur validé
  let enrollMode = 'primary';    // 'primary' | 'backup'
  let pendingEnroll = null;      // { factorId } pendant un enrôlement
  let pendingPassword = null;    // mot de passe en attente (login → dérivation clé post-aal2)

  // Clé de chiffrement prête ? (vit en mémoire dans SupabaseCrypto, jamais persistée)
  function hasCryptoKey() { return !!(window.SupabaseCrypto && window.SupabaseCrypto.hasKey()); }

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
    ['login', 'enroll', 'challenge', 'account', 'unlock'].forEach(v => {
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
  // Fermeture À L'INITIATIVE de l'utilisateur (X / backdrop / Échap) : on purge
  // aussi le mot de passe en attente pour ne pas le laisser résider en mémoire
  // si la MFA est abandonnée (afterAuthenticated, lui, appelle closeModal()
  // directement et conserve donc pendingPassword pour dériver la clé).
  function dismissModal() {
    pendingPassword = null;
    closeModal();
  }

  function updateAuthButton() {
    const btn = $('auth-btn');
    const label = $('auth-btn-label');
    if (!btn) return;
    show(btn, isConfigured());
    btn.classList.remove('connected', 'mfa', 'locked');
    if (!currentUser) {
      if (label) label.textContent = 'Se connecter';
      btn.title = 'Connecte-toi pour synchroniser tes données (cloud)';
    } else if (aal2 && !hasCryptoKey()) {
      // Session restaurée (reload) sans clé de chiffrement en mémoire → déverrouillage
      btn.classList.add('locked');
      if (label) label.textContent = 'Déverrouiller';
      btn.title = 'Saisis ton mot de passe pour déchiffrer tes données cloud';
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
  // Sauvegarde possible seulement avec aal2 ET clé de chiffrement prête.
  function showSaveButton(on) { show($('save-btn'), on && aal2 && hasCryptoKey()); }

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
        // PAS de chargement auto au boot : la clé de chiffrement n'est jamais
        // persistée, donc indisponible après un reload. updateAuthButton affiche
        // alors « Déverrouiller » (si aal2) ou « MFA requise » (si aal1) ;
        // l'utilisateur clique quand il veut pour saisir son mot de passe.
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
      else if (aal2 && !hasCryptoKey()) { openModal('unlock'); setTimeout(() => { const f = $('auth-unlock-password'); if (f) { f.value = ''; f.focus(); } }, 50); }
      else if (aal2) { showAccount(); }
      else { openModal(); proceedMfa(); }
    });
    onClick('save-btn', doSave);
    onClick('auth-close', dismissModal);
    onClick('auth-backdrop', dismissModal);

    onClick('auth-login-submit', doLogin);
    onEnter('auth-email', doLogin);
    onEnter('auth-password', doLogin);

    onClick('auth-enroll-submit', doEnrollVerify);
    onEnter('auth-enroll-code', doEnrollVerify);

    onClick('auth-challenge-submit', doChallengeVerify);
    onEnter('auth-challenge-code', doChallengeVerify);

    onClick('auth-unlock-submit', doUnlock);
    onEnter('auth-unlock-password', doUnlock);

    onClick('auth-add-backup', startBackupEnroll);
    onClick('auth-logout', doLogout);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dismissModal();
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
      // Stash du mot de passe : le sel n'est lisible qu'après aal2 (MFA), donc
      // la clé est dérivée dans afterAuthenticated() puis pendingPassword effacé.
      pendingPassword = password;
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
      pendingPassword = null;   // MFA en échec → on ne garde pas le mot de passe en clair
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
      pendingPassword = null;
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
      pendingPassword = null;
      setError('auth-challenge-error', traduireErreur(e));
    } finally {
      setBusy('auth-challenge-submit', false);
    }
  }

  // ============================================================
  // APRÈS AUTH RÉUSSIE (login + MFA = aal2)
  // ============================================================
  async function afterAuthenticated() {
    closeModal();
    let keyOk = false;
    let needUnlock = false;
    if (pendingPassword) {
      try {
        await ensureCryptoKey(pendingPassword);
        keyOk = hasCryptoKey();
      } catch (e) {
        if (e && e.cryptoVerifier) {
          // Auth réussie mais le vérificateur échoue → le mot de passe a changé
          // depuis le dernier chiffrement (cf. footgun rotation de mot de passe).
          showToast({ title: 'Re-chiffrement nécessaire',
            body: 'Ton mot de passe a changé depuis le dernier chiffrement du cloud. Réimporte ton CSV puis clique « Sauvegarder » pour re-chiffrer.', ok: false });
        } else {
          showToast({ title: 'Clé de chiffrement', body: traduireErreur(e), ok: false });
        }
      } finally {
        pendingPassword = null;
      }
    } else {
      // aal2 atteint sans mot de passe en main (ex. MFA rejouée sur session restaurée)
      needUnlock = true;
    }
    updateAuthButton();
    showSaveButton(true);
    if (keyOk) {
      await autoLoadFromCloud({ silent: false });
    } else if (needUnlock) {
      openModal('unlock');
      setTimeout(() => { const f = $('auth-unlock-password'); if (f) { f.value = ''; f.focus(); } }, 50);
    }
  }

  // ============================================================
  // CLÉ DE CHIFFREMENT — dérivation + vérification (PBKDF2/AES-GCM)
  // ============================================================
  // Lit (ou crée au 1er setup) le sel + le vérificateur dans app_settings,
  // dérive la clé du mot de passe, et la pose en mémoire (SupabaseCrypto).
  // Ne pose JAMAIS la clé avant que le sel soit persisté (sinon ciphertext orphelin).
  async function ensureCryptoKey(pw) {
    const SC = window.SupabaseCrypto;
    if (!SC) throw new Error('Module de chiffrement absent.');
    if (!pw) throw new Error('Mot de passe requis pour dériver la clé.');

    const { data, error } = await client.from('app_settings')
      .select('key,value').in('key', [CRYPTO_SALT_KEY, CRYPTO_CHECK_KEY]);
    if (error) throw error;
    const rows = data || [];
    const saltRow = rows.find(r => r.key === CRYPTO_SALT_KEY);
    const checkRow = rows.find(r => r.key === CRYPTO_CHECK_KEY);
    const uid = currentUser ? currentUser.id : undefined;

    // --- 1er setup : aucun sel → on génère sel + vérificateur ---
    if (!saltRow || !saltRow.value || !saltRow.value.salt) {
      const salt = SC.randomBytes(16);
      const iters = PBKDF2_ITERS;
      const key = await SC.deriveKey(pw, salt, iters);
      const checkEnc = await SC.makeVerifier(key);
      const { error: e } = await client.from('app_settings').upsert([
        { user_id: uid, key: CRYPTO_SALT_KEY,  value: { salt: SC.b64encode(salt), iterations: iters, v: 1 } },
        { user_id: uid, key: CRYPTO_CHECK_KEY, value: { enc: checkEnc } }
      ], { onConflict: 'user_id,key' });
      if (e) throw e;            // sel non persisté → on NE pose PAS la clé
      SC.setKey(key);
      return { firstSetup: true };
    }

    // --- Sel existant : dériver la clé ---
    const saltBytes = SC.b64decode(saltRow.value.salt);
    const iters = saltRow.value.iterations || PBKDF2_ITERS;
    const key = await SC.deriveKey(pw, saltBytes, iters);

    // Vérificateur manquant (état partiel, ex. mutation manuelle de la table).
    // AVANT de (re)stamper un vérificateur, on VALIDE la clé contre une éventuelle
    // donnée déjà chiffrée : sinon un mauvais mot de passe écraserait le
    // vérificateur et masquerait DÉFINITIVEMENT le vrai mot de passe.
    if (!checkRow || !checkRow.value || !checkRow.value.enc) {
      const { data: sample, error: sampleErr } = await client.from('transactions').select('payload').limit(1);
      if (sampleErr) throw sampleErr;   // une sonde en échec NE DOIT PAS être prise pour « aucune donnée » → sinon on stamperait un vérificateur sur une clé non validée
      if (sample && sample.length && sample[0].payload) {
        try {
          await SC.decrypt(key, sample[0].payload);   // throw si la clé ne correspond pas aux données existantes
        } catch (e) {
          SC.clearKey();
          const err = new Error('verifier-mismatch');
          err.cryptoVerifier = true;
          throw err;
        }
      }
      const checkEnc = await SC.makeVerifier(key);
      const { error: e } = await client.from('app_settings').upsert(
        [{ user_id: uid, key: CRYPTO_CHECK_KEY, value: { enc: checkEnc } }],
        { onConflict: 'user_id,key' });
      if (e) throw e;
      SC.setKey(key);
      return { firstSetup: false };
    }

    // Vérification : la clé déchiffre-t-elle le vérificateur ?
    const ok = await SC.checkVerifier(key, checkRow.value.enc);
    if (!ok) {
      SC.clearKey();
      const err = new Error('verifier-mismatch');
      err.cryptoVerifier = true;
      throw err;
    }
    SC.setKey(key);
    return { firstSetup: false };
  }

  // ============================================================
  // DÉVERROUILLAGE (reload : re-dérive la clé sans re-authentifier)
  // ============================================================
  async function doUnlock() {
    const pw = $('auth-unlock-password') ? $('auth-unlock-password').value : '';
    setError('auth-unlock-error', '');
    if (!pw) { setError('auth-unlock-error', 'Mot de passe requis.'); return; }

    setBusy('auth-unlock-submit', true);
    try {
      await ensureCryptoKey(pw);
      if ($('auth-unlock-password')) $('auth-unlock-password').value = '';
      updateAuthButton();
      showSaveButton(true);
      closeModal();
      await autoLoadFromCloud({ silent: false });
    } catch (e) {
      if (e && e.cryptoVerifier) {
        setError('auth-unlock-error', 'Mot de passe incorrect — ou ton mot de passe a changé depuis le dernier chiffrement (réimporte ton CSV puis Sauvegarde).');
      } else {
        setError('auth-unlock-error', traduireErreur(e));
      }
    } finally {
      setBusy('auth-unlock-submit', false);
    }
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
    const SC = window.SupabaseCrypto;
    if (!SC || !SC.hasKey()) return;   // pas de clé → on ne déchiffre rien (dashboard reste local)
    try {
      const { data: rows, error } = await client.from('transactions').select('payload');
      if (error) throw error;

      // Déchiffrer TOUTES les lignes AVANT toute comparaison/écrasement :
      // un échec partiel ne doit jamais écraser le local avec un cloud tronqué.
      let cloudRows;
      try {
        cloudRows = [];
        for (const row of (rows || [])) {
          cloudRows.push(dbRowToApp(await SC.decryptRow(row.payload)));
        }
      } catch (decErr) {
        console.error('Déchiffrement cloud', decErr);
        showToast({ title: 'Erreur de déchiffrement', body: 'Impossible de déchiffrer les données cloud (clé incorrecte ?). Tes données locales sont intactes.', ok: false });
        return;
      }

      const localRows = Array.isArray(DATASET) ? DATASET : [];

      if (cloudRows.length === 0) {
        await loadSettingsFromCloud();
        render();   // les réglages (règles clients, fiscal, projection) peuvent avoir changé → rafraîchir l'UI
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
    const SC = window.SupabaseCrypto;
    try {
      const { data, error } = await client.from('app_settings').select('key,value');
      if (error) { console.warn('app_settings', error); return; }
      for (const row of (data || [])) {
        // Clés méta de chiffrement : jamais écrites en localStorage, jamais déchiffrées ici.
        if (row.key === CRYPTO_SALT_KEY || row.key === CRYPTO_CHECK_KEY) continue;
        const map = SETTINGS_KEYS.find(s => s.key === row.key);
        if (!map || row.value == null) continue;
        // Valeur chiffrée { enc } → déchiffrer ; tolère une valeur en clair (pré-migration).
        let plain;
        try {
          plain = (SC && row.value && row.value.enc != null)
            ? await SC.decryptSettingValue(row.value)
            : row.value;
        } catch (e) { console.warn('Déchiffrement réglage ' + row.key, e); continue; } // skip-one
        try { localStorage.setItem(map.ls, JSON.stringify(plain)); } catch (e) {}
        // CLIENT_RULES est mis en cache (let de data.js) → réassignation explicite.
        if (row.key === 'client_rules' && Array.isArray(plain)) {
          try { CLIENT_RULES = plain; } catch (e) {}
        }
      }
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
    const SC = window.SupabaseCrypto;
    if (!aal2 || !client || !currentUser || !SC || !SC.hasKey()) return;
    const count = Array.isArray(DATASET) ? DATASET.length : 0;
    const ok = await showConfirm({
      title: 'Sauvegarder dans le cloud ?',
      message: 'L\'état actuel du dashboard va être CHIFFRÉ puis REMPLACER le contenu du cloud (instantané miroir) :\n\n'
             + '• ' + count + ' opération' + (count > 1 ? 's' : '') + '\n'
             + '• réglages (fiscal, checklist, projection, règles clients)',
      okLabel: 'Sauvegarder',
      cancelLabel: 'Annuler',
      danger: false
    });
    if (!ok) return;

    setBusy('save-btn', true);
    try {
      // 1) Transactions — chiffrées ligne par ligne, remplacement atomique serveur
      const payload = [];
      for (const r of (Array.isArray(DATASET) ? DATASET : [])) {
        payload.push({ payload: await SC.encryptRow(appRowToDb(r)) });
      }
      const { error: e1 } = await client.rpc('replace_transactions', { p_rows: payload });
      if (e1) throw e1;

      // 2) Réglages — valeur CHIFFRÉE { enc } (jamais null grâce aux fallbacks)
      const uid = currentUser ? currentUser.id : undefined;
      const settingsRows = [];
      for (const s of SETTINGS_KEYS) {
        let value = readLocalJSON(s.ls);
        if (value == null) value = s.fallback();
        settingsRows.push({ user_id: uid, key: s.key, value: await SC.encryptSettingValue(value) });
      }
      const { error: e2 } = await client.from('app_settings').upsert(settingsRows, { onConflict: 'user_id,key' });
      if (e2) throw e2;

      showToast({ title: 'Sauvegardé (chiffré)', body: count + ' opérations + réglages chiffrés enregistrés dans le cloud.', ok: true });
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
    pendingPassword = null;
    if (window.SupabaseCrypto) window.SupabaseCrypto.clearKey();  // la clé ne survit pas à la déconnexion
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
    if (error.name === 'OperationError' || msg.includes('operation failed') || msg.includes('operation-specific')) {
      return 'Clé de chiffrement incorrecte ou données corrompues.';
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
    hasCryptoKey,
    // utilitaires testables (mapping pur)
    _appRowToDb: appRowToDb,
    _dbRowToApp: dbRowToApp
  };

  // Auto-init : le DOM est déjà parsé (script en fin de <body>).
  init().catch(e => console.error('SupabaseSync init', e));
})();
