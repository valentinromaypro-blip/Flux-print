-- Données de démonstration pour visualiser le tableau de bord de l'atelier (30 jours d'activité fictive).
-- Base locale uniquement ! Les commandes créées sont marquées « demo » (e-mail en @exemple.fr).
-- Aucune ligne n'est laissée dans un état que le moteur traite (approved payée, prepared) : il n'y a pas de vrais fichiers.
--   docker compose exec db psql -U postgres -d flux -f /flux/supabase/seed/demo.sql
-- Pour les retirer : delete from public.orders where email like '%@exemple.fr'; delete from public.batches where id like 'L-DEMO-%';
begin;
select setseed(0.42);

insert into public.batches (id, gang_key, media, sheet_code, status, sheets, impressions, fill_ratio, created_at, generated_at) values
  ('L-DEMO-01', 'cmdm-350g|63.5x88.9|3|short_edge', 'cmdm-350g', 'SRA3', 'printed', 31, 62, 0.9412, now() - interval '20 days', now() - interval '20 days'),
  ('L-DEMO-02', 'cmdm-350g|63.5x88.9|3|short_edge', 'cmdm-350g', 'SRA3', 'printed', 46, 92, 0.9630, now() - interval '12 days', now() - interval '12 days'),
  ('L-DEMO-03', 'carte-graphique-300g|63.5x88.9|3|short_edge', 'carte-graphique-300g', 'SRA3', 'printed', 16, 32, 0.9074, now() - interval '6 days', now() - interval '6 days'),
  ('L-DEMO-04', 'cmdm-350g|63.5x88.9|3|short_edge', 'cmdm-350g', 'SRA3', 'generated', 38, 76, 0.9510, now() - interval '5 hours', now() - interval '5 hours'),
  ('L-DEMO-05', 'carte-graphique-300g|63.5x88.9|3|short_edge', 'carte-graphique-300g', 'SRA3', 'generated', 12, 24, 0.8889, now() - interval '2 hours', now() - interval '2 hours')
on conflict (id) do nothing;

do $$
declare
  n int; o uuid; paid timestamptz; st text; ist text; b text; prod text; med text; cp int; price int;
  firsts text[] := array['camille','lucas','lea','hugo','chloe','nathan','manon','louis','ines','jules','sarah','tom'];
begin
  for n in 1..48 loop
    paid := now() - (random() * 29 + 0.1) * interval '1 day';
    prod := (array['jeu-poker-54','jeu-poker-54','jeu-poker-54','jeu-poker-32','jeu-bridge-54','jeu-poker-54-dos-individuels'])[1 + floor(random() * 6)];
    med  := case when random() < 0.75 then 'cmdm-350g' else 'carte-graphique-300g' end;
    cp   := (array[1,1,1,1,2,2,3,5,10,25])[1 + floor(random() * 10)];
    price := cp * (2490 + floor(random() * 900)::int) * case when cp >= 10 then 85 else 100 end / 100;
    -- Avancement selon l'ancienneté de la commande
    if paid < now() - interval '8 days' then st := 'shipped'; ist := 'batched';
      b := case when paid < now() - interval '15 days' then 'L-DEMO-01' when med = 'cmdm-350g' then 'L-DEMO-02' else 'L-DEMO-03' end;
    elsif paid < now() - interval '4 days' then st := 'printed'; ist := 'batched'; b := case when med = 'cmdm-350g' then 'L-DEMO-02' else 'L-DEMO-03' end;
    elsif paid < now() - interval '1 day' then st := 'in_production'; ist := 'batched'; b := case when med = 'cmdm-350g' then 'L-DEMO-04' else 'L-DEMO-05' end;
    else st := 'paid'; ist := 'checking'; b := null;  -- jamais « approved » ni « prepared » : le vrai moteur les traiterait
    end if;
    insert into public.orders (email, status, total_cents, paid_at, created_at, updated_at, payment_ref, due_date, shipping_address,
                               shipped_at, carrier, tracking_number)
    values (firsts[1 + floor(random() * 12)] || n || '@exemple.fr', st, price + 490, paid, paid - interval '20 minutes',
            least(now(), paid + interval '4 days'), 'demo',
            case when n % 11 = 0 and st = 'paid' then current_date + 1 end,
            jsonb_build_object('name', initcap(firsts[1 + n % 12]) || ' ' || (array['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand','Leroy'])[1 + n % 8],
                               'line1', (1 + n * 7 % 90) || ' ' || (array['rue des Lilas','avenue Jean Jaurès','rue Victor Hugo','boulevard Voltaire','place du Marché'])[1 + n % 5],
                               'postal_code', (array['75011','69003','33000','44000','13006','59800','67000','31000'])[1 + n % 8],
                               'city', (array['Paris','Lyon','Bordeaux','Nantes','Marseille','Lille','Strasbourg','Toulouse'])[1 + n % 8], 'country', 'FR'),
            case when st = 'shipped' then least(now(), paid + interval '4 days') end,
            case when st = 'shipped' then 'Colissimo' end, case when st = 'shipped' then '6A' || (10000000000 + n * 7919)::text end)
    returning id into o;
    if random() < 0.7 then  -- création en ligne, sinon PDF déposé
      insert into public.order_items (order_id, product_code, media, copies, status, batch_id, design, preflight_report, created_at, updated_at)
      values (o, prod, med, cp, ist, b, '{"demo": true}', case when ist <> 'checking' then '{"findings": []}'::jsonb end, paid - interval '25 minutes', least(now(), paid + interval '40 minutes'));
    else
      insert into public.order_items (order_id, product_code, media, copies, status, batch_id, source_path, preflight_report, created_at, updated_at)
      values (o, prod, med, cp, ist, b, 'demo/fichier.pdf', case when ist <> 'checking' then '{"findings": []}'::jsonb end, paid - interval '25 minutes', least(now(), paid + interval '40 minutes'));
    end if;
  end loop;

  -- Cas à traiter : une erreur moteur, un fichier refusé depuis 3 jours, deux paniers non payés
  insert into public.orders (email, status, total_cents, paid_at, payment_ref, shipping_address) values ('marc.demo@exemple.fr', 'paid', 3480, now() - interval '3 hours', 'demo', '{"name": "Marc Lefèvre", "line1": "4 impasse des Tilleuls", "postal_code": "21000", "city": "Dijon", "country": "FR"}') returning id into o;
  insert into public.order_items (order_id, product_code, media, copies, status, error, design)
  values (o, 'jeu-poker-54', 'cmdm-350g', 1, 'failed', 'check: RuntimeError: photo illisible (fichier HEIC renommé en .jpg)', '{"demo": true}');
  insert into public.orders (email, status, total_cents) values ('asso.demo@exemple.fr', 'awaiting_payment', 0) returning id into o;
  insert into public.order_items (order_id, product_code, media, copies, status, source_path, created_at, updated_at)
  values (o, 'jeu-poker-54-dos-individuels', 'cmdm-350g', 20, 'rejected', 'demo/fichier.pdf', now() - interval '3 days', now() - interval '3 days');
  for n in 1..2 loop
    insert into public.orders (email, status, total_cents) values ('panier' || n || '@exemple.fr', 'awaiting_payment', 0) returning id into o;
    insert into public.order_items (order_id, product_code, media, copies, status, design) values (o, 'jeu-poker-54', 'cmdm-350g', 1, 'approved', '{"demo": true}');
  end loop;
end $$;

-- Cohérence : chaque lot est généré après le paiement de ses commandes.
update public.batches b set created_at = x.at, generated_at = x.at
  from (select i.batch_id, least(now() - interval '1 hour', max(o.paid_at) + interval '9 hours') as at
          from public.order_items i join public.orders o on o.id = i.order_id where i.batch_id like 'L-DEMO-%' group by 1) x
 where x.batch_id = b.id;

insert into public.events (entity, entity_id, type, payload) values ('batch', 'L-DEMO-05', 'generated', '{"demo": true}');
commit;
