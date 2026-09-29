-- Facturation : chaque commande payée reçoit sa facture dans l'outil de facturation de l'atelier
-- (Sellsy, synchronisé vers Pennylane). Le numéro légal est celui de cet outil.
alter table public.orders
  add column if not exists invoice_provider text,
  add column if not exists invoice_id       text,
  add column if not exists invoice_number   text,
  add column if not exists invoice_pdf_url  text,
  add column if not exists invoice_error    text,
  add column if not exists invoiced_at      timestamptz;

-- Un client (par e-mail) = un contact dans l'outil de facturation : pas de doublon d'une commande à l'autre.
create table if not exists public.invoicing_contacts (
  provider    text not null,
  email       text not null,
  external_id text not null,
  created_at  timestamptz not null default now(),
  primary key (provider, email)
);
alter table public.invoicing_contacts enable row level security;  -- réservé au worker (service_role)
