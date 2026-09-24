# Déploiement kanka-mcp (Windows, exécutable autonome)

Le serveur existe en deux versions, même code :

| Version | Cible | Forme | Doc |
|---|---|---|---|
| v1.2 | Ubuntu 24.04 | `server.js` + service systemd | [DEPLOY.md](DEPLOY.md) |
| v1.3 | Windows | `kanka-mcp.exe` autonome, HTTP sur `http://127.0.0.1:3333` | ce fichier |

L'exe est un **Single Executable Application** Node : le runtime Node est
embarqué dans le `.exe`, la machine cible n'a besoin de **rien** (ni Node, ni
`npm install`). Il lance un processus qui ouvre un port sur localhost et sert
le MCP en HTTP (JSON-RPC par POST, health check par GET).

## TL;DR

```powershell
# Machine de build (Node >= 20 + npm) :
git clone https://github.com/frantz2501/kanka-mcp.git
cd kanka-mcp
node windows\build.mjs            # -> dist\kanka-mcp.exe (+ smoke test automatique)

# Config : mettre le token Kanka (Profile > API sur kanka.io) :
notepad dist\kanka-mcp.json       # {"apiToken": "ton_token", ...}

# Lancer :
dist\kanka-mcp.exe                # -> http://127.0.0.1:3333
curl http://127.0.0.1:3333/        # {"status":"ok",...}
```

Le build est auto-vérifié : le script lance l'exe fraîchement construit, teste
`GET /` et `tools/list` sur un port temporaire, puis le referme.

## Configuration

Ordre de priorité : variables d'environnement > `kanka-mcp.json` > défauts.

Fichiers config cherchés dans cet ordre :

1. `kanka-mcp.json` à côté de `kanka-mcp.exe` (recommandé, c'est le template
   créé par le build dans `dist\`) ;
2. `kanka-mcp.json` dans le répertoire courant ;
3. `%APPDATA%\kanka-mcp\config.json` (utilisé par l'autostart).

```json
{
  "apiToken": "ton_token_kanka",
  "defaultCampaign": 123456,
  "apiBase": "https://api.kanka.io/1.0",
  "bind": "127.0.0.1",
  "port": 3333,
  "httpToken": ""
}
```

| Clé | Équivalent env | Défaut | Description |
|---|---|---|---|
| `apiToken` | `KANKA_API_TOKEN` | — (obligatoire) | Token API Kanka |
| `defaultCampaign` | `KANKA_DEFAULT_CAMPAIGN` | — | Campagne par défaut |
| `apiBase` | `KANKA_API_BASE` | `https://api.kanka.io/1.0` | Base URL API |
| `bind` | `KANKA_MCP_BIND` | `127.0.0.1` | Adresse d'écoute |
| `port` | `KANKA_MCP_PORT` | `3333` | Port d'écoute |
| `httpToken` | `KANKA_MCP_HTTP_TOKEN` | — | Bearer exigé des clients HTTP |

Options CLI (passent avant tout) : `--port N`, `--bind ADDR` (le mode HTTP est
toujours actif dans l'exe). Depuis le repo, `node server.js` lancé dans un
terminal démarre la même app locale (`--local` / `--http`), et reste en stdio
quand il est lancé par un client MCP (ou `--stdio`).

Si le token manque au lancement, l'exe affiche les instructions et attend
Entrée avant de fermer (au lieu de flasher et disparaître).

## Démarrage automatique à la session

Équivalent du `systemd --user` : une tâche planifiée lance l'exe **sans
fenêtre de console** (wrapper VBS) à chaque ouverture de session, avec relance
en cas de crash (3 essais à 1 min d'intervalle).

```powershell
powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1
# suppression :
powershell -ExecutionPolicy Bypass -File windows\install-autostart.ps1 -Uninstall
```

La config lue est alors `%APPDATA%\kanka-mcp\config.json` (ou le
`kanka-mcp.json` resté à côté de l'exe — l'exe cherche les deux).

Alternative : un vrai **service Windows** (démarrage avant login) via
[NSSM](https://nssm.cc) :

```powershell
nssm install kanka-mcp C:\chemin\vers\kanka-mcp.exe
nssm set kanka-mcp AppStdout C:\chemin\vers\kanka-mcp.log
nssm start kanka-mcp
```

## Config du client MCP (Vibe CLI)

Sur la même machine :

```toml
[[mcp_servers]]
name = "kanka"
transport = "http"
url = "http://127.0.0.1:3333"
# si httpToken est défini dans la config :
[mcp_servers.headers]
Authorization = "Bearer le-http-token"
```

Vérification rapide :

```powershell
curl -Method POST -ContentType "application/json" -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://127.0.0.1:3333/
```

## Sécurité

- L'exe écoute sur `127.0.0.1` **par défaut** : rien n'est exposé au réseau.
- `httpToken` est optionnel en localhost strict ; il devient indispensable si
  `bind` vaut `0.0.0.0` — et dans ce cas, mets un reverse proxy TLS devant,
  comme pour la version Linux. Le token Kanka donne accès en écriture à la
  campagne, jamais de `0.0.0.0` en clair.
- L'exe n'est pas signé : SmartScreen peut afficher « Windows a protégé votre
  PC » si le fichier est téléchargé depuis Internet (Plus d'informations >
  Exécuter quand même). Un build local ne déclenche pas cet avertissement ;
  la signature (signtool) reste optionnelle.

## Notes build

- `windows/build.mjs` convertit `server.js` (ESM) en entrée CJS à la volée :
  `server.js` reste l'unique source. Après toute modification de `server.js`,
  relancer le build — l'exe est un instantané, il ne relit pas `server.js`.
- Le build télécharge `postject` via `npx` au premier usage (injection du blob
  SEA dans l'exe) ; c'est le seul outil externe, uniquement sur la machine de
  build.
- Cross-build : SEA embarque le runtime de la machine qui construit. Pour
  produire `kanka-mcp.exe`, builder **sur Windows**.
