#!/usr/bin/env bash
# Fabrique dist/carte-blanche.zip, prêt à téléverser dans WordPress (Extensions → Ajouter → Téléverser).
# Prérequis : Node 20+. Le modèle de détourage vient du site (apps/site : node tools/fetch-segmenter.mjs).
set -euo pipefail
cd "$(dirname "$0")"
(cd studio && npm ci --no-audit --no-fund && npm run assets && npm run build)
mkdir -p ../dist
rm -f ../dist/carte-blanche.zip
zip -rq ../dist/carte-blanche.zip carte-blanche -x 'carte-blanche/.gitignore' '*.DS_Store'
ls -lh ../dist/carte-blanche.zip
