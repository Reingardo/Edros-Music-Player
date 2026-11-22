// Temas de color. Cada tema define las variables CSS de la interfaz.
(() => {
  const dark = {
    '--bg': '#0c0e13', '--panel': '#12151c', '--panel-2': '#171b24', '--hover': '#1d2230', '--line': '#232937',
    '--text': '#e9ebf1', '--muted': '#8a90a2', '--faint': '#5d6475', '--player-bg': '#0f1218', '--sel': '#1e2433',
    '--track': '#2a3040', '--canvas-bg': '#0d1016', '--grid': '#1a1f29', '--grid0': '#2c3343', '--toast-bg': '#1f2430',
    '--play-bg': '#ffffff', '--play-fg': '#0c0e13', '--scroll': '#262c3a', '--thumb-shadow': 'rgba(0,0,0,.5)',
  };

  const THEMES = [
    { id: 'sunset', name: { es: 'Atardecer', en: 'Sunset' }, vars: { ...dark, '--accent': '#ff5c8a', '--accent-2': '#ffb347' } },
    {
      id: 'ocean', name: { es: 'Océano', en: 'Ocean' },
      vars: { ...dark, '--bg': '#0a0f17', '--panel': '#0f1622', '--panel-2': '#141d2b', '--hover': '#1a2536', '--line': '#1f2b3d',
        '--player-bg': '#0c131d', '--sel': '#182638', '--canvas-bg': '#0a111b', '--accent': '#38bdf8', '--accent-2': '#818cf8' },
    },
    {
      id: 'forest', name: { es: 'Bosque', en: 'Forest' },
      vars: { ...dark, '--bg': '#0a110e', '--panel': '#0f1814', '--panel-2': '#142019', '--hover': '#1a2a21', '--line': '#1e2e25',
        '--player-bg': '#0c1511', '--sel': '#17281f', '--canvas-bg': '#0a130e', '--accent': '#34d399', '--accent-2': '#bef264' },
    },
    {
      id: 'neon', name: { es: 'Neón', en: 'Neon' },
      vars: { ...dark, '--bg': '#0d0a16', '--panel': '#130f1f', '--panel-2': '#1a1429', '--hover': '#221a35', '--line': '#2a2140',
        '--player-bg': '#100c1b', '--sel': '#241c3a', '--canvas-bg': '#0e0a18', '--accent': '#a855f7', '--accent-2': '#f472b6' },
    },
    {
      id: 'ember', name: { es: 'Brasa', en: 'Ember' },
      vars: { ...dark, '--bg': '#110b0a', '--panel': '#18100e', '--panel-2': '#201613', '--hover': '#2a1c18', '--line': '#30211c',
        '--player-bg': '#140d0b', '--sel': '#2c1d18', '--canvas-bg': '#120b09', '--accent': '#f97316', '--accent-2': '#facc15' },
    },
    {
      id: 'light', name: { es: 'Claro', en: 'Light' },
      vars: {
        '--bg': '#f4f5f8', '--panel': '#ffffff', '--panel-2': '#eef0f4', '--hover': '#e6e9ef', '--line': '#dfe2e9',
        '--text': '#161a22', '--muted': '#5b6273', '--faint': '#8d93a3', '--player-bg': '#ffffff', '--sel': '#e2e6ef',
        '--track': '#d3d8e1', '--canvas-bg': '#f3f5f8', '--grid': '#e3e6ec', '--grid0': '#c6cbd5', '--toast-bg': '#ffffff',
        '--play-bg': '#161a22', '--play-fg': '#ffffff', '--scroll': '#cfd4dd', '--thumb-shadow': 'rgba(0,0,0,.25)',
        '--accent': '#e8457a', '--accent-2': '#f59e0b',
      },
    },
  ];

  function apply(id) {
    const th = THEMES.find((x) => x.id === id) || THEMES[0];
    const root = document.documentElement;
    for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
    root.dataset.theme = th.id;
    root.style.colorScheme = th.id === 'light' ? 'light' : 'dark';
    return th;
  }

  window.THEMES = { list: THEMES, apply };
})();
