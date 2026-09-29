-- Espaces de stockage (Supabase Storage).
--   uploads    : fichiers clients, chemin {auth.uid()}/{order_id}/{fichier}.pdf
--   previews   : aperçus PNG générés par le worker (lecture par le propriétaire)
--   production : fichiers préparés et lots SRA3 (worker uniquement)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads',    'uploads',    false, 524288000, array['application/pdf']),
  ('previews',   'previews',   false, 10485760,  array['image/png', 'image/webp']),
  ('production', 'production', false, null,      array['application/pdf', 'application/json'])
on conflict (id) do nothing;

create policy uploads_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy uploads_read_own on storage.objects
  for select to authenticated
  using (bucket_id in ('uploads', 'previews') and (storage.foldername(name))[1] = auth.uid()::text);
