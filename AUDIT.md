# Audit du code — novembre 2026

Revue complète du dépôt : failles, bugs et optimisations. Ce document liste tous les
constats, ce qui a été corrigé sur `master` et ce qui reste à faire. Une correction =
un commit : chacune s'annule seule avec `git revert <commit>`.

## 1. Synthèse

- 23 constats. Aucune injection : les 41 écritures `innerHTML` échappent toutes les
  données importées ou synchronisées. RLS forcé et second facteur exigé côté base.
- 18 corrigés, 2 corrigés en partie (le reste à faire est indiqué sur chaque ligne), 3 ouverts.
- Le plus important : le SDK Supabase était chargé depuis un CDN en version flottante,
  sans contrôle d'intégrité, dans la page où tu saisis ton mot de passe et ton code
  TOTP. Il est maintenant servi par l'app, en version figée, et une CSP limite les
  scripts à ceux de l'app et les connexions au projet Supabase.

### Vérifications faites

| Vérification | Résultat |
|---|---|
| `node scripts/test-merge.js` | 14 tests sur 14, dont 5 nouveaux : lignes identiques gardées, réimport sans doublon, ligne retirée à la source, date ou mois corrigés, export partiel |
| Syntaxe des scripts modifiés (`node --check`) | OK |
| Page chargée dans Chromium (Playwright) avec un jeu d'essai, CSP active | 0 violation CSP, 0 erreur console au chargement, à l'import, dans l'audit et sur l'écran de connexion ; service worker enregistré ; un script externe, un `fetch` hors liste et un gestionnaire en ligne sont bien bloqués |
| Héros, exemple de l'audit (facture 12 000 € et commission 720 € payées, salaire 1 800 € et tickets 240 € non payés) | « Ton portage te doit » 2 040 € (0 € avant), segment « Salaire et frais en attente », solde sur encaissé 11 280 € |
| Projection, exemple de l'audit (20 j × 600 €) | profit share projeté 7 047 €, égal au réel (7 480 € avant) ; mois écoulé non facturé à 0 jour |
| Synchro : code réel contre un faux client Supabase en mémoire, deux appareils | appareil en retard refusé puis fusion ; révision absente non bloquante ; réglages locaux confirmés avant écrasement ; réglage en clair ignoré ; réinitialisation du chiffrement après changement de mot de passe |
| Import : `importFile()` réel | fichier avec U+FFFD refusé ; nature inconnue et statut inattendu annoncés avant import |
| Userscript exécuté sur un faux tableau | « 1 239 opérations » lu, export filtré ou incomplet refusé, statut et montant contrôlés |
| Règles client corrompues en `localStorage` | la page s'affiche (elle restait vide) |
| Parseur de montants | 12 formats testés, dont « 1.234,56 » et le signe moins typographique |

### Ce qui n'a pas pu être vérifié

- Le projet Supabase réel : inscription ouverte ou fermée, données déjà en base. La
  révision de synchro et la réinitialisation du chiffrement n'ont été exercées que contre
  un faux client.
- Le parcours de connexion avec deux facteurs TOTP (pas de compte de test).
- L'intranet source du userscript (`tools/reecho-export.user.js`) : le format des
  montants réellement affiché. Un montant inattendu arrête l'export avec un message qui
  le cite ; un statut inconnu est exporté et signalé.

## 2. À faire de ton côté

1. **Version de cache `v9`** : les navigateurs reçoivent les correctifs au prochain
   chargement (un rechargement suffit, le service worker se met à jour seul).
2. **Vérifier dans le dashboard Supabase** que l'inscription est fermée (« Allow new
   users to sign up » désactivé). Rien dans le dépôt ne limite le projet à ton compte.
3. **Tester une connexion** avec ton authenticator habituel, puis avec celui de secours,
   et une sauvegarde : la première écrit la révision de synchro, rien n'est bloqué avant.
4. **Userscript** : son `@namespace` a changé, Tampermonkey l'installe comme un nouveau
   script. Installe la version 2.1.0, puis supprime l'ancienne.
5. **Si l'URL du projet Supabase change** : la reporter aussi dans la CSP d'`index.html`
   (`connect-src`, en `https://` et `wss://`), sinon le cloud est bloqué.

## 3. Constats

Sévérité : H haute, M moyenne, B basse.

| ID | Sév. | Constat | Statut |
|---|---|---|---|
| FD-SEC-01 | H | SDK Supabase chargé depuis jsDelivr en `@2`, sans intégrité ni CSP | corrigé : SDK auto-hébergé en 2.118.0 et pré-caché ; balise CSP (script de thème autorisé par son hash) |
| FD-BUG-01 | H | Salaire, notes de frais et tickets restaurant émis mais non payés étaient soustraits du solde sur encaissé, et absents de « Ton portage te doit » | corrigé : le solde sur encaissé ne compte que le payé ; segment « Salaire et frais en attente » dans le héros et le détail du solde |
| FD-BUG-02 | H | Un seul facteur TOTP interrogé : le code d'un authenticator de secours était toujours refusé | corrigé |
| FD-SEC-02 | M | La clé de chiffrement dérive du mot de passe de connexion, que Supabase Auth reçoit : ce n'est pas un chiffrement de bout en bout face au fournisseur | ouvert ; le README décrit maintenant cette limite |
| FD-BUG-03 | M | Après un changement de mot de passe, impossible de re-chiffrer : le bouton est masqué et la nouvelle clé refusée | corrigé : « Réinitialiser le chiffrement », proposé en aal2 quand le déverrouillage échoue (nouveau sel, nouveau vérificateur, ré-envoi des données locales) |
| FD-BUG-04 | M | La clé de fusion ignore la date et le mois : deux lignes légitimes identiques n'en font qu'une | corrigé : appariement occurrence par occurrence, mois hors de la clé (une date ou un mois corrigés restent une mise à jour) |
| FD-BUG-05 | M | Projection : provision congés, PAS et charges diverses oubliés (433 € de trop par mois dans l'exemple) ; mois passés non facturés projetés à 100 % | corrigé : les trois montants sont déduits du profit share projeté ; 0 jour par défaut pour un mois écoulé non facturé |
| FD-BUG-06 | M | Synchro en miroir sans version : un appareil en retard écrase le cloud, les réglages du cloud écrasent les réglages locaux | corrigé : révision chiffrée relue avant chaque sauvegarde (refus et proposition de fusion), confirmation avant d'écraser des réglages locaux, date d'import conservée ; la relecture et l'écriture ne sont pas atomiques côté base (deux sauvegardes à la même seconde restent possibles) |
| FD-SEC-03 | M | Le service worker purgeait tous les caches de l'origine, y compris ceux d'autres pages du même compte GitHub Pages | corrigé |
| FD-SEC-04 | M | Réglage malformé venu du cloud : le rendu plantait à chaque ouverture | corrigé en partie : réglage en clair refusé, forme de chaque réglage validée avant écriture ; reste : lier les blobs par AAD (demande une migration des données existantes) |
| FD-SEC-05 | M | Aucune limite au nombre de comptes ni à la taille des lignes côté base | ouvert (dépend du réglage d'inscription) |
| FD-ROB-01 | M | Import silencieux : « 1.234,56 » valait 1,234, le signe moins typographique donnait 0, nature inconnue et statut inattendu ignorés sans alerte | corrigé : montants lus correctement ; fichier ré-encodé (U+FFFD) refusé ; nature inconnue et statut inattendu annoncés avant l'import ; règle d'audit « Natures ignorées » |
| FD-SEC-06 | B | Itérations PBKDF2 et sel fournis par le serveur sans plancher | corrigé |
| FD-BUG-07 | B | Une date ou un mois corrigés à la source étaient ignorés à la fusion | corrigé |
| FD-ROB-02 | B | Contenu `localStorage` non validé : page vide ou import bloqué | corrigé |
| FD-BUG-08 | B | Chargement cloud non paginé (troncature à 1 000 lignes) ; le userscript ne lisait pas « 1 239 opérations » | corrigé |
| FD-BUG-09 | B | « -5 j écoulés » quand l'émission retenue est à venir | corrigé |
| FD-OPT-01 | B | Une réponse 404 était mise en cache ; version écrite à la main à 43 endroits | corrigé pour la 404 ; la version reste manuelle |
| FD-OPT-02 | B | Script du CDN synchrone et bloquant, non pré-caché | corrigé (SDK local) |
| FD-OPT-03 | B | Synchro ligne à ligne : 69 Ko par synchro contre 1,8 Ko pour un blob compressé et chiffré | ouvert |
| FD-ROB-03 | B | Userscript : statut exporté tel qu'affiché, format de montant supposé, `@namespace` personnel | corrigé : statut ramené à « Payé » / « Non payé » (une autre valeur est exportée et signalée), montant `1 234,56` exigé (export annulé sinon), `@namespace` neutre ; fusionné avec l'adaptation à `intranet.reecho.eu` (colonne « Statut », nature lue dans `title`, libellés renommés) |
| FD-BUG-10 | B | Userscript : arrêt au chargement (ReferenceError) si un tableau ou des onglets étaient déjà affichés, bouton jamais visible | corrigé |
| — | B | Le README affirmait « le serveur ne voit que du texte chiffré » | corrigé |

## 4. Reste à faire, par priorité

1. **FD-SEC-02** : phrase secrète de chiffrement distincte du mot de passe, ou deux
   secrets dérivés côté client avec une clé de données enveloppée. Elle permettrait aussi
   de changer de mot de passe sans réinitialiser le chiffrement (aujourd'hui, ce qui n'est
   que dans le cloud est perdu si l'ancien mot de passe l'est aussi).
2. **FD-SEC-05** : fermer l'inscription côté Supabase, limiter taille et nombre de lignes
   en base. Une fonction SQL qui compare la révision avant d'écrire rendrait aussi la
   garde de FD-BUG-06 atomique.
3. **FD-SEC-04, suite** : lier chaque blob chiffré à son usage (AAD), avec une migration
   des données déjà en base.
4. **FD-OPT-01, FD-OPT-03** : une seule constante de version dans `sw.js` ; un seul
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
