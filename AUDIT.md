# Audit du code — novembre 2026

Revue complète du dépôt : failles, bugs et optimisations. Ce document liste tous les
constats, ce qui a été corrigé sur la branche `claude/fervent-euler-5e07sf` (commit
`cff698b`) et ce qui reste à faire.

## 1. Synthèse

- 22 constats. Aucune injection : les 41 écritures `innerHTML` échappent toutes les
  données importées ou synchronisées. RLS forcé et second facteur exigé côté base.
- 8 corrigés, 6 corrigés en partie (le reste à faire est indiqué sur chaque ligne), 8 ouverts.
- Le plus important : le SDK Supabase était chargé depuis un CDN en version flottante,
  sans contrôle d'intégrité, dans la page où tu saisis ton mot de passe et ton code
  TOTP. Il est maintenant servi par l'app, en version figée.

### Vérifications faites

| Vérification | Résultat |
|---|---|
| `node scripts/test-merge.js` | 9 tests sur 9 |
| Syntaxe des scripts modifiés (`node --check`) | OK |
| Page chargée dans un navigateur avec un jeu d'essai | 0 erreur console, SDK local chargé, aucune requête vers le CDN |
| Salaire émis non payé | exclu des versements reçus (vérifié sur les totaux) |
| Règles client corrompues en `localStorage` | la page s'affiche (elle restait vide) |
| Parseur de montants | 12 formats testés, dont « 1.234,56 » et le signe moins typographique |

### Ce qui n'a pas pu être vérifié

- Le projet Supabase réel : inscription ouverte ou fermée, données déjà en base.
- Le parcours de connexion avec deux facteurs TOTP (pas de compte de test).
- L'intranet source du userscript (`tools/reecho-export.user.js`).

## 2. À faire de ton côté

1. **Fusionner** : la version de cache passe à `v8`, les navigateurs reçoivent les
   correctifs au prochain chargement.
2. **Vérifier dans le dashboard Supabase** que l'inscription est fermée (« Allow new
   users to sign up » désactivé). Rien dans le dépôt ne limite le projet à ton compte.
3. **Tester une connexion** avec ton authenticator habituel, puis avec celui de secours.

## 3. Constats

Sévérité : H haute, M moyenne, B basse.

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| FD-SEC-01 | H | SDK Supabase chargé depuis jsDelivr en `@2`, sans intégrité ni CSP | corrigé en partie : SDK auto-hébergé en 2.118.0 et pré-caché ; la CSP reste à ajouter |
| FD-BUG-01 | H | Salaire, notes de frais et tickets restaurant émis mais non payés étaient soustraits du solde sur encaissé, et absents de « Ton portage te doit » | corrigé en partie : le solde sur encaissé ne compte plus que le payé ; le héros reste à compléter (voir section 4) |
| FD-BUG-02 | H | Un seul facteur TOTP interrogé : le code d'un authenticator de secours était toujours refusé | corrigé |
| FD-SEC-02 | M | La clé de chiffrement dérive du mot de passe de connexion, que Supabase Auth reçoit : ce n'est pas un chiffrement de bout en bout face au fournisseur | ouvert ; le README décrit maintenant cette limite |
| FD-BUG-03 | M | Après un changement de mot de passe, impossible de re-chiffrer : le bouton est masqué et la nouvelle clé refusée | ouvert |
| FD-BUG-04 | M | La clé de fusion ignore la date et le mois : deux lignes légitimes identiques n'en font qu'une | ouvert (à confirmer sur un export réel) |
| FD-BUG-05 | M | Projection : provision congés, PAS et charges diverses oubliés (433 € de trop par mois dans l'exemple) ; mois passés non facturés projetés à 100 % | ouvert |
| FD-BUG-06 | M | Synchro en miroir sans version : un appareil en retard écrase le cloud, les réglages du cloud écrasent les réglages locaux | ouvert |
| FD-SEC-03 | M | Le service worker purgeait tous les caches de l'origine, y compris ceux d'autres pages du même compte GitHub Pages | corrigé |
| FD-SEC-04 | M | Réglage malformé venu du cloud : le rendu plantait à chaque ouverture | corrigé (forme validée) ; reste : refuser un réglage en clair, lier les blobs par AAD |
| FD-SEC-05 | M | Aucune limite au nombre de comptes ni à la taille des lignes côté base | ouvert (dépend du réglage d'inscription) |
| FD-ROB-01 | M | Import silencieux : « 1.234,56 » valait 1,234, le signe moins typographique donnait 0 | corrigé pour les montants ; nature inconnue et statut inattendu restent ignorés sans alerte |
| FD-SEC-06 | B | Itérations PBKDF2 et sel fournis par le serveur sans plancher | corrigé |
| FD-BUG-07 | B | Une date ou un mois corrigés à la source étaient ignorés à la fusion | corrigé |
| FD-ROB-02 | B | Contenu `localStorage` non validé : page vide ou import bloqué | corrigé |
| FD-BUG-08 | B | Chargement cloud non paginé (troncature à 1 000 lignes) | corrigé ; le userscript ne lit toujours pas « 1 239 opérations » |
| FD-BUG-09 | B | « -5 j écoulés » quand l'émission retenue est à venir | corrigé |
| FD-OPT-01 | B | Une réponse 404 était mise en cache ; version écrite à la main à 43 endroits | corrigé pour la 404 ; la version reste manuelle |
| FD-OPT-02 | B | Script du CDN synchrone et bloquant, non pré-caché | corrigé (SDK local) |
| FD-OPT-03 | B | Synchro ligne à ligne : 69 Ko par synchro contre 1,8 Ko pour un blob compressé et chiffré | ouvert |
| FD-ROB-03 | B | Userscript : statut exporté tel qu'affiché, format de montant supposé, `@namespace` personnel | ouvert |
| — | B | Le README affirmait « le serveur ne voit que du texte chiffré » | corrigé |

## 4. Reste à faire, par priorité

1. **FD-BUG-01, suite** : ajouter au héros « Ton portage te doit » un segment « Salaire
   et frais en attente » pour le salaire, les notes de frais et les tickets émis mais
   non payés. Aujourd'hui ils n'apparaissent que dans la vue mensuelle.
2. **FD-BUG-03** : action « Réinitialiser le chiffrement » (nouveau sel, nouveau
   vérificateur, ré-envoi des données locales). Sans elle, la clé reste liée à l'ancien
   mot de passe, même s'il a été changé parce qu'il était compromis.
3. **FD-BUG-06** : stocker une révision chiffrée, la relire avant de sauvegarder,
   proposer la fusion (`mergeDatasets` existe) quand le cloud a changé.
4. **FD-BUG-05** : soustraire provision, PAS et charges diverses dans `projectMonth` ;
   0 jour par défaut pour un mois passé non facturé.
5. **FD-SEC-01, suite** : balise `Content-Security-Policy` (`script-src 'self'` plus le
   hash du script de thème, `connect-src` limité au projet Supabase).
6. **FD-SEC-02** : phrase secrète de chiffrement distincte du mot de passe, ou deux
   secrets dérivés côté client avec une clé de données enveloppée (règle aussi FD-BUG-03).
7. **FD-BUG-04, FD-ROB-01** : dédupliquer par rang d'occurrence avec le mois dans la clé ;
   refuser un import dont une nature est inconnue.
8. **FD-OPT-01, FD-OPT-03** : une seule constante de version dans `sw.js` ; un seul
   enregistrement compressé et chiffré par synchro.

## 5. Ce qui est sain

- **Échappement** : toute chaîne importée ou synchronisée passe par `UI.esc` ou
  `textContent`. Aucun gestionnaire en ligne, aucun `eval`.
- **Chiffrement** : IV aléatoire de 96 bits à chaque appel, clé 256 bits non extractible
  et jamais persistée, PBKDF2-SHA256 à 600 000 itérations. Une mauvaise phrase est
  rejetée sans rien écraser.
- **Base** : RLS activé et forcé, policies par commande sur `user_id`, policy restrictive
  `aal2`, aucun droit pour `anon`.
- **Service worker** : Supabase jamais intercepté, aucune requête authentifiée en cache.
- **Performance** : 1,24 ms par rendu pour 198 lignes ; aucun écouteur en fuite.
