"""Accès à la base Postgres (Supabase) du worker.

Le worker se connecte directement à Postgres avec le rôle propriétaire (chaîne
de connexion Supabase) : la RLS ne s'applique pas à lui, les clients passent
par l'API avec leurs propres droits.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class Database:
    def __init__(self, dsn: str):
        self.conn = psycopg.connect(dsn, row_factory=dict_row, autocommit=True)

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def transaction(self) -> Iterator[psycopg.Connection]:
        with self.conn.transaction():
            yield self.conn

    # --- Catalogue -------------------------------------------------------------

    def upsert_product(self, code: str, label: str, media_options: list[str], page_count: int,
                       shop: dict | None = None, options: dict | None = None, media: list | None = None,
                       templates: dict | None = None, active: bool = True) -> None:
        self.conn.execute(
            """insert into public.products (code, label, media_options, page_count, shop, options, media, templates,
                                            active, updated_at)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
               on conflict (code) do update set label = excluded.label, media_options = excluded.media_options,
                 page_count = excluded.page_count, shop = excluded.shop, options = excluded.options,
                 media = excluded.media, templates = excluded.templates, active = excluded.active,
                 updated_at = now()""",
            (code, label, media_options, page_count, Jsonb(shop or {}), Jsonb(options or {}), Jsonb(media or []),
             Jsonb(templates or {}), active),
        )

    # --- Commandes (développement / back-office) ----------------------------------

    def create_order(self, email: str, customer_id: str | None = None, due_date: str | None = None) -> dict:
        return self.conn.execute(
            "insert into public.orders (email, customer_id, due_date) values (%s, %s, %s) returning *",
            (email, customer_id, due_date),
        ).fetchone()

    def add_item(self, order_id: str, product_code: str, media: str, copies: int, source_path: str,
                 options: dict | None = None) -> dict:
        return self.conn.execute(
            """insert into public.order_items (order_id, product_code, media, copies, source_path, options)
               values (%s, %s, %s, %s, %s, %s) returning *""",
            (order_id, product_code, media, copies, source_path, Jsonb(options or {})),
        ).fetchone()

    def mark_paid(self, order_id: str, payment_ref: str, total_cents: int | None = None) -> None:
        self.conn.execute(
            """update public.orders set status = 'paid', paid_at = now(), payment_ref = %s,
                 total_cents = coalesce(%s, total_cents)
               where id = %s and status in ('draft', 'awaiting_payment')""",
            (payment_ref, total_cents, order_id),
        )
        self.event("order", order_id, "paid", {"payment_ref": payment_ref})

    def order(self, order_id: str) -> dict:
        return self.conn.execute("select * from public.orders where id = %s", (order_id,)).fetchone()

    def item(self, item_id: str) -> dict:
        return self.conn.execute("select * from public.order_items where id = %s", (item_id,)).fetchone()

    def batch(self, batch_id: str) -> dict:
        return self.conn.execute("select * from public.batches where id = %s", (batch_id,)).fetchone()

    # --- Lignes de commande --------------------------------------------------------

    def claim_items(self, from_status: str, to_status: str, limit: int = 10, paid_only: bool = False) -> list[dict]:
        return self.conn.execute(
            "select * from public.claim_items(%s, %s, %s, %s)", (from_status, to_status, limit, paid_only)
        ).fetchall()

    def update_item(self, item_id: str, **fields: Any) -> None:
        if not fields:
            return
        columns = ", ".join(f"{k} = %s" for k in fields)
        values = [Jsonb(v) if isinstance(v, dict) else v for v in fields.values()]
        self.conn.execute(f"update public.order_items set {columns} where id = %s", (*values, item_id))

    def prepared_items(self) -> list[dict]:
        """Lignes prêtes à amalgamer, avec les infos de commande utiles au regroupement."""
        return self.conn.execute(
            """select i.*, o.number as order_number, o.due_date, o.paid_at
                 from public.order_items i join public.orders o on o.id = i.order_id
                where i.status = 'prepared'
                order by o.due_date nulls last, i.created_at"""
        ).fetchall()

    # --- Lots ----------------------------------------------------------------------

    def reserve_batch(self, batch_id: str, gang_key: str, media: str, sheet_code: str, item_ids: list[str]) -> list[dict]:
        """Crée le lot et y rattache les lignes encore « prepared » (verrouillées)."""
        with self.transaction() as conn:
            conn.execute(
                """insert into public.batches (id, gang_key, media, sheet_code, status)
                   values (%s, %s, %s, %s, 'generating')""",
                (batch_id, gang_key, media, sheet_code),
            )
            rows = conn.execute(
                """update public.order_items set status = 'batched', batch_id = %s
                    where id = any(%s::uuid[]) and status = 'prepared'
                    returning *""",
                (batch_id, item_ids),
            ).fetchall()
        return rows

    def complete_batch(self, batch_id: str, pdf_path: str, manifest: dict) -> None:
        with self.transaction() as conn:
            conn.execute(
                """update public.batches set status = 'generated', pdf_path = %s, manifest = %s,
                     sheets = %s, impressions = %s, fill_ratio = %s, generated_at = now()
                   where id = %s""",
                (pdf_path, Jsonb(manifest), manifest["sheets_count"], manifest["impressions"],
                 manifest["fill_ratio"], batch_id),
            )
            orders = conn.execute(
                "select distinct order_id from public.order_items where batch_id = %s", (batch_id,)
            ).fetchall()
            for row in orders:
                conn.execute("select public.refresh_order_status(%s)", (row["order_id"],))

    def fail_batch(self, batch_id: str, error: str) -> None:
        """Le lot échoue : ses lignes redeviennent disponibles pour un prochain lot."""
        with self.transaction() as conn:
            conn.execute("update public.batches set status = 'failed', error = %s where id = %s", (error, batch_id))
            conn.execute(
                "update public.order_items set status = 'prepared', batch_id = null where batch_id = %s", (batch_id,)
            )

    # --- Demandes de lot (back-office) ---------------------------------------------------

    def take_batch_requests(self) -> list[dict]:
        return self.conn.execute(
            """update public.batch_requests set handled_at = now()
                where handled_at is null returning *"""
        ).fetchall()

    def answer_batch_requests(self, ids: list[int], result: dict) -> None:
        if ids:
            self.conn.execute("update public.batch_requests set result = %s where id = any(%s)", (Jsonb(result), ids))

    # --- Journal ---------------------------------------------------------------------

    def event(self, entity: str, entity_id: str, type_: str, payload: dict | None = None) -> None:
        self.conn.execute(
            "insert into public.events (entity, entity_id, type, payload) values (%s, %s, %s, %s)",
            (entity, str(entity_id), type_, Jsonb(json.loads(json.dumps(payload or {}, default=str)))),
        )

    def events(self, entity: str, entity_id: str) -> list[dict]:
        return self.conn.execute(
            "select * from public.events where entity = %s and entity_id = %s order by id", (entity, str(entity_id))
        ).fetchall()
