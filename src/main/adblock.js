// Bloqueo de anuncios a nivel de red para el reproductor de YouTube.
// Complementa al script del reproductor (preload del escenario), que además
// elimina los anuncios de la respuesta del reproductor y salta los que se cuelen.
const AD_URLS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.googletagservices.com/*',
  '*://*.moatads.com/*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/get_midroll_info*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube-nocookie.com/pagead/*',
  '*://*.youtube-nocookie.com/api/stats/ads*',
  '*://*.google.com/pagead/*',
  '*://*.google.com/ads/*',
  '*://imasdk.googleapis.com/*',
];

export function installAdBlock(session) {
  let blocked = 0;
  session.webRequest.onBeforeRequest({ urls: AD_URLS }, (_details, cb) => {
    blocked++;
    cb({ cancel: true });
  });
  return () => blocked;
}
