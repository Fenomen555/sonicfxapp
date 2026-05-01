const INDICATOR_META = {
  rsi: {
    short: "RSI",
    title: "Relative Strength Index",
    tone: "violet"
  },
  stochastic_oscillator: {
    short: "STO",
    title: "Stochastic Oscillator",
    tone: "blue"
  },
  cci: {
    short: "CCI",
    title: "Commodity Channel Index",
    tone: "amber"
  },
  williams_r: {
    short: "W%R",
    title: "Williams %R",
    tone: "green"
  },
  macd: {
    short: "MACD",
    title: "MACD",
    tone: "rose"
  },
  ema_9_50_200: {
    short: "EMA",
    title: "EMA 9 / 50 / 200",
    tone: "cyan"
  },
  adx: {
    short: "ADX",
    title: "Average Directional Index",
    tone: "teal"
  },
  atr: {
    short: "ATR",
    title: "Average True Range",
    tone: "orange"
  },
  bollinger_bands: {
    short: "BB",
    title: "Bollinger Bands",
    tone: "indigo"
  },
  parabolic_sar: {
    short: "PSAR",
    title: "Parabolic SAR",
    tone: "pink"
  },
  momentum: {
    short: "MOM",
    title: "Momentum",
    tone: "sky"
  },
  rate_of_change: {
    short: "ROC",
    title: "Rate Of Change",
    tone: "lime"
  }
};

export function getIndicatorMeta(code, fallbackTitle = "", fallbackDescription = "") {
  const key = String(code || "").trim().toLowerCase();
  const meta = INDICATOR_META[key] || null;

  return {
    code: key,
    short: meta?.short || String(fallbackTitle || code || "IND").slice(0, 5).toUpperCase(),
    title: meta?.title || fallbackTitle || "Indicator",
    description: fallbackDescription || "",
    tone: meta?.tone || "blue"
  };
}
