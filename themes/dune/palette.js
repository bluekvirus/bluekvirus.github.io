// Single source of truth for every color and link in the dune theme.
export const COLORS = {
  sandLit: 0xe8763a,
  sandShadow: 0x4a2d5e,
  skyZenith: 0x12081f,
  horizon: 0xc2452e,
  neonCyan: 0x00e5ff,
  neonMagenta: 0xff2e88,
  amber: 0xffb347,
  fremenBlue: 0x4d9fff,
  emperorGold: 0xffd75e,
  wormHide: 0x3b2a52,
  moonA: 0xd8c9b8,
  moonB: 0xb9a6c9,
  sunlight: 0xffa050,
};

export const SIGILS = [
  { id: 'emperor', label: 'LINKEDIN', color: COLORS.emperorGold, url: 'https://www.linkedin.com/in/timzhiyuanliu' },
  { id: 'guild', label: 'PROJECTS', color: COLORS.neonCyan, url: 'https://github.com/bluekvirus' },
  { id: 'bene', label: 'CV', color: COLORS.neonMagenta, url: 'mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)' },
  { id: 'fremen', label: 'CONTACT', color: COLORS.fremenBlue, url: 'mailto:bluekvirus@gmail.com' },
];
