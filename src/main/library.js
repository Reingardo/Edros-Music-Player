// Escaneo de carpetas locales y lectura de metadatos (título, artista, carátula...).
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFile, selectCover } from 'music-metadata';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.wma', '.weba']);
export const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v', '.ogv']);

export function mediaKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile() && mediaKind(full)) out.push(full);
  }
  return out;
}

export async function readTrack(file) {
  const media = mediaKind(file);
  const base = path.basename(file, path.extname(file));
  const track = {
    id: 'l:' + file,
    type: 'local',
    path: file,
    media,
    ext: path.extname(file).slice(1).toUpperCase(),
    title: base,
    artist: '',
    album: path.basename(path.dirname(file)),
    duration: 0,
    hasCover: false,
    genre: '',
  };
  try {
    const st = await fs.stat(file);
    track.mtime = st.mtimeMs;
    const meta = await parseFile(file, { skipPostHeaders: true });
    const c = meta.common;
    if (c.title) track.title = c.title;
    if (c.artist) track.artist = c.artist;
    else if (c.artists?.length) track.artist = c.artists.join(', ');
    if (c.album) track.album = c.album;
    track.genre = (c.genre && c.genre[0]) || '';
    if (meta.format.duration) track.duration = meta.format.duration;
    track.hasCover = !!(c.picture && c.picture.length);
  } catch {
    // archivo sin etiquetas legibles: nos quedamos con el nombre del archivo
  }
  // "Artista - Título" en el nombre del archivo cuando no hay etiquetas
  if (!track.artist && track.title === base && base.includes(' - ')) {
    const [a, ...rest] = base.split(' - ');
    track.artist = a.trim();
    track.title = rest.join(' - ').trim();
  }
  return track;
}

export async function scanFolders(folders, known, onProgress) {
  const files = [];
  for (const f of folders) await walk(f, files);
  const knownMap = new Map(known.map((t) => [t.path, t]));
  const result = [];
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      const prev = knownMap.get(file);
      let st = null;
      try { st = await fs.stat(file); } catch { /* ignorado */ }
      if (prev && st && prev.mtime === st.mtimeMs && prev.genre !== undefined) result.push(prev);
      else result.push(await readTrack(file));
      done++;
      if (done % 10 === 0 || done === files.length) onProgress?.(done, files.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  result.sort((a, b) => a.path.localeCompare(b.path, 'es'));
  return result;
}

const coverCache = new Map();
export function clearCover(file) { coverCache.delete(file); }
export async function readCover(file) {
  if (coverCache.has(file)) return coverCache.get(file);
  let cover = null;
  try {
    const meta = await parseFile(file, { skipPostHeaders: true });
    const pic = selectCover(meta.common.picture);
    if (pic) cover = { data: Buffer.from(pic.data), format: pic.format || 'image/jpeg' };
  } catch { /* sin carátula */ }
  if (coverCache.size > 300) coverCache.delete(coverCache.keys().next().value);
  coverCache.set(file, cover);
  return cover;
}
