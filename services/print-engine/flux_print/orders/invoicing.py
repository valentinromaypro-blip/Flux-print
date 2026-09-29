"""Facturation des commandes payées dans l'outil de l'atelier (Sellsy, API v2).

Sellsy émet la facture (numérotation légale continue) et la transmet à Pennylane
comme les autres factures de l'imprimerie. Le paiement reste chez Stripe, qui
n'émet que des reçus : une seule suite de numéros de facture.

Tout ce qui dépend du format de l'API Sellsy est dans `SellsyClient` : à vérifier
au premier essai avec le compte réel (documentation : https://api.sellsy.com/doc/v2/).

Réglages (variables d'environnement) :
    FLUX_INVOICING=sellsy           (absent : pas de facturation automatique)
    SELLSY_CLIENT_ID / SELLSY_CLIENT_SECRET   identifiants API « personnels » Sellsy
    SELLSY_TAX_RATE=20              taux de TVA des jeux (le prix client est TTC)
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import httpx

TOKEN_URL = "https://login.sellsy.com/oauth2/access-tokens"
API_URL = "https://api.sellsy.com/v2"


class InvoicingError(RuntimeError):
    pass


@dataclass(frozen=True)
class Line:
    label: str
    quantity: int
    total_cents: int  # TTC, tel que payé


@dataclass(frozen=True)
class Customer:
    email: str
    name: str
    address: dict


@dataclass(frozen=True)
class Invoice:
    id: str
    number: str
    pdf_url: str | None
    total_incl_tax_cents: int | None


def excl_tax(cents: int, rate: Decimal) -> Decimal:
    """Montant HT (4 décimales) d'un montant TTC en centimes."""
    return (Decimal(cents) / 100 / (1 + rate / 100)).quantize(Decimal("0.0001"), ROUND_HALF_UP)


class SellsyClient:
    def __init__(self, client_id: str, client_secret: str, tax_rate: Decimal = Decimal(20),
                 transport: httpx.BaseTransport | None = None):
        self.client_id, self.client_secret, self.tax_rate = client_id, client_secret, tax_rate
        self.http = httpx.Client(timeout=30.0, transport=transport)
        self._token: tuple[str, float] | None = None
        self._tax_id: int | None = None

    # --- Accès ---------------------------------------------------------------------------
    def _auth(self) -> dict:
        if not self._token or self._token[1] < time.time() + 60:
            r = self.http.post(TOKEN_URL, data={"grant_type": "client_credentials", "client_id": self.client_id,
                                                "client_secret": self.client_secret})
            if r.status_code != 200:
                raise InvoicingError(f"Sellsy : authentification refusée ({r.status_code}).")
            body = r.json()
            self._token = (body["access_token"], time.time() + float(body.get("expires_in", 3600)))
        return {"Authorization": f"Bearer {self._token[0]}"}

    def _call(self, method: str, path: str, **kw) -> dict:
        r = self.http.request(method, f"{API_URL}{path}", headers=self._auth(), **kw)
        if r.status_code >= 300:
            raise InvoicingError(f"Sellsy {method} {path} : {r.status_code} {r.text[:300]}")
        return r.json() if r.content else {}

    # --- Référentiels ------------------------------------------------------------------------
    def tax_id(self) -> int:
        if self._tax_id is None:
            taxes = self._call("GET", "/taxes", params={"limit": 100}).get("data", [])
            match = [t for t in taxes if Decimal(str(t.get("rate"))) == self.tax_rate and t.get("is_active", True)]
            if not match:
                raise InvoicingError(f"Sellsy : aucun taux de TVA actif à {self.tax_rate} %.")
            self._tax_id = int(match[0]["id"])
        return self._tax_id

    # --- Opérations ------------------------------------------------------------------------------
    def create_individual(self, customer: Customer) -> str:
        first, _, last = customer.name.strip().partition(" ")
        body = {"type": "client", "first_name": first or customer.email, "last_name": last or first or customer.email,
                "email": customer.email}
        return str(self._call("POST", "/individuals", json=body)["id"])

    def create_invoice(self, individual_id: str, order_number: str, lines: list[Line], day: date) -> Invoice:
        tax = self.tax_id()
        rows = [{"type": "single", "reference": order_number, "description": f"{ln.quantity} × {ln.label}",
                 "quantity": "1", "unit_amount": str(excl_tax(ln.total_cents, self.tax_rate)), "tax_id": tax}
                for ln in lines]
        draft = self._call("POST", "/invoices", json={
            "date": day.isoformat(), "subject": f"Commande {order_number}", "currency": "EUR",
            "order_reference": order_number, "related": [{"id": int(individual_id), "type": "individual"}], "rows": rows,
        })
        done = self._call("POST", f"/invoices/{draft['id']}/validate", json={"date": day.isoformat()})
        invoice = {**draft, **done} if done else self._call("GET", f"/invoices/{draft['id']}")
        total = (invoice.get("amounts") or {}).get("total_incl_tax")
        return Invoice(id=str(invoice["id"]), number=str(invoice.get("number") or ""), pdf_url=invoice.get("pdf_link"),
                       total_incl_tax_cents=round(Decimal(str(total)) * 100) if total is not None else None)


def from_env() -> SellsyClient | None:
    if os.environ.get("FLUX_INVOICING", "").lower() != "sellsy":
        return None
    try:
        return SellsyClient(os.environ["SELLSY_CLIENT_ID"], os.environ["SELLSY_CLIENT_SECRET"],
                            Decimal(os.environ.get("SELLSY_TAX_RATE", "20")))
    except KeyError as exc:
        raise InvoicingError(f"Réglage manquant pour Sellsy : {exc.args[0]}") from None
