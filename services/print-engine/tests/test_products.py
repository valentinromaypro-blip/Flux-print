from flux_print.products.playing_cards import DECKS, build_document_spec, is_court_card


def test_deck_compositions():
    assert len(DECKS["54"].cards) == 54
    assert len(DECKS["52"].cards) == 52
    assert len(DECKS["32"].cards) == 32
    assert len({c.code for c in DECKS["54"].cards}) == 54


def test_page_count_by_back_layout():
    assert build_document_spec("poker", "54", "common").page_count == 55
    assert build_document_spec("poker", "54", "individual").page_count == 108


def test_page_order_common_back():
    spec = build_document_spec("bridge", "54", "common")
    assert spec.pages[0].label == "Dos (commun)"
    assert spec.pages[1].label == "Face — As de pique"
    assert spec.pages[13].label == "Face — Roi de pique"
    assert spec.pages[-1].label == "Face — Joker 2"


def test_page_order_individual_backs():
    spec = build_document_spec("poker", "32", "individual")
    assert [p.label for p in spec.pages[:2]] == ["Face — As de pique", "Dos — As de pique"]


def test_court_cards():
    courts = [c for c in DECKS["54"].cards if is_court_card(c)]
    assert len(courts) == 12
