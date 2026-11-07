/** The app's mark: a receipt on a blue rounded square (the same artwork as the installer and desktop icon). */
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b9bff" />
          <stop offset="1" stopColor="#0062d6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.5" fill="url(#bm-g)" />
      <path d="M20 14h24v36l-4-3-4 3-4-3-4 3-4-3-4 3z" fill="#fff" />
      <path d="M25 23h14M25 29h14M25 35h8" stroke="#0a6fe0" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
