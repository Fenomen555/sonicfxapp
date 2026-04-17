import { useMemo } from "react";

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractPoints(payload) {
  const directCandidates = [
    payload?.points,
    payload?.history,
    payload?.candles,
    payload?.ticks,
    payload?.data
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item, index) => ({
          x: toNumber(item?.ts ?? item?.time ?? item?.t ?? index) ?? index,
          y: toNumber(item?.close ?? item?.price ?? item?.value ?? item?.bid ?? item?.ask)
        }))
        .filter((item) => item.y !== null);
    }
  }

  return [];
}

function buildPolyline(points) {
  if (points.length < 2) return "";
  const values = points.map((point) => point.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.000001);
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - ((point.y - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export default function LiveQuoteChart({
  symbol,
  marketLabel,
  payload,
  state,
  title,
  hint
}) {
  const points = useMemo(() => extractPoints(payload), [payload]);
  const line = useMemo(() => buildPolyline(points), [points]);
  const lastPrice = points.length ? points[points.length - 1].y : null;
  const change = points.length > 1 ? (points[points.length - 1].y - points[0].y) : 0;
  const isPositive = change >= 0;

  return (
    <div className="live-quote-zone">
      <div className="live-quote-head">
        <div className="live-quote-copy">
          <span className="live-quote-badge">{marketLabel}</span>
          <div className="live-quote-title">{title || symbol}</div>
          <div className="live-quote-subhint">{hint}</div>
        </div>
        <div className={`live-quote-status ${state?.status || "idle"}`}>
          {state?.status === "ready" || state?.status === "connected" || state?.status === "alive"
            ? "Live"
            : state?.status === "reconnecting"
              ? "Reconnecting"
              : state?.status === "error"
                ? "Issue"
                : "Standby"}
        </div>
      </div>

      <div className="live-quote-chart-shell">
        {line ? (
          <svg className="live-quote-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="liveQuoteLine" x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="0%" stopColor={isPositive ? "#7be6b2" : "#ff8f8f"} />
                <stop offset="100%" stopColor={isPositive ? "#8fb8ff" : "#ffc18a"} />
              </linearGradient>
            </defs>
            <polyline fill="none" stroke="url(#liveQuoteLine)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={line} />
          </svg>
        ) : (
          <div className="live-quote-empty">
            <div className="live-quote-empty-title">{symbol}</div>
            <div className="live-quote-empty-copy">
              {state?.status === "error"
                ? (state?.detail || "Quote feed is unavailable")
                : "Preparing the live quote stream"}
            </div>
          </div>
        )}
      </div>

      <div className="live-quote-metrics">
        <div className="live-quote-metric">
          <span>Pair</span>
          <strong>{symbol}</strong>
        </div>
        <div className="live-quote-metric">
          <span>Price</span>
          <strong>{formatPrice(lastPrice)}</strong>
        </div>
        <div className="live-quote-metric">
          <span>Move</span>
          <strong className={isPositive ? "up" : "down"}>
            {points.length > 1 ? `${isPositive ? "+" : ""}${change.toFixed(4)}` : "--"}
          </strong>
        </div>
      </div>
    </div>
  );
}
