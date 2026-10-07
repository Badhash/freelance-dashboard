# Pilotage freelance

Tableau de bord personnel pour un freelance en portage salarial : on importe l'export CSV
de l'intranet du portage, et l'application montre ce que le portage te doit, ce qui arrive
et quand, ton activité et ce que tu toucheras d'ici la fin de l'année.

Application monopage en HTML, CSS et JavaScript sans framework ni étape de build,
publiée sur GitHub Pages et installable comme application (PWA).

## Fonctionnalités

- **Aperçu** : total à récupérer au centime (profit shares en attente, provision congés,
  cooptation) avec sa composition, prochain versement, et solde déjà présent sur le compte
  de portage.
- **Prochains versements** : escalier cumulé des profit shares en attente, avec une date
  d'arrivée estimée (date d'émission + délai médian constaté).
- **Indicateurs** : CA facturé et jours facturés de l'année comparés à la même période de
  l'année précédente, TJM actuel, délais de paiement constatés (factures client et profit
  shares).
- **Détail du solde** : équation du solde, cascade des flux et grand livre ligne à ligne.
- **En attente de versement** : piste de chaque profit share émis ou à venir, et des
  factures que le client n'a pas encore réglées au portage (retards signalés).
- **Activité** : CA cumulé année par année, bilan par année (jours, TJM moyen, congés
  acquis, répartition par client) et « constellation » des jours facturés mois par mois.
- **Projection fin d'année** : jours prévus ajustables mois par mois (conservés dans le
  navigateur), total projeté et comparaison avec l'année précédente.
- **Mois par mois** : répartition du facturé (prélevé, salaire, petits plus, profit share),
  statuts de paiement et récit détaillé de chaque mois.
- **Audit** : vérification automatique de l'historique (commission, tickets restaurant,
  délais des profit shares, salaire, charges, provision congés, écarts de clôture).
- **Import sans doublon** : les lignes déjà connues sont reconnues, les nouveautés sont
  résumées après chaque import (encaissements, charges réglées par le portage, nouvelles
  factures…). Une facture corrigée ou ré-émise à la source est détectée et son ancienne
  version peut être retirée.
- **Interface** : thèmes clair et sombre (préférence système par défaut), mise en page
  bureau, tablette et mobile (dock d'actions au pouce), fonctionnement hors ligne une fois
  installée, respect de `prefers-reduced-motion`.

## Utilisation

Ouvre `index.html` dans un navigateur récent, ou l'URL GitHub Pages du dépôt, puis importe
ton CSV (bouton « Importer » ou glisser-déposer sur l'écran d'accueil). Réimporte un export
plus récent quand tu veux : la fusion est sans doublon.

Les clients sont détectés depuis les libellés de facturation. Pour imposer tes propres noms,
utilise la console du navigateur :

```javascript
addClientRule('MOT_CLE_DU_LIBELLE', 'Nom à afficher')
listClientRules()
resetClientRules()
```

## Export depuis l'intranet du portage

`tools/reecho-export.user.js` est un script Tampermonkey qui ajoute un bouton « Exporter CSV »
sur la page du compte d'activité de l'intranet Reecho. Il parcourt toutes les pages de
l'onglet « Opérations » et télécharge un CSV au format attendu par `parseCSV()` (en-têtes
historiques, dates `JJ/MM/AAAA`, mois `MM-AAAA`, montants positifs dans le sens de leur
nature). Il refuse d'exporter quand une recherche ou un filtre est actif : l'import considère
un export comme l'état complet des mois qu'il couvre.

## Confidentialité

- Par défaut, tout reste dans ce navigateur (`localStorage`, en clair) : aucun serveur,
  aucun suivi, aucune mesure d'audience.
- La synchronisation cloud est **optionnelle** (Supabase) : connexion email et mot de passe
  avec second facteur TOTP obligatoire, données et réglages **chiffrés dans le navigateur**
  avant l'envoi (AES-GCM 256, clé dérivée du mot de passe par PBKDF2, jamais stockée).
  Le serveur ne voit que du texte chiffré, protégé en plus par RLS.
- La page charge les polices Google Fonts et, pour le cloud, la bibliothèque Supabase depuis
  le CDN jsDelivr.

Pour activer le cloud sur ton propre projet : exécute `supabase_setup.sql` dans l'éditeur SQL
de Supabase, puis renseigne l'URL du projet et la clé publique (« anon ») dans
`supabase-config.js`. Sans configuration, aucun bouton cloud n'apparaît.

## Structure

```
index.html              coquille : barre d'app, état vide, points de montage, modales
css/tokens.css          couleurs, rayons, ombres et mouvement (thèmes clair et sombre)
css/base.css            reset, typographie, composants partagés, graphiques, infobulle
css/shell.css           ciel d'aurore, barre d'app, navigation, dock mobile, pied de page
css/hero.css            premier écran (héros, prochains versements) et détail du solde
css/activity.css        indicateurs et section Activité
css/months.css          piste des versements et mois par mois
css/projection.css      projection
css/overlays.css        modales et notifications
data.js                 moteur : lecture du CSV, fusion, agrégats, projection
icons.js                icônes SVG (tracés Lucide) en sprite
charts.js               primitives partagées : formats, dates, composants, SVG, infobulle
render.js               orchestration du rendu et modèle de vue
render-balance.js       héros, prochains versements, détail du solde
render-stats.js         indicateurs et activité
render-months.js        en attente de versement, mois par mois
render-projection.js    projection
render-overlays.js      modales, notifications, audit, résumé d'import
main.js                 import, actions, thème, service worker
supabase-*.js           synchronisation cloud optionnelle et chiffrement
sw.js, manifest.json    application installable et hors ligne
scripts/test-merge.js   tests du moteur de fusion (node scripts/test-merge.js)
scripts/gen-icons.js    génération des icônes PNG de l'application
tools/                  script d'export de l'intranet
```

## Tests

```bash
node scripts/test-merge.js
```

Le jeu d'essai est synthétique : aucune donnée réelle n'est versionnée.
