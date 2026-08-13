// frontend/src/theme.js
// Shared design tokens for the institutional terminal aesthetic.
// Import `T` for colors and `mono` for the monospace font stack.
// See frontend/CONTEXT.md for full usage guidance.

export const T = {
  bg:          '#06080c',
  surface:     '#0b0f16',
  surfaceHi:   '#111720',
  border:      'rgba(255,255,255,0.07)',
  borderHi:    'rgba(255,255,255,0.14)',

  amber:       '#F0A500',
  amberDim:    'rgba(240,165,0,0.12)',
  amberBorder: 'rgba(240,165,0,0.35)',

  green:       '#00C896',
  greenDim:    'rgba(0,200,150,0.12)',

  red:         '#E05252',
  redDim:      'rgba(224,82,82,0.12)',

  pink:        '#D66E9A',
  blue:        '#4A9EFF',
  purple:      '#A855F7',

  textHi:      'rgba(255,255,255,0.90)',
  textMid:     'rgba(255,255,255,0.50)',
  textLo:      'rgba(255,255,255,0.25)',
  textGhost:   'rgba(255,255,255,0.12)',
};

export const mono = { fontFamily: "'IBM Plex Mono', 'Fira Code', 'Consolas', monospace" };

// Participant accent colors — used by both FII.jsx and Participants.jsx
export const PARTICIPANT_COLORS = { FII: T.blue, DII: T.green, Client: T.amber, Pro: T.purple };
export const PARTICIPANTS = ['FII', 'DII', 'Client', 'Pro'];

export const labelStyle = (extra = {}) => ({
  ...mono,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: T.textLo,
  ...extra,
});

export const chartAxisProps = {
  tick: { fill: T.textLo, fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.04em' },
  tickLine: false,
  axisLine: { stroke: T.border },
};

export const gridProps = { strokeDasharray: '2 4', stroke: T.textGhost, vertical: false };
