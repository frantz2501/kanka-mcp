# Déploiement kanka-mcp (Ubuntu 24.04, systemd)

## TL;DR

```bash
git clone git@github.com:frantz2501/kanka-mcp.git
cd kanka-mcp
sudo bash install.sh
sudo nano /etc/kanka-mcp.env      # mettre ton vrai token Kanka + campaign id
sudo systemctl restart kanka-mcp
curl http://127.0.0.1:3333/        # {"status":"ok",...}
```

## Où vont les fichiers

| Fichier | Emplacement | Machine |
|---|---|---|
| Code serveur | `/opt/kanka-mcp/server.js` | **serveur** |
| Env serveur (token Kanka, port, bind, bearer HTTP) | `/etc/kanka-mcp.env` (chmod 600) | **serveur** |
| Unit systemd | `/etc/systemd/system/kanka-mcp.service` | **serveur** |
| `config.toml` du client Vibe CLI | `~/.vibe/config.toml` ou `./.vibe/config.toml` dans le projet | **machine où tu lances le Vibe CLI** (PAS le serveur) |

Point clé souvent mal compris : le `.vibe` n'a rien à voir avec le serveur.
C'est la config du **client** MCP. Tu la mets sur ta machine de travail (ton PC,
ton laptop), et elle pointe vers l'URL du serveur distant.

## 1. Installer sur le serveur

```bash
git clone git@github.com:frantz2501/kanka-mcp.git
cd kanka-mcp
sudo bash install.sh
```

Le script :
- installe Node 22 (NodeSource) si absent, exige Node >= 18 ;
- copie `server.js` dans `/opt/kanka-mcp/` ;
- crée `/etc/kanka-mcp.env` (chmod 600) avec un bearer HTTP **généré aléatoirement** ;
- crée et active `kanka-mcp.service` (Restart=always).

Puis édite `/etc/kanka-mcp.env` :

```ini
KANKA_API_TOKEN=ton_token_kanka       # Profile > API sur kanka.io
KANKA_DEFAULT_CAMPAIGN=123456         # id de la campagne (optionnel)
KANKA_API_BASE=https://api.kanka.io/1.0
KANKA_MCP_BIND=127.0.0.1              # voir "Exposition réseau"
KANKA_MCP_PORT=3333
KANKA_MCP_HTTP_TOKEN=le-bearer-genere # requis par les clients HTTP
```

```bash
sudo systemctl restart kanka-mcp
journalctl -u kanka-mcp -f
```

## 2. Exposition réseau — deux options

### Option A (recommandée) : bind 127.0.0.1 + tunnel SSH

Le serveur n'est jamais exposé à Internet. Depuis ta machine cliente :

```bash
ssh -N -L 3333:127.0.0.1:3333 user@ton-serveur
```

Le Vibe CLI pointe alors vers `http://127.0.0.1:3333` comme si le serveur était local.

### Option B : 0.0.0.0 + reverse proxy TLS

1. `KANKA_MCP_BIND=0.0.0.0` dans l'env, restart ;
2. reverse proxy nginx/caddy avec TLS devant (443 → 3333) ;
3. le bearer `KANKA_MCP_HTTP_TOKEN` devient ta seule protection — TLS obligatoire,
   sinon le token circule en clair.

Jamais de `0.0.0.0` sans TLS et sans token. Le token Kanka donne accès
en écriture à ta campagne, on ne le joue pas sur du HTTP en clair.

## 3. Config du client Vibe CLI

Sur la machine où tu lances le Vibe CLI (pas le serveur) :
`~/.vibe/config.toml` (global) ou `./.vibe/config.toml` (par projet).

```toml
[[mcp_servers]]
name = "kanka"
transport = "http"
url = "http://127.0.0.1:3333"          # option A (tunnel SSH)
# url = "https://kanka.example.com"     # option B
[mcp_servers.headers]
Authorization = "Bearer le-bearer-genere"
```

Sans bearer (déconseillé hors localhost strict) :

```toml
[[mcp_servers]]
name = "kanka"
transport = "http"
url = "http://127.0.0.1:3333"
```

Vérification rapide :

```bash
curl -H "Authorization: Bearer le-bearer-genere" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  -H "Content-Type: application/json" http://127.0.0.1:3333/
```

## 4. Mode stdio local (alternative)

Si tu lances le CLI sur la même machine sans serveur permanent :

```toml
[[mcp_servers]]
name = "kanka"
transport = "stdio"
command = "node"
args = ["/opt/kanka-mcp/server.js"]
env = { KANKA_API_TOKEN = "ton_token", KANKA_DEFAULT_CAMPAIGN = "123456" }
```

## 5. Opérations courantes

```bash
sudo systemctl status kanka-mcp
sudo systemctl restart kanka-mcp
sudo journalctl -u kanka-mcp -n 50
sudo nano /etc/kanka-mcp.env && sudo systemctl restart kanka-mcp
```
