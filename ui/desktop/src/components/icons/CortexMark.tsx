import { useId } from 'react';

const GLYPH_PATHS = [
  'M 543.7 397.0 A 168.0 168.0 0 1 0 486.0 657.3',
  'M 543.7 397.0 A 168.0 168.0 0 1 0 486.0 657.3 C 585.7 610.8 801.2 157.1 878.0 262.0',
  'M 596.0 262.0 L 862.0 668.0',
] as const;

const GRADIENT_STOPS = {
  base: '#28518D',
  baseEnd: '#3A6BB0',
  loop: ['#3E68AD', '#6568BC', '#2FA3E4', '#1FD3FB'],
  cross: ['#7E86CC', '#3FB0E8', '#1FD3FB'],
} as const;

export function CortexMark({ className = '' }: { className?: string }) {
  const id = useId();

  return (
    <svg
      width="24"
      height="24"
      // Glyph bounding box (including its 70px stroke) with symmetric padding, so
      // the mark fills small boxes the same way the packaged app icon does.
      viewBox="153.91 159.31 817.22 600.72"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-base`}
          x1="300"
          y1="330"
          x2="360"
          y2="700"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={GRADIENT_STOPS.base} />
          <stop offset="1" stopColor={GRADIENT_STOPS.baseEnd} />
        </linearGradient>
        <linearGradient
          id={`${id}-loop`}
          x1="560"
          y1="680"
          x2="880"
          y2="270"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={GRADIENT_STOPS.loop[0]} />
          <stop offset="0.3" stopColor={GRADIENT_STOPS.loop[1]} />
          <stop offset="0.68" stopColor={GRADIENT_STOPS.loop[2]} />
          <stop offset="1" stopColor={GRADIENT_STOPS.loop[3]} />
        </linearGradient>
        <linearGradient
          id={`${id}-cross`}
          x1="596"
          y1="262"
          x2="862"
          y2="668"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={GRADIENT_STOPS.cross[0]} />
          <stop offset="0.55" stopColor={GRADIENT_STOPS.cross[1]} />
          <stop offset="1" stopColor={GRADIENT_STOPS.cross[2]} />
        </linearGradient>
      </defs>
      <g transform="translate(-30.3 61.3) scale(0.9641084165477889)">
        <path
          d={GLYPH_PATHS[0]}
          stroke={`url(#${id}-base)`}
          strokeWidth="70"
          strokeLinecap="round"
        />
        <path
          d={GLYPH_PATHS[1]}
          stroke={`url(#${id}-loop)`}
          strokeWidth="70"
          strokeLinecap="round"
        />
        <path
          d={GLYPH_PATHS[2]}
          stroke={`url(#${id}-cross)`}
          strokeWidth="70"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
