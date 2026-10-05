import type { CSSProperties } from 'react';
import type { Color, PieceType } from '../../../shared/protocol';
import { discUrl, glyphUrl } from '../lib/pieces';

interface Props {
  color: Color;
  type: PieceType;
  /** pixel size; omit to let CSS size it */
  size?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

/** A lacquered disc (from the supplied PNG) with the white calligraphy glyph (supplied SVG) on top. */
export function PieceIcon({ color, type, size, className = '', style, label }: Props) {
  return (
    <span
      className={`piece-icon ${className}`}
      style={{ backgroundImage: `url(${discUrl(color)})`, width: size, height: size, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <img src={glyphUrl(color, type)} alt="" draggable={false} />
    </span>
  );
}
