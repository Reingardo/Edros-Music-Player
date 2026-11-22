# 🛠️ Documentación técnica

Cómo está construido **Edros Music Player**, cómo ejecutarlo desde el código y cómo crear el instalador.

## Tecnologías

| Pieza | Uso |
|---|---|
| [Electron 45](https://www.electronjs.org/) | Aplicación de escritorio (Chromium + Node.js). |
| JavaScript sin frameworks | Interfaz en HTML, CSS y JS puros; sin paso de compilación. |
| Web Audio API | Preamplificador, ecualizador, igualador, limitador, visualizadores y nivel de la mascota. |
| [youtubei.js](https://github.com/LuanRT/YouTube.js) | Búsqueda, videos relacionados y listas de YouTube. |
| YouTube IFrame API | Reproducción de los videos. |
| [music-metadata](https://github.com/borewit/music-metadata) | Lectura de etiquetas y carátulas. |
| [node-id3](https://github.com/Zazama/node-id3) | Escritura de etiquetas y carátulas en MP3. |
| [qrcode](https://github.com/soldair/node-qrcode) | Código QR del control remoto. |
| [lrclib.net](https://lrclib.net) | Letras sincronizadas. |
| [electron-builder](https://www.electron.build/) | Instalador NSIS para Windows. |

## Ejecutar desde el código

```bash
npm install        # dependencias (descarga Electron)
npm start          # abre la app
npm run dist       # crea dist/MusicPlayer-Setup-<versión>.exe
```

Variables de entorno útiles para probar:

| Variable | Efecto |
|---|---|
| `MP_USER_DATA` | Carpeta de datos alternativa (perfil de pruebas, sin tocar tus datos reales). |

Ejemplo en PowerShell:

```powershell
$env:MP_USER_DATA = "$env:TEMP\mp-pruebas"; npm start -- --remote-debugging-port=9333
```

## Estructura

```
├── build/icon.png            Icono para el instalador
├── docs/                     Documentación e imágenes
├── src/
│   ├── assets/icon.png       Icono de ventanas y bandeja (logo Edros)
│   ├── main/                 Proceso principal (Node.js)
│   │   ├── main.js           Ventanas, IPC, YouTube, doble pantalla, menús
│   │   ├── server.js         Servidor HTTP local (interfaz + archivos de audio/video)
│   │   ├── library.js        Escaneo de carpetas, etiquetas y carátulas
│   │   ├── store.js          Guardado en JSON
│   │   ├── adblock.js        Bloqueo de servidores de anuncios
│   │   ├── lyrics.js         Letras (.lrc local o lrclib.net)
│   │   ├── remote.js         Servidor del control desde el celular + QR
│   │   └── desktop.js        Bandeja, miniatura de la barra de tareas, avisos, mini reproductor
│   ├── preload/              Puentes seguros entre páginas y proceso principal
│   │   ├── control.cjs       API de la ventana principal (window.mp)
│   │   ├── stage.cjs         Motor de audio, anti-anuncios de YouTube y visualizadores
│   │   └── mini.cjs          API del mini reproductor
│   └── renderer/             Páginas
│       ├── control.html/.css/.js   Ventana principal
│       ├── stage.html/.js          Pantalla de video
│       ├── mini.html               Mini reproductor
│       ├── remote.html             Página del celular
│       ├── i18n.js                 Traducciones (es / en)
│       ├── themes.js               Temas de color
│       ├── mascot.js / .css        Mascota Tempo
│       ├── icons.js                Iconos SVG
│       └── edros-logo.svg          Logo
└── package.json              Dependencias y configuración del instalador
```

## Arquitectura

```
┌──────────────────────────── Proceso principal (main.js) ────────────────────────────┐
│ Servidor HTTP local (localhost) · YouTube (youtubei.js) · letras · etiquetas · JSON │
│ Bandeja / barra de tareas / avisos · servidor del celular (0.0.0.0, con clave)      │
└──────┬───────────────────────────────┬──────────────────────────────┬────────────────┘
       │ IPC                           │ IPC                          │ HTTP + SSE
┌──────▼───────────────┐      ┌────────▼─────────────┐      ┌─────────▼─────────┐
│ Ventana de control   │      │ Escenario (stage)    │      │ Celular           │
│ control.js           │      │ WebContentsView      │      │ remote.html       │
│ cola, vistas, ajustes│─cmd─►│ <video> ×2 + YouTube │      └───────────────────┘
│ mascota, estadísticas│◄state│ Web Audio (preload)  │      ┌───────────────────┐
└──────────────────────┘      └──────────────────────┘      │ Mini reproductor  │
                                                            └───────────────────┘
```

### Ventana de control y escenario

- La **ventana de control** (`control.js`) tiene toda la lógica de la cola, las vistas, los ajustes, las estadísticas y la mascota. No reproduce sonido: envía órdenes (`load`, `toggle`, `seek`, `volume`, `crossfade`, `lyrics`, `viz`…) al escenario.
- El **escenario** (`stage.html`) es una `WebContentsView` que reproduce todo: archivos locales con dos elementos `<video>` (para poder fundir canciones) y YouTube con la IFrame API. Informa su estado 4 veces por segundo y avisa de eventos (`ended`, `error`, `nearEnd`).
- **Doble pantalla**: la misma `WebContentsView` se mueve de la ventana principal a una ventana a pantalla completa en el otro monitor, sin recargarla, así que la reproducción no se corta.

### Servidor local

La interfaz y los archivos se sirven desde `http://localhost:<puerto>` con un token aleatorio:

- Permite que el **reproductor de YouTube** funcione. Desde `localhost` YouTube permite incrustar muchos más videos musicales que desde `127.0.0.1` o `file://`.
- Permite que **Web Audio** procese los archivos locales, que son del mismo origen.
- Solo sirve archivos que están en la biblioteca y soporta peticiones `Range` para poder adelantar.

### Motor de audio (preload del escenario)

`stage.cjs` se ejecuta en la página del escenario **y dentro del iframe de YouTube** (`nodeIntegrationInSubFrames`). En ambos conecta el elemento de video a la misma cadena:

```
fuente → preamplificador → 10 filtros (lowshelf, 8 peaking, highshelf) → [igualador + compensación] → [limitador] → analizador → salida
```

El analizador alimenta los visualizadores y el nivel de graves que hace bailar a la mascota, con ganancia automática.

### YouTube sin anuncios

1. `adblock.js` cancela las peticiones a servidores de publicidad (`doubleclick`, `googlesyndication`, `pagead`, `get_midroll_info`…).
2. En el contexto de la página de YouTube se interceptan `JSON.parse` y `Response.json` para eliminar `adPlacements`, `adSlots` y `playerAds` de la respuesta del reproductor.
3. Si aun así aparece un anuncio (`.ad-showing`), se silencia, se salta al final y se pulsa *Omitir*.

### Control desde el celular

`remote.js` levanta un servidor en `0.0.0.0:8765` (o un puerto libre) solo cuando se activa. Todas las rutas exigen la clave `k` (12 bytes aleatorios, guardada en los ajustes), que va en el QR. El estado se envía por **Server-Sent Events** y las órdenes por `POST /api/cmd`.

## Datos

`%APPDATA%\MusicPlayer\musicplayer-data.json`:

| Clave | Contenido |
|---|---|
| `sources` | Carpetas del disco que se escanean. |
| `tracks` | Biblioteca local (con caché por fecha de modificación). |
| `folders` | Carpetas del usuario `{ id, name, parentId, items, eq? }`. |
| `favorites`, `recent` | Favoritos e historial. |
| `stats` | `id → { n, secs, last, item }`. |
| `overrides` | Datos editados de archivos que no son MP3. |
| `settings` | Volumen, idioma, tema, ecualizador, mascota, control remoto… |

## Traducciones

Los textos están en `src/renderer/i18n.js` (`es` y `en`). Para añadir un idioma, copia el bloque `en`, tradúcelo, añádelo a `DICTS` y a la lista `LANGS` de `control.js`. Los textos de la pantalla de video están en `stage.js` (`TXT`) y los del proceso principal en `main.js` (`MAIN_TXT`).

## Crear una versión

1. Sube la versión en `package.json`.
2. `npm run dist` → `dist/MusicPlayer-Setup-<versión>.exe`.
3. Crea un *release* en GitHub con la etiqueta `v<versión>` y adjunta el `.exe`:

```bash
gh release create v1.2.0 dist/MusicPlayer-Setup-1.2.0.exe --title "Edros Music Player 1.2.0" --notes-file CHANGELOG.md
```

El instalador no está firmado; para evitar el aviso de SmartScreen hace falta un certificado de firma de código (`win.certificateFile` en la configuración de electron-builder).
