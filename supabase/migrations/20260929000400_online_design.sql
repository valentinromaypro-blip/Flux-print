-- Création en ligne : la ligne porte un design (JSON) au lieu d'un fichier déposé.
-- Le worker fabrique le PDF (source_path) avant de le contrôler comme un fichier client.
alter table public.order_items alter column source_path drop not null;
alter table public.order_items add column design jsonb;
alter table public.order_items add constraint order_items_source_or_design
  check (source_path is not null or design is not null);

alter table public.products add column editor text;  -- type d'éditeur en ligne (null = dépôt de PDF seulement)
