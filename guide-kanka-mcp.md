# Guide d'intégration du MCP `kanka-mcp` (à fournir au modèle)

> **Objet** : ce document contient tout ce qu'un modèle (LLM/agent) doit connaître
> pour utiliser le serveur MCP **kanka-mcp** v1.4.0, qui expose l'API
> [Kanka.io](https://kanka.io) (gestionnaire de campagnes de JDR).
> Il peut être collé tel quel dans un prompt système ou un fichier de contexte.

---

## 1. Accès au serveur

Le serveur existe en un seul code, accessible de deux façons :

| Mode | Quand | Comment |
|---|---|---|
| **HTTP (app locale)** | serveur lancé sur la machine (`node server.js` dans un terminal, ou `dist/kanka-mcp.exe`) | URL : `http://127.0.0.1:3333/` |
| **stdio** | le client MCP lance lui-même le processus (`node server.js`, stdin redirigé) | JSON-RPC ligne par ligne sur stdin/stdout |

### 1.1 Configuration recommandée du client MCP

```toml
# App locale déjà lancée (HTTP) :
[[mcp_servers]]
name = "kanka"
transport = "http"
url = "http://127.0.0.1:3333"
# si un httpToken est configuré côté serveur :
[mcp_servers.headers]
Authorization = "Bearer <http-token>"
```

```json
// Ou en launch stdio (Claude Desktop, etc.) :
{
  "mcpServers": {
    "kanka": {
      "command": "node",
      "args": ["C:/Users/tortu/git/kanka-mcp/server.js"],
      "env": {
        "KANKA_API_TOKEN": "<token-kanka>",
        "KANKA_DEFAULT_CAMPAIGN": "123456"
      }
    }
  }
}
```

### 1.2 Endpoints HTTP

- `GET /` → état du serveur : `{"server":"kanka-mcp","version":"1.4.0","transport":"http","status":"ok"}`
- `POST /` → requêtes JSON-RPC 2.0 (un objet, ou un tableau = batch).

### 1.3 Authentification

- Le **token Kanka** (`apiToken` dans `kanka-mcp.json` ou variable `KANKA_API_TOKEN`) est configuré **côté serveur** — le modèle ne le manipule jamais.
- Si le serveur exige un bearer HTTP (`httpToken`), c'est le **client** qui l'envoie dans l'en-tête `Authorization: Bearer <http-token>` — à configurer, pas à deviner.

---

## 2. Protocole (JSON-RPC 2.0)

Séquence normale d'une session :

1. `initialize` — handshake
2. `notifications/initialized` (notification, pas de réponse)
3. `tools/list` — (optionnel) découvrir les outils
4. `tools/call` — appeler les outils

| Méthode | Params | Réponse |
|---|---|---|
| `initialize` | `{"protocolVersion":"2024-11-05","capabilities":{}}` | `serverInfo` + `capabilities.tools` |
| `ping` | `{}` | `{}` |
| `tools/list` | `{}` | liste des 15 outils avec `inputSchema` |
| `tools/call` | `{"name":"<outil>","arguments":{...}}` | `result.content[0].text` |

**Format des réponses d'outils** : le résultat est **toujours du texte** contenant du
JSON (`content: [{type:"text", text:"..."}]`). Le modèle doit `JSON.parse` le texte.
En cas d'échec : `result.isError === true` et le texte contient le message d'erreur.
Les réponses de plus de 100 000 caractères sont tronquées.

Exemple HTTP complet :

```bash
curl -s -X POST http://127.0.0.1:3333/ -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"kanka_search","arguments":{"term":"Weng"}}}'
```

---

## 3. Concepts Kanka indispensables

- **Campaign** : tout est rattaché à une campagne. L'id de campagne est passé via
  `campaign_id` **ou** défini par défaut côté serveur (`defaultCampaign`). Si ni l'un
  ni l'autre n'existe, l'appel échoue : appeler `kanka_list_campaigns` pour obtenir un id.
- **Module** : type de contenu parmi 18 :
  `characters, locations, families, organisations, items, notes, events, calendars,
  timelines, creatures, races, quests, maps, journals, abilities, tags,
  conversations, dice_rolls`.
- **Record id** : id **dans le module** (ex. `characters/123`).
- **Entity id** : id **transverse** de l'entité (tout objet Kanka a aussi un `entity_id`,
  utilisé pour les posts, les relations, l'inventaire…). Les résultats de recherche
  renvoient `entity_id` et `child_id` (= record id dans son module).
- **Rate limit** : l'API Kanka est limitée à **90 requêtes/minute**. Après un 429,
  attendre le timestamp `reset` fourni par `kanka_health`.

---

## 4. Règles de rédaction des contenus (markdown → HTML)

- Le champ **`entry`** accepte du **markdown**, converti en HTML automatiquement
  à la façon de Kanka. Ne pas envoyer de HTML Markdown mélangé.
- Si `entry` commence directement par une balise HTML (`<p>`, `<h1>`, …), il est
  transmis **tel quel** (pas de double conversion).
- Markdown supporté : titres `#`→`####`, listes `-`/`*` et numérotées,
  `**gras**`, `*italique*`, `` `code` ``, liens `[texte](https://...)`.
- **Mentions Kanka** : `[entity:123]` est **préservé tel quel** — c'est la syntaxe
  Kanka pour lier une entité. L'utiliser dans les entrées pour référencer d'autres
  fiches.
- Pour **modifier** une fiche (`kanka_update`), n'envoyer que les champs concernés.

---

## 5. Catalogue des 15 outils

### 5.1 Campagnes & diagnostic

#### `kanka_list_campaigns`
Liste les campagnes accessibles (id, nom, locale, visibilité, membres).
- Arguments : `{ "page"?: number }` — page ≥ 1
- **Toujours le premier appel** si on ne connaît pas le `campaign_id`.

#### `kanka_get_campaign`
- Arguments : `{ "campaign_id": number }` (requis)
- Détail d'une campagne (description, membres, réglages).

#### `kanka_health`
- Arguments : `{}`
- Vérifie la connectivité API et le budget de rate-limit
  (`{ok, base, campaigns_visible, rate_limit:{limit, remaining, reset}}`).
- **À appeler en premier en cas de doute** (auth, 429, réseau).

### 5.2 Recherche & lecture

#### `kanka_search`
Recherche server-side par mot-clé — **le meilleur moyen de trouver un id**.
- Arguments : `{ "term": string (requis), "campaign_id"?: number, "page"?: number }`
- Retour : fiches avec `entity_id` et `child_id`.

#### `kanka_list`
Liste/pagination d'un module, avec filtres Kanka.
- Arguments :
  - `module` (requis) : un des 18 modules
  - `campaign_id?`, `page?`
  - `updated_since?` : timestamp ISO 8601 — filtre incrémental (lastSync Kanka)
  - `filter?` : objet de filtres clé/valeur, ex. `{"name":"Dragon"}`,
    `{"type":"Village"}`, `{"tag_id":"12"}`, `{"is_private":"0"}`
- Retour : `data` (page courante) + méta de pagination.

#### `kanka_get`
- Arguments : `{ "module": string (requis), "record_id": number (requis), "campaign_id"?: number }`
- Une fiche par module + id.

#### `kanka_get_entity`
- Arguments : `{ "entity_id": number (requis), "campaign_id"?: number }`
- Une entité quel que soit son type. Utiliser le `child_id` renvoyé avec
  `kanka_get` pour la fiche typée complète.

### 5.3 Écriture (CRUD sur les modules)

#### `kanka_create`
- Arguments : `{ "module" (requis), "fields": object, "records"?: object[], "campaign_id"? }`
- **Une fiche** : `fields` doit contenir au minimum `{"name": "..."}` + champ `entry`
  en markdown.
- **Batch** : passer `records: [{name...}, ...]` — retourne
  `{batch:true, created:N, results:[{ok:true,data}|{ok:false,error}]}`.

#### `kanka_update`
- Arguments : `{ "module", "record_id", "fields", "campaign_id"? }` (tous requis sauf campaign)
- PATCH : **n'envoyer que les champs modifiés**. `entry` accepte le markdown.

#### `kanka_delete`
- Arguments : `{ "module", "record_id", "campaign_id"? }`
- **Destructif.** Récupérable uniquement via « recently deleted » de Kanka.

### 5.4 Posts (entrées de journal, notes de session)

#### `kanka_list_entity_posts`
- `{ "entity_id" (requis), "campaign_id"?, "page"? }`
- Le contenu complet de chaque post est renvoyé dans le listing ; il n'y a pas
  d'outil get_post dédié dans cette version.

#### `kanka_create_entity_post`
- `{ "entity_id", "fields": {"name": "...", "entry": "<markdown>"}, "campaign_id"? }`
- Usage typique : journal de session sur l'entité de la campagne.

#### `kanka_update_entity_post`
- `{ "entity_id", "post_id", "fields", "campaign_id"? }` — PATCH partiel.

#### `kanka_delete_entity_post`
- `{ "entity_id", "post_id", "campaign_id"? }` — destructif.

### 5.5 Sous-ressources d'entité

#### `kanka_list_entity_relations`
- `{ "entity_id" (requis), "sub" (requis), "campaign_id"?, "page"? }`
- `sub` ∈ : `abilities, attributes, inventory, reminders, mentions, connections,
  relationships, entity_events`

> Les outils create/update/delete de sous-ressources génériques ne sont pas
> exposés dans cette version : lire via `kanka_list_entity_relations`, écrire
> via les modules dédiés ou les posts.

---

## 6. Méthodes de travail recommandées

1. **Découvrir** : `kanka_health` → `kanka_list_campaigns` (si pas de campagne par défaut).
2. **Trouver un id** : toujours `kanka_search` (jamais deviner un id).
3. **Lire** : `kanka_get` (fiche) / `kanka_get_entity` (entité) / `kanka_list_entity_posts`.
4. **Écrire** : `kanka_create` / `kanka_update` avec markdown + mentions `[entity:123]`.
5. **Journaliser** : `kanka_create_entity_post` sur l'entité concernée.
6. **Supprimer** : confirmation explicite de l'utilisateur requise avant
   `kanka_delete` / `kanka_delete_entity_post` (destructif).

### Exemples d'appels

Recherche puis mise à jour d'un personnage :

```json
{"name":"kanka_search","arguments":{"term":"Weng Weng"}}
// → child_id: 7, entity_id: 77
{"name":"kanka_update","arguments":{
  "module":"characters","record_id":7,
  "fields":{"entry":"Blessé lors de la **nuit des fantômes**. Voir [entity:123]."}
}}
```

Création d'un post de session (markdown) :

```json
{"name":"kanka_create_entity_post","arguments":{
  "entity_id":77,
  "fields":{"name":"Session 12 - Le marché de Jade","entry":"# Résumé\n\n- Rencontre avec **Maître Liu**\n- Le talisman est volé\n\nSuite : [entity:456]."}
}}
```

Liste filtrée + incrémentale :

```json
{"name":"kanka_list","arguments":{
  "module":"locations",
  "filter":{"name":"Hong Kong"},
  "updated_since":"2026-09-01T00:00:00Z"
}}
```

---

## 7. Gestion des erreurs

| Situation | Symptôme | Conduite |
|---|---|---|
| Token/campagne manquant | `isError` avec message explicite | `kanka_list_campaigns` / vérifier config serveur |
| Rate limit (429) | message avec `(rate limited - resets at <ts>)` | attendre, puis `kanka_health` pour vérifier |
| Campagne inconnue | `campaign_id is required...` | passer `campaign_id` ou lister les campagnes |
| Outil inconnu | `Unknown tool: ...` | `tools/list` |
| JSON trop gros | `... (truncated)` | paginer (`page`) ou filtrer |

**Règle d'or** : après chaque erreur, diagnostiquer avec `kanka_health` plutôt que
de réessayer en boucle (chaque essai consomme le budget de 90 req/min).

---

## 8. Rappel sécurité

- Le token Kanka donne un accès **en écriture** à la campagne : il ne doit jamais
  apparaître dans une conversation, uniquement dans la config serveur.
- Le serveur écoute par défaut sur `127.0.0.1` (localhost uniquement).
- Les outils de suppression sont destructifs : demander confirmation à
  l'utilisateur avant tout `delete`.
