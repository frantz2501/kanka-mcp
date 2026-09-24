# kanka-mcp

Serveur MCP (Model Context Protocol) **zéro dépendance** pour l'API
[Kanka.io](https://kanka.io) — gestionnaire de campagnes de JDR.

- Node.js >= 18, aucun `npm install`
- 2 transports : **stdio** (client local) et **HTTP** (déploiement permanent, systemd)
- 15 outils : recherche globale, CRUD sur les 18 modules Kanka (characters, locations,
  notes, journals, events, creatures, abilities, tags, ...), posts des entités,
  sous-ressources (attributes, relationships, inventory, ...)
- Écriture en markdown convertie en HTML à la Kanka, mentions `[entity:123]` préservées
- Auth HTTP optionnelle par bearer token

## Installation rapide (local, stdio)

```bash
git clone git@github.com:frantz2501/kanka-mcp.git
export KANKA_API_TOKEN=ton_token     # Profile > API sur kanka.io
export KANKA_DEFAULT_CAMPAIGN=123456
node server.js
```

## Déploiement permanent (Ubuntu 24.04, HTTP)

Voir [DEPLOY.md](DEPLOY.md) — script `install.sh`, unit systemd, config client
Vibe CLI (`~/.vibe/config.toml`), tunnel SSH ou reverse proxy TLS.

## Configuration

| Variable | Obligatoire | Défaut | Description |
|---|---|---|---|
| `KANKA_API_TOKEN` (`KANKA_TOKEN`) | oui | — | Token API Kanka |
| `KANKA_DEFAULT_CAMPAIGN` (`KANKA_CAMPAIGN_ID`) | non | — | Campagne par défaut |
| `KANKA_API_BASE` | non | `https://api.kanka.io/1.0` | Base URL API (utile pour les tests) |
| `KANKA_MCP_BIND` (HTTP) | non | `127.0.0.1` | Adresse d'écoute |
| `KANKA_MCP_PORT` (HTTP) | non | `3333` | Port d'écoute |
| `KANKA_MCP_HTTP_TOKEN` (HTTP) | recommandé | — | Bearer token exigé des clients |

Options CLI HTTP : `--http`, `--port N`, `--bind ADDR`.

## Outils

| Outil | Description |
|---|---|
| `kanka_search` | Recherche globale (`/search`) |
| `kanka_get_entity` | Entité par id/type |
| `kanka_list_entities` | Liste/pagination d'un module |
| `kanka_create_entity` | Création (markdown → HTML) |
| `kanka_update_entity` | Mise à jour |
| `kanka_delete_entity` | Suppression (force possible) |
| `kanka_list_posts` / `kanka_get_post` | Posts d'une entité |
| `kanka_create_post` / `kanka_update_post` / `kanka_delete_post` | CRUD posts |
| `kanka_list_sub` / `kanka_create_sub` / `kanka_update_sub` / `kanka_delete_sub` | Sous-ressources (attributes, relationships, inventory, ...) |

Modules : characters, locations, families, organisations, items, notes, events,
calendars, timelines, creatures, races, quests, maps, journals, abilities, tags,
conversations, dice_rolls.

## Tests

```bash
cd test && bash run.sh    # 18 tests sur un mock local de l'API Kanka
```

## Références

- API Kanka : https://docs.kanka.io/en/latest/advanced/api.html (rate limit 90 req/min)
- Inspiration markdown/posts : https://github.com/ervwalter/mcp-kanka

## Licence

MIT
