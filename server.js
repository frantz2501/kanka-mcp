#!/usr/bin/env node
/**
 * kanka-mcp - zero-dependency MCP server for the Kanka.io API (v1.0)
 * Docs: https://docs.kanka.io/en/latest/advanced/api.html
 * Inspired in part by ervwalter/mcp-kanka (markdown handling, lastSync, posts).
 *
 * Transports:
 *   stdio (default)  - for local MCP clients (Vibe CLI, Claude Desktop, ...)
 *   http  (--http)   - for a persistent remote deployment (systemd)
 *
 * Node >= 18. No dependencies.
 *
 * Env:
 *   KANKA_API_TOKEN or KANKA_TOKEN              (required) token from Profile > API
 *   KANKA_DEFAULT_CAMPAIGN or KANKA_CAMPAIGN_ID (optional) default campaign id
 *   KANKA_API_BASE                              (optional) default https://api.kanka.io/1.0
 *
 * HTTP mode only:
 *   KANKA_MCP_PORT       (optional) listen port, default 3333
 *   KANKA_MCP_BIND       (optional) bind address, default 127.0.0.1
 *   KANKA_MCP_HTTP_TOKEN (recommended) if set, requires "Authorization: Bearer <token>"
 */
'use strict';

import readline from 'node:readline';
import http from 'node:http';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'kanka-mcp', version: '1.2.0' };
const API_BASE = (process.env.KANKA_API_BASE || 'https://api.kanka.io/1.0').replace(/\/$/, '');
const TOKEN = process.env.KANKA_API_TOKEN || process.env.KANKA_TOKEN || '';
const DEFAULT_CAMPAIGN = Number(
  process.env.KANKA_DEFAULT_CAMPAIGN || process.env.KANKA_CAMPAIGN_ID || NaN,
);

const MODULES = [
  'characters', 'locations', 'families', 'organisations', 'items', 'notes',
  'events', 'calendars', 'timelines', 'creatures', 'races', 'quests',
  'maps', 'journals', 'abilities', 'tags', 'conversations', 'dice_rolls',
];

const ENTITY_SUBRESOURCES = [
  'abilities', 'attributes', 'inventory', 'reminders', 'mentions', 'connections',
  'relationships', 'entity_events',
];

// --- Markdown -> HTML (minimal, keeps Kanka [entity:123] mentions untouched)
function inlineMd(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function mdToHtml(md) {
  if (typeof md !== 'string') return md;
  if (/^\s*<(\w+)[\s>]/.test(md)) return md; // already HTML - pass through
  const lines = md.split(/\r?\n/);
  const out = [];
  let listType = null;
  const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      out.push('<h' + m[1].length + '>' + inlineMd(m[2]) + '</h' + m[1].length + '>');
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push('<li>' + inlineMd(m[1]) + '</li>');
    } else if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push('<li>' + inlineMd(m[1]) + '</li>');
    } else {
      closeList();
      out.push('<p>' + inlineMd(line) + '</p>');
    }
  }
  closeList();
  return out.join('\n');
}

function processPayload(fields) {
  const out = { ...fields };
  if (typeof out.entry === 'string') out.entry = mdToHtml(out.entry);
  return out;
}

// --- Kanka HTTP client
const rateInfo = { limit: null, remaining: null, reset: null };

async function api(method, path, { query, body } = {}) {
  const url = new URL(API_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const h of ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) {
    const v = res.headers.get(h);
    if (v) rateInfo[h.replace('X-RateLimit-', '').toLowerCase()] = v;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data && data.message ? data.message : text.slice(0, 400);
    const hint = res.status === 429 ? ' (rate limited - resets at ' + rateInfo.reset + ')' : '';
    throw new Error('Kanka API ' + res.status + ' on ' + method + ' ' + path + ': ' + detail + hint);
  }
  return data;
}

function campaignId(args) {
  const id = args.campaign_id ?? DEFAULT_CAMPAIGN;
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('campaign_id is required (or set KANKA_DEFAULT_CAMPAIGN / KANKA_CAMPAIGN_ID).');
  }
  return id;
}

const listQuery = (a) => ({ page: a.page, lastSync: a.updated_since, ...(a.filter || {}) });

// --- Schemas
const s = (type, description, extra = {}) => ({ type, description, ...extra });
const intId = (d) => s('integer', d, { minimum: 1 });
const moduleEnum = s('string', 'Kanka module: ' + MODULES.join(', '), { enum: MODULES });
const subEnum = s('string', 'Entity sub-resource: ' + ENTITY_SUBRESOURCES.join(', '), {
  enum: ENTITY_SUBRESOURCES,
});
const campaignIdProp = intId(
  Number.isInteger(DEFAULT_CAMPAIGN)
    ? 'Campaign id (defaults to ' + DEFAULT_CAMPAIGN + ')'
    : 'Campaign id (or set KANKA_DEFAULT_CAMPAIGN env)',
);
const fieldsObj = s('object',
  'Record fields. "entry" accepts Markdown (converted to HTML automatically); ' +
  'Kanka mentions like [entity:123] are preserved.', {});

// --- Tools
const tools = {
  kanka_list_campaigns: {
    description:
      'List all Kanka campaigns the user can access (id, name, locale, visibility, members). ' +
      'Use the returned campaign id in other tools.',
    inputSchema: { type: 'object', properties: { page: s('integer', 'Page number', { minimum: 1 }) } },
    handler: (a) => api('GET', '/campaigns', { query: { page: a.page } }),
  },
  kanka_get_campaign: {
    description: 'Get a single campaign by id (description, members, settings...).',
    inputSchema: {
      type: 'object', properties: { campaign_id: campaignIdProp }, required: ['campaign_id'],
    },
    handler: (a) => api('GET', '/campaigns/' + campaignId(a)),
  },
  kanka_search: {
    description:
      'Search entities in a campaign by keyword (server-side). Best way to find the record id / entity_id ' +
      'of a character, location, organisation, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp,
        term: s('string', 'Search term', { minLength: 1 }),
        page: s('integer', 'Page number', { minimum: 1 }),
      },
      required: ['term'],
    },
    handler: (a) =>
      api('GET', '/campaigns/' + campaignId(a) + '/search', { query: { q: a.term, page: a.page } }),
  },
  kanka_list: {
    description:
      'List records of a module (characters, locations, ...) with pagination, Kanka filters ' +
      '(name, type, tag_id, is_private, ...) and an updated_since (lastSync) incremental filter.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp,
        module: moduleEnum,
        page: s('integer', 'Page number', { minimum: 1 }),
        updated_since: s('string', 'ISO 8601 timestamp - only records modified after it (Kanka lastSync)'),
        filter: s('object', 'Kanka list filters as key/value pairs, e.g. {"name":"Dragon"}', {
          additionalProperties: { type: 'string' },
        }),
      },
      required: ['module'],
    },
    handler: (a) => api('GET', '/campaigns/' + campaignId(a) + '/' + a.module, { query: listQuery(a) }),
  },
  kanka_get: {
    description: 'Get one record by module and record id (e.g. characters/123). Use kanka_search to find ids.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, module: moduleEnum, record_id: intId('Record id within the module'),
      },
      required: ['module', 'record_id'],
    },
    handler: (a) => api('GET', '/campaigns/' + campaignId(a) + '/' + a.module + '/' + a.record_id),
  },
  kanka_create: {
    description:
      'Create one record (fields) or several records (batch: pass "records": [{...}, ...]) in a module. ' +
      'Entry accepts Markdown, converted to HTML automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp,
        module: moduleEnum,
        fields: fieldsObj,
        records: s('array', 'Batch mode: array of field objects, each needs at least {"name":"..."}', {
          items: { type: 'object' },
        }),
      },
      required: ['module'],
    },
    handler: async (a) => {
      const base = '/campaigns/' + campaignId(a) + '/' + a.module;
      if (a.records) {
        const results = [];
        for (const rec of a.records) {
          try {
            results.push({ ok: true, data: await api('POST', base, { body: processPayload(rec) }) });
          } catch (e) {
            results.push({ ok: false, error: String(e.message || e) });
          }
        }
        return { batch: true, created: results.filter((r) => r.ok).length, results };
      }
      if (!a.fields) throw new Error('Provide "fields" (single) or "records" (batch).');
      return api('POST', base, { body: processPayload(a.fields) });
    },
  },
  kanka_update: {
    description:
      'Update (PATCH) a record. Only send the fields to change; entry accepts Markdown (converted to HTML).',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, module: moduleEnum,
        record_id: intId('Record id'), fields: fieldsObj,
      },
      required: ['module', 'record_id', 'fields'],
    },
    handler: (a) =>
      api('PATCH', '/campaigns/' + campaignId(a) + '/' + a.module + '/' + a.record_id, {
        body: processPayload(a.fields),
      }),
  },
  kanka_delete: {
    description: 'Delete a record (recoverable only via Kanka "recently deleted"). Destructive.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, module: moduleEnum, record_id: intId('Record id'),
      },
      required: ['module', 'record_id'],
    },
    handler: async (a) => {
      await api('DELETE', '/campaigns/' + campaignId(a) + '/' + a.module + '/' + a.record_id);
      return { deleted: true, module: a.module, record_id: a.record_id };
    },
  },
  kanka_get_entity: {
    description:
      'Get a single entity by entity_id (any type). Use child_id from the response with kanka_get ' +
      'for the full typed record.',
    inputSchema: {
      type: 'object',
      properties: { campaign_id: campaignIdProp, entity_id: intId('Entity id') },
      required: ['entity_id'],
    },
    handler: (a) => api('GET', '/campaigns/' + campaignId(a) + '/entities/' + a.entity_id),
  },
  kanka_list_entity_relations: {
    description:
      'List a sub-resource of an entity: abilities, attributes, inventory, reminders, mentions, ' +
      'connections, relationships or entity_events.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, entity_id: intId('Entity id'), sub: subEnum,
        page: s('integer', 'Page number', { minimum: 1 }),
      },
      required: ['entity_id', 'sub'],
    },
    handler: (a) =>
      api('GET', '/campaigns/' + campaignId(a) + '/entities/' + a.entity_id + '/' + a.sub, {
        query: { page: a.page },
      }),
  },
  kanka_list_entity_posts: {
    description: 'List the posts (journal entries, session notes) attached to an entity.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, entity_id: intId('Entity id'),
        page: s('integer', 'Page number', { minimum: 1 }),
      },
      required: ['entity_id'],
    },
    handler: (a) =>
      api('GET', '/campaigns/' + campaignId(a) + '/entities/' + a.entity_id + '/posts', {
        query: { page: a.page },
      }),
  },
  kanka_create_entity_post: {
    description:
      'Create a post on an entity (e.g. session log). fields: {"name":"...", "entry":"<markdown>"} - ' +
      'entry is Markdown converted to HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, entity_id: intId('Entity id'), fields: fieldsObj,
      },
      required: ['entity_id', 'fields'],
    },
    handler: (a) =>
      api('POST', '/campaigns/' + campaignId(a) + '/entities/' + a.entity_id + '/posts', {
        body: processPayload(a.fields),
      }),
  },
  kanka_update_entity_post: {
    description: 'Update (PATCH) an existing post of an entity. Only changed fields needed.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, entity_id: intId('Entity id'),
        post_id: intId('Post id'), fields: fieldsObj,
      },
      required: ['entity_id', 'post_id', 'fields'],
    },
    handler: (a) =>
      api('PATCH', '/campaigns/' + campaignId(a) + '/entities/' + a.entity_id + '/posts/' + a.post_id, {
        body: processPayload(a.fields),
      }),
  },
  kanka_delete_entity_post: {
    description: 'Delete a post from an entity. Destructive.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: campaignIdProp, entity_id: intId('Entity id'), post_id: intId('Post id'),
      },
      required: ['entity_id', 'post_id'],
    },
    handler: async (a) => {
      await api('DELETE', '/campaigns/' + campaignId(a) + '/entities/' + a.entity_id + '/posts/' + a.post_id);
      return { deleted: true, post_id: a.post_id };
    },
  },
  kanka_health: {
    description:
      'Check API connectivity and the current rate-limit budget (limit/remaining/reset). ' +
      'Call this first when debugging authentication or 429 issues.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await api('GET', '/campaigns');
      return {
        ok: true,
        base: API_BASE,
        campaigns_visible: Array.isArray(data?.data) ? data.data.length : 0,
        rate_limit: rateInfo,
      };
    },
  },
};

// --- JSON-RPC dispatch (transport-agnostic): returns a response object or null
function dispatch(msg) {
  if (!msg || typeof msg !== 'object') return Promise.resolve(null);
  const { id, method, params } = msg;
  if (method === 'notifications/initialized') return Promise.resolve(null);

  if (method === 'initialize') {
    return Promise.resolve({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
  }
  if (method === 'ping') return Promise.resolve({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return Promise.resolve({
      jsonrpc: '2.0', id,
      result: {
        tools: Object.entries(tools).map(([name, t]) => ({
          name, description: t.description, inputSchema: t.inputSchema,
        })),
      },
    });
  }
  if (method === 'tools/call') {
    const tool = tools[params?.name];
    if (!tool) {
      return Promise.resolve({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: 'Unknown tool: ' + params?.name }], isError: true },
      });
    }
    return tool.handler(params.arguments || {}).then(
      (data) => {
        let text = JSON.stringify(data, null, 2) ?? 'null';
        if (text.length > 100000) text = text.slice(0, 100000) + '\n... (truncated)';
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
      },
      (err) => ({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: String(err?.message || err) }], isError: true },
      }),
    );
  }
  return Promise.resolve({
    jsonrpc: '2.0', id,
    error: { code: -32601, message: 'Method not found: ' + method },
  });
}

// --- CLI args
const argv = process.argv.slice(2);
const HTTP_MODE = argv.includes('--http');
const argVal = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const HTTP_PORT = Number(argVal('--port', process.env.KANKA_MCP_PORT || '3333'));
const HTTP_BIND = argVal('--bind', process.env.KANKA_MCP_BIND || '127.0.0.1');
const HTTP_TOKEN = process.env.KANKA_MCP_HTTP_TOKEN || '';

// --- stdio transport
function runStdio() {
  if (!TOKEN) {
    console.error('kanka-mcp: missing KANKA_API_TOKEN (or KANKA_TOKEN) environment variable.');
    console.error('Create one at https://app.kanka.io/ > Profile > API Settings.');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    dispatch(msg).then((res) => {
      if (res) process.stdout.write(JSON.stringify(res) + '\n');
    });
  });
  rl.on('close', () => process.exit(0));
  console.error('kanka-mcp v' + SERVER_INFO.version + ' ready (stdio, base: ' + API_BASE + ')');
}

// --- http transport (JSON responses, stateless)
function runHttp() {
  if (!TOKEN) {
    console.error('kanka-mcp: missing KANKA_API_TOKEN (or KANKA_TOKEN) environment variable.');
    process.exit(1);
  }
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        server: SERVER_INFO.name,
        version: SERVER_INFO.version,
        transport: 'http',
        status: 'ok',
      }));
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'method not allowed' }));
    }
    if (HTTP_TOKEN && req.headers.authorization !== 'Bearer ' + HTTP_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid JSON' }));
      }
      const messages = Array.isArray(msg) ? msg : [msg];
      Promise.all(messages.map(dispatch)).then((responses) => {
        const body = Array.isArray(msg)
          ? responses.filter(Boolean)
          : (responses[0] || { jsonrpc: '2.0', id: null, result: {} });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
  });
  server.listen(HTTP_PORT, HTTP_BIND, () => {
    console.error(
      'kanka-mcp v' + SERVER_INFO.version + ' ready (http://' + HTTP_BIND + ':' + HTTP_PORT +
      ', base: ' + API_BASE + (HTTP_TOKEN ? ', auth: bearer' : ', auth: none') + ')',
    );
  });
}

if (HTTP_MODE) runHttp();
else runStdio();
