-- ============================================================================
-- supabase_setup.sql  —  SCHÉMA CHIFFRÉ (E2E)
-- Dashboard freelance — schéma BDD + sécurité (RLS, MFA/aal2, grants opt-in)
-- ----------------------------------------------------------------------------
-- À COLLER dans Supabase → SQL Editor → New query → Run.
-- Idempotent : ré-exécutable sans danger (CREATE IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Schéma de référence (installation neuve, BDD vide).
--
-- Mono-utilisateur. Données financières sensibles. Page front publique :
-- la barrière est login + MFA + RLS, ET le CHIFFREMENT CÔTÉ NAVIGATEUR.
--
-- ----------------------------------------------------------------------------
-- CHIFFREMENT END-TO-END (E2E)
-- ----------------------------------------------------------------------------
--   Les 8 champs métier d'une ligne (date, mois, reference, description, nature,
--   montant, statut, datePaiement) sont sérialisés en JSON puis CHIFFRÉS
--   (AES-GCM 256, clé dérivée du mot de passe via PBKDF2) DANS LE NAVIGATEUR,
--   et stockés dans une seule colonne `transactions.payload` (text, base64).
--   Postgres ne voit que du ciphertext illisible. Aucune colonne métier en clair
--   n'est nécessaire : l'app lit TOUT le dataset et trie/agrège côté client.
--
--   La clé n'est JAMAIS stockée côté serveur. Seul le SEL (non secret) est stocké,
--   en clair, dans app_settings (clé `crypto_salt`). Un vérificateur de mot de
--   passe (constante chiffrée) est stocké dans `crypto_check`.
--
-- Réglages (table app_settings, clé/valeur JSONB) :
--   value = { "enc": "<base64>" }  (CHIFFRÉ) pour les 5 réglages synchronisés :
--     fiscal_config, checklist, ae_config, proj_overrides, client_rules
--   value EN CLAIR (non secret) pour les 2 clés méta de chiffrement :
--     crypto_salt  = { "salt": "<base64 16o>", "iterations": 600000, "v": 1 }
--     crypto_check = { "enc": "<chiffré d'une constante connue>" }
--   (Le thème dashboard_theme_v1 reste LOCAL à l'appareil, non synchronisé.)
-- ============================================================================

-- gen_random_uuid() (présent par défaut sur Supabase, sécurité si projet minimal)
create extension if not exists pgcrypto;

-- ============================================================================
-- 1) TABLES
-- ============================================================================

-- transactions : UNIQUEMENT des colonnes techniques + le payload chiffré.
-- Aucune donnée financière en clair.
create table if not exists public.transactions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  payload    text        not null default '',   -- JSON des 8 champs, chiffré AES-GCM (base64)
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_id_idx on public.transactions (user_id);

create table if not exists public.app_settings (
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,   -- { enc } chiffré (réglages) OU clair (crypto_salt/crypto_check)
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ============================================================================
-- 2) RLS — activé ET forcé (même le propriétaire de la table y est soumis)
-- ============================================================================
alter table public.transactions enable row level security;
alter table public.transactions force  row level security;
alter table public.app_settings  enable row level security;
alter table public.app_settings  force  row level security;

-- ============================================================================
-- 3) GRANTS explicites — strict minimum (principe de moindre privilège)
--    On retire d'abord TOUT, y compris les privilèges hérités des "default
--    privileges" de Supabase (TRUNCATE / REFERENCES / TRIGGER accordés à
--    `authenticated` à la création de la table), PUIS on n'accorde que les
--    4 commandes utiles. `anon` n'a aucun accès. Pas de séquence (PK = UUID).
--    NB : TRUNCATE contournerait le RLS → on s'assure que `authenticated`
--    ne l'a pas.
-- ============================================================================
revoke all on public.transactions from anon, public, authenticated;
revoke all on public.app_settings  from anon, public, authenticated;

grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.app_settings  to authenticated;

-- ============================================================================
-- 4) POLICIES « propriétaire » (permissives) — auth.uid() = user_id, par commande
--    (select) wrappé dans un sous-select : initplan mis en cache → plus rapide.
-- ============================================================================

-- transactions
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- app_settings
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_delete on public.app_settings
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ============================================================================
-- 5) POLICY RESTRICTIVE — MFA OBLIGATOIRE (niveau d'assurance aal2)
--    Combinée en ET avec les policies « propriétaire » ci-dessus :
--    sans 2e facteur validé (aal != aal2), l'API ne renvoie/accepte RIEN,
--    même si le front était contourné. (Indépendante des colonnes lues.)
-- ============================================================================
drop policy if exists transactions_require_mfa on public.transactions;
create policy transactions_require_mfa on public.transactions
  as restrictive for all to authenticated
  using      ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

drop policy if exists app_settings_require_mfa on public.app_settings;
create policy app_settings_require_mfa on public.app_settings
  as restrictive for all to authenticated
  using      ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ============================================================================
-- 6) FONCTION replace_transactions — sauvegarde « miroir » ATOMIQUE
--    security invoker => s'exécute avec le rôle + le RLS de l'appelant
--    (donc soumise aux policies propriétaire ET aal2 ci-dessus).
--    Tout en une transaction : delete de mes lignes puis insert du snapshot.
--    p_rows = tableau JSON de lignes { "payload": "<ciphertext base64>" }.
-- ============================================================================
create or replace function public.replace_transactions(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.transactions
   where user_id = (select auth.uid());

  insert into public.transactions (user_id, payload)
  select
    (select auth.uid()),
    coalesce(r ->> 'payload', '')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;
end;
$$;

revoke all     on function public.replace_transactions(jsonb) from anon, public;
grant  execute on function public.replace_transactions(jsonb) to authenticated;

-- ============================================================================
-- 7) VÉRIFICATIONS (à lancer après coup, facultatif)
-- ----------------------------------------------------------------------------
-- a) RLS bien actif sur les 2 tables :
--    select relname, relrowsecurity, relforcerowsecurity
--      from pg_class where relname in ('transactions','app_settings');
--    -> relrowsecurity et relforcerowsecurity doivent être TRUE.
--
-- b) Lister les policies :
--    select schemaname, tablename, policyname, permissive, cmd
--      from pg_policies where tablename in ('transactions','app_settings');
--
-- c) Données bien ILLISIBLES : Table Editor → transactions → colonne `payload`
--    doit afficher du base64 incompréhensible (pas de montant/description lisible).
--
-- d) Erreur 42501 « permission denied » au save/load côté app :
--    => un GRANT manque. Ré-exécuter la section 3 (GRANTS) ci-dessus.
-- ============================================================================
