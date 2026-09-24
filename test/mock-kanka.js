// Mock Kanka API for testing - loopback only.
import http from 'node:http';
let nextId = 100;
const store = {};
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-RateLimit-Limit', '90');
    res.setHeader('X-RateLimit-Remaining', '42');
    res.setHeader('X-RateLimit-Reset', '1700000000');
    if (!req.headers.authorization?.startsWith('Bearer tok-')) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ message: 'Unauthenticated.' }));
    }
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && path === '/campaigns')
      return res.end(JSON.stringify({ data: [{ id: 42, name: 'Chroniques', locale: 'fr' }] }));
    if (req.method === 'GET' && path === '/campaigns/42')
      return res.end(JSON.stringify({ data: { id: 42, name: 'Chroniques' } }));
    if (req.method === 'GET' && path === '/campaigns/42/search') {
      const q = new URL(req.url, 'http://x').searchParams.get('q');
      return res.end(JSON.stringify({ data: [{ id: 7, entity_id: 77, name: 'Weng ' + q, child_id: 7 }] }));
    }
    let m = path.match(/^\/campaigns\/42\/entities\/(\d+)\/posts$/);
    if (req.method === 'POST' && m) {
      const rec = { id: nextId++, entity_id: Number(m[1]), ...body };
      return res.end(JSON.stringify({ data: rec }));
    }
    m = path.match(/^\/campaigns\/42\/entities\/(\d+)\/(\w+)$/);
    if (req.method === 'GET' && m)
      return res.end(JSON.stringify({ data: [{ id: 1, name: 'subitem' }] }));
    m = path.match(/^\/campaigns\/42\/(\w+)$/);
    if (req.method === 'POST' && m) {
      if (!body || typeof body.name !== 'string' || !body.name) {
        res.statusCode = 422;
        return res.end(JSON.stringify({ message: 'The given data was invalid.' }));
      }
      const rec = { id: nextId++, ...body };
      store[m[1] + '/' + rec.id] = rec;
      return res.end(JSON.stringify({ data: rec }));
    }
    if (req.method === 'GET' && m)
      return res.end(JSON.stringify({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } }));
    m = path.match(/^\/campaigns\/42\/(\w+)\/(\d+)$/);
    if (req.method === 'GET' && m) {
      const rec = store[m[1] + '/' + m[2]];
      if (!rec) { res.statusCode = 404; return res.end(JSON.stringify({ message: 'Not found' })); }
      return res.end(JSON.stringify({ data: rec }));
    }
    if (req.method === 'PATCH' && m) {
      const rec = store[m[1] + '/' + m[2]] || {};
      Object.assign(rec, body);
      return res.end(JSON.stringify({ data: rec }));
    }
    if (req.method === 'DELETE' && m) {
      delete store[m[1] + '/' + m[2]];
      return res.end('');
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'nf ' + req.method + ' ' + path }));
  });
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
