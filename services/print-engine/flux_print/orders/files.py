"""Stockage des fichiers : Supabase Storage en production, dossier local en développement.

Trois espaces (buckets) : `uploads` (fichiers clients), `previews` (aperçus),
`production` (fichiers préparés, lots SRA3, manifestes).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx


class FileStore(Protocol):
    def download(self, bucket: str, path: str, dest: Path) -> Path: ...
    def upload(self, bucket: str, path: str, src: Path, content_type: str) -> str: ...


class LocalFileStore:
    """Un sous-dossier par bucket. Pour le développement et les tests."""

    def __init__(self, root: str | Path):
        self.root = Path(root)

    def _path(self, bucket: str, path: str) -> Path:
        target = (self.root / bucket / path).resolve()
        if not target.is_relative_to((self.root / bucket).resolve()):
            raise ValueError(f"Chemin hors du bucket : {path}")
        return target

    def download(self, bucket: str, path: str, dest: Path) -> Path:
        shutil.copyfile(self._path(bucket, path), dest)
        return dest

    def upload(self, bucket: str, path: str, src: Path, content_type: str) -> str:
        target = self._path(bucket, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
        return path


class SupabaseStorage:
    """API Storage de Supabase, avec la clé service_role (worker uniquement)."""

    def __init__(self, url: str, service_key: str, timeout: float = 300.0, transport: httpx.BaseTransport | None = None):
        self.client = httpx.Client(
            base_url=url.rstrip("/") + "/storage/v1",
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=timeout,
            transport=transport,
        )

    def download(self, bucket: str, path: str, dest: Path) -> Path:
        with self.client.stream("GET", f"/object/{bucket}/{quote(path)}") as response:
            response.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in response.iter_bytes():
                    fh.write(chunk)
        return dest

    def upload(self, bucket: str, path: str, src: Path, content_type: str) -> str:
        with src.open("rb") as fh:
            response = self.client.post(
                f"/object/{bucket}/{quote(path)}",
                content=fh.read(),
                headers={"Content-Type": content_type, "x-upsert": "true"},
            )
        response.raise_for_status()
        return path
