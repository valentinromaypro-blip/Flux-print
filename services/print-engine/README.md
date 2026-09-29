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
.venv/bin/flux-print products
.venv/bin/flux-print gabarit --format poker --deck 54 gabarit.pdf
.venv/bin/flux-print preflight --format poker --deck 54 fichier.pdf [--json] [--normalized out.pdf] [--icc presse.icc]
.venv/bin/flux-print impose --format poker --deck 54 cmd1.pdf cmd2.pdf:3 -o lot.pdf --manifest lot.json
```

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
  cli.py
```

Pour ajouter un produit, il suffit d'écrire une fonction qui renvoie un `DocumentSpec`. Le preflight et les gabarits le prennent en charge sans autre modification.

## Tests

```bash
.venv/bin/python -m pytest
```
