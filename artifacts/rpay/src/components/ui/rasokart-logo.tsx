interface RasoKartLogoProps {
  size?: number;
  className?: string;
}

export function RasoKartLogo({ size = 32, className = "" }: RasoKartLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="180" height="180" rx="36" fill="#0f172a" />
      <rect x="4" y="4" width="172" height="172" rx="33" fill="url(#rk-grad-bg)" opacity="0.15" />
      <defs>
        <linearGradient id="rk-grad-bg" x1="0" y1="0" x2="180" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="rk-grad-text" x1="30" y1="50" x2="150" y2="130" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <text
        x="18"
        y="128"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="800"
        fontSize="105"
        fill="url(#rk-grad-text)"
        letterSpacing="-4"
      >
        RK
      </text>
      <circle cx="152" cy="42" r="10" fill="#06b6d4" opacity="0.9" />
    </svg>
  );
}
