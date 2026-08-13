// frontend/src/components/shared/Divider.jsx

import { T } from '../../theme';

// 1px separator. Pass `vertical` for a column divider (used between control-bar groups).
export default function Divider({ vertical, style = {} }) {
  return vertical
    ? <div style={{ width: 1, alignSelf: 'stretch', background: T.border, flexShrink: 0, ...style }} />
    : <div style={{ height: 1, background: T.border, ...style }} />;
}
