-- Demandes de lancement immédiat d'un lot, depuis le back-office atelier.
create table public.batch_requests (
  id           bigint generated always as identity primary key,
  requested_by text,
  requested_at timestamptz not null default now(),
  handled_at   timestamptz,
  result       jsonb
);
alter table public.batch_requests enable row level security;  -- aucun accès client
