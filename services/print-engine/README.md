# print-engine

Moteur d'impression Flux-print (Python) : spécifications produit, gabarits clients, preflight PDF, amalgame et imposition sur feuille 32 × 45.

## Installation

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

Optionnel : Ghostscript (`apt install ghostscript`) pour mesurer la couverture d'encre. Il est appelé en processus externe (licence AGPL, voir `docs/01-decisions.md`).

## Utilisation

```bash
.venv/bin/flux-print config
.venv/bin/flux-print gabarit   --product jeu-poker-54 gabarit.pdf
.venv/bin/flux-print preflight --product jeu-poker-54 fichier.pdf [--json]
.venv/bin/flux-print prepare   --product jeu-poker-54 fichier.pdf -o cmd1.pdf
.venv/bin/flux-print impose    --product jeu-poker-54 cmd1.pdf cmd2.pdf:3 -o lot.pdf --manifest lot.json
```

Presse par défaut : `xerox-iridesse` (`--press` pour en choisir une autre). Déposer le profil FOGRA51 dans `config/icc/` (voir `config/icc/README.md`).

## Configuration (`config/`)

```
config/
  presses/xerox-iridesse.toml   feuilles (SRA3), retournement, encres spéciales, profil de sortie
  products/*.toml               un fichier par produit vendu
  icc/                          profils ICC (non versionnés)
```

Ajouter un produit à plat (carte, flyer, étiquette…) ne demande qu'une fiche :

```toml
code = "flyer-a5"
type = "flat"
label = "Flyer A5 recto/verso"
media = "couche-brillant-170g"

[params]
trim_mm = [148.0, 210.0]
sides = 2
```

Un nouveau *type* de produit (livre, calendrier…) s'ajoute avec une fonction dans `PRODUCT_TYPES` (`flux_print/config.py`), qui renvoie un `DocumentSpec`.

Code de sortie : `0` si le fichier est conforme, `1` s'il est refusé.

## Structure

```
flux_print/
  products/base.py            DocumentSpec générique (pages, fond perdu, sécurité, seuils)
  products/playing_cards.py   Formats, compositions de jeux, ordre des pages
  preflight/scanner.py        Interprétation des flux PDF (CTM, images, couleurs, filets, polices)
  preflight/engine.py         Contrôles et corrections sans perte
  preflight/tac.py            Couverture d'encre via rendu CMJN (Ghostscript)
  templates/gabarit.py        Gabarits PDF téléchargeables
  production/sheet.py         Feuille 32 × 45, grille de pose, recto/verso
  production/imposition.py    Amalgame, coupe et empile, séparateurs, PDF de lot, manifeste
  production/pdfx.py          Finalisation PDF/X-4 (OutputIntent, XMP)
  color/convert.py            Conversion RVB → CMJN (LittleCMS), noirs en K seul
  products/flat.py            Produits à plat génériques
  config.py                   Chargement presses / feuilles / produits
  pipeline.py                 prepare = preflight + normalisation + CMJN
  orders/db.py                Accès Postgres (Supabase) du worker
  orders/files.py             Stockage : Supabase Storage ou dossier local
  orders/batching.py          Décision de lancement des lots
  orders/worker.py            Worker : contrôle → préparation → lot SRA3
  cli.py
```

Chaîne de commande et worker : voir `docs/04-chaine-commande.md`. Les tests de la chaîne demandent un PostgreSQL (`FLUX_TEST_PG`) et sont sautés sinon.

Pour ajouter un produit, il suffit d'écrire une fonction qui renvoie un `DocumentSpec`. Le preflight et les gabarits le prennent en charge sans autre modification.

## Tests

```bash
.venv/bin/python -m pytest
```
