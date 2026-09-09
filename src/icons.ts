import creasekitLogo from './assets/creasekit.svg';

const paths = {
  inspect:
    '<path d="M9 3H4a1 1 0 0 0-1 1v5m12-6h5a1 1 0 0 1 1 1v5M3 15v5a1 1 0 0 0 1 1h5M14 10l7 5-4 1-2 4-5-10Z"/>',
  note: '<path d="M20 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6M7 7h9M7 11h4m3 9 1-4 5-5 3 3-5 5-4 1Z"/>',
  xray: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M8 2H3a1 1 0 0 0-1 1v5m14-6h5a1 1 0 0 1 1 1v5M2 16v5a1 1 0 0 0 1 1h5m8 0h5a1 1 0 0 0 1-1v-5"/>',
  ruler: '<path d="M3 3h18v5H8v13H3V3Zm4 0v3m4-3v3m4-3v3m4-3v3M3 11h3m-3 4h3m-3 4h3"/>',
  type: '<path d="M4 7V4h16v3M12 4v16m-4 0h8M2 11v7m20-7v7"/>',
  color: '<path d="m14 4 2-2 6 6-2 2-6-6Zm1 3L4 18v3h3L18 10M6 16l3 3"/>',
  output:
    '<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M15 7V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h4m4-5h4m-4 4h4"/>',
  settings:
    '<path d="m9 3 1-2h4l1 2 2 1 2-.2 2 3-1 2v3l1 2-2 3-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3 1-2V9L3 7l2-3 2 .2 2-1Z"/><circle cx="12" cy="10.5" r="3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  undo: '<path d="M4 4v6h6M4 10a8 8 0 1 1 0 7"/>',
  redo: '<path d="M20 4v6h-6m6 0a8 8 0 1 0 0 7"/>',
  pin: '<path d="M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6Zm3 12v7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
};

export type IconName = keyof typeof paths | 'creasekit';

export const icon = (name: IconName): string =>
  name === 'creasekit'
    ? `<img class="creasekit-logo" src="${creasekitLogo.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" alt="" width="21" height="21"/>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
