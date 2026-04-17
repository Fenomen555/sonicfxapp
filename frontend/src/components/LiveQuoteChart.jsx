import { useMemo } from "react";

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getPayloadRoot(payload) {
  if (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload || {};
}

function extractPoints(payload) {
  const root = getPayloadRoot(payload);
  const directCandidates = [
    root?.points,
    root?.history,
    root?.candles,
    root?.ticks,
    root?.data,
    payload?.points,
    payload?.history,
    payload?.candles,
    payload?.ticks
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

function extractCandles(payload) {
  const root = getPayloadRoot(payload);
  const directCandidates = [
    root?.candles,
    root?.history,
    payload?.candles,
    payload?.history
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((item, index) => ({
          ts: toNumber(item?.ts ?? item?.time ?? item?.t ?? index) ?? index,
          open: toNumber(item?.open),
          high: toNumber(item?.high),
          low: toNumber(item?.low),
          close: toNumber(item?.close)
        }))
        .filter((item) => [item.open, item.high, item.low, item.close].every((value) => value !== null));
    }
  }

  return [];
}

function buildCandles(candles) {
  if (!candles.length) return [];

  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = Math.max(max - min, 0.000001);
  const step = 100 / Math.max(candles.length, 1);
  const bodyWidth = Math.min(Math.max(step * 0.56, 3), 7);

  const scaleY = (value) => 100 - ((value - min) / range) * 100;

  return candles.map((item, index) => {
    const centerX = step * index + step / 2;
    const openY = scaleY(item.open);
    const closeY = scaleY(item.close);
    const highY = scaleY(item.high);
    const lowY = scaleY(item.low);
    const top = Math.min(openY, closeY);
    const height = Math.max(Math.abs(closeY - openY), 1.5);
    return {
      x: centerX,
      wickTop: highY,
      wickBottom: lowY,
      bodyY: top,
      bodyHeight: height,
      bodyWidth,
      bullish: item.close >= item.open
    };
  });
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
  state
}) {
  const root = useMemo(() => getPayloadRoot(payload), [payload]);
  const candles = useMemo(() => extractCandles(payload), [payload]);
  const points = useMemo(() => extractPoints(payload), [payload]);
  const chartCandles = useMemo(() => buildCandles(candles), [candles]);
  const lastPrice = toNumber(root?.price) ?? (points.length ? points[points.length - 1].y : null);
  const rawChange = toNumber(root?.change);
  const change = rawChange ?? (points.length > 1 ? (points[points.length - 1].y - points[0].y) : 0);
  const isPositive = change >= 0;
  const displaySymbol = symbol || root?.requested_symbol || root?.resolved_symbol;

  return (
    <div className="live-quote-zone">
      <div className="live-quote-head">
        <div className="live-quote-copy">
          <span className="live-quote-badge">{marketLabel}</span>
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
        {chartCandles.length ? (
          <svg className="live-quote-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {chartCandles.map((candle, index) => (
              <g key={`${displaySymbol || "pair"}-${index}`}>
                <line
                  x1={candle.x}
                  x2={candle.x}
                  y1={candle.wickTop}
                  y2={candle.wickBottom}
                  stroke={candle.bullish ? "#62d96b" : "#ff6c5c"}
                  strokeWidth="0.5"
                  strokeLinecap="round"
                />
                <rect
                  x={candle.x - candle.bodyWidth / 2}
                  y={candle.bodyY}
                  width={candle.bodyWidth}
                  height={candle.bodyHeight}
                  rx="0.45"
                  fill={candle.bullish ? "#5fd14f" : "#ff5b44"}
                />
              </g>
            ))}
          </svg>
        ) : (
          <div className="live-quote-empty">
            <div className="live-quote-empty-title">{displaySymbol}</div>
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
          <strong>{displaySymbol}</strong>
        </div>
        <div className="live-quote-metric">
          <span>Price</span>
          <strong>{formatPrice(lastPrice)}</strong>
        </div>
        <div className="live-quote-metric">
          <span>Move</span>
          <strong className={isPositive ? "up" : "down"}>
            {Number.isFinite(change) ? `${isPositive ? "+" : ""}${change.toFixed(4)}` : "--"}
          </strong>
        </div>
      </div>
    </div>
  );
}
