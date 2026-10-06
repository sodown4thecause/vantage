export type GlyphFeatures = {
  fit: number;
  intent: number;
  evidence: number;
  momentum: number;
  timing: number;
};

export const GLYPH_AXES = [
  "fit",
  "intent",
  "evidence",
  "momentum",
  "timing",
] as const;

const clamp = (n: number) => Math.min(1, Math.max(0.04, Number.isFinite(n) ? n : 0));

function point(i: number, r: number, cx: number, cy: number) {
  const a = (-90 + i * 72) * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

function ring(r: number, cx: number, cy: number) {
  return GLYPH_AXES.map((_, i) => point(i, r, cx, cy).join(",")).join(" ");
}

/**
 * Five-axis score glyph: fit, intent, evidence, momentum, timing (0 to 1).
 * It is a plain SVG so it renders on the server. With `labels` it names each axis.
 */
export function Glyph({
  features,
  size = 72,
  labels = false,
  animate = false,
}: {
  features: GlyphFeatures;
  size?: number;
  labels?: boolean;
  animate?: boolean;
}) {
  const pad = labels ? 44 : 6;
  const box = 200;
  const c = box / 2;
  const R = box / 2 - pad;
  const shape = GLYPH_AXES.map((k, i) => point(i, R * clamp(features[k]), c, c).join(",")).join(" ");
  const summary = GLYPH_AXES.map((k) => `${k} ${features[k].toFixed(2)}`).join(", ");

  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      role="img"
      aria-label={`Score breakdown: ${summary}`}
      className="shrink-0 overflow-visible"
    >
      <polygon points={ring(R, c, c)} fill="var(--sheet)" stroke="var(--contour)" strokeWidth="1.5" />
      <polygon points={ring(R / 2, c, c)} fill="none" stroke="var(--contour)" strokeWidth="1" strokeDasharray="3 4" />
      {GLYPH_AXES.map((_, i) => {
        const [x, y] = point(i, R, c, c);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--contour)" strokeWidth="1" />;
      })}
      <polygon
        points={shape}
        className={animate ? "glyph-shape" : undefined}
        fill="color-mix(in oklab, var(--signal) 22%, transparent)"
        stroke="var(--signal)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {GLYPH_AXES.map((k, i) => {
        const [x, y] = point(i, R * clamp(features[k]), c, c);
        return <circle key={k} cx={x} cy={y} r={labels ? 4.5 : 5} fill="var(--signal)" className={animate ? "glyph-shape" : undefined} />;
      })}
      {labels &&
        GLYPH_AXES.map((k, i) => {
          const [x, y] = point(i, R + 16, c, c);
          const anchor = Math.abs(x - c) < 4 ? "middle" : x > c ? "start" : "end";
          return (
            <text key={k} x={x} y={y + 4} textAnchor={anchor} fontSize="12" fontWeight="600" fill="var(--ridge)">
              {k}
            </text>
          );
        })}
    </svg>
  );
}

/** The brand mark: an empty glyph with one filled bearing. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
      <polygon points={ring(92, 100, 100)} fill="none" stroke="currentColor" strokeWidth="14" strokeLinejoin="round" />
      <polygon points={[point(0, 92, 100, 100), [100, 100], point(1, 92, 100, 100)].map((p) => p.join(",")).join(" ")} fill="var(--signal)" />
    </svg>
  );
}
