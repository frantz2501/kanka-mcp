# kanka-mcp

Serveur MCP (Model Context Protocol) **zéro dépendance** pour l'API
[Kanka.io](https://kanka.io) — gestionnaire de campagnes de JDR.

- Node.js >= 18, aucun `npm install`
- 3 modes : **stdio** (client MCP local), **app locale** (HTTP sur
  `http://127.0.0.1:3333`, lancé dans un terminal) et **HTTP** (déploiement
  permanent, systemd)
- 15 outils : recherche globale, CRUD sur les 18 modules Kanka (characters, locations,
  notes, journals, events, creatures, abilities, tags, ...), posts des entités,
  sous-ressources (attributes, relationships, inventory, ...)
- Écriture en markdown convertie en HTML à la Kanka, mentions `[entity:123]` préservées
- Auth HTTP optionnelle par bearer token

## App locale (HTTP sur localhost)

```bash
git clone git@github.com:frantz2501/kanka-mcp.git
cd kanka-mcp
node server.js          # lancé dans un terminal -> app locale automatique
```

Lancé directement dans un terminal (stdin interactif), `server.js` démarre en
**app locale** : serveur MCP HTTP sur `http://127.0.0.1:3333` avec une bannière
d'accueil. Lancé par un client MCP (stdin redirigé — Claude Desktop, Vibe CLI,
...), il reste en mode **stdio**, le comportement des clients est inchangé.
Forçage possible : `node server.js --local` / `--http` / `--stdio`.

Configuration sans variables d'environnement — fichier `kanka-mcp.json`
(cherché à côté de `server.js`, puis dans le répertoire courant, puis
`%APPDATA%\kanka-mcp\config.json` ; les variables d'environnement restent
prioritaires) :

```json
{
  "apiToken": "ton_token",
  "defaultCampaign": 123456,
  "apiBase": "https://api.kanka.io/1.0",
  "bind": "127.0.0.1",
  "port": 3333,
  "httpToken": ""
}
```

Config du client MCP (même machine) :

```toml
[[mcp_servers]]
name = "kanka"
transport = "http"
url = "http://127.0.0.1:3333"
```

## Client MCP local (stdio)

```bash
export KANKA_API_TOKEN=ton_token     # Profile > API sur kanka.io
export KANKA_DEFAULT_CAMPAIGN=123456
node server.js
```

## Déploiement permanent (Ubuntu 24.04, HTTP)

Voir [DEPLOY.md](DEPLOY.md) — script `install.sh`, unit systemd, config client
Vibe CLI (`~/.vibe/config.toml`), tunnel SSH ou reverse proxy TLS.

## Windows : exécutable autonome (HTTP sur localhost)

`node windows/build.mjs` produit `dist/kanka-mcp.exe` : un exécutable **sans
prérequis** (runtime Node embarqué) qui ouvre un port MCP sur
`http://127.0.0.1:3333`. Config via `dist/kanka-mcp.json` (token, campagne,
port), démarrage automatique à la session via `windows/install-autostart.ps1`.

Voir [DEPLOY-WINDOWS.md](DEPLOY-WINDOWS.md) — build auto-vérifié, config,
autostart (tâche planifiée cachée), config client Vibe CLI.

## Configuration

Priorité : variables d'environnement > `kanka-mcp.json` > défauts.
Chaque variable a sa clé équivalente dans le fichier de config :
`apiToken`, `defaultCampaign`, `apiBase`, `bind`, `port`, `httpToken`.

| Variable | Obligatoire | Défaut | Description |
|---|---|---|---|
| `KANKA_API_TOKEN` (`KANKA_TOKEN`) | oui | — | Token API Kanka |
| `KANKA_DEFAULT_CAMPAIGN` (`KANKA_CAMPAIGN_ID`) | non | — | Campagne par défaut |
| `KANKA_API_BASE` | non | `https://api.kanka.io/1.0` | Base URL API (utile pour les tests) |
| `KANKA_MCP_BIND` (HTTP) | non | `127.0.0.1` | Adresse d'écoute |
| `KANKA_MCP_PORT` (HTTP) | non | `3333` | Port d'écoute |
| `KANKA_MCP_HTTP_TOKEN` (HTTP) | recommandé | — | Bearer token exigé des clients |

Options CLI : `--local`, `--http`, `--stdio`, `--port N`, `--bind ADDR`.

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
