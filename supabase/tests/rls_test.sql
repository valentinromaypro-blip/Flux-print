-- Vérifie la RLS et la réservation atomique. Échoue (exception) au premier écart.
grant select, insert on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.products (code, label, media_options, page_count) values ('jeu-poker-54', 'Jeu', '{cmdm-350g}', 55);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.orders (id, customer_id, email) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'a@x.fr');
insert into public.order_items (order_id, product_code, media, source_path)
  values ('10000000-0000-0000-0000-000000000001', 'jeu-poker-54', 'cmdm-350g', 'a/1/f.pdf');
do $$ begin
  begin
    insert into public.orders (customer_id, email, status) values
      ('00000000-0000-0000-0000-00000000000a', 'a@x.fr', 'paid');
    raise exception 'ECHEC : un client a créé une commande payée';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.orders) <> 0 then raise exception 'ECHEC : B voit la commande de A'; end if;
  if (select count(*) from public.order_items) <> 0 then raise exception 'ECHEC : B voit les lignes de A'; end if;
  if (select count(*) from public.products) <> 1 then raise exception 'ECHEC : catalogue invisible'; end if;
end $$;

reset role;
do $$ declare n int; begin
  select count(*) into n from public.claim_items('uploaded', 'checking', 10, true);
  if n <> 0 then raise exception 'ECHEC : ligne non payée réservée'; end if;
  select count(*) into n from public.claim_items('uploaded', 'checking', 10, false);
  if n <> 1 then raise exception 'ECHEC : réservation (%)', n; end if;
  select count(*) into n from public.claim_items('uploaded', 'checking', 10, false);
  if n <> 0 then raise exception 'ECHEC : double réservation'; end if;
end $$;
select 'RLS et réservation : OK' as resultat;
