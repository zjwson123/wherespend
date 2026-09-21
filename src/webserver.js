import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getRecords, invalidateRecordCache, summarize, rangeFor } from './query.js';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function authorized(req, url) {
  if (!config.accessKey) return true;
  const q = url.searchParams.get('key');
  const h = req.headers['x-access-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return q === config.accessKey || h === config.accessKey;
}

function serveStatic(res, filePath) {
  const full = path.join(webDir, filePath);
  if (!full.startsWith(webDir) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}

export function startHttpServer(onStatus) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    try {
      if (p === '/api/health') {
        return json(res, 200, { ok: true, ws: onStatus().wsConnected, uptime: process.uptime(), ...onStatus().info });
      }

      if (p.startsWith('/api/')) {
        if (!authorized(req, url)) return json(res, 401, { error: 'invalid key' });

        if (p === '/api/records') {
          const records = await getRecords({ maxAgeMs: 15000 });
          return json(res, 200, {
            updatedAt: Date.now(),
            count: records.length,
            categories: [...new Set(records.map((r) => r.category))],
            accounts: [...new Set(records.map((r) => r.account))],
            records: records.map((r) => ({
              id: r.recordId, ts: r.date.getTime(), type: r.type, amount: r.amount,
              item: r.item, category: r.category, account: r.account, platform: r.platform,
              note: r.note, source: r.source,
            })),
          });
        }

        if (p === '/api/summary') {
          const records = await getRecords({ maxAgeMs: 15000 });
          const now = new Date();
          const thisMonth = summarize(records, rangeFor('this_month', now));
          const lastMonth = summarize(records, rangeFor('last_month', now));
          const today = summarize(records, rangeFor('today', now));
          return json(res, 200, { today, thisMonth, lastMonth });
        }

        if (p === '/api/refresh' && req.method === 'POST') {
          invalidateRecordCache();
          const records = await getRecords({ maxAgeMs: 0 });
          return json(res, 200, { count: records.length });
        }

        return json(res, 404, { error: 'not found' });
      }

      // 静态资源（首页与 PWA）
      if (p === '/') return serveStatic(res, 'index.html');
      return serveStatic(res, p.slice(1));
    } catch (e) {
      console.error('[http]', p, e.message);
      return json(res, 500, { error: e.message });
    }
  });

  server.listen(config.port, () => {
    console.log(`[web] 账本已就绪: http://localhost:${config.port}${config.accessKey ? '/?key=' + config.accessKey : ''}`);
  });
  return server;
}
