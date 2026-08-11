// ============================================================
// Vérification du moteur de fusion d'import : node scripts/test-merge.js
// Aucune dépendance, aucune donnée réelle — le jeu d'essai est synthétique.
//
// Régression couverte : quand le portage ré-émet une facture (client final, TJM
// ou nombre de jours corrigés), sa description et/ou son montant changent, donc
// rowKey() change. La fusion additive ajoutait alors la version corrigée À CÔTÉ
// de l'ancienne, et l'agrégation mensuelle cumulait les deux : CA et jours du
// mois doublés, sans que rien ne le signale.
// ============================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// data.js est écrit pour le navigateur : on lui fournit les globales minimales.
const sandbox = {
  console,
  window: {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'),
  sandbox,
  { filename: 'data.js' }
);

// DATASET est un `let` de haut niveau : il n'est pas exposé sur le sandbox,
// on passe donc systématiquement par une évaluation dans le contexte.
const run = (code, vars) => {
  Object.assign(sandbox, vars || {});
  return vm.runInContext(code, sandbox);
};
const parseCSV        = (text)      => run('parseCSV(__text)', { __text: text });
const supersededRows  = (a, b)      => run('supersededRows(__a, __b)', { __a: a, __b: b });
const mergeDatasets   = (a, b, o)   => run('mergeDatasets(__a, __b, __o)', { __a: a, __b: b, __o: o || {} });
const aggregateOf     = (rows)      => run('DATASET = __rows; aggregate()', { __rows: rows });

const HEADER = 'DATE arrow_drop_up arrow_drop_down,MOIS,RÉFÉRENCE,DESCRIPTION,' +
               'NATURE arrow_drop_up arrow_drop_down,MONTANT HT,ENCAISSÉ/PAYÉ,' +
               'DATE PAIEMENT arrow_drop_up arrow_drop_down';

// Export initial : février clôturé, mars facturé 10,5 j au nom d'ALPHA.
const EXPORT_V1 = [
  HEADER,
  '31/03/2030,03-2030,RC-2030-03-0001,Facturation ALPHA DEMO (03-2030) (700.00 * 10.50),Crédit - Facturation,"7 350,00",Non payé,',
  '31/03/2030,03-2030,RC-2030-03-0001,Frais de portage 6.00%,Charges - Commission Portage,"441,00",Non payé,',
  '01/03/2030,03-2030,RC-2030-03-0001,Salaire FR NET,Revenu - Salaire NET (Après impot),"1 800,00",Non payé,',
  '28/02/2030,02-2030,RC-2030-02-0001,Facturation ALPHA DEMO (02-2030) (700.00 * 18.00),Crédit - Facturation,"12 600,00",Payé,30/04/2030',
  '28/02/2030,02-2030,RC-2030-02-0001,Frais de portage 6.00%,Charges - Commission Portage,"756,00",Payé,30/04/2030'
].join('\n');

// Export suivant : même référence RC-2030-03-0001, mais la facture de mars a été
// ré-émise (client BETA, 525 € x 14 j au lieu de 700 € x 10,5 j) pour le même
// total. Le salaire de mars est passé à "Payé", et avril arrive.
const EXPORT_V2 = [
  HEADER,
  '30/04/2030,04-2030,RC-2030-04-0001,Facturation BETA DEMO (04-2030) (525.00 * 20.00),Crédit - Facturation,"10 500,00",Non payé,',
  '31/03/2030,03-2030,RC-2030-03-0001,Facturation BETA DEMO (03-2030) (525.00 * 14.00),Crédit - Facturation,"7 350,00",Non payé,',
  '31/03/2030,03-2030,RC-2030-03-0001,Frais de portage 6.00%,Charges - Commission Portage,"441,00",Non payé,',
  '01/03/2030,03-2030,RC-2030-03-0001,Salaire FR NET,Revenu - Salaire NET (Après impot),"1 800,00",Payé,30/04/2030',
  '28/02/2030,02-2030,RC-2030-02-0001,Facturation ALPHA DEMO (02-2030) (700.00 * 18.00),Crédit - Facturation,"12 600,00",Payé,30/04/2030',
  '28/02/2030,02-2030,RC-2030-02-0001,Frais de portage 6.00%,Charges - Commission Portage,"756,00",Payé,30/04/2030'
].join('\n');

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const v1 = parseCSV(EXPORT_V1);
const v2 = parseCSV(EXPORT_V2);

test('le CSV est parsé avec les bonnes colonnes', () => {
  assert.strictEqual(v1.length, 5);
  assert.strictEqual(v1[0].mois, '03-2030');
  assert.strictEqual(v1[0].montant, 7350);
  assert.strictEqual(v1[0].nature, 'Crédit - Facturation');
});

const initial = mergeDatasets([], v1);
test('import initial : tout est ajouté, rien n\'est supprimé', () => {
  assert.strictEqual(initial.rows.length, 5);
  assert.strictEqual(initial.stats.added, 5);
  assert.strictEqual(initial.stats.removed, 0);
});

test('réimporter le même export ne change rien (idempotence)', () => {
  const again = mergeDatasets(initial.rows, v1);
  assert.strictEqual(again.rows.length, 5);
  assert.strictEqual(again.stats.added, 0);
  assert.strictEqual(again.stats.updated, 0);
  assert.strictEqual(again.stats.removed, 0);
  assert.strictEqual(again.stats.unchanged, 5);
});

test('la facture ré-émise est détectée comme obsolète', () => {
  const obsoletes = supersededRows(initial.rows, v2);
  assert.strictEqual(obsoletes.length, 1);
  assert.strictEqual(obsoletes[0].description, 'Facturation ALPHA DEMO (03-2030) (700.00 * 10.50)');
});

const applied = mergeDatasets(initial.rows, v2);
test('l\'import remplace la facture ré-émise au lieu de l\'empiler', () => {
  assert.strictEqual(applied.stats.removed, 1);
  assert.strictEqual(applied.stats.added, 2);   // mars ré-émis + avril
  assert.strictEqual(applied.stats.updated, 1); // salaire de mars passé à Payé
  assert.strictEqual(applied.rows.length, 6);
  const facturationsMars = applied.rows.filter(r => r.mois === '03-2030' && r.nature === 'Crédit - Facturation');
  assert.strictEqual(facturationsMars.length, 1);
});

test('le mois corrigé retrouve son CA et ses jours réels', () => {
  const mars = aggregateOf(applied.rows).monthsByKey['03-2030'];
  assert.strictEqual(mars.facturation, 7350);
  assert.strictEqual(mars.jours_travailles, 14);
  assert.strictEqual(mars.tjm, 525);
});

test('sans suppression, le mois est bien faussé (le test détecte la régression)', () => {
  const additif = mergeDatasets(initial.rows, v2, { dropMissing: false });
  assert.strictEqual(additif.stats.removed, 0);
  assert.strictEqual(additif.rows.length, 7);
  const mars = aggregateOf(additif.rows).monthsByKey['03-2030'];
  assert.strictEqual(mars.facturation, 14700); // 7 350 comptés deux fois
  assert.strictEqual(mars.jours_travailles, 24.5); // 10,5 + 14
});

test('un mois non couvert par l\'export est conservé intact', () => {
  const horsPerimetre = {
    date: '31/01/2030', mois: '01-2030', reference: 'RC-2030-01-0001',
    description: 'Facturation ALPHA DEMO (01-2030) (700.00 * 12.00)',
    nature: 'Crédit - Facturation', montant: 8400, statut: 'Payé', datePaiement: '31/03/2030'
  };
  const avec = mergeDatasets([horsPerimetre].concat(initial.rows), v2);
  assert.strictEqual(avec.stats.removed, 1); // seule la facture de mars saute
  assert.strictEqual(avec.rows.filter(r => r.mois === '01-2030').length, 1);
});

console.log(`\n${passed} tests OK`);
