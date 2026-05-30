// ============================================================
// SUPABASE — CONFIG (bloc isolé)
// ============================================================
// ⚙️  C'EST LE SEUL FICHIER À ÉDITER pour brancher le cloud.
//
// Où trouver ces valeurs : Supabase Dashboard → ton projet →
//   Project Settings → API
//     • Project URL                     → champ `url` ci-dessous
//     • Project API keys → clé "anon" / "publishable"
//                                        → champ `publishableKey` ci-dessous
//
// ⚠️  NE METS JAMAIS la clé `service_role` ici : elle contourne le RLS
//     et donnerait un accès total à tes données depuis cette page publique.
//     Seule la clé publishable (anon) doit figurer dans le front.
//
// Tant que les deux PLACEHOLDER ne sont pas remplacés, le dashboard
// reste 100 % local (aucun client Supabase n'est créé, aucun bouton cloud
// n'apparaît) — exactement le comportement actuel.
// ============================================================
window.SUPABASE_CONFIG = {
  url: 'https://awpvoiqnfcdppbjdunfo.supabase.co',
  publishableKey: 'sb_publishable_19C2YCe8lI8L5uM6EgSJlw_KxoHfQK3'
};
