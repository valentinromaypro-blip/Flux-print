"""Chaîne complète sur un vrai PostgreSQL, avec les migrations Supabase.

Nécessite un serveur Postgres : FLUX_TEST_PG (défaut : socket /tmp, port 5499,
utilisateur postgres). Les tests sont sautés s'il n'est pas joignable.
"""

import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pikepdf
import psycopg
import pytest

from conftest import make_pdf
from flux_print.config import list_products, load_press, load_product, media_options
from flux_print.orders.batching import BatchingRules, plan_batches
from flux_print.orders.db import Database
from flux_print.orders.files import LocalFileStore, SupabaseStorage
from flux_print.orders.worker import ProductionSettings, Worker
from flux_print.production import is_pdfx4
from flux_print.production.dispatch import check_press_ready

REPO = Path(__file__).resolve().parents[3]
PG = os.environ.get("FLUX_TEST_PG", "host=/tmp port=5499 user=postgres")


def _admin():
    try:
        return psycopg.connect(f"{PG} dbname=postgres", autocommit=True, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip("PostgreSQL de test indisponible")


@pytest.fixture
def db():
    admin = _admin()
    name = f"fp_test_{uuid.uuid4().hex[:8]}"
    admin.execute(f"create database {name}")
    try:
        with psycopg.connect(f"{PG} dbname={name}", autocommit=True) as conn:
            for role in ("anon", "authenticated", "service_role"):
                conn.execute(f"do $$ begin create role {role} nologin; exception when duplicate_object then null; end $$")
            stubs = (REPO / "supabase/tests/supabase_stubs.sql").read_text()
            stubs = "\n".join(l for l in stubs.splitlines() if not l.startswith("create role"))
            conn.execute(stubs)
            for migration in sorted((REPO / "supabase/migrations").glob("*.sql")):
                conn.execute(migration.read_text())
        database = Database(f"{PG} dbname={name}")
        for code in list_products():
            spec = load_product(code)
            database.upsert_product(code, spec.label, media_options(code), spec.page_count)
        yield database
        database.close()
    finally:
        admin.execute(f"drop database if exists {name} with (force)")
        admin.close()


@pytest.fixture
def files(tmp_path):
    return LocalFileStore(tmp_path / "storage")


def _settings(**rules):
    return ProductionSettings(rules=BatchingRules(**rules), measure_ink=False)


def _order(db, files, tmp_path, pdf: Path, product="jeu-poker-54", copies=1, paid=True, due=None, media=None):
    spec = load_product(product, media=media)
    order = db.create_order("client@example.fr", due_date=due)
    path = f"invites/{order['id']}/{uuid.uuid4()}.pdf"
    files.upload("uploads", path, pdf, "application/pdf")
    item = db.add_item(order["id"], product, spec.media, copies, path)
    if paid:
        db.mark_paid(order["id"], "test")
    return order, item


def _deck(tmp_path, name="deck.pdf", product="jeu-poker-54", **kw):
    return make_pdf(tmp_path / name, load_product(product), **kw)


def test_full_chain_to_sra3_file(db, files, tmp_path):
    order, item = _order(db, files, tmp_path, _deck(tmp_path), copies=2)
    worker = Worker(db, files, _settings())
    counts = worker.run_once(force_batches=True)
    assert counts == {"checked": 1, "prepared": 1, "batches": 1, "invoiced": 0}

    item = db.item(item["id"])
    assert item["status"] == "batched"
    assert item["preflight_report"]["passed"] is True
    assert len(item["preview_paths"]) == 2
    batch = db.batch(item["batch_id"])
    assert batch["status"] == "generated"
    assert batch["sheets"] == 7  # 2 × (54 + séparateur) = 110 pièces / 18
    assert db.order(order["id"])["status"] == "in_production"

    lot = files._path("production", batch["pdf_path"])
    with pikepdf.open(lot) as pdf:
        assert is_pdfx4(pdf)
    sheet = load_press("xerox-iridesse").sheet()
    assert check_press_ready(lot, sheet, batch["manifest"]) == []
    assert [e["type"] for e in db.events("item", item["id"])] == ["approved", "prepared"]


def test_rejected_file_never_reaches_production(db, files, tmp_path):
    bad = _deck(tmp_path, "bad.pdf", bleed_mm=0)  # sans fond perdu
    _, item = _order(db, files, tmp_path, bad)
    Worker(db, files, _settings()).run_once(force_batches=True)
    item = db.item(item["id"])
    assert item["status"] == "rejected"
    assert "geometry.bleed" in {f["code"] for f in item["preflight_report"]["findings"]}
    assert item["batch_id"] is None


def test_unpaid_order_is_checked_but_not_prepared(db, files, tmp_path):
    order, item = _order(db, files, tmp_path, _deck(tmp_path), paid=False)
    worker = Worker(db, files, _settings())
    worker.run_once(force_batches=True)
    assert db.item(item["id"])["status"] == "approved"
    db.mark_paid(order["id"], "stripe_pi_x")
    worker.run_once(force_batches=True)
    assert db.item(item["id"])["status"] == "batched"


def test_batch_waits_for_fill_then_ganges_orders(db, files, tmp_path):
    worker = Worker(db, files, _settings(min_fill_ratio=0.99, max_wait_hours=48, separators=False))
    deck = _deck(tmp_path)
    _, first = _order(db, files, tmp_path, deck)
    worker.run_once()
    # 54 pièces = 3 feuilles pleines : remplissage 100 %, le lot part.
    assert db.item(first["id"])["status"] == "batched"

    _, a = _order(db, files, tmp_path, _deck(tmp_path, "d32.pdf", "jeu-poker-32"), product="jeu-poker-32")
    worker.run_once()
    assert db.item(a["id"])["status"] == "prepared"  # 32 pièces sur 36 poses : on attend
    _, b = _order(db, files, tmp_path, _deck(tmp_path, "d32b.pdf", "jeu-poker-32"), product="jeu-poker-32")
    _, c = _order(db, files, tmp_path, deck)
    worker.run_once()
    # 32 + 32 + 54 = 118 pièces… pas plein ; mais jeux 54 et 32 partagent la même clé d'amalgame.
    statuses = {db.item(x["id"])["status"] for x in (a, b, c)}
    assert statuses == {"prepared"}
    worker.run_once(force_batches=True)
    batch_ids = {db.item(x["id"])["batch_id"] for x in (a, b, c)}
    assert len(batch_ids) == 1  # un seul lot, trois commandes, deux produits


def test_different_media_are_never_ganged(db, files, tmp_path):
    deck = _deck(tmp_path)
    _, a = _order(db, files, tmp_path, deck)
    _, b = _order(db, files, tmp_path, deck, media="carte-graphique-300g")
    Worker(db, files, _settings()).run_once(force_batches=True)
    assert db.item(a["id"])["batch_id"] != db.item(b["id"])["batch_id"]
    assert db.batch(db.item(b["id"])["batch_id"])["media"] == "carte-graphique-300g"


def test_urgent_order_launches_batch(db, files, tmp_path):
    worker = Worker(db, files, _settings(min_fill_ratio=0.99, max_wait_hours=999))
    _, item = _order(db, files, tmp_path, _deck(tmp_path, "d32.pdf", "jeu-poker-32"), product="jeu-poker-32",
                     due=date.today() + timedelta(days=1))
    worker.run_once()
    assert db.item(item["id"])["status"] == "batched"
    assert db.batch(db.item(item["id"])["batch_id"])["manifest"]["reason"] == "commande urgente"


def test_failed_generation_releases_items(db, files, tmp_path, monkeypatch):
    _, item = _order(db, files, tmp_path, _deck(tmp_path))
    worker = Worker(db, files, _settings())
    worker.check_uploads()
    worker.prepare_paid()

    def boom(*a, **k):
        raise RuntimeError("disque plein")

    monkeypatch.setattr("flux_print.orders.worker.impose", boom)
    assert worker.generate_batches(force=True) == []
    item = db.item(item["id"])
    assert item["status"] == "prepared" and item["batch_id"] is None
    failed = db.conn.execute("select * from public.batches where status = 'failed'").fetchall()
    assert len(failed) == 1 and "disque plein" in failed[0]["error"]


def test_planner_reasons():
    spec = load_product("jeu-poker-54")
    layout_for = lambda s: __import__("flux_print.production", fromlist=["compute_layout"]).compute_layout(
        load_press("xerox-iridesse").sheet(), 63.5, 88.9, 3)
    now = datetime.now(timezone.utc)
    item = {"id": "1", "copies": 1, "created_at": now - timedelta(hours=30), "paid_at": None, "due_date": None}
    rules = BatchingRules(min_fill_ratio=0.99, max_wait_hours=24)
    [c] = plan_batches([item], lambda i: spec, layout_for, rules, now=now)
    assert c.reason.startswith("attente")
    item["created_at"] = now
    assert plan_batches([item], lambda i: spec, layout_for, rules, now=now) == []


def test_supabase_storage_client(tmp_path):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.path, request.headers.get("authorization")))
        if request.method == "GET":
            return httpx.Response(200, content=b"%PDF-1.7")
        return httpx.Response(200, json={"Key": "ok"})

    store = SupabaseStorage("https://x.supabase.co", "cle-service", transport=httpx.MockTransport(handler))
    src = tmp_path / "a.pdf"
    src.write_bytes(b"%PDF")
    store.upload("production", "batches/L1.pdf", src, "application/pdf")
    store.download("uploads", "u/o/f.pdf", tmp_path / "b.pdf")
    assert seen[0] == ("POST", "/storage/v1/object/production/batches/L1.pdf", "Bearer cle-service")
    assert seen[1][:2] == ("GET", "/storage/v1/object/uploads/u/o/f.pdf")
    assert (tmp_path / "b.pdf").read_bytes() == b"%PDF-1.7"


def test_publish_catalog_with_templates(db, files):
    from flux_print.orders.catalog import publish_catalog

    codes = publish_catalog(db, files)
    assert "oracle" in codes
    oracle = db.conn.execute("select * from public.products where code = 'oracle'").fetchone()
    assert oracle["active"] and oracle["shop"]["pricing"]["per_card"] > 0
    assert set(oracle["templates"]) == {"tarot", "poker"}
    assert files._path("templates", oracle["templates"]["tarot"]).is_file()
    assert oracle["options"]["cards"]["min"] == 22
    business = db.conn.execute("select active from public.products where code = 'carte-visite-85x55'").fetchone()
    assert business["active"] is False  # pas de fiche boutique : non vendu sur ce site


def test_oracle_chain_with_customer_options(db, files, tmp_path):
    from flux_print.config import load_item_spec

    spec = load_item_spec("oracle", options={"cards": 30, "format": "tarot"})
    pdf = make_pdf(tmp_path / "oracle.pdf", spec)
    order = db.create_order("oracle@example.fr")
    path = f"invites/{order['id']}/oracle.pdf"
    files.upload("uploads", path, pdf, "application/pdf")
    item = db.add_item(order["id"], "oracle", "cmdm-350g", 2, path, options={"cards": 30, "format": "tarot"})
    db.mark_paid(order["id"], "test")
    Worker(db, files, _settings()).run_once(force_batches=True)
    item = db.item(item["id"])
    assert item["status"] == "batched", item["preflight_report"]
    batch = db.batch(item["batch_id"])
    assert batch["manifest"]["layout"]["per_sheet"] == 10  # tarot 70 × 120 sur SRA3
    assert batch["sheets"] == 7  # 2 × (30 + séparateur) = 62 pièces / 10


def test_wrong_card_count_is_rejected(db, files, tmp_path):
    from flux_print.config import load_item_spec

    pdf = make_pdf(tmp_path / "o.pdf", load_item_spec("oracle", options={"cards": 30}))
    order = db.create_order("x@example.fr")
    files.upload("uploads", f"i/{order['id']}/o.pdf", pdf, "application/pdf")
    item = db.add_item(order["id"], "oracle", "cmdm-350g", 1, f"i/{order['id']}/o.pdf", options={"cards": 44})
    Worker(db, files, _settings()).check_uploads()
    assert db.item(item["id"])["status"] == "rejected"


def test_batch_request_from_back_office(db, files, tmp_path):
    worker = Worker(db, files, _settings(min_fill_ratio=0.99, max_wait_hours=999))
    _, item = _order(db, files, tmp_path, _deck(tmp_path, "d32.pdf", "jeu-poker-32"), product="jeu-poker-32")
    worker.run_once()
    assert db.item(item["id"])["status"] == "prepared"  # seuils non atteints
    db.conn.execute("insert into public.batch_requests (requested_by) values ('atelier')")
    assert worker.run_once()["batches"] == 1
    assert db.item(item["id"])["status"] == "batched"
    req = db.conn.execute("select * from public.batch_requests").fetchone()
    assert req["handled_at"] and len(req["result"]["batches"]) == 1


def test_online_design_rendered_checked_and_batched(db, files, tmp_path):
    from PIL import Image

    photo = tmp_path / "papa.jpg"
    Image.new("RGB", (900, 1200), (180, 120, 90)).save(photo)
    files.upload("uploads", "sessions/s1/photos/papa.jpg", photo, "image/jpeg")
    design = {"back": {"color": "#1C2440", "ink": "#E8D6B0", "title": "J & M", "subtitle": "2027"},
              "courts": {"H-K": {"photo": {"path": "sessions/s1/photos/papa.jpg", "zoom": 1.2}}}}
    order = db.create_order("design@example.fr")
    item = db.add_item(order["id"], "jeu-poker-54", "cmdm-350g", 1, None, design=design)
    db.mark_paid(order["id"], "test")
    Worker(db, files, _settings()).run_once(force_batches=True)
    item = db.item(item["id"])
    assert item["source_path"] == f"rendered/{item['id']}.pdf"
    assert item["status"] == "batched", item["preflight_report"]
    assert [p.rsplit("/", 1)[-1] for p in item["preview_paths"]] == ["p1.png", "p27.png"]  # dos + Roi de cœur


def test_invalid_design_fails_cleanly(db, files, tmp_path):
    order = db.create_order("x@example.fr")
    item = db.add_item(order["id"], "jeu-poker-54", "cmdm-350g", 1, None, design={"back": {"color": "rouge"}})
    Worker(db, files, _settings()).check_uploads()
    item = db.item(item["id"])
    assert item["status"] == "failed" and "Couleur invalide" in item["error"]
