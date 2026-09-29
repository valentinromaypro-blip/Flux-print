# Flux-print

Moteur web-to-print mono-produit / mono-niche : vitrines personnalisables, éditeur contraint, génération PDF/X, preflight automatisé et pipeline commande → mise en machine.

## Documentation
- [Cadrage technique et fonctionnel](docs/00-cadrage.md)
- [Décisions actées](docs/01-decisions.md)
- [Produit 1 — Jeu de cartes personnalisé](docs/02-cartes-a-jouer.md)
- [Production numérique 32 × 45 : amalgame et imposition](docs/03-production-numerique.md)
- [Chaîne commande → fichier de production](docs/04-chaine-commande.md)

## Code
- [`supabase/`](supabase) — schéma, sécurité (RLS) et stockage de la base Supabase
- [`services/print-engine`](services/print-engine) — spécifications produit, gabarits clients, preflight PDF, amalgame et imposition 32 × 45 (Python)
