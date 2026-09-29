-- Boutique : fiches produit pour le site, options client, sessions invités, prix.

alter table public.products
  add column shop     jsonb not null default '{}',   -- titre, accroche, description, image, grille de prix
  add column options  jsonb not null default '{}',   -- options modifiables par le client
  add column media    jsonb not null default '[]',   -- supports proposés [{code, label, description}]
  add column templates jsonb not null default '{}';  -- gabarits : { "<format ou default>": "<chemin bucket templates>" }

-- Commandes d'invités : jeton de session (cookie httpOnly signé côté site).
alter table public.orders
  add column session_token uuid,
  add column payment_provider text;
create index orders_session_idx on public.orders (session_token) where status = 'draft';

-- Ligne : options choisies (format, nombre de cartes…) et prix figé au moment de l'ajout.
alter table public.order_items
  add column options          jsonb not null default '{}',
  add column unit_price_cents int,
  add column total_cents      int;

-- Gabarits téléchargeables : bucket public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('templates', 'templates', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;
