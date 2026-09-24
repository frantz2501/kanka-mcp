# kanka-mcp

Zero-dependency [MCP](https://modelcontextprotocol.io) server for the [Kanka.io](https://kanka.io) API (v1.0).
Single file, pure Node (>= 18), no build step, no node_modules.

## Features

- 15 tools: campaigns, search, full CRUD on all Kanka modules, entity posts (CRUD), entity sub-resources, health check
- All 18 Kanka modules: characters, locations, families, organisations, items, notes, events, calendars, timelines, creatures, races, quests, maps, journals, abilities, tags, conversations, dice_rolls
- Markdown entry fields converted to HTML automatically (Kanka mentions like `[entity:123]` preserved)
- Batch creation with per-record error tolerance
- Incremental sync via Kanka native `lastSync`
- Rate-limit budget exposed (Kanka allows 90 requests/minute)

## Setup

1. Create an API token on Kanka: **Profile > API Settings**
2. Configure your MCP client:

```json
{
  "mcpServers": {
    "kanka": {
      "command": "node",
      "args": ["/path/to/kanka-mcp/server.js"],
      "env": {
        "KANKA_API_TOKEN": "your-token",
        "KANKA_DEFAULT_CAMPAIGN": "your-campaign-id"
      }
    }
  }
}
```

`KANKA_DEFAULT_CAMPAIGN` / `KANKA_CAMPAIGN_ID` is optional; if set, `campaign_id` can be omitted in tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `kanka_list_campaigns` | List campaigns the user can access |
| `kanka_get_campaign` | Get one campaign |
| `kanka_search` | Server-side entity search by keyword |
| `kanka_list` | List records of a module (filters, pagination, lastSync) |
| `kanka_get` | Get one record by module + id |
| `kanka_create` | Create one record or a batch |
| `kanka_update` | PATCH a record |
| `kanka_delete` | Delete a record |
| `kanka_get_entity` | Get any entity by entity_id |
| `kanka_list_entity_relations` | abilities, attributes, inventory, reminders, mentions, connections, relationships, entity_events |
| `kanka_list_entity_posts` | List posts of an entity |
| `kanka_create_entity_post` | Create a post (Markdown entry) |
| `kanka_update_entity_post` | PATCH a post |
| `kanka_delete_entity_post` | Delete a post |
| `kanka_health` | Connectivity + rate-limit check |

## Tests

Integration tests run against a local mock of the Kanka API (no network, no token needed):

```bash
npm test
```

The harness spawns the server over stdio, plays the MCP handshake and asserts 18 behaviours (CRUD, markdown conversion, mentions, batch, posts, rate-limit headers, error paths).

## License

MIT
