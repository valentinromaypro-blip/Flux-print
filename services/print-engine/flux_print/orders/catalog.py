"""Publication du catalogue dans la base : fiches boutique, options, supports, gabarits."""

from __future__ import annotations

import tempfile
from pathlib import Path

from ..config import (customer_options, list_products, load_item_spec, load_product, media_catalog,
                      media_options, product_data)
from ..templates import generate_gabarit
from .db import Database
from .files import FileStore


def publish_catalog(db: Database, files: FileStore) -> list[str]:
    catalog = media_catalog()
    published = []
    for code in list_products():
        data = product_data(code)
        spec = load_product(code)
        options = customer_options(code)
        media = [{"code": m, "label": catalog.get(m, {}).get("label", m),
                  "description": catalog.get(m, {}).get("description", "")} for m in media_options(code)]
        templates = {}
        formats = list(options.get("format", {}).get("choices", {})) or ["default"]
        with tempfile.TemporaryDirectory(prefix="flux-gabarits-") as tmp:
            for fmt in formats:
                overrides = {} if fmt == "default" else {"format": fmt}
                if data["type"] == "custom_deck":
                    overrides["template"] = True
                    tspec = load_product(code, **overrides)
                else:
                    tspec = load_item_spec(code, options=overrides)
                local = generate_gabarit(tspec, Path(tmp) / f"{code}-{fmt}.pdf")
                templates[fmt] = files.upload("templates", f"{code}/{fmt}.pdf", local, "application/pdf")
        shop = data.get("shop", {})
        db.upsert_product(code, spec.label if not shop else shop.get("title", spec.label), media_options(code),
                          spec.page_count, shop=shop, options=options, media=media, templates=templates,
                          active=bool(shop), editor=data.get("editor"))
        published.append(code)
    return published
