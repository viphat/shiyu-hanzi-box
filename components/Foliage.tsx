/**
 * Hand-drawn watercolor-style botanical ornaments, inline SVG only.
 *
 * Purely decorative: every ornament is `aria-hidden`, non-interactive, and
 * positioned behind content by its caller. Callers place them absolutely and
 * fade/hide them on narrow viewports so they never collide with content.
 */
import type { CSSProperties } from 'react';

type FoliageProps = {
  className?: string;
  style?: CSSProperties;
};

/** A single rotated leaf blade with a soft center vein. */
function Leaf({
  cx,
  cy,
  rx,
  ry,
  rotate,
  fill,
  vein,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate: number;
  fill: string;
  vein: string;
}) {
  return (
    <g transform={`rotate(${rotate} ${cx} ${cy})`}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} />
      <line
        x1={cx - rx}
        y1={cy}
        x2={cx + rx}
        y2={cy}
        stroke={vein}
        strokeWidth={0.8}
        strokeLinecap="round"
        opacity={0.6}
      />
    </g>
  );
}

const wrapStyle = (style?: CSSProperties): CSSProperties => ({
  pointerEvents: 'none',
  ...style,
});

/** Leafy sage branch — reaches in from a page corner. */
export function SageBranch({ className, style }: FoliageProps) {
  return (
    <svg
      viewBox="0 0 170 170"
      className={className}
      style={wrapStyle(style)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 12 C40 34, 66 56, 96 108 C108 130, 120 150, 132 164"
        fill="none"
        stroke="#9db287"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M52 46 C66 44, 82 50, 96 66"
        fill="none"
        stroke="#a8b894"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Leaf cx={30} cy={26} rx={16} ry={7} rotate={28} fill="#b9c7a3" vein="#8ea378" />
      <Leaf cx={50} cy={40} rx={14} ry={6} rotate={-14} fill="#cdd8b9" vein="#9db287" />
      <Leaf cx={62} cy={62} rx={17} ry={7} rotate={40} fill="#b9c7a3" vein="#8ea378" />
      <Leaf cx={92} cy={64} rx={13} ry={6} rotate={-8} fill="#cdd8b9" vein="#9db287" />
      <Leaf cx={84} cy={92} rx={16} ry={7} rotate={54} fill="#b9c7a3" vein="#8ea378" />
      <Leaf cx={110} cy={122} rx={14} ry={6} rotate={62} fill="#cdd8b9" vein="#9db287" />
      <Leaf cx={122} cy={148} rx={13} ry={6} rotate={70} fill="#b9c7a3" vein="#8ea378" />
    </svg>
  );
}

/** Warm autumn branch — golden leaves for a page corner or banner accent. */
export function AutumnBranch({ className, style }: FoliageProps) {
  return (
    <svg
      viewBox="0 0 170 170"
      className={className}
      style={wrapStyle(style)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M164 158 C130 136, 104 114, 74 62 C62 40, 50 20, 38 6"
        fill="none"
        stroke="#c2a173"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path
        d="M118 124 C104 126, 88 120, 74 104"
        fill="none"
        stroke="#c2a173"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Leaf cx={140} cy={144} rx={16} ry={7} rotate={-28} fill="#d9c39a" vein="#c2a173" />
      <Leaf cx={120} cy={130} rx={14} ry={6} rotate={18} fill="#e7d7b6" vein="#c2a173" />
      <Leaf cx={108} cy={108} rx={17} ry={7} rotate={-42} fill="#f0d9b5" vein="#c2a173" />
      <Leaf cx={78} cy={106} rx={13} ry={6} rotate={10} fill="#e7d7b6" vein="#c2a173" />
      <Leaf cx={86} cy={78} rx={16} ry={7} rotate={-56} fill="#d9c39a" vein="#c2a173" />
      <Leaf cx={60} cy={48} rx={14} ry={6} rotate={-64} fill="#f0d9b5" vein="#c2a173" />
      <Leaf cx={48} cy={22} rx={13} ry={6} rotate={-72} fill="#e7d7b6" vein="#c2a173" />
    </svg>
  );
}

/** Tiny three-leaf sprig for margins and compact surfaces. */
export function Sprig({ className, style }: FoliageProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      style={wrapStyle(style)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M32 60 C32 44, 30 30, 24 16"
        fill="none"
        stroke="#9db287"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Leaf cx={24} cy={16} rx={12} ry={5} rotate={-24} fill="#b9c7a3" vein="#8ea378" />
      <Leaf cx={40} cy={26} rx={11} ry={5} rotate={30} fill="#cdd8b9" vein="#9db287" />
      <Leaf cx={22} cy={38} rx={12} ry={5} rotate={-40} fill="#b9c7a3" vein="#8ea378" />
    </svg>
  );
}
