// Servidor HTTP local (solo 127.0.0.1) que sirve la interfaz y los archivos de audio/video.
// Servir desde http:// permite que el reproductor de YouTube funcione y que el
// preamplificador (Web Audio) pueda procesar los archivos locales.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readCover } from './library.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.weba': 'audio/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/webm', // Chromium reproduce la mayoría de MKV (VP8/VP9/H.264) así
  '.mov': 'video/mp4',
  '.ogv': 'video/ogg',
};

export function startServer({ rendererDir, isAllowedMedia }) {
  const token = crypto.randomBytes(18).toString('hex');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname.startsWith('/app/')) {
        const rel = path.normalize(decodeURIComponent(url.pathname.slice(5)));
        const file = path.join(rendererDir, rel);
        if (!file.startsWith(rendererDir)) return send(res, 403);
        return fs.readFile(file, (err, buf) => {
          if (err) return send(res, 404);
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
          res.end(buf);
        });
      }

      if (url.searchParams.get('t') !== token) return send(res, 403);
      const p = url.searchParams.get('p') || '';
      if (!isAllowedMedia(p)) return send(res, 404);

      if (url.pathname === '/cover') {
        const cover = await readCover(p);
        if (!cover) return send(res, 404);
        res.writeHead(200, { 'Content-Type': cover.format, 'Cache-Control': 'max-age=3600' });
        return res.end(cover.data);
      }

      if (url.pathname === '/media') return streamFile(req, res, p);
      send(res, 404);
    } catch {
      send(res, 500);
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      // Se usa "localhost" (no 127.0.0.1): YouTube permite incrustar muchos más videos musicales desde ese origen.
      resolve({ origin: `http://localhost:${port}`, token, server });
    });
  });
}

function send(res, code) {
  res.writeHead(code);
  res.end();
}

function streamFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
      if (start >= st.size || end >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}
