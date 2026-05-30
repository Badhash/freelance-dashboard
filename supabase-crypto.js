// ============================================================
// SUPABASE — CRYPTO (chiffrement E2E côté navigateur, module isolé)
// ============================================================
// Chiffre les données financières DANS le navigateur avant l'envoi à Supabase
// et ne les déchiffre qu'à l'affichage. Supabase ne stocke que du ciphertext.
//
// • Clé DÉRIVÉE DU MOT DE PASSE via PBKDF2 (Web Crypto natif), chiffrement
//   AES-GCM 256. Aucune lib crypto tierce.
// • La clé n'est JAMAIS persistée : elle vit en mémoire le temps de la session
//   (state ci-dessous), dérivée à chaque login/déverrouillage.
// • Le sel (non secret) est stocké côté serveur dans app_settings.crypto_salt.
//
// Module STRICTEMENT inerte au chargement : il ne fait QUE définir
// window.SupabaseCrypto (aucun appel crypto, aucun await top-level, aucune
// dépendance DOM). Sans connexion/clé, rien n'est invoqué → flux local intact.
//
// Chargé APRÈS supabase-config.js / data.js / render*.js et AVANT
// supabase-sync.js (qui en dépend).
// ============================================================

(function () {
  'use strict';

  const VERSION = 0x01;          // octet de version en tête d'enveloppe (évolutif)
  const IV_LEN = 12;             // nonce AES-GCM standard (96 bits)
  const VERIFIER = 'freelance-dashboard-crypto-v1';   // constante connue → vérificateur de mot de passe
  const DEFAULT_ITERATIONS = 600000;                  // PBKDF2-HMAC-SHA256 (OWASP 2023)

  // Web Crypto : window.crypto en navigateur ; injecté dans le sandbox de test.
  const C = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto
          : (typeof window !== 'undefined' && window.crypto ? window.crypto : null);

  // --- État clé de session (jamais persisté, jamais sur window) ------------
  let _key = null;
  function setKey(k) { _key = k; }
  function getKey() { return _key; }
  function hasKey() { return !!_key; }
  function clearKey() { _key = null; }
  function requireKey() { if (!_key) throw new Error('Clé de chiffrement absente.'); return _key; }

  // --- Encodages ------------------------------------------------------------
  const _enc = new TextEncoder();
  const _dec = new TextDecoder();
  function utf8encode(str) { return _enc.encode(str); }
  function utf8decode(bytes) { return _dec.decode(bytes); }

  // base64 par chunks : évite le RangeError (stack) sur gros tableaux et ne
  // corrompt aucun octet (String.fromCharCode appliqué par tranches de 0x8000).
  function b64encode(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }
  function b64decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) { return C.getRandomValues(new Uint8Array(n)); }

  // --- Dérivation de clé (PBKDF2 → AES-GCM 256) -----------------------------
  async function deriveKey(password, saltBytes, iterations) {
    const baseKey = await C.subtle.importKey(
      'raw', utf8encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return C.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: iterations || DEFAULT_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,                 // extractable:false → la clé ne peut pas être relue/exportée
      ['encrypt', 'decrypt']
    );
  }

  // --- Chiffrement / déchiffrement ------------------------------------------
  // enveloppe = base64( [VERSION(1o)] [IV(12o ALÉATOIRE)] [ciphertext+tag] )
  async function encrypt(key, plaintextStr) {
    const iv = randomBytes(IV_LEN);   // IV aléatoire à CHAQUE appel — jamais réutilisé ni dérivé du contenu
    const ct = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8encode(plaintextStr)));
    const out = new Uint8Array(1 + IV_LEN + ct.length);
    out[0] = VERSION;
    out.set(iv, 1);
    out.set(ct, 1 + IV_LEN);
    return b64encode(out);
  }
  async function decrypt(key, envelopeStr) {
    const bytes = b64decode(envelopeStr);
    if (bytes[0] !== VERSION) throw new Error('Version de chiffrement inconnue.');
    const iv = bytes.subarray(1, 1 + IV_LEN);
    const ct = bytes.subarray(1 + IV_LEN);
    // throw (OperationError) si la clé est mauvaise : le tag GCM ne valide pas.
    const pt = await C.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return utf8decode(new Uint8Array(pt));
  }

  // --- Helpers métier (utilisent la clé de session interne) -----------------
  // dbRow = objet au format appRowToDb (data_emission, mois, …, montant Number).
  async function encryptRow(dbRow) { return encrypt(requireKey(), JSON.stringify(dbRow)); }
  async function decryptRow(payloadStr) { return JSON.parse(await decrypt(requireKey(), payloadStr)); }
  async function encryptSettingValue(obj) { return { enc: await encrypt(requireKey(), JSON.stringify(obj)) }; }
  async function decryptSettingValue(value) { return JSON.parse(await decrypt(requireKey(), value.enc)); }

  // --- Vérificateur de mot de passe ----------------------------------------
  // crypto_check = { enc: makeVerifier(key) }. Si checkVerifier renvoie false,
  // le mot de passe ne correspond pas à celui qui a chiffré les données.
  async function makeVerifier(key) { return encrypt(key, VERIFIER); }
  async function checkVerifier(key, envelopeStr) {
    try { return (await decrypt(key, envelopeStr)) === VERIFIER; }
    catch (e) { return false; }
  }

  window.SupabaseCrypto = {
    DEFAULT_ITERATIONS,
    // état clé de session
    setKey, getKey, hasKey, clearKey,
    // primitives
    deriveKey, encrypt, decrypt,
    b64encode, b64decode, randomBytes, utf8encode, utf8decode,
    // helpers métier
    encryptRow, decryptRow, encryptSettingValue, decryptSettingValue,
    // vérificateur
    makeVerifier, checkVerifier
  };
})();
