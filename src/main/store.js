// Persistencia simple en JSON dentro de la carpeta de datos del usuario.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA = {
  sources: [],          // carpetas del disco que se escanean
  tracks: [],           // pistas locales encontradas
  folders: [],          // carpetas organizadas por el usuario {id, name, parentId, items: [], eq?}
  favorites: [],        // elementos marcados con ❤
  stats: {},            // id → { n: reproducciones, secs: segundos escuchados, last, item }
  recent: [],           // últimos reproducidos (más reciente primero)
  overrides: {},        // datos editados de archivos que no son MP3 (ruta → {title, artist, album, genre})
  settings: {
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',      // off | all | one
    dualScreen: false,
    preamp: {
      enabled: true,
      gain: 0,          // dB del preamplificador
      bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      limiter: true,
      preset: 'Plano',
    },
  },
};

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'musicplayer-data.json');
    this.data = structuredClone(DEFAULT_DATA);
    this._timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...this.data,
        ...raw,
        settings: {
          ...this.data.settings,
          ...(raw.settings || {}),
          preamp: { ...this.data.settings.preamp, ...(raw.settings?.preamp || {}) },
        },
      };
    } catch {
      // primer arranque o archivo dañado: se usan los valores por defecto
    }
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
