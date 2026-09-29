-- Expédition : transporteur, numéro de suivi, date d'envoi (saisis par l'atelier).
alter table public.orders
  add column if not exists carrier text,
  add column if not exists tracking_number text,
  add column if not exists shipped_at timestamptz;
