"""Facturation Sellsy des commandes payées (faux serveur Sellsy, base Postgres de test)."""

import json
from datetime import date
from decimal import Decimal

import httpx
import pytest

from flux_print.orders.invoicing import Line, SellsyClient, excl_tax
from flux_print.orders.worker import Worker

from test_order_pipeline import db, files  # noqa: F401  (fixtures)


class FakeSellsy:
    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.fail_invoices = False
        self.next_id = 100

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content and request.headers.get("content-type", "").startswith("application/json") else {}
        path = request.url.path
        self.calls.append((request.method, path, body))
        if path == "/oauth2/access-tokens":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        assert request.headers["authorization"] == "Bearer tok"
        if path == "/v2/taxes":
            return httpx.Response(200, json={"data": [{"id": 6, "rate": "5.50", "is_active": True}, {"id": 5, "rate": "20.00", "is_active": True}]})
        if path == "/v2/individuals":
            self.next_id += 1
            return httpx.Response(201, json={"id": self.next_id})
        if path == "/v2/invoices":
            if self.fail_invoices:
                return httpx.Response(503, text="maintenance")
            return httpx.Response(201, json={"id": 77, "status": "draft"})
        if path == "/v2/invoices/77/validate":
            return httpx.Response(200, json={"id": 77, "number": "F-2026-0042", "status": "due",
                                             "pdf_link": "https://sellsy.example/f42.pdf", "amounts": {"total_incl_tax": "34.90"}})
        return httpx.Response(404)


def _paid(db, email="anne@example.fr", provider="stripe", total=3490, name="Anne Durand"):
    order = db.create_order(email)
    db.add_item(order["id"], "jeu-poker-54", "cmdm-350g", 1, "x.pdf")
    db.conn.execute("""update public.order_items set total_cents = %s, status = 'batched' where order_id = %s""", (total, order["id"]))
    db.conn.execute("""update public.orders set status = 'paid', paid_at = now(), payment_provider = %s, total_cents = %s,
                         shipping_address = %s where id = %s""", (provider, total, json.dumps({"name": name}), order["id"]))
    return order


def _worker(db, files, fake):
    return Worker(db, files, invoicer=SellsyClient("id", "secret", transport=httpx.MockTransport(fake)))


def test_excl_tax():
    assert excl_tax(3490, Decimal(20)) == Decimal("29.0833")
    assert excl_tax(1200, Decimal(20)) == Decimal("10.0000")


def test_paid_order_gets_its_sellsy_invoice(db, files):
    fake = FakeSellsy()
    order = _paid(db)
    assert _worker(db, files, fake).invoice_paid() == 1
    row = db.order(order["id"])
    assert (row["invoice_number"], row["invoice_pdf_url"], row["invoice_error"]) == ("F-2026-0042", "https://sellsy.example/f42.pdf", None)
    _, _, individual = next(c for c in fake.calls if c[1] == "/v2/individuals")
    assert (individual["first_name"], individual["last_name"], individual["email"]) == ("Anne", "Durand", "anne@example.fr")
    _, _, invoice = next(c for c in fake.calls if c[1] == "/v2/invoices")
    assert invoice["related"] == [{"id": 101, "type": "individual"}]
    assert invoice["rows"][0]["unit_amount"] == "29.0833" and invoice["rows"][0]["tax_id"] == 5
    assert invoice["order_reference"] == order["number"]
    assert db.events("order", order["id"])[-1]["payload"]["gap_cents"] == 0


def test_same_customer_is_not_duplicated_and_test_payments_are_ignored(db, files):
    fake = FakeSellsy()
    _paid(db, email="Bob@Example.fr")
    _paid(db, email="bob@example.fr")
    _paid(db, email="essai@example.fr", provider="test")
    assert _worker(db, files, fake).invoice_paid() == 2
    assert sum(1 for c in fake.calls if c[1] == "/v2/individuals") == 1


def test_sellsy_outage_is_recorded_then_retried(db, files):
    fake = FakeSellsy()
    fake.fail_invoices = True
    order = _paid(db)
    worker = _worker(db, files, fake)
    assert worker.invoice_paid() == 0
    assert "503" in db.order(order["id"])["invoice_error"]
    fake.fail_invoices = False
    assert worker.invoice_paid() == 1
    assert db.order(order["id"])["invoice_number"] == "F-2026-0042"


def test_shipping_becomes_its_own_line():
    fake = FakeSellsy()
    client = SellsyClient("id", "secret", transport=httpx.MockTransport(fake))
    client.create_invoice("5", "FP-1", [Line("Jeu", 1, 2990), Line("Livraison", 1, 500)], date(2026, 9, 29))
    rows = next(c for c in fake.calls if c[1] == "/v2/invoices")[2]["rows"]
    assert [r["description"] for r in rows] == ["1 × Jeu", "1 × Livraison"]


def test_missing_vat_rate_is_explicit():
    fake = FakeSellsy()
    client = SellsyClient("id", "secret", tax_rate=Decimal("8.5"), transport=httpx.MockTransport(fake))
    with pytest.raises(Exception, match="8.5"):
        client.create_invoice("5", "FP-1", [Line("Jeu", 1, 2990)], date(2026, 9, 29))
