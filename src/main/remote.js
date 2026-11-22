// Control remoto desde el celular: servidor en la red local (Wi-Fi), protegido con una clave
// que va dentro del código QR. Solo funciona mientras esté activado en Ajustes.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

export function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  const score = (a) => (a.startsWith('192.168.') ? 3 : a.startsWith('10.') ? 2 : a.startsWith('172.') ? 1 : 0);
  all.sort((a, b) => score(b.address) - score(a.address));
  return all[0]?.address || '127.0.0.1';
}

export async function startRemote({ key, rendererDir, onCmd, search, getCover, getState, preferredPort = 8765 }) {
  const clients = new Set();
  const html = () => fs.readFileSync(path.join(rendererDir, 'remote.html'));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ok = url.searchParams.get('k') === key;
    const json = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    try {
      if (url.pathname === '/' || url.pathname === '/r') {
        if (!ok) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Escanea el código QR de MusicPlayer / Scan the MusicPlayer QR code'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html());
      }
      if (!ok) return json({ error: 'forbidden' }, 403);

      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(getState())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/state') return json(getState());
      if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') || '').slice(0, 200);
        return json(await search(url.searchParams.get('src') === 'yt' ? 'yt' : 'local', q));
      }
      if (url.pathname === '/api/cover') {
        const c = await getCover(url.searchParams.get('id') || '');
        if (!c) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': c.format, 'Cache-Control': 'max-age=600' });
        return res.end(c.data);
      }
      if (url.pathname === '/api/cmd' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 65536) break; }
        onCmd(JSON.parse(body || '{}'));
        return json({ ok: true });
      }
      json({ error: 'not found' }, 404);
    } catch {
      json({ error: 'server' }, 500);
    }
  });

  const port = await new Promise((resolve) => {
    server.once('error', () => server.listen(0, '0.0.0.0', () => resolve(server.address().port)));
    server.listen(preferredPort, '0.0.0.0', () => resolve(server.address().port));
  });

  const url = `http://${lanAddress()}:${port}/r?k=${key}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#14101f', light: '#ffffff' } });

  return {
    url,
    qr,
    push(state) {
      const msg = `data: ${JSON.stringify(state)}\n\n`;
      for (const c of clients) c.write(msg);
    },
    clients: () => clients.size,
    stop() {
      for (const c of clients) c.end();
      clients.clear();
      server.close();
    },
  };
}
