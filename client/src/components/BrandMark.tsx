/** The app's small logo: a bill with a few lines on it. */
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="28" height="28" rx="8" fill="var(--primary)" />
      <path d="M9 8.5h10M9 12.5h10M9 16.5h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="19" cy="18.5" r="2.4" fill="#fff" />
    </svg>
  );
}
