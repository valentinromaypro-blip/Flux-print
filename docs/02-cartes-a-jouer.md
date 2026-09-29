# Produit 1 — Jeu de cartes personnalisé

## 1. Variantes produit

| Paramètre | Valeurs initiales | Où c'est défini |
|---|---|---|
| Format | Poker 63,5 × 88,9 · Bridge 57,2 × 88,9 · Mini 44 × 63 · Tarot 61 × 112 (mm) | `FORMATS` |
| Composition | 54 (52 + 2 jokers) · 52 · 32 | `DECKS` |
| Dos | commun (1 design) ou individuels (1 dos par carte) | `BackLayout` |
| Fond perdu | 3 mm | `CardFormat.bleed_mm` |
| Zone de sécurité | 4 mm du bord fini (3 mm en mini) | `CardFormat.safe_mm` |
| Coins arrondis | rayon 3,5 mm (2,5 mm en mini) | `CardFormat.corner_radius_mm` |

**À valider avec l'atelier** : les formats exacts (outils de découpe et arrondisseuse disponibles), le fond perdu (selon la précision de coupe) et le rayon des coins.

## 2. Convention du fichier client (parcours « je dépose mon PDF »)

- Un PDF, **une page par face de carte**, au format fini + fond perdu (poker : 69,5 × 94,9 mm), en portrait.
- **Dos commun** : page 1 = dos, puis les faces. Jeu de 54 → **55 pages**.
- **Dos individuels** : face, dos, face, dos… Jeu de 54 → **108 pages**.
- Ordre des faces : pique, cœur, carreau, trèfle ; dans chaque couleur As, 2 … 10, Valet, Dame, Roi ; puis Joker 1 et Joker 2.
- Le gabarit téléchargeable reprend exactement cet ordre, avec le nom de chaque carte au centre de sa page.

Commande :

```bash
flux-print gabarit --format poker --deck 54 --backs common gabarit-poker-54.pdf
```

## 3. Preflight appliqué au fichier déposé

| Contrôle | Gravité | Correction automatique |
|---|---|---|
| PDF illisible ou chiffré | Bloquant | — |
| Nombre de pages ≠ attendu | Bloquant | — |
| Format fini incorrect / paysage | Bloquant | (à venir : rotation automatique si toutes les pages sont en paysage) |
| Fond perdu absent ou insuffisant | Bloquant | (à venir : extension miroir des bords, à faire valider au BAT) |
| TrimBox absente mais format déductible | Info | ✅ TrimBox/BleedBox posées |
| Image < 150 ppi | Bloquant | — |
| Image < 250 ppi | Avertissement | — |
| Police non incorporée | Bloquant | (à venir : vectorisation) |
| Éléments RVB / Lab | Avertissement | (à venir : conversion ICC vers le profil de la presse) |
| Ton direct non prévu | Bloquant | (à venir : conversion en quadri sur demande) |
| Repères du gabarit laissés dans le fichier | Bloquant | — |
| Texte hors zone de sécurité | Avertissement | — |
| Filets < 0,25 pt | Avertissement | — |
| Couverture d'encre > 320 % | Avertissement | (à venir : réduction via le profil de sortie) |
| Surimpression | Avertissement | — |
| Transparences | Info | Aucune (PDF/X-4) |
| Annotations / formulaires | Avertissement | (à venir : suppression) |

```bash
flux-print preflight --deck 54 fichier-client.pdf            # rapport lisible
flux-print preflight --deck 54 fichier-client.pdf --json     # pour le site / le back-office
flux-print preflight --deck 54 fichier-client.pdf --normalized corrige.pdf --icc presse.icc
```

## 4. Spécificités métier à intégrer

1. **Repérage recto/verso** : si le dos est décalé par rapport à la face, les cartes deviennent reconnaissables (jeu « marqué »). Il faut privilégier les dos avec une marge uniforme ou un motif continu jusqu'au fond perdu. Il faudra aussi un contrôle dédié : alerte si le dos contient un cadre proche de la coupe.
2. **Figures à deux têtes** : dans le configurateur, le visage placé sur un Roi, une Dame ou un Valet est dupliqué avec une rotation de 180° (symétrie centrale).
3. **Opacité** : utiliser un carton à âme (noire ou bleue), sans quoi on voit la carte en transparence.
4. **Collationnement** : les 54 cartes doivent être rangées dans l'ordre et regroupées par jeu. Chaque feuille et chaque jeu reçoit un code (Datamatrix placé en marge de la feuille).
5. **Étui** : c'est un deuxième document, avec son propre gabarit (développé à plat). Il sera traité comme un produit lié.

## 5. Prochaines étapes techniques

1. Caler les valeurs réelles avec la production : formats, profil ICC de la presse, seuil de TAC du carton.
2. **Imposition** : step-and-repeat des 55 pages sur la feuille machine, recto/verso en retournement, traits de coupe et code de feuille.
3. Corrections automatiques : conversion ICC, extension du fond perdu, rotation.
4. Aperçus (rendu PDFium) et BAT PDF.
5. API HTTP autour du moteur (dépôt, preflight asynchrone, rapport).
6. Configurateur en ligne : modèle de document JSON, puis rendu vers le même format PDF, qui repasse par le même preflight.
