-- Flux-print : chaîne commande → fichier de production.
--
-- États d'une ligne de commande (order_items.status) :
--   uploaded   fichier client déposé, en attente de contrôle
--   checking   preflight en cours (réservé par un worker)
--   rejected   fichier refusé (rapport dans preflight_report)
--   approved   fichier conforme, en attente du paiement de la commande
--   preparing  normalisation + conversion CMJN en cours
--   prepared   fichier de production prêt, en attente d'amalgame
--   batched    posé dans un lot (batch_id)
--   failed     erreur technique (error), reprise manuelle
--
-- États d'un lot (batches.status) : planned → generating → generated
-- (→ dispatched → printed, avec le lien Fiery).

create extension if not exists pgcrypto;

-- Catalogue : synchronisé depuis la configuration du moteur (config/products).
create table public.products (
  code          text primary key,
  label         text not null,
  media_options text[] not null default '{}',
  page_count    int  not null,
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);

create sequence public.order_number_seq start 1000;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique default ('FP-' || nextval('public.order_number_seq')),
  customer_id      uuid references auth.users (id) on delete set null,
  email            text not null,
  status           text not null default 'draft'
                   check (status in ('draft', 'awaiting_payment', 'paid', 'in_production',
                                     'printed', 'shipped', 'cancelled')),
  currency         text not null default 'EUR',
  total_cents      int  not null default 0,
  payment_ref      text,
  shipping_address jsonb,
  due_date         date,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.batches (
  id            text primary key,              -- ex. L20260929-081500
  -- Un lot peut mélanger plusieurs produits compatibles (ex. jeux de 54 et de 32
  -- au même format et sur le même carton) : il est défini par sa clé d'amalgame.
  gang_key      text not null,                 -- support | format | fond perdu | recto/verso
  media         text not null,
  sheet_code    text not null,
  status        text not null default 'planned'
                check (status in ('planned', 'generating', 'generated', 'dispatched', 'printed', 'failed')),
  sheets        int,
  impressions   int,
  fill_ratio    numeric(5, 4),
  pdf_path      text,                          -- bucket production
  manifest      jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  generated_at  timestamptz
);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  product_code    text not null references public.products (code),
  media           text not null,
  copies          int  not null default 1 check (copies between 1 and 500),
  source_path     text not null,               -- bucket uploads
  status          text not null default 'uploaded'
                  check (status in ('uploaded', 'checking', 'rejected', 'approved', 'preparing',
                                    'prepared', 'batched', 'failed')),
  preflight_report jsonb,
  preview_paths   text[] not null default '{}', -- bucket previews
  prepared_path   text,                        -- bucket production
  batch_id        text references public.batches (id),
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index order_items_status_idx on public.order_items (status, created_at);
create index order_items_order_idx on public.order_items (order_id);

create table public.events (
  id          bigint generated always as identity primary key,
  entity      text not null check (entity in ('order', 'item', 'batch')),
  entity_id   text not null,
  type        text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index events_entity_idx on public.events (entity, entity_id, created_at);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
create trigger order_items_touch before update on public.order_items
  for each row execute function public.touch_updated_at();

-- Réservation atomique de lignes par un worker : plusieurs workers peuvent tourner
-- sans jamais traiter deux fois la même ligne (FOR UPDATE SKIP LOCKED).
-- p_paid_only : ne prendre que les lignes dont la commande est payée.
create or replace function public.claim_items(
  p_from text, p_to text, p_limit int default 10, p_paid_only boolean default false
) returns setof public.order_items
language sql security definer set search_path = public as $$
  update public.order_items i
     set status = p_to
   where i.id in (
     select i2.id
       from public.order_items i2
       join public.orders o on o.id = i2.order_id
      where i2.status = p_from
        and (not p_paid_only or o.status in ('paid', 'in_production'))
      order by o.due_date nulls last, i2.created_at
      limit p_limit
      for update of i2 skip locked)
  returning i.*;
$$;

-- Une commande passe « en production » dès que toutes ses lignes sont en lot.
create or replace function public.refresh_order_status(p_order uuid) returns void
language sql security definer set search_path = public as $$
  update public.orders o
     set status = 'in_production'
   where o.id = p_order
     and o.status = 'paid'
     and not exists (select 1 from public.order_items i
                      where i.order_id = o.id and i.status <> 'batched');
$$;

revoke execute on function public.claim_items(text, text, int, boolean) from public, anon, authenticated;
revoke execute on function public.refresh_order_status(uuid) from public, anon, authenticated;

-- Sécurité (RLS) ---------------------------------------------------------------
-- Le worker utilise la clé service_role (contourne la RLS).
-- Les clients (y compris invités via connexion anonyme Supabase) ne voient que
-- leurs commandes. Paiement et changements d'état : uniquement côté serveur.

alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.batches     enable row level security;
alter table public.events      enable row level security;

create policy products_read on public.products
  for select to anon, authenticated using (active);

create policy orders_read_own on public.orders
  for select to authenticated using (customer_id = auth.uid());
create policy orders_create_own on public.orders
  for insert to authenticated
  with check (customer_id = auth.uid() and status = 'draft' and total_cents = 0 and payment_ref is null);

create policy items_read_own on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy items_create_own on public.order_items
  for insert to authenticated
  with check (
    status = 'uploaded'
    and batch_id is null and prepared_path is null and preflight_report is null
    and exists (select 1 from public.orders o
                where o.id = order_id and o.customer_id = auth.uid() and o.status = 'draft')
  );
-- batches et events : aucun accès client.
