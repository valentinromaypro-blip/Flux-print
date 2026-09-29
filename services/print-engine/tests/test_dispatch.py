"""Seuls des lots SRA3 préimposés, PDF/X-4, entrent dans le Fiery."""

import json
from pathlib import Path

import pytest

from conftest import make_prepared_pdf
from flux_print.config import load_press, load_product
from flux_print.production import Job, impose
from flux_print.production.dispatch import DispatchRefused, HotFolder, check_press_ready, dispatch


@pytest.fixture
def lot(tmp_path):
    press = load_press("xerox-iridesse")
    spec = load_product("jeu-poker-54", press=press)
    job = Job("A", make_prepared_pdf(tmp_path / "a.pdf", spec), spec)
    result = impose([job], tmp_path / "lot.pdf", sheet=press.sheet(), output_profile=press.output,
                    manifest_path=tmp_path / "lot.json", batch_id="L1")
    return press, tmp_path / "lot.pdf", tmp_path / "lot.json", result


def test_sra3_lot_is_press_ready(lot):
    press, pdf, manifest, _ = lot
    assert check_press_ready(pdf, press.sheet(), json.loads(manifest.read_text())) == []


def test_client_file_is_refused(tmp_path, lot):
    press, _, manifest, _ = lot
    spec = load_product("jeu-poker-54")
    client = make_prepared_pdf(tmp_path / "client.pdf", spec)
    problems = check_press_ready(client, press.sheet())
    assert any("seul le SRA3" in p for p in problems)
    assert any("PDF/X-4" in p for p in problems)


def test_lot_without_output_intent_is_refused(tmp_path):
    press = load_press("xerox-iridesse")
    spec = load_product("jeu-poker-54", press=press)
    job = Job("A", make_prepared_pdf(tmp_path / "a.pdf", spec), spec)
    impose([job], tmp_path / "lot.pdf", sheet=press.sheet(), output_profile=None)
    assert any("PDF/X-4" in p for p in check_press_ready(tmp_path / "lot.pdf", press.sheet()))


def test_dispatch_routes_by_media_and_is_atomic(tmp_path, lot):
    press, pdf, manifest, _ = lot
    fiery = tmp_path / "fiery"
    folder = fiery / "SRA3_CMDM350_RV"
    other = fiery / "SRA3_CG300_RV"
    folder.mkdir(parents=True)
    other.mkdir()
    folders = [HotFolder(other, "carte-graphique-300g", True), HotFolder(folder, "cmdm-350g", True)]
    target = dispatch(pdf, manifest, press.sheet(), folders)
    assert target.parent == folder and target.name == "L1_SRA3_cmdm-350g_RV.pdf"
    assert [p.name for p in folder.iterdir()] == [target.name]  # rien d'autre dans le hot folder
    assert not list(other.iterdir())
    assert (fiery / "manifestes" / "L1.json").is_file()
    with pytest.raises(DispatchRefused):
        dispatch(pdf, manifest, press.sheet(), folders)  # pas de double dépôt


def test_dispatch_refuses_non_sra3(tmp_path, lot):
    press, _, manifest, _ = lot
    client = make_prepared_pdf(tmp_path / "client.pdf", load_product("jeu-poker-54"))
    folder = tmp_path / "hf"
    folder.mkdir()
    with pytest.raises(DispatchRefused):
        dispatch(client, manifest, press.sheet(), [HotFolder(folder, "cmdm-350g", True)])
    assert not list(folder.iterdir())


def test_iridesse_hot_folders_configured():
    press = load_press("xerox-iridesse")
    assert {(h.media, h.duplex) for h in press.hot_folders} == {("cmdm-350g", True), ("carte-graphique-300g", True)}
