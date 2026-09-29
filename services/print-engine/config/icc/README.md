# Profils ICC

Les fichiers `.icc` ne sont pas versionnés : ils se déposent ici, sur chaque serveur.

| Fichier attendu | Usage | Source |
|---|---|---|
| `PSO_Coated_v3.icc` | Papiers et cartons couchés (cartes à jouer, couvertures) — FOGRA51 | Pack gratuit « ECI Offset 2009/2013 » sur eci.org, ou export depuis le contrôleur de l'Iridesse |
| `PSO_Uncoated_v3_FOGRA52.icc` | Papiers non couchés (intérieurs de livres de coloriage) — FOGRA52 | idem |

Le nom de fichier et la condition de sortie se règlent dans `config/presses/*.toml` (section `[output]`).

Idéalement, on crée ensuite des **profils propres à chaque support** en caractérisant la presse. La norme FOGRA51 reste alors le profil déclaré dans les PDF, et le contrôleur simule cette norme sur chaque support.
