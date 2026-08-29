/** Tiny inline SVG price sparkline. Server-renderable, no chart library. */
export default function Sparkline({
  values,
  width = 96,
  height = 28,
  up,
  stretch = false,
}: {
  values: number[];
  width?: number;
  height?: number;
  up: boolean;
  stretch?: boolean; // fill the parent width, keeping the aspect ratio
}) {
  if (values.length < 2) {
    return <div style={{ width: stretch ? undefined : width, height }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = up ? "#22c55e" : "#f43f5e";

  return (
    <svg
      width={stretch ? undefined : width}
      height={stretch ? undefined : height}
      viewBox={`0 0 ${width} ${height}`}
      className={stretch ? "h-auto w-full" : undefined}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
