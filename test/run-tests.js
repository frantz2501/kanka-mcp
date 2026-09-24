// MCP client harness: spawns the server, plays the handshake, calls tools, asserts.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const port = Number(process.argv[2]);
const proc = spawn(process.execPath, ['server.js'], {
  cwd: fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]test[\\/]$/, ''),
  env: { ...process.env, KANKA_API_TOKEN: 'tok-test', KANKA_DEFAULT_CAMPAIGN: '42', KANKA_API_BASE: 'http://127.0.0.1:' + port },
});
let buf = '', nextId = 1;
const pending = new Map();
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const rpc = (method, params) => new Promise((res) => {
  const id = nextId++;
  pending.set(id, res);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const results = [];
const assert = (c, l) => results.push((c ? 'PASS' : 'FAIL') + ' - ' + l);
const txt = (r) => r.result.content[0].text;

const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
assert(init.result?.serverInfo?.name === 'kanka-mcp', 'initialize handshake');
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await rpc('tools/list', {});
assert(list.result.tools.length >= 15, 'tools/list returns ' + list.result.tools.length + ' tools');

let r = await call('kanka_list_campaigns', {});
assert(JSON.parse(txt(r)).data[0].id === 42, 'list campaigns');

r = await call('kanka_search', { term: 'Weng' });
assert(JSON.parse(txt(r)).data[0].entity_id === 77, 'search with default campaign');

r = await call('kanka_create', { module: 'characters', fields: { name: 'Brenda', entry: '# Titre\n\nElle voit **le Jiugwaai** a [entity:77].\n\n- un\n- deux' } });
const created = JSON.parse(txt(r)).data;
assert(created.id >= 100, 'create record');
assert(created.entry.includes('<h1>Titre</h1>'), 'md heading');
assert(created.entry.includes('<strong>le Jiugwaai</strong>'), 'md bold');
assert(created.entry.includes('<ul>'), 'md list');
assert(created.entry.includes('[entity:77]'), 'mention preserved');

r = await call('kanka_get', { module: 'characters', record_id: created.id });
assert(JSON.parse(txt(r)).data.name === 'Brenda', 'get created');

r = await call('kanka_update', { module: 'characters', record_id: created.id, fields: { entry: 'Texte *simple*' } });
assert(JSON.parse(txt(r)).data.entry.includes('<em>simple</em>'), 'update + md');

r = await call('kanka_create', { module: 'characters', records: [{ name: 'A' }, { name: 'B' }, {}] });
const batch = JSON.parse(txt(r));
assert(batch.batch && batch.created === 2, 'batch create 2/3');

r = await call('kanka_create_entity_post', { entity_id: 77, fields: { name: 'Session 12', entry: 'Resume de **session**' } });
assert(JSON.parse(txt(r)).data.entry.includes('<strong>session</strong>'), 'create post + md');

r = await call('kanka_list_entity_relations', { entity_id: 77, sub: 'inventory' });
assert(JSON.parse(txt(r)).data.length === 1, 'entity sub-resource');

r = await call('kanka_list', { module: 'characters', updated_since: '2026-01-01T00:00:00Z' });
assert(!r.result.isError, 'list with lastSync');

r = await call('kanka_health', {});
const h = JSON.parse(txt(r));
assert(h.ok && h.rate_limit.remaining === '42', 'health + rate-limit');

r = await call('kanka_delete', { module: 'characters', record_id: created.id });
assert(JSON.parse(txt(r)).deleted, 'delete record');

r = await call('kanka_get', { module: 'characters', record_id: created.id });
assert(r.result.isError, 'deleted -> isError');

proc.kill();
console.log(results.join('\n'));
const fails = results.filter((x) => x.startsWith('FAIL'));
console.log(fails.length ? fails.length + ' FAILURES' : 'ALL TESTS PASSED');
process.exit(fails.length ? 1 : 0);
