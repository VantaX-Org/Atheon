/**
 * JeffLogo — JARVIS-style arc-reactor mark for the in-app assistant.
 *
 * Pure inline SVG (no asset, no font): concentric rings + hexagonal core,
 * all strokes use currentColor so it inherits the accent from its container
 * and works in both themes. `spin` rotates the outer tick-ring when Jeff is
 * thinking. Respects prefers-reduced-motion via the CSS class.
 */
interface JeffLogoProps {
  size?: number;
  spin?: boolean;
  className?: string;
}

export function JeffLogo({ size = 22, spin = false, className }: JeffLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* outer tick-ring — rotates while thinking */}
      <g
        className={spin ? 'motion-safe:animate-spin' : undefined}
        style={spin ? { transformOrigin: '24px 24px', animationDuration: '3s' } : undefined}
      >
        <circle cx="24" cy="24" r="21" strokeWidth="1" opacity="0.35" strokeDasharray="2 4" />
      </g>
      {/* mid ring */}
      <circle cx="24" cy="24" r="16" strokeWidth="1.5" opacity="0.55" />
      {/* hex core */}
      <path
        d="M24 11 L35 17.5 L35 30.5 L24 37 L13 30.5 L13 17.5 Z"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      {/* reactor centre */}
      <circle cx="24" cy="24" r="5" strokeWidth="1.75" fill="currentColor" fillOpacity="0.15" />
      <circle cx="24" cy="24" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
