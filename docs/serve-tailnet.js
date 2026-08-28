// Minimal static server for the architecture diagram, bound to the tailnet
// address ONLY — binding 0.0.0.0 would also expose it to the local LAN.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.ORCH_HOST || '100.79.233.63';
const PORT = Number(process.env.ORCH_PORT || 8088);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'orch-architecture.html' : rel);
  // Path traversal guard: a served path must stay inside ROOT.
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`serving ${ROOT} on http://${HOST}:${PORT}/`));
