// Local-only simulator. It rewrites the endpoint, including service worker imports.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const reports = new Map();
let fail = false;
let hideReceipt = false;
const oldDate = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
const history = [{ sheet: 'Mantenimiento', idDispenser: '804', fechaMantenimiento: oldDate,
    lugarDispenser: 'Planta original', sectorDispenser: 'Sector A', tecnico: 'TEST',
    observacionesMantenimiento: 'Visita anterior', idReportes: 'seed-804' }];

http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1:8765');
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/__test') {
            if (req.method === 'POST') {
                let body = '';
                for await (const chunk of req) body += chunk;
                ({ fail = false, hideReceipt = false } = JSON.parse(body));
            }
            res.end(JSON.stringify({ fail, hideReceipt, reports: [...reports.values()] }));
            return;
        }
        if (url.pathname === '/mock-api') {
            if (fail) { res.writeHead(503); res.end('{}'); return; }
            if (req.method === 'POST') {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const request = new Request(url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) });
                const value = Object.fromEntries(await request.formData());
                reports.set(value.idReportes, value);
                res.end(JSON.stringify({ ok: true }));
            } else if (url.searchParams.get('action') === 'status') {
                const id = url.searchParams.get('idReportes');
                res.end(JSON.stringify({ idReportes: id, confirmed: !hideReceipt && reports.has(id) }));
            } else {
                res.end(JSON.stringify({ data: [...history, ...reports.values()] }));
            }
            return;
        }
        const name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const file = path.resolve(root, '.' + name);
        if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
        let data = await fs.readFile(file);
        if (path.basename(file) === 'data.js') {
            data = Buffer.from(data.toString().replace(/https:\/\/script\.google\.com\/macros\/s\/[^']+/, 'http://127.0.0.1:8765/mock-api'));
        }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript'
            : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        res.end(data);
    } catch (error) {
        console.error(error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
    }
}).listen(8765, '127.0.0.1', () => console.log('Simulator ready: http://127.0.0.1:8765'));
