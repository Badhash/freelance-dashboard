-- ============================================================================
-- supabase_setup.sql
-- Dashboard freelance — schéma BDD + sécurité (RLS, MFA/aal2, grants opt-in)
-- ----------------------------------------------------------------------------
-- À COLLER dans Supabase → SQL Editor → New query → Run.
-- Idempotent : ré-exécutable sans danger (CREATE IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Mono-utilisateur. Données financières sensibles. Page front publique :
-- la seule barrière est le login + MFA, doublée ici par le RLS côté BDD.
--
-- ----------------------------------------------------------------------------
-- MAPPING 1:1  —  ligne du dataset (en mémoire, produite par parseCSV) → colonne
-- ----------------------------------------------------------------------------
--   row.date         (DD/MM/YYYY)  ->  transactions.date_emission   text
--   row.mois         (MM-YYYY)     ->  transactions.mois            text
--   row.reference                  ->  transactions.reference       text
--   row.description                ->  transactions.description     text
--   row.nature                     ->  transactions.nature          text   (déclenche l'agrégation)
--   row.montant      (number)      ->  transactions.montant         numeric (recoercé en Number à la lecture)
--   row.statut                     ->  transactions.statut          text   ('Payé' = encaissé)
--   row.datePaiement (DD/MM/YYYY)  ->  transactions.date_paiement   text
--
--   En-têtes CSV reconnus (parseCSV, fuzzy/casse-insensible) : MOIS, RÉFÉRENCE,
--   DESCRIPTION, NATURE, MONTANT HT, ENCAISSÉ/STATUT, DATE PAIEMENT, DATE.
--   Les dates restent du TEXTE DD/MM/YYYY (aucune conversion → round-trip exact,
--   les 3 chiffres de référence du dashboard sont préservés au centime près).
--
-- Réglages (table app_settings, clé/valeur JSONB) ← clés localStorage :
--   fiscal_config   <- dashboard_fiscal_config_v1
--   checklist       <- dashboard_fiscal_checklist_v1
--   ae_config       <- dashboard_ae_config_v1
--   proj_overrides  <- dashboard_proj_overrides_v1
--   client_rules    <- dashboard_client_rules_v1
--   (Le thème dashboard_theme_v1 reste LOCAL à l'appareil, non synchronisé.)
-- ============================================================================

-- gen_random_uuid() (présent par défaut sur Supabase, sécurité si projet minimal)
create extension if not exists pgcrypto;

-- ============================================================================
-- 1) TABLES
-- ============================================================================

create table if not exists public.transactions (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid()
                            references auth.users (id) on delete cascade,
  date_emission text        not null default '',
  mois          text        not null default '',
  reference     text        not null default '',
  description   text        not null default '',
  nature        text        not null default '',
  montant       numeric     not null default 0,
  statut        text        not null default '',
  date_paiement text        not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists transactions_user_id_idx on public.transactions (user_id);

create table if not exists public.app_settings (
  user_id    uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,
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
--    même si le front était contourné.
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
--    p_rows = tableau JSON de lignes au format appRowToDb (cf. mapping en tête).
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

  insert into public.transactions
    (user_id, date_emission, mois, reference, description, nature, montant, statut, date_paiement)
  select
    (select auth.uid()),
    coalesce(r ->> 'date_emission', ''),
    coalesce(r ->> 'mois', ''),
    coalesce(r ->> 'reference', ''),
    coalesce(r ->> 'description', ''),
    coalesce(r ->> 'nature', ''),
    coalesce((r ->> 'montant')::numeric, 0),
    coalesce(r ->> 'statut', ''),
    coalesce(r ->> 'date_paiement', '')
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
-- c) Test « API déconnectée » (rôle anon) : doit renvoyer 0 ligne / refus.
--    set role anon;
--      select * from public.transactions;   -- doit échouer ou ne rien renvoyer
--    reset role;
--
-- d) Erreur 42501 « permission denied » au save/load côté app :
--    => un GRANT manque. Ré-exécuter la section 3 (GRANTS) ci-dessus.
-- ============================================================================
