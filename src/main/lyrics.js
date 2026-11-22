// Letras sincronizadas: primero un archivo .lrc junto a la canción; si no hay, se buscan en lrclib.net (gratis, sin clave).
import fs from 'node:fs/promises';
import path from 'node:path';

const UA = 'MusicPlayer/1.2 (reproductor de escritorio)';
const cache = new Map();

export function parseLRC(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const ms = s[3] ? parseInt(s[3].padEnd(3, '0'), 10) : 0;
      lines.push({ t: parseInt(s[1], 10) * 60 + parseInt(s[2], 10) + ms / 1000, text: words });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

// "Bad Bunny - DtMF (Video Oficial) [4K]" → { artist: 'Bad Bunny', title: 'DtMF' }
export function cleanTitle(item) {
  let title = String(item.title || '');
  let artist = String(item.artist || '');
  title = title
    .replace(/\[[^\]]*\]|\([^)]*(official|oficial|video|audio|lyric|letra|visualizer|hd|4k|remaster|live|en vivo|mv)[^)]*\)/gi, '')
    .replace(/\b(official|oficial)\s+(music\s+)?(video|audio)\b/gi, '')
    .replace(/\|.*$/, '')
    .trim();
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) { artist = m[1].trim(); title = m[2].trim(); }
  title = title.replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, '').replace(/\s+x\s+.*$/i, '').trim();
  artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s+(ft\.?|feat\.?|x|&|,)\s+.*$/i, '').trim();
  return { artist, title: title.replace(/["“”]/g, '').trim() };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  return r.json();
}

export async function findLyrics(item) {
  const key = item.id;
  if (cache.has(key)) return cache.get(key);
  let result = null;

  // 1) Archivo .lrc al lado del audio
  if (item.type === 'local' && item.path) {
    try {
      const lrc = await fs.readFile(item.path.replace(/\.[^.\\/]+$/, '.lrc'), 'utf8');
      const lines = parseLRC(lrc);
      if (lines.length) result = { synced: lines, source: path.basename(item.path, path.extname(item.path)) + '.lrc' };
    } catch { /* no hay .lrc */ }
  }

  // 2) lrclib.net
  if (!result) {
    const { artist, title } = cleanTitle(item);
    if (title) {
      try {
        const q = new URLSearchParams({ track_name: title, artist_name: artist });
        if (item.duration) q.set('duration', Math.round(item.duration));
        let hit = artist ? await getJSON(`https://lrclib.net/api/get?${q}`) : null;
        if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
          const s = await getJSON(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}`.trim() })}`);
          if (Array.isArray(s) && s.length) {
            const dur = item.duration || 0;
            s.sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || (dur ? Math.abs(a.duration - dur) - Math.abs(b.duration - dur) : 0));
            hit = s[0];
          }
        }
        if (hit && (hit.syncedLyrics || hit.plainLyrics)) {
          result = {
            synced: hit.syncedLyrics ? parseLRC(hit.syncedLyrics) : null,
            plain: hit.plainLyrics || null,
            source: 'lrclib.net',
            match: `${hit.artistName} — ${hit.trackName}`,
          };
        }
      } catch { /* sin conexión */ }
    }
  }

  result ||= { none: true };
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
