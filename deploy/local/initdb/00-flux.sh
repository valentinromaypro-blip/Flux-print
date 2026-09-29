#!/bin/sh
# Initialisation de la base de démonstration : maquette des objets Supabase, puis migrations.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /flux/supabase/tests/supabase_stubs.sql
for f in /flux/supabase/migrations/*.sql; do
  echo "migration $f"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$f"
done
