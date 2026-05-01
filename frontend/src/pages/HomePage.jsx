import { useEffect, useMemo, useRef, useState } from "react";
import Lottie from "lottie-react";
import {
  AutoModeIcon,
  CameraIcon,
  GalleryIcon,
  IndicatorModeIcon,
  LinkIcon,
  ScannerModeIcon,
  SparkIcon
} from "../components/AppIcons";
import AnalyzeCtaAnimation from "../components/AnalyzeCtaAnimation";
import confettiAnimation from "../assets/confetti.json";
import lossSignAnimation from "../assets/loss-sign.json";
import trophyAnimation from "../assets/trophy.json";
import upgradeAnimation from "../assets/upgrade.json";
import homeHistoryIcon from "../assets/profile-history.png";
import homeInfoIcon from "../assets/home-info.png";
import LiveQuoteChart from "../components/LiveQuoteChart";
import ScanAnalysisOverlay from "../components/ScanAnalysisOverlay";
import UploadScanAnimation from "../components/UploadScanAnimation";
import { apiFetch, apiFetchJson } from "../lib/api";
import { getDeviceProfile } from "../lib/device";
import { getIndicatorMeta } from "../lib/indicatorMeta";
import { QuoteStreamClient } from "../lib/quoteStream";

const FALLBACK_EXPIRATIONS = [
  { value: "5s", label: "5s" },
  { value: "15s", label: "15s" },
  { value: "1m", label: "1m" },
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" }
];

function mergeExpirationOptions(...groups) {
  const merged = [];
  const seen = new Set();

  groups.forEach((group) => {
    if (!Array.isArray(group)) return;
    group.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const value = String(item.value || "").trim().toLowerCase();
      if (!value || seen.has(value)) return;
      seen.add(value);
      merged.push({ value, label: item.label || value });
    });
  });

  return merged.length ? merged : FALLBACK_EXPIRATIONS;
}

const BASIC_MARKETS = [
  { key: "otc", label: "OTC" },
  { key: "forex", label: "Forex" }
];

const INDICATOR_MARKETS = [
  { key: "otc", label: "OTC" },
  { key: "forex", label: "Forex" },
  { key: "crypto", label: "Crypto" },
  { key: "commodities", label: "Metals" },
  { key: "stocks", label: "Stocks" }
];

const FALLBACK_INDICATORS = [
  { code: "rsi", title: "RSI", description: "Relative Strength Index" },
  { code: "stochastic_oscillator", title: "Stochastic Oscillator", description: "Momentum oscillator" },
  { code: "cci", title: "CCI", description: "Commodity Channel Index" },
  { code: "williams_r", title: "Williams %R", description: "Overbought / oversold oscillator" },
  { code: "macd", title: "MACD", description: "Trend and momentum convergence" },
  { code: "ema_9_50_200", title: "Moving Average (EMA 9 / 50 / 200)", description: "EMA stack for trend alignment" },
  { code: "adx", title: "ADX", description: "Average Directional Index" },
  { code: "atr", title: "ATR", description: "Average True Range" },
  { code: "bollinger_bands", title: "Bollinger Bands", description: "Volatility envelope" },
  { code: "parabolic_sar", title: "Parabolic SAR", description: "Stop and reverse trend marker" },
  { code: "momentum", title: "Momentum", description: "Raw momentum oscillator" },
  { code: "rate_of_change", title: "Rate Of Change", description: "ROC momentum percentage" }
];

function normalizeIndicatorCopy(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[%/()+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getUniqueIndicatorDescription(description, ...titles) {
  const normalizedDescription = normalizeIndicatorCopy(description);
  if (!normalizedDescription) return "";
  const normalizedTitles = titles.map(normalizeIndicatorCopy).filter(Boolean);
  return normalizedTitles.includes(normalizedDescription) ? "" : description;
}

function getQuotePayloadRoot(payload) {
  if (payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload || {};
}

function normalizeQuoteMatchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function matchesQuotePayload(payload, subscriptionItem) {
  if (!payload || !subscriptionItem) return false;

  const root = getQuotePayloadRoot(payload);
  const payloadCategory = String(root?.category || payload?.category || "").trim().toLowerCase();
  if (payloadCategory && payloadCategory !== String(subscriptionItem.category || "").trim().toLowerCase()) {
    return false;
  }

  const expectedSymbol = normalizeQuoteMatchValue(subscriptionItem.symbol);
  const symbolCandidates = [
    root?.requested_symbol,
    root?.resolved_symbol,
    root?.symbol,
    payload?.requested_symbol,
    payload?.resolved_symbol,
    payload?.symbol
  ]
    .map(normalizeQuoteMatchValue)
    .filter(Boolean);

  if (!symbolCandidates.length) return true;
  return symbolCandidates.includes(expectedSymbol);
}

function getQuoteSubscriptionKey(item) {
  if (!item) return "";
  return `${String(item.category || "").trim().toLowerCase()}::${normalizeQuoteMatchValue(item.symbol)}`;
}

function payloadHasRenderableCandles(payload) {
  const root = getQuotePayloadRoot(payload);
  const candidates = [root?.candles, root?.history, payload?.candles, payload?.history];

  return candidates.some((candidate) => (
    Array.isArray(candidate) &&
    candidate.some((item) => (
      [item?.open, item?.high, item?.low, item?.close].every((value) => Number.isFinite(Number(value)))
    ))
  ));
}

function getRenderableCandleCount(payload) {
  const root = getQuotePayloadRoot(payload);
  const candidates = [root?.candles, root?.history, payload?.candles, payload?.history];

  let maxCount = 0;
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const renderableCount = candidate.filter((item) => (
      [item?.open, item?.high, item?.low, item?.close].every((value) => Number.isFinite(Number(value)))
    )).length;
    if (renderableCount > maxCount) {
      maxCount = renderableCount;
    }
  }

  return maxCount;
}

function getRenderableCandles(payload, limit = 64) {
  const root = getQuotePayloadRoot(payload);
  const candidates = [root?.candles, root?.history, payload?.candles, payload?.history];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const candles = candidate
      .map((item, index) => ({
        ts: Number(item?.ts ?? item?.time ?? item?.t ?? index) || index,
        open: Number(item?.open),
        high: Number(item?.high),
        low: Number(item?.low),
        close: Number(item?.close)
      }))
      .filter((item) => [item.open, item.high, item.low, item.close].every(Number.isFinite));
    if (candles.length) {
      return candles.slice(-Math.max(Number(limit) || 64, 8));
    }
  }

  return [];
}

function buildLiveChartImageDataUrl({ payload, symbol, marketLabel }) {
  const candles = getRenderableCandles(payload, 48);
  if (!candles.length) return "";

  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#162238");
  gradient.addColorStop(0.56, "#0c1422");
  gradient.addColorStop(1, "#070d16");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let x = 56; x < canvas.width - 34; x += 92) {
    ctx.fillRect(x, 96, 1, 390);
  }
  for (let y = 112; y <= 466; y += 72) {
    ctx.fillRect(40, y, 880, 1);
  }

  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const padding = Math.max((max - min) * 0.035, 0.000001);
  const scaledMin = min - padding;
  const scaledMax = max + padding;
  const range = Math.max(scaledMax - scaledMin, 0.000001);
  const plot = { left: 44, top: 94, width: 872, height: 392 };
  const yOf = (value) => plot.top + (1 - ((value - scaledMin) / range)) * plot.height;
  const step = plot.width / Math.max(candles.length, 1);
  const bodyWidth = Math.min(Math.max(step * 0.58, 8), 34);

  ctx.font = "800 22px Arial";
  ctx.fillStyle = "#f4f7ff";
  ctx.fillText(String(symbol || "Live chart"), 44, 42);
  ctx.font = "800 14px Arial";
  ctx.fillStyle = "#9ed7ff";
  ctx.fillText(String(marketLabel || "LIVE").toUpperCase(), 44, 64);

  candles.forEach((item, index) => {
    const x = plot.left + step * index + step / 2;
    const openY = yOf(item.open);
    const closeY = yOf(item.close);
    const highY = yOf(item.high);
    const lowY = yOf(item.low);
    const bullish = item.close >= item.open;
    ctx.strokeStyle = bullish ? "#62e56f" : "#ff6c5d";
    ctx.fillStyle = bullish ? "#57d955" : "#ff543f";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 6);
    ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  });

  ctx.strokeStyle = "rgba(128, 159, 216, 0.28)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(plot.left, plot.top, plot.width, plot.height);
  return canvas.toDataURL("image/png", 0.92);
}

function getAnalysisSignalTone(signal) {
  const normalized = String(signal || "").trim().toUpperCase();
  if (normalized === "BUY") return "buy";
  if (normalized === "SELL") return "sell";
  return "neutral";
}

function formatAnalysisExpiration(value) {
  const numeric = Number(value || 0);
  return numeric > 0 ? `${numeric} мин` : "—";
}

function formatAnalysisAsset(asset, marketMode) {
  const normalizedAsset = String(asset || "").trim() || "не определен";
  const normalizedMode = String(marketMode || "").trim().toUpperCase();
  if (normalizedAsset === "не определен") return normalizedAsset;
  if (normalizedMode === "OTC" && !/\bOTC\b/i.test(normalizedAsset)) {
    return `${normalizedAsset} OTC`;
  }
  return normalizedAsset;
}

function formatAnalysisPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  return numeric.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function formatSelectedExpirationLabel(selectedExpirationMeta, expirationValue) {
  return selectedExpirationMeta?.label || String(expirationValue || "").trim() || "—";
}

function getExpirationSeconds(value) {
  const raw = String(value || "").trim().toLowerCase();
  const match = raw.match(/^(\d+)\s*([smh])$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (match[2] === "s") return amount;
  if (match[2] === "m") return amount * 60;
  if (match[2] === "h") return amount * 60 * 60;
  return 0;
}

function formatCountdown(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const rest = Math.floor(total % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function getSettlementTone(outcome) {
  const value = String(outcome || "").trim().toLowerCase();
  if (value === "win") return "win";
  if (value === "loss") return "loss";
  if (value === "refund") return "refund";
  return "pending";
}

function getCountdownProgress(settlement) {
  if (!settlement || settlement.status !== "countdown") {
    return { elapsedPercent: 0, remainingPercent: 100 };
  }
  const total = Math.max(1, Number(settlement.totalSeconds || 0));
  const remaining = Math.max(0, Math.min(total, Number(settlement.remainingSeconds || 0)));
  const remainingPercent = Math.round((remaining / total) * 100);
  return {
    elapsedPercent: 100 - remainingPercent,
    remainingPercent
  };
}


export default function HomePage({ t, notify, featureFlags = {} }) {
  const [signalMode, setSignalMode] = useState("scanner");
  const [isSignalModeExpanded, setIsSignalModeExpanded] = useState(false);
  const [marketKind, setMarketKind] = useState("otc");
  const [pairs, setPairs] = useState([]);
  const [expirations, setExpirations] = useState(FALLBACK_EXPIRATIONS);
  const [asset, setAsset] = useState("");
  const [expiration, setExpiration] = useState("5m");
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [availableMarkets, setAvailableMarkets] = useState([]);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isLinkSheetOpen, setIsLinkSheetOpen] = useState(false);
  const [isInfoSheetOpen, setIsInfoSheetOpen] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState("");
  const [deviceProfile, setDeviceProfile] = useState(() => getDeviceProfile());
  const [pickerSheet, setPickerSheet] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [indicators, setIndicators] = useState(FALLBACK_INDICATORS);
  const [selectedIndicator, setSelectedIndicator] = useState(FALLBACK_INDICATORS[0]?.code || "rsi");
  const [quotesConfig, setQuotesConfig] = useState({
    enabled: true,
    websocket_url: "/api/ws/quotes",
    history_seconds: 300,
    replace_debounce_ms: 220
  });
  const [quoteState, setQuoteState] = useState({ status: "idle", detail: "" });
  const [quotePayload, setQuotePayload] = useState(null);
  const [quoteRenderReady, setQuoteRenderReady] = useState(false);
  const [scanUploadState, setScanUploadState] = useState({ status: "idle", file: null, detail: "" });
  const [scanPreview, setScanPreview] = useState({ url: "", status: "idle" });
  const [analysisMediaPreview, setAnalysisMediaPreview] = useState({ url: "", status: "idle" });
  const [isAnalysisScanning, setIsAnalysisScanning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisSettlement, setAnalysisSettlement] = useState({ status: "idle" });
  const [activeAnalyses, setActiveAnalyses] = useState([]);
  const [activeAnalysis, setActiveAnalysis] = useState(null);
  const [activeAnalysisRemaining, setActiveAnalysisRemaining] = useState(0);
  const [isActiveSignalsSheetOpen, setIsActiveSignalsSheetOpen] = useState(false);
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const analysisScanTimerRef = useRef(0);
  const settlementTimerRef = useRef(null);
  const settlementTokenRef = useRef("");
  const quoteClientRef = useRef(null);
  const currentQuoteSubscriptionRef = useRef(null);
  const quoteRenderReadyRef = useRef(false);
  const pendingQuotePayloadRef = useRef(null);
  const quoteUnlockTimerRef = useRef(null);
  const currentQuoteLoadKeyRef = useRef("");
  const lastQuoteSubscriptionKeyRef = useRef("");

  const quickActions = useMemo(
    () => [
      { id: "gallery", label: t.home.gallery || "Gallery", icon: GalleryIcon },
      ...(!deviceProfile.isDesktop ? [{ id: "camera", label: t.home.camera || "Camera", icon: CameraIcon }] : []),
      { id: "link", label: t.home.link || "Link", icon: LinkIcon }
    ],
    [deviceProfile.isDesktop, t.home]
  );

  const uploadAccept = "image/jpeg,image/png,image/webp,image/heic,image/heif";
  const analysisMediaPath = useMemo(() => {
    const historyPreviewPath = String(analysisResult?.history_item?.preview_path || "").trim();
    if (historyPreviewPath) return historyPreviewPath;

    const uploadId = Number(analysisResult?.upload?.id || analysisResult?.history_item?.upload_id || 0);
    return uploadId ? `/api/upload/scan/${encodeURIComponent(uploadId)}/preview` : "";
  }, [
    analysisResult?.history_item?.preview_path,
    analysisResult?.history_item?.upload_id,
    analysisResult?.upload?.id
  ]);

  const baseSignalModes = useMemo(
    () => [
      {
        id: "scanner",
        flagKey: "mode_scanner_enabled",
        label: t.home.signalModeScannerLabel || "Scanner",
        hint: t.home.signalModeScannerHint || "Screenshot + AI breakdown",
        icon: ScannerModeIcon
      },
      {
        id: "automatic",
        flagKey: "mode_ai_enabled",
        label: t.home.signalModeAutomaticLabel || "Automatic",
        hint: t.home.signalModeAutomaticHint || "AI drives the signal flow",
        icon: AutoModeIcon
      },
      {
        id: "indicators",
        flagKey: "mode_indicators_enabled",
        label: t.home.signalModeIndicatorsLabel || "Indicators",
        hint: t.home.signalModeIndicatorsHint || "Market, symbol and expiration",
        icon: IndicatorModeIcon
      }
    ],
    [t.home]
  );

  const signalModes = useMemo(
    () => baseSignalModes.filter((item) => Number(featureFlags?.[item.flagKey] ?? 1) === 1),
    [baseSignalModes, featureFlags]
  );

  useEffect(() => {
    if (!signalModes.length) return;
    if (!signalModes.some((item) => item.id === signalMode)) {
      setSignalMode(signalModes[0].id);
      setIsSignalModeExpanded(false);
    }
  }, [signalMode, signalModes]);

  const allowedMarkets = useMemo(
    () => (signalMode === "indicators" ? INDICATOR_MARKETS : BASIC_MARKETS),
    [signalMode]
  );

  const marketMap = useMemo(
    () => new Map(allowedMarkets.map((item) => [item.key, item])),
    [allowedMarkets]
  );

  useEffect(() => {
    if (!marketMap.has(marketKind)) {
      setMarketKind(allowedMarkets[0]?.key || "otc");
    }
  }, [allowedMarkets, marketKind, marketMap]);

  useEffect(() => {
    function refreshDeviceProfile() {
      setDeviceProfile(getDeviceProfile());
    }

    refreshDeviceProfile();
    window.addEventListener("resize", refreshDeviceProfile);
    window.Telegram?.WebApp?.onEvent?.("viewportChanged", refreshDeviceProfile);

    return () => {
      window.removeEventListener("resize", refreshDeviceProfile);
      window.Telegram?.WebApp?.offEvent?.("viewportChanged", refreshDeviceProfile);
    };
  }, []);

  useEffect(() => () => {
    if (analysisScanTimerRef.current) {
      window.clearTimeout(analysisScanTimerRef.current);
      analysisScanTimerRef.current = 0;
    }
    if (settlementTimerRef.current) {
      window.clearInterval(settlementTimerRef.current);
      settlementTimerRef.current = null;
    }
    settlementTokenRef.current = "";
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadActiveAnalysis() {
      try {
        const data = await apiFetchJson("/api/analysis/active");
        if (!isActive) return;
        const items = Array.isArray(data?.items) ? data.items : data?.item ? [data.item] : [];
        const item = items[0] || null;
        setActiveAnalyses(items);
        setActiveAnalysis(item);
        setActiveAnalysisRemaining(Number(item?.remaining_seconds ?? data?.remaining_seconds ?? 0));
      } catch (_error) {
        if (!isActive) return;
        setActiveAnalyses([]);
        setActiveAnalysis(null);
        setActiveAnalysisRemaining(0);
      }
    }

    loadActiveAnalysis();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeAnalysis?.id || activeAnalysisRemaining <= 0) return undefined;
    const timer = window.setInterval(() => {
      setActiveAnalysisRemaining((prev) => Math.max(0, Number(prev || 0) - 1));
      setActiveAnalyses((prev) =>
        prev.map((item) => ({
          ...item,
          remaining_seconds: Math.max(0, Number(item.remaining_seconds || 0) - 1)
        }))
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeAnalysis?.id, activeAnalysisRemaining, expiration]);

  useEffect(() => {
    if (!activeAnalysis?.id || activeAnalysisRemaining !== 0) return;
    setActiveAnalysisRemaining(-1);
    settleAnalysisResult(activeAnalysis.id, activeAnalysis.selected_expiration || expiration, "");
  }, [activeAnalysis?.id, activeAnalysisRemaining]);

  useEffect(() => {
    if (analysisSettlement.status !== "countdown") return;
    const currentItem = activeAnalyses.find((item) => Number(item.id) === Number(analysisSettlement.historyId || 0));
    if (!currentItem) return;
    setAnalysisSettlement((prev) => ({
      ...prev,
      remainingSeconds: Math.max(0, Number(currentItem.remaining_seconds || 0))
    }));
  }, [activeAnalyses, analysisSettlement.status, analysisSettlement.historyId]);

  useEffect(() => {
    if (analysisSettlement.status !== "countdown" || !analysisSettlement.historyId) return;
    const currentItem = activeAnalyses.find((item) => Number(item.id) === Number(analysisSettlement.historyId));
    if (!currentItem || Number(currentItem.remaining_seconds || 0) > 0) return;
    settleAnalysisResult(analysisSettlement.historyId, currentItem.selected_expiration || analysisSettlement.selectedExpiration || expiration, "");
  }, [activeAnalyses, analysisSettlement.historyId, analysisSettlement.selectedExpiration, analysisSettlement.status, expiration]);

  useEffect(() => {
    let isActive = true;

    async function loadLatestScanUpload() {
      try {
        const data = await apiFetchJson("/api/upload/scan/latest");
        if (!isActive || !data?.file) return;
        setScanUploadState({ status: "success", file: data.file, detail: "" });
      } catch (_error) {
        return;
      }
    }

    loadLatestScanUpload();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    let objectUrl = "";
    const uploadId = Number(scanUploadState.file?.id || 0);

    if (scanUploadState.status !== "success" || !uploadId) {
      setScanPreview({ url: "", status: "idle" });
      return undefined;
    }

    async function loadPreview() {
      setScanPreview({ url: "", status: "loading" });
      try {
        const response = await apiFetch(`/api/upload/scan/${encodeURIComponent(uploadId)}/preview`);
        if (!response.ok) {
          throw new Error("Preview request failed");
        }

        const blob = await response.blob();
        if (!isActive) return;

        objectUrl = URL.createObjectURL(blob);
        setScanPreview({ url: objectUrl, status: "ready" });
      } catch (_error) {
        if (isActive) {
          setScanPreview({ url: "", status: "error" });
        }
      }
    }

    loadPreview();

    return () => {
      isActive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [scanUploadState.file?.id, scanUploadState.status]);

  useEffect(() => {
    let isActive = true;
    let objectUrl = "";

    if (!analysisMediaPath) {
      setAnalysisMediaPreview({ url: "", status: "idle" });
      return undefined;
    }

    async function loadAnalysisMediaPreview() {
      setAnalysisMediaPreview({ url: "", status: "loading" });
      try {
        const response = await apiFetch(analysisMediaPath);
        if (!response.ok) {
          throw new Error("Analysis media preview request failed");
        }

        const blob = await response.blob();
        if (!isActive) return;

        objectUrl = URL.createObjectURL(blob);
        setAnalysisMediaPreview({ url: objectUrl, status: "ready" });
      } catch (_error) {
        if (isActive) {
          setAnalysisMediaPreview({ url: "", status: "error" });
        }
      }
    }

    loadAnalysisMediaPreview();

    return () => {
      isActive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [analysisMediaPath]);

  useEffect(() => {
    let isActive = true;

    async function loadOptions() {
      setIsLoading(true);
      setErrorText("");

      try {
        const data = await apiFetchJson(`/api/market/options?kind=${marketKind}`);
        if (!isActive) return;

        const nextPairs = Array.isArray(data?.pairs) ? data.pairs : [];
        const nextExp = mergeExpirationOptions(FALLBACK_EXPIRATIONS, data?.expirations);
        const nextMarkets = Array.isArray(data?.available_markets) ? data.available_markets : [];

        setPairs(nextPairs);
        setExpirations(nextExp);
        setAvailableMarkets(nextMarkets);
        if (data?.kind && data.kind !== marketKind) {
          setMarketKind(data.kind);
        }

        setAsset((prev) => {
          if (prev && nextPairs.some((item) => item?.pair === prev)) return prev;
          return nextPairs[0]?.pair || "";
        });

        setExpiration((prev) => {
          if (prev && nextExp.some((item) => item?.value === prev)) return prev;
          return nextExp[0]?.value || "5m";
        });
      } catch (error) {
        if (!isActive) return;
        setPairs([]);
        setExpirations(FALLBACK_EXPIRATIONS);
        setAvailableMarkets([]);
        setErrorText(error.message || "Failed to load market data");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadOptions();

    return () => {
      isActive = false;
    };
  }, [marketKind]);

  useEffect(() => {
    let isActive = true;

    async function loadIndicators() {
      try {
        const data = await apiFetchJson("/api/indicators/options");
        if (!isActive) return;
        const nextIndicators = Array.isArray(data?.items) && data.items.length > 0 ? data.items : FALLBACK_INDICATORS;
        setIndicators(nextIndicators);
        setSelectedIndicator((prev) => (
          prev && nextIndicators.some((item) => item?.code === prev)
            ? prev
            : (nextIndicators[0]?.code || FALLBACK_INDICATORS[0]?.code || "rsi")
        ));
      } catch (_error) {
        if (!isActive) return;
        setIndicators(FALLBACK_INDICATORS);
        setSelectedIndicator((prev) => prev || FALLBACK_INDICATORS[0]?.code || "rsi");
      }
    }

    loadIndicators();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadQuotesConfig() {
      try {
        const data = await apiFetchJson("/api/quotes/config");
        if (!isActive) return;
        setQuotesConfig({
          enabled: Boolean(data?.enabled),
          websocket_url: data?.websocket_url || "/api/ws/quotes",
          history_seconds: Number(data?.history_seconds) || 300,
          replace_debounce_ms: Number(data?.replace_debounce_ms) || 220
        });
      } catch (_error) {
        if (!isActive) return;
        setQuotesConfig((prev) => ({
          ...prev,
          enabled: false
        }));
      }
    }

    loadQuotesConfig();

    return () => {
      isActive = false;
    };
  }, []);

  const isAutomaticMode = signalMode === "automatic";

  const activeAvailableMarketKeys = useMemo(
    () => new Set(availableMarkets.map((item) => item.key).filter(Boolean)),
    [availableMarkets]
  );

  const basicMarkets = useMemo(
    () => (activeAvailableMarketKeys.size ? BASIC_MARKETS.filter((item) => activeAvailableMarketKeys.has(item.key)) : BASIC_MARKETS),
    [activeAvailableMarketKeys]
  );

  const indicatorMarkets = useMemo(() => {
    if (!availableMarkets.length) return INDICATOR_MARKETS;
    const labels = new Map(INDICATOR_MARKETS.map((item) => [item.key, item.label]));
    return availableMarkets
      .filter((item) => labels.has(item.key))
      .map((item) => ({
        key: item.key,
        label: labels.get(item.key) || item.title || item.key
      }));
  }, [availableMarkets]);

  const currentMarkets = signalMode === "indicators" ? indicatorMarkets : basicMarkets;
  useEffect(() => {
    if (currentMarkets.length && !currentMarkets.some((item) => item.key === marketKind)) {
      setMarketKind(currentMarkets[0].key);
    }
  }, [currentMarkets, marketKind]);

  const selectedMode = signalModes.find((item) => item.id === signalMode) || signalModes[0] || baseSignalModes[0];
  const SelectedModeIcon = selectedMode.icon;
  const selectedModeInfo = useMemo(() => ({
    scanner: {
      title: t.home.scannerInfoTitle || "SonicFX Scanner",
      body: t.home.scannerInfoBody || "Add a chart screenshot or image link. The algorithm will run technical analysis, detect market dynamics and build a signal from price structure and key levels."
    },
    automatic: {
      title: t.home.autoInfoTitle || "SonicFX Auto",
      body: t.home.autoInfoBody || "The live chart is processed in real time. The system analyzes price movement, market structure and key zones, forming signals when suitable conditions appear."
    },
    indicators: {
      title: t.home.indicatorsInfoTitle || "SonicFX Indicators",
      body: t.home.indicatorsInfoBody || "Configure indicators, ticker and expiration. The algorithm analyzes the market with selected tools and forms a recommendation from the current price structure."
    }
  }), [t.home]);
  const activeModeInfo = selectedModeInfo[signalMode] || selectedModeInfo.scanner;
  const isIndicatorsMode = signalMode === "indicators";
  const selectedPairMeta = pairs.find((item) => item?.pair === asset) || null;
  const selectedExpirationMeta = expirations.find((item) => item?.value === expiration) || null;
  const selectedIndicatorMeta = indicators.find((item) => item?.code === selectedIndicator) || indicators[0] || FALLBACK_INDICATORS[0];
  const selectedIndicatorDisplay = getIndicatorMeta(
    selectedIndicatorMeta?.code,
    selectedIndicatorMeta?.title,
    selectedIndicatorMeta?.description
  );
  const selectedIndicatorHint = getUniqueIndicatorDescription(
    selectedIndicatorMeta?.description,
    selectedIndicatorMeta?.title,
    selectedIndicatorDisplay.title
  );
  const actionLabel = signalMode === "automatic"
    ? (t.home.analyze || "Analyze")
    : signalMode === "indicators"
      ? (t.home.indicatorAction || "Get signal")
      : (t.home.analyze || "Analyze");

  const pairSearchValue = pickerSearch.trim().toLowerCase();
  const filteredPairs = pairSearchValue
    ? pairs.filter((item) => {
        const label = `${item?.pair || ""} ${typeof item?.payout === "number" ? `${item.payout}` : ""}`.toLowerCase();
        return label.includes(pairSearchValue);
      })
    : pairs;
  const filteredIndicators = pairSearchValue
    ? indicators.filter((item) => {
        const meta = getIndicatorMeta(item?.code, item?.title, item?.description);
        return `${item?.title || ""} ${item?.description || ""} ${item?.code || ""} ${meta.short} ${meta.title}`.toLowerCase().includes(pairSearchValue);
      })
    : indicators;

  const autoQuoteSubscription = useMemo(() => {
    if (!isAutomaticMode || analysisResult?.result) return [];
    const symbol = selectedPairMeta?.pair || asset;
    if (!symbol) return [];
    return [{
      category: marketKind,
      symbol,
      history_seconds: quotesConfig.history_seconds || 300
    }];
  }, [analysisResult?.result, asset, isAutomaticMode, marketKind, quotesConfig.history_seconds, selectedPairMeta]);

  useEffect(() => {
    currentQuoteSubscriptionRef.current = autoQuoteSubscription[0] || null;
  }, [autoQuoteSubscription]);

  useEffect(() => {
    quoteRenderReadyRef.current = quoteRenderReady;
  }, [quoteRenderReady]);

  useEffect(() => {
    if (!quotesConfig.enabled) {
      quoteClientRef.current?.destroy();
      quoteClientRef.current = null;
      setQuotePayload(null);
      setQuoteState({
        status: "error",
        detail: t.home.quoteUnavailable || "Quote stream is unavailable right now"
      });
      return undefined;
    }

    const client = new QuoteStreamClient({
      url: quotesConfig.websocket_url,
      historySeconds: quotesConfig.history_seconds,
      replaceDebounceMs: quotesConfig.replace_debounce_ms,
      onStateChange: (nextState) => setQuoteState(nextState),
      onEvent: (payload) => {
        const currentItem = currentQuoteSubscriptionRef.current;
        const eventName = String(payload?.event || "").trim().toLowerCase();

        if ((eventName === "quote" || eventName === "snapshot" || eventName === "subscribed") && matchesQuotePayload(payload, currentItem)) {
          if (!payloadHasRenderableCandles(payload)) {
            return;
          }

          pendingQuotePayloadRef.current = payload;
          if (!quoteRenderReadyRef.current) {
            if (quoteUnlockTimerRef.current) {
              window.clearTimeout(quoteUnlockTimerRef.current);
            }
            const subscriptionKey = getQuoteSubscriptionKey(currentItem);
            quoteUnlockTimerRef.current = window.setTimeout(() => {
              quoteUnlockTimerRef.current = null;
              if (quoteRenderReadyRef.current) return;

              const activeItem = currentQuoteSubscriptionRef.current;
              if (!activeItem || getQuoteSubscriptionKey(activeItem) !== subscriptionKey) {
                return;
              }

              const pendingPayload = pendingQuotePayloadRef.current;
              if (!pendingPayload || !matchesQuotePayload(pendingPayload, activeItem) || !payloadHasRenderableCandles(pendingPayload)) {
                return;
              }

              setQuotePayload(pendingPayload);
              setQuoteRenderReady(true);
              quoteRenderReadyRef.current = true;
              setQuoteState((prev) => (
                prev.status === "error"
                  ? prev
                  : { status: "ready", detail: "" }
              ));
            }, Math.max(180, quotesConfig.replace_debounce_ms || 220));
            return;
          }

          setQuotePayload(payload);
        }
        if (eventName === "unsubscribed" && !currentQuoteSubscriptionRef.current) {
          if (quoteUnlockTimerRef.current) {
            window.clearTimeout(quoteUnlockTimerRef.current);
            quoteUnlockTimerRef.current = null;
          }
          pendingQuotePayloadRef.current = null;
          setQuotePayload(null);
          setQuoteRenderReady(false);
          quoteRenderReadyRef.current = false;
        }
        if (eventName === "error") {
          setQuoteState({ status: "error", detail: payload?.detail || "Quote stream error" });
        }
      }
    });

    quoteClientRef.current = client;
    if (currentQuoteSubscriptionRef.current) {
      client.setSubscriptions([currentQuoteSubscriptionRef.current]);
    }

    const handleBeforeUnload = () => client.destroy();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (quoteUnlockTimerRef.current) {
        window.clearTimeout(quoteUnlockTimerRef.current);
        quoteUnlockTimerRef.current = null;
      }
      client.destroy();
      if (quoteClientRef.current === client) {
        quoteClientRef.current = null;
      }
    };
  }, [
    quotesConfig.enabled,
    quotesConfig.history_seconds,
    quotesConfig.replace_debounce_ms,
    quotesConfig.websocket_url,
    t.home.quoteUnavailable
  ]);

  useEffect(() => {
    let isActive = true;

    async function loadQuoteHistory() {
      if (!isAutomaticMode || !autoQuoteSubscription.length || !quotesConfig.enabled) {
        return;
      }

      const currentItem = autoQuoteSubscription[0];
      const requestKey = getQuoteSubscriptionKey(currentItem);
      currentQuoteLoadKeyRef.current = requestKey;
      try {
        const data = await apiFetchJson(
          `/api/quotes/history?category=${encodeURIComponent(currentItem.category)}&symbol=${encodeURIComponent(currentItem.symbol)}&history_seconds=${encodeURIComponent(currentItem.history_seconds || quotesConfig.history_seconds || 300)}`
        );
        if (!isActive) return;
        if (data && typeof data === "object" && matchesQuotePayload(data, currentItem) && payloadHasRenderableCandles(data)) {
          if (currentQuoteLoadKeyRef.current !== requestKey) {
            return;
          }
          if (quoteUnlockTimerRef.current) {
            window.clearTimeout(quoteUnlockTimerRef.current);
            quoteUnlockTimerRef.current = null;
          }
          const pendingPayload = pendingQuotePayloadRef.current;
          const nextPayload = (
            pendingPayload &&
            matchesQuotePayload(pendingPayload, currentItem) &&
            payloadHasRenderableCandles(pendingPayload) &&
            getRenderableCandleCount(pendingPayload) > getRenderableCandleCount(data)
          )
            ? pendingPayload
            : data;
          setQuotePayload(nextPayload);
          setQuoteRenderReady(true);
          quoteRenderReadyRef.current = true;
          pendingQuotePayloadRef.current = null;
          setQuoteState((prev) => (
            prev.status === "error"
              ? prev
              : { status: "ready", detail: "" }
          ));
        }
      } catch (_error) {
        if (!isActive) return;
      }
    }

    loadQuoteHistory();

    return () => {
      isActive = false;
    };
  }, [autoQuoteSubscription, isAutomaticMode, quotesConfig.enabled, quotesConfig.history_seconds]);

  useEffect(() => {
    const client = quoteClientRef.current;
    if (!client) return;

    if (isAutomaticMode && autoQuoteSubscription.length) {
      const currentItem = autoQuoteSubscription[0];
      const nextKey = getQuoteSubscriptionKey(currentItem);
      if (lastQuoteSubscriptionKeyRef.current !== nextKey) {
        lastQuoteSubscriptionKeyRef.current = nextKey;
        currentQuoteLoadKeyRef.current = nextKey;
        if (quoteUnlockTimerRef.current) {
          window.clearTimeout(quoteUnlockTimerRef.current);
          quoteUnlockTimerRef.current = null;
        }
        pendingQuotePayloadRef.current = null;
        setQuotePayload(null);
        setQuoteRenderReady(false);
        quoteRenderReadyRef.current = false;
        setQuoteState({ status: "loading", detail: t.home.quoteLoading || "Идет загрузка графика..." });
      }
      client.setSubscriptions(autoQuoteSubscription);
      return;
    }

    lastQuoteSubscriptionKeyRef.current = "";
    currentQuoteLoadKeyRef.current = "";
    if (quoteUnlockTimerRef.current) {
      window.clearTimeout(quoteUnlockTimerRef.current);
      quoteUnlockTimerRef.current = null;
    }
    pendingQuotePayloadRef.current = null;
    client.clearSubscriptions();
    setQuotePayload(null);
    setQuoteRenderReady(false);
    quoteRenderReadyRef.current = false;
    setQuoteState({ status: "idle", detail: "" });
  }, [autoQuoteSubscription, isAutomaticMode, t.home.quoteLoading]);

  function openPickerSheet(type) {
    setPickerSearch("");
    setPickerSheet(type);
  }

  function closePickerSheet() {
    setPickerSearch("");
    setPickerSheet(null);
  }

  function handleAutomaticZoneKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPickerSheet("asset");
    }
  }

  async function uploadScanFile(file, sourceType) {
    if (!file) return;
    setScanUploadState({ status: "uploading", file: null, detail: t.home.uploadingFile || "Uploading file..." });
    setErrorText("");

    const formData = new FormData();
    formData.append("source_type", sourceType);
    formData.append("file", file);

    try {
      const data = await apiFetchJson("/api/upload/scan", {
        method: "POST",
        body: formData
      });
      setScanUploadState({ status: "success", file: data?.file || null, detail: "" });
      clearSettlementTimer();
      setAnalysisResult(null);
      setAnalysisSettlement({ status: "idle" });
      notify?.({
        type: "success",
        title: t.home.uploadToastTitle || "Chart uploaded",
        message: t.home.uploadToastMessage || "You can start analysis now."
      });
    } catch (error) {
      const message = error.message || t.home.uploadFailed || "Unable to upload file";
      setScanUploadState({ status: "error", file: null, detail: message });
      setErrorText(message);
      notify?.({
        type: "error",
        title: t.home.uploadErrorToastTitle || "Upload failed",
        message
      });
    }
  }

  function handleScanFileInput(event, sourceType) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    uploadScanFile(file, sourceType);
  }

  async function uploadScanLink(url = linkInputValue) {
    const trimmedUrl = (url || "").trim();
    if (!trimmedUrl) return;

    setScanUploadState({ status: "uploading", file: null, detail: t.home.uploadingLink || "Checking link..." });
    setErrorText("");

    try {
      const data = await apiFetchJson("/api/upload/scan/link", {
        method: "POST",
        body: JSON.stringify({ url: trimmedUrl })
      });
      setScanUploadState({ status: "success", file: data?.file || null, detail: "" });
      clearSettlementTimer();
      setAnalysisResult(null);
      setAnalysisSettlement({ status: "idle" });
      setIsLinkSheetOpen(false);
      setLinkInputValue("");
      notify?.({
        type: "success",
        title: t.home.uploadToastTitle || "Chart uploaded",
        message: t.home.uploadToastMessage || "You can start analysis now."
      });
    } catch (error) {
      const message = error.message || t.home.linkUploadFailed || "Unable to download file from link";
      setScanUploadState({ status: "error", file: null, detail: message });
      setErrorText(message);
      notify?.({
        type: "error",
        title: t.home.uploadErrorToastTitle || "Upload failed",
        message
      });
    }
  }

  function closeLinkSheet() {
    if (scanUploadState.status === "uploading") return;
    setIsLinkSheetOpen(false);
  }

  function submitLinkUpload(event) {
    event.preventDefault();
    uploadScanLink();
  }

  function handleSourceAction(sourceId) {
    setIsActionSheetOpen(false);
    if (sourceId === "gallery") {
      galleryInputRef.current?.click();
      return;
    }
    if (sourceId === "camera") {
      cameraInputRef.current?.click();
      return;
    }
    if (sourceId === "link") {
      setLinkInputValue("");
      if (scanUploadState.status === "error") {
        setScanUploadState({ status: "idle", file: null, detail: "" });
      }
      setIsLinkSheetOpen(true);
    }
  }

  function replaceScanUpload() {
    if (scanUploadState.status === "uploading") return;
    setIsActionSheetOpen(true);
  }

  function clearSettlementTimer() {
    if (settlementTimerRef.current) {
      window.clearInterval(settlementTimerRef.current);
      settlementTimerRef.current = null;
    }
    settlementTokenRef.current = "";
  }

  async function settleAnalysisResult(historyId, selectedExpiration, token) {
    if (!historyId || (token && settlementTokenRef.current !== token)) return;
    setAnalysisSettlement((prev) => ({
      ...prev,
      status: "settling",
      remainingSeconds: 0
    }));
    try {
      const data = await apiFetchJson(`/api/analysis/history/${historyId}/settle`, {
        method: "POST",
        body: JSON.stringify({ selected_expiration: selectedExpiration })
      });
      if (token && settlementTokenRef.current !== token) return;
      const settlement = data?.settlement || data?.item?.settlement || null;
      setAnalysisSettlement({
        status: "settled",
        historyId,
        settlement,
        selectedExpiration
      });
      setAnalysisResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          history_item: data?.item || prev.history_item,
          result: {
            ...(prev.result || {}),
            settlement
          }
        };
      });
      const nextActiveItems = activeAnalyses.filter((item) => Number(item.id) !== Number(historyId));
      setActiveAnalyses(nextActiveItems);
      setActiveAnalysis(nextActiveItems[0] || null);
      setActiveAnalysisRemaining(Number(nextActiveItems[0]?.remaining_seconds || 0));
      notify?.({
        type: "success",
        title: settlement?.outcome_label || "Результат сделки готов",
        message: `Финальная цена: ${formatAnalysisPrice(settlement?.exit_price)}`
      });
    } catch (error) {
      if (token && settlementTokenRef.current !== token) return;
      setAnalysisSettlement((prev) => ({
        ...prev,
        status: "error",
        error: error.message || "Не удалось проверить результат сделки"
      }));
      notify?.({
        type: "error",
        title: "Не удалось проверить сделку",
        message: error.message || "Попробуйте открыть историю позже."
      });
    }
  }

  function startSettlementCountdown(data, selectedExpiration) {
    clearSettlementTimer();
    const result = data?.result || null;
    const signal = String(result?.signal || "").trim().toUpperCase();
    const historyId = Number(data?.history_item?.id || 0);
    const totalSeconds = getExpirationSeconds(selectedExpiration);

    if (!historyId || !["BUY", "SELL"].includes(signal) || totalSeconds <= 0) {
      setAnalysisSettlement({ status: "idle" });
      return;
    }

    const token = `${historyId}:${Date.now()}`;
    const endsAt = Date.now() + totalSeconds * 1000;
    settlementTokenRef.current = token;
    setAnalysisSettlement({
      status: "countdown",
      historyId,
      totalSeconds,
      remainingSeconds: totalSeconds,
      selectedExpiration
    });
    settlementTimerRef.current = window.setInterval(() => {
      const remainingSeconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setAnalysisSettlement((prev) => ({ ...prev, remainingSeconds }));
      if (remainingSeconds <= 0) {
        if (settlementTimerRef.current) {
          window.clearInterval(settlementTimerRef.current);
          settlementTimerRef.current = null;
        }
        settleAnalysisResult(historyId, selectedExpiration, token);
      }
    }, 1000);
  }

  async function resetScanUpload() {
    if (scanUploadState.status === "uploading") return;
    setErrorText("");
    clearSettlementTimer();
    try {
      await apiFetchJson("/api/upload/scan/latest", { method: "DELETE" });
    } catch (_error) {
      // The local reset still keeps the interface usable if the server is temporarily unavailable.
    }
    setAnalysisResult(null);
    setAnalysisSettlement({ status: "idle" });
    setScanUploadState({ status: "idle", file: null, detail: "" });
    notify?.({
      type: "info",
      title: t.home.uploadResetToastTitle || "Chart reset",
      message: t.home.uploadResetToastMessage || "Choose a new chart source when you are ready."
    });
  }

  async function startNewScannerAnalysis() {
    if (scanUploadState.status === "uploading") return;
    setErrorText("");
    clearSettlementTimer();
    try {
      await apiFetchJson("/api/upload/scan/latest", { method: "DELETE" });
    } catch (_error) {
      // Local reset is enough to return the user to the initial scanner state.
    }
    setAnalysisResult(null);
    setAnalysisSettlement({ status: "idle" });
    setScanPreview({ url: "", status: "idle" });
    setScanUploadState({ status: "idle", file: null, detail: "" });
    setSignalMode("scanner");
    setIsSignalModeExpanded(false);
    setIsActionSheetOpen(false);
    setIsLinkSheetOpen(false);
  }

  async function startNewAnalysis() {
    clearSettlementTimer();
    setAnalysisSettlement({ status: "idle" });
    if (signalMode === "automatic") {
      setAnalysisResult(null);
      setErrorText("");
      return;
    }
    await startNewScannerAnalysis();
  }

  function openActiveAnalysis(item = activeAnalysis) {
    if (!item) return;
    setIsActiveSignalsSheetOpen(false);
    const remainingSeconds = Math.max(0, Number(item.remaining_seconds ?? activeAnalysisRemaining ?? 0));
    const result = item.result && typeof item.result === "object"
      ? item.result
      : {
          signal: item.signal,
          asset: item.asset,
          market_mode: item.market_mode,
          entry_price: item.entry_price,
          confidence: item.confidence,
          expiration_minutes: item.expiration_minutes,
          comment: item.comment
        };
    setAnalysisResult({
      status: "success",
      result,
      history_item: item
    });
    setAnalysisSettlement({
      status: "countdown",
      historyId: item.id,
      totalSeconds: Math.max(0, remainingSeconds),
      remainingSeconds,
      selectedExpiration: item.selected_expiration || expiration
    });
  }

  function handleActiveAnalysisCardClick() {
    if (!activeAnalysis) return;
    if (activeAnalyses.length > 1) {
      setIsActiveSignalsSheetOpen(true);
      return;
    }
    openActiveAnalysis(activeAnalysis);
  }

  async function handleAnalyzeClick() {
    if (signalMode === "scanner" && !hasScanUploadPreview) {
      notify?.({
        type: "error",
        title: t.home.analyzeNoImageTitle || "Chart is not uploaded",
        message: t.home.analyzeNoImageMessage || "Upload a chart from gallery, camera or link before analysis."
      });
      return;
    }

    if (isAnalysisScanning) return;

    clearSettlementTimer();
    setIsAnalysisScanning(true);
    setAnalysisResult(null);
    setAnalysisSettlement({ status: "idle" });
    setErrorText("");

    try {
      const data = signalMode === "automatic"
        ? await (async () => {
            if (!quoteRenderReady || !payloadHasRenderableCandles(quotePayload)) {
              throw new Error(t.home.autoAnalyzeNoChartMessage || "Дождитесь загрузки live-графика перед анализом.");
            }
            const symbol = selectedPairMeta?.pair || asset;
            if (!symbol) {
              throw new Error(t.home.autoAnalyzeNoPairMessage || "Выберите валютную пару для Auto-анализа.");
            }
            const marketLabel = currentMarkets.find((item) => item.key === marketKind)?.label || marketKind.toUpperCase();
            const imageDataUrl = buildLiveChartImageDataUrl({
              payload: quotePayload,
              symbol,
              marketLabel
            });
            if (!imageDataUrl) {
              throw new Error(t.home.autoAnalyzeNoChartMessage || "Дождитесь загрузки live-графика перед анализом.");
            }
            return apiFetchJson("/api/analyze/auto", {
              method: "POST",
              body: JSON.stringify({
                category: marketKind,
                symbol,
                image_data_url: imageDataUrl,
                selected_expiration: expiration
              })
            });
          })()
        : signalMode === "indicators"
          ? await (async () => {
              const symbol = selectedPairMeta?.pair || asset;
              if (!symbol) {
                throw new Error(t.home.autoAnalyzeNoPairMessage || "Выберите валютную пару для анализа.");
              }
              if (!selectedIndicatorMeta?.code) {
                throw new Error(t.home.indicatorSearchEmpty || "Выберите индикатор для сигнала.");
              }
              return apiFetchJson("/api/analyze/indicators", {
                method: "POST",
                body: JSON.stringify({
                  category: marketKind,
                  symbol,
                  indicator_code: selectedIndicatorMeta.code,
                  selected_expiration: expiration
                })
              });
            })()
          : await apiFetchJson("/api/analyze/scanner", {
            method: "POST",
            body: JSON.stringify({
              upload_id: scanUploadState.file?.id || null,
              selected_expiration: expiration
            })
          });
      setAnalysisResult(data || null);
      if (data?.history_item && ["BUY", "SELL"].includes(String(data?.history_item?.signal || data?.result?.signal || "").toUpperCase())) {
        const nextItem = {
          ...data.history_item,
          remaining_seconds: getExpirationSeconds(expiration)
        };
        setActiveAnalyses((prev) => [nextItem, ...prev.filter((item) => Number(item.id) !== Number(nextItem.id))]);
        setActiveAnalysis(nextItem);
        setActiveAnalysisRemaining(Number(nextItem.remaining_seconds || 0));
      }
      startSettlementCountdown(data || null, expiration);
    } catch (error) {
      notify?.({
        type: "error",
        title: t.home.analyzeFailedTitle || "Не удалось завершить анализ",
        message: error.message || t.home.analyzeFailedMessage || "Попробуйте еще раз через несколько секунд."
      });
    } finally {
      setIsAnalysisScanning(false);
      analysisScanTimerRef.current = 0;
    }
  }

  const scanUploadFileLabel = scanUploadState.file?.original_name || scanUploadState.file?.public_path || "";
  const hasScanUploadPreview = !isIndicatorsMode && scanUploadState.status === "success" && Boolean(scanUploadState.file);
  const scanUploadTitle = scanUploadState.status === "uploading"
    ? (t.home.uploadingFile || "Uploading file...")
    : scanUploadState.status === "success"
      ? (t.home.uploadSaved || "File saved")
      : (t.home.upload || "Upload chart");
  const scanUploadHint = scanUploadState.status === "success"
    ? (scanUploadFileLabel || t.home.uploadSavedHint || "Ready for analysis")
    : scanUploadState.status === "error"
      ? (scanUploadState.detail || t.home.uploadFailed || "Upload failed")
      : (t.home.uploadHint || "JPG, PNG or HEIC");
  const scanUploadSubhint = scanUploadState.status === "success"
    ? (t.home.uploadSavedHint || "Path saved on the server")
    : scanUploadState.status === "uploading"
      ? (t.home.uploadingHint || "Please wait, we are saving the chart")
      : (t.home.sourceHint || "Choose a chart source");
  const analysisSummary = analysisResult?.result || null;
  const analysisSignalTone = getAnalysisSignalTone(analysisSummary?.signal);
  const analysisTitle = analysisSummary?.status === "graph_not_found"
    ? (t.home.analysisGraphNotFoundTitle || "График не обнаружен")
    : analysisSummary?.signal || "NO TRADE";
  const analysisAssetLabel = formatAnalysisAsset(analysisSummary?.asset, analysisSummary?.market_mode);
  const analysisPriceLabel = formatAnalysisPrice(analysisSummary?.entry_price);
  const selectedExpirationLabel = formatSelectedExpirationLabel(selectedExpirationMeta, expiration);
  const displayedSettlement = analysisSettlement.status !== "idle"
    ? analysisSettlement
    : analysisSummary?.settlement
      ? { status: "settled", settlement: analysisSummary.settlement }
      : { status: "idle" };
  const settlementCountdownProgress = getCountdownProgress(displayedSettlement);
  const displayedSettlementOutcome = String(displayedSettlement.settlement?.outcome || "").trim().toLowerCase();
  const shouldShowConfetti = displayedSettlement.status === "settled" && displayedSettlementOutcome === "win";
  const shouldShowLossAnimation = displayedSettlement.status === "settled" && displayedSettlementOutcome === "loss";
  const isNoTradeResult = String(analysisSummary?.signal || "").trim().toUpperCase() === "NO TRADE";
  const activeAnalysisSignalTone = getAnalysisSignalTone(activeAnalysis?.signal);
  const activeAnalysisAssetLabel = activeAnalysis
    ? formatAnalysisAsset(activeAnalysis.asset, activeAnalysis.market_mode)
    : "";
  const activeAnalysisCount = activeAnalyses.length;
  const shouldShowActiveAnalysisCard = Boolean(activeAnalysis?.id && !analysisSummary);

  function renderSettlementCard() {
    if (isNoTradeResult) {
      return (
        <article className="analysis-result-card analysis-settlement-card settlement-advice">
          <span>Рекомендация</span>
          <strong>Советуем вам выбрать другую валютную пару.</strong>
        </article>
      );
    }
    if (displayedSettlement.status === "idle") return null;
    return (
      <article className={`analysis-result-card analysis-settlement-card settlement-${getSettlementTone(displayedSettlement.settlement?.outcome)}`}>
        {displayedSettlement.status === "countdown" ? (
          <>
            <div className="deal-timer-head">
              <span>Таймер сделки</span>
              <strong>{formatCountdown(displayedSettlement.remainingSeconds)}</strong>
            </div>
            <div
              className="deal-timer-flow"
              style={{ "--deal-progress": `${settlementCountdownProgress.remainingPercent}%` }}
            >
              <span className="deal-timer-percent left">{settlementCountdownProgress.remainingPercent}%</span>
              <div className="deal-timer-track" aria-hidden="true">
                <span className="deal-timer-line green" />
                <span className="deal-timer-pin" />
                <span className="deal-timer-line red" />
              </div>
              <span className="deal-timer-percent right">{settlementCountdownProgress.elapsedPercent}%</span>
            </div>
            <small className="analysis-result-subcopy">Финальную цену проверим после экспирации</small>
          </>
        ) : (
          <div className="analysis-settlement-summary">
            <div className="analysis-settlement-copy">
              <span>
                {displayedSettlement.status === "settling"
                  ? "Проверка сделки"
                  : displayedSettlement.status === "error"
                    ? "Проверка сделки"
                    : "Результат сделки"}
              </span>
              <strong>
                {displayedSettlement.status === "settling"
                  ? "Проверяем..."
                  : displayedSettlement.status === "error"
                    ? "Ошибка"
                    : displayedSettlement.settlement?.outcome_label || "Готово"}
              </strong>
              <small className="analysis-result-subcopy">
                {displayedSettlement.status === "settling"
                  ? "Запрашиваем свежую цену актива"
                  : displayedSettlement.status === "error"
                    ? (displayedSettlement.error || "Не удалось получить финальную цену")
                    : `Финал: ${formatAnalysisPrice(displayedSettlement.settlement?.exit_price)}`}
              </small>
            </div>
            {shouldShowConfetti ? (
              <div className="analysis-outcome-badge analysis-trophy-badge" aria-hidden="true">
                <Lottie animationData={trophyAnimation} loop={false} autoplay />
              </div>
            ) : null}
            {shouldShowLossAnimation ? (
              <div className="analysis-outcome-badge analysis-loss-badge" aria-hidden="true">
                <Lottie animationData={lossSignAnimation} loop={false} autoplay />
              </div>
            ) : null}
          </div>
        )}
      </article>
    );
  }

  function renderAnalysisResultPanel({ showMedia = true } = {}) {
    if (!analysisSummary) return null;
    const mediaUrl = analysisMediaPath ? analysisMediaPreview.url : scanPreview.url;
    const handleMediaError = () => {
      if (analysisMediaPath) {
        setAnalysisMediaPreview((prev) => ({ ...prev, url: "", status: "error" }));
        return;
      }
      setScanPreview((prev) => ({ ...prev, url: "", status: "error" }));
    };

    return (
      <div className="upload-zone analysis-result-panel">
        {shouldShowConfetti ? (
          <div className="analysis-confetti-layer" aria-hidden="true">
            <Lottie animationData={confettiAnimation} loop={false} autoplay />
          </div>
        ) : null}
        <div className="analysis-result-sheet analysis-result-sheet-inline" role="region" aria-label={t.home.analysisSheetTitle || "Результат анализа"}>
          {showMedia && mediaUrl ? (
            <div className="upload-preview-media analysis-result-media">
              <img
                className="upload-preview-backdrop"
                src={mediaUrl}
                alt=""
                aria-hidden="true"
              />
              <img
                className="upload-preview-image"
                src={mediaUrl}
                alt={t.home.uploadPreviewAlt || "Uploaded chart"}
                onError={handleMediaError}
              />
            </div>
          ) : null}

          <div className="analysis-result-hero">
            <div className="analysis-result-copy">
              <small>
                {analysisSummary.status === "graph_not_found"
                  ? (t.home.analysisGraphNotFoundHint || "Загрузите более читаемый скриншот с ценой, свечами и шкалой.")
                  : (analysisSummary.comment || t.home.analysisResultHint || "Сигнал подготовлен по текущей структуре цены.")}
              </small>
            </div>
            <span className={`analysis-result-signal signal-${analysisSignalTone}`}>
              {analysisSummary.status === "graph_not_found" ? "NO DATA" : (analysisSummary.signal || "NO TRADE")}
            </span>
          </div>

          {analysisSummary.status !== "graph_not_found" ? (
            <>
              {renderSettlementCard()}
              <div className="analysis-result-grid">
                <article className="analysis-result-card">
                  <span>{t.home.analysisAssetLabel || "Актив"}</span>
                  <strong>{analysisAssetLabel}</strong>
                </article>
                <article className="analysis-result-card">
                  <span>{t.home.analysisPriceLabel || "Цена"}</span>
                  <strong>{analysisPriceLabel}</strong>
                </article>
                <article className="analysis-result-card">
                  <span>{t.home.analysisConfidenceLabel || "Уверенность"}</span>
                  <strong>{Number(analysisSummary.confidence || 0)}%</strong>
                </article>
                <article className="analysis-result-card">
                  <span>{t.home.analysisExpirationLabel || "Экспирация"}</span>
                  <strong>{selectedExpirationLabel}</strong>
                  <small className="analysis-result-subcopy">
                    {(t.home.analysisExpirationRecommendationPrefix || "ИИ рекомендует")}: {formatAnalysisExpiration(analysisSummary.expiration_minutes)}
                  </small>
                </article>
              </div>
            </>
          ) : (
            <div className="analysis-result-empty">
              <strong>{t.home.analysisGraphNotFoundTitle || "График не обнаружен"}</strong>
              <p>{t.home.analysisGraphNotFoundHint || "Попробуйте загрузить более четкий скриншот, где видны свечи, движение цены и шкала."}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="page page-home-ref">
      <input
        ref={galleryInputRef}
        className="scan-file-input"
        type="file"
        accept={uploadAccept}
        onChange={(event) => handleScanFileInput(event, "gallery")}
      />
      <input
        ref={cameraInputRef}
        className="scan-file-input"
        type="file"
        accept={uploadAccept}
        capture="environment"
        onChange={(event) => handleScanFileInput(event, "camera")}
      />

      <div className="home-quota">
        <div className="quota-left">
          <SparkIcon className="quota-left-icon" aria-hidden="true" />
          <span>{t.home.quota || "Analyses: 3 / 3"}</span>
        </div>
        <button className="quota-btn quota-btn-upgrade" type="button" aria-label={t.home.pro || "Get PRO"}>
          <span className="quota-upgrade-animation" aria-hidden="true">
            <Lottie animationData={upgradeAnimation} loop autoplay />
          </span>
          <span className="quota-upgrade-text">{t.home.pro || "Upgrade to PRO"}</span>
        </button>
      </div>

      {shouldShowActiveAnalysisCard ? (
        <article className={`active-analysis-card signal-${activeAnalysisSignalTone}`}>
          <div className="active-analysis-main">
            <span className="active-analysis-kicker">
              {activeAnalysisCount > 1 ? `Активных сигналов: ${activeAnalysisCount}` : "Анализ 1"}
            </span>
            <strong>{activeAnalysisCount > 1 ? "Выберите сигнал" : activeAnalysisAssetLabel}</strong>
            <small>
              {activeAnalysisCount > 1
                ? `${activeAnalysisAssetLabel} · ${String(activeAnalysis.signal || "").toUpperCase()}`
                : `Цена ${formatAnalysisPrice(activeAnalysis.entry_price)} · ${String(activeAnalysis.signal || "").toUpperCase()}`}
            </small>
          </div>
          <div className="active-analysis-side">
            <b>{activeAnalysisRemaining > 0 ? formatCountdown(activeAnalysisRemaining) : "Проверяем"}</b>
            <button type="button" onClick={handleActiveAnalysisCardClick}>
              {activeAnalysisCount > 1 ? "Выбрать" : "Открыть"}
            </button>
          </div>
        </article>
      ) : null}

      {isActiveSignalsSheetOpen && (
        <div className="action-sheet-layer" role="presentation">
          <button
            className="action-sheet-backdrop"
            type="button"
            aria-label={t.home.close || "Close"}
            onClick={() => setIsActiveSignalsSheetOpen(false)}
          />
          <div className="action-sheet active-signals-sheet" role="dialog" aria-modal="true" aria-label="Активные сигналы">
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="action-sheet-head active-signals-head">
              <div className="action-sheet-title">Активные сигналы</div>
              <div className="action-sheet-copy">Выберите сделку, которую хотите открыть сейчас.</div>
            </div>
            <div className="active-signals-list">
              {activeAnalyses.map((item, index) => {
                const tone = getAnalysisSignalTone(item.signal);
                const label = formatAnalysisAsset(item.asset, item.market_mode);
                const remaining = Math.max(0, Number(item.remaining_seconds || 0));
                return (
                  <article className={`active-signal-option signal-${tone}`} key={item.id || index}>
                    <div className="active-signal-option-main">
                      <span>Анализ {index + 1}</span>
                      <strong>{label}</strong>
                      <small>
                        Цена {formatAnalysisPrice(item.entry_price)} · {String(item.signal || "").toUpperCase()}
                      </small>
                    </div>
                    <div className="active-signal-option-side">
                      <b>{remaining > 0 ? formatCountdown(remaining) : "Проверяем"}</b>
                      <button type="button" onClick={() => openActiveAnalysis(item)}>Открыть</button>
                    </div>
                  </article>
                );
              })}
            </div>
            <button className="action-sheet-close" type="button" onClick={() => setIsActiveSignalsSheetOpen(false)}>
              {t.home.close || "Close"}
            </button>
          </div>
        </div>
      )}

      {isAutomaticMode && analysisSummary ? (
        renderAnalysisResultPanel({ showMedia: true })
      ) : isAutomaticMode ? (
        <>
          <div
            className="live-quote-stage"
            role="button"
            tabIndex={0}
            onClick={() => openPickerSheet("asset")}
            onKeyDown={handleAutomaticZoneKeyDown}
          >
            <LiveQuoteChart
              symbol={selectedPairMeta?.pair || asset || (t.home.quoteAwaitPair || "Choose a pair")}
              marketLabel={currentMarkets.find((item) => item.key === marketKind)?.label || marketKind.toUpperCase()}
              payload={quoteRenderReady ? quotePayload : null}
              state={quoteState}
            />
            <ScanAnalysisOverlay
              isActive={isAnalysisScanning}
              label={t.home.scanAnalysisLabel || "Scanning chart"}
            />
          </div>
        </>
      ) : analysisSummary ? (
        renderAnalysisResultPanel({ showMedia: true })
      ) : hasScanUploadPreview ? (
        <div className="upload-zone upload-zone-preview">
          <div className="upload-preview-media">
            {scanPreview.url ? (
              <>
                <img
                  className="upload-preview-backdrop"
                  src={scanPreview.url}
                  alt=""
                  aria-hidden="true"
                />
                <img
                  className="upload-preview-image"
                  src={scanPreview.url}
                  alt={t.home.uploadPreviewAlt || "Uploaded chart"}
                  onError={() => setScanPreview((prev) => ({ ...prev, url: "", status: "error" }))}
                />
              </>
            ) : (
              <div className={`upload-preview-placeholder ${scanPreview.status === "error" ? "error" : ""}`}>
                {scanPreview.status === "error"
                  ? (t.home.uploadPreviewUnavailable || "Preview unavailable")
                  : (t.home.uploadPreviewLoading || "Preparing preview...")}
              </div>
            )}
            <ScanAnalysisOverlay
              isActive={isAnalysisScanning}
              label={t.home.scanAnalysisLabel || "Scanning chart"}
            />
          </div>

          <div className="upload-preview-actions">
            <button className="upload-preview-btn replace" type="button" onClick={replaceScanUpload}>
              {t.home.replaceUpload || "Replace"}
            </button>
            <button className="upload-preview-btn reset" type="button" onClick={resetScanUpload}>
              {t.home.resetUpload || "Reset"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className={`upload-zone ${isIndicatorsMode ? "upload-zone-indicator" : ""}`}
          type="button"
          onClick={() => (isIndicatorsMode ? openPickerSheet("indicator") : setIsActionSheetOpen(true))}
        >
          <span className="frame-corner tl" />
          <span className="frame-corner tr" />
          <span className="frame-corner bl" />
          <span className="frame-corner br" />

          {isIndicatorsMode ? (
            <>
              <div className="upload-icon" aria-hidden="true">
                <IndicatorModeIcon />
              </div>
            <div className="upload-indicator-hero">
              <span className={`indicator-inline-code tone-${selectedIndicatorDisplay.tone}`}>{selectedIndicatorDisplay.short}</span>
              <div className="upload-title">{selectedIndicatorDisplay.title}</div>
            </div>
            {selectedIndicatorHint ? <div className="upload-hint">{selectedIndicatorHint}</div> : null}
            <div className="upload-subhint">{t.home.indicatorZoneHint || "Tap to choose an indicator"}</div>
            </>
          ) : (
          <>
            <div className="upload-icon" aria-hidden="true">
              <UploadScanAnimation />
            </div>
            <div className="upload-title">{scanUploadTitle}</div>
            <div className={`upload-hint ${scanUploadState.status === "error" ? "upload-hint-error" : ""}`}>{scanUploadHint}</div>
            <div className="upload-subhint">{scanUploadSubhint}</div>
          </>
          )}
        </button>
      )}

      {!analysisSummary && (
        <div className="signal-panel">
          <button
            className={`signal-panel-toggle ${isSignalModeExpanded ? "expanded" : ""}`}
            type="button"
            onClick={() => setIsSignalModeExpanded((prev) => !prev)}
          >
            <span className="signal-panel-toggle-copy">
              <span className="signal-panel-label">{t.home.signalModeLabel || "Signal generation mode"}</span>
              <span className="signal-panel-selected">
                <span className="signal-panel-selected-icon" aria-hidden="true">
                  <SelectedModeIcon />
                </span>
                <span className="signal-panel-selected-text">
                  <strong>{selectedMode.label}</strong>
                  <small>{selectedMode.hint}</small>
                </span>
              </span>
            </span>
            <span className="signal-panel-toggle-meta">
              <span className="signal-panel-state">{isSignalModeExpanded ? (t.home.signalModeCollapse || "Collapse") : (t.home.signalModeChoose || "Choose")}</span>
              <span className={`signal-panel-chevron ${isSignalModeExpanded ? "expanded" : ""}`} aria-hidden="true" />
            </span>
          </button>

          {isSignalModeExpanded && (
            <div className="signal-mode-grid">
              {signalModes.filter((item) => item.id !== signalMode).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className="signal-mode-card"
                    onClick={() => { setSignalMode(item.id); setIsSignalModeExpanded(false); }}
                    type="button"
                  >
                    <span className="signal-mode-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="signal-mode-text">
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </span>
                    <span className="signal-mode-cta">{t.home.signalModeChoose || "Choose"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className={`analysis-action-row ${analysisSummary ? "is-result-state" : ""}`} aria-label={t.home.quickActionsLabel || "Quick actions"}>
        {!analysisSummary && (
          <button
            type="button"
            className="home-quick-action analysis-side-action"
            onClick={() => notify?.({
              type: "info",
              title: t.home.historyActionTitle || "История",
              message: t.home.historyActionMessage || "История сигналов появится здесь."
            })}
            aria-label={t.home.historyActionTitle || "История"}
          >
            <img src={homeHistoryIcon} alt="" loading="lazy" aria-hidden="true" />
          </button>
        )}
        <button
          className={`primary-btn ref-primary primary-btn-top primary-btn-scanner ${analysisSummary ? "is-reset-mode" : ""}`}
          type="button"
          onClick={analysisSummary ? startNewAnalysis : handleAnalyzeClick}
          disabled={isAnalysisScanning}
        >
          <span>{analysisSummary ? (t.home.newAnalysis || "Новый анализ") : actionLabel}</span>
          {!analysisSummary && <AnalyzeCtaAnimation />}
        </button>
        {!analysisSummary && (
          <button
            type="button"
            className="home-quick-action analysis-side-action"
            onClick={() => setIsInfoSheetOpen(true)}
            aria-label={t.home.infoActionTitle || "Инфо"}
          >
            <img src={homeInfoIcon} alt="" loading="lazy" aria-hidden="true" />
          </button>
        )}
      </div>

      {!analysisSummary && (
        <div className="card form-card ref-form-card generator-panel">
          <div className={`field-row ${signalMode === "indicators" ? "field-row-indicators" : ""} ${signalMode === "scanner" ? "field-row-scanner" : ""}`}>
            {signalMode !== "scanner" && (
              <div className="field-grow">
                <label className="field-label">{t.home.asset || "Symbol"}</label>
                <button
                  type="button"
                  className="field-input ref-input field-picker-trigger"
                  onClick={() => openPickerSheet("asset")}
                >
                  <span className="field-picker-copy">
                    <strong>
                      {selectedPairMeta
                        ? `${selectedPairMeta.pair}${typeof selectedPairMeta.payout === "number" ? ` (${selectedPairMeta.payout}%)` : ""}`
                        : isLoading
                          ? (t.home.loading || "Loading...")
                          : (t.home.emptyPairs || "No pairs available")}
                    </strong>
                    <small>{t.home.assetPickerHint || "Tap to choose a currency pair"}</small>
                  </span>
                  <span className="field-picker-chevron" aria-hidden="true" />
                </button>
              </div>
            )}

            {signalMode === "scanner" ? (
              <div className="field-grow expiration-inline-picker">
                <label className="field-label">{t.home.expiration || "Expiration"}</label>
                <div className="expiration-inline-grid" role="group" aria-label={t.home.expiration || "Expiration"}>
                  {expirations.map((item) => {
                    const isActive = expiration === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        className={`expiration-inline-btn ${isActive ? "active" : ""}`}
                        onClick={() => setExpiration(item.value)}
                        aria-pressed={isActive}
                      >
                        {item.label || item.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="field-mini">
                <label className="field-label">{t.home.expiration || "Expiration"}</label>
                <button
                  type="button"
                  className="field-input ref-input field-picker-trigger field-picker-trigger-mini"
                  onClick={() => openPickerSheet("expiration")}
                >
                  <span className="field-picker-copy">
                    <strong>{selectedExpirationMeta?.label || expiration || "5m"}</strong>
                    <small>{t.home.expirationPickerHint || "Choose time"}</small>
                  </span>
                  <span className="field-picker-chevron" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {errorText && <div className="form-error">{errorText}</div>}
        </div>
      )}

      {isInfoSheetOpen && (
        <div className="action-sheet-layer" role="presentation">
          <button
            className="action-sheet-backdrop"
            type="button"
            aria-label={t.home.close || "Close"}
            onClick={() => setIsInfoSheetOpen(false)}
          />
          <div className="action-sheet mode-info-sheet" role="dialog" aria-modal="true" aria-label={activeModeInfo.title}>
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="mode-info-hero">
              <span className="mode-info-icon" aria-hidden="true">
                <SelectedModeIcon />
              </span>
              <div className="mode-info-copy">
                <strong>{activeModeInfo.title}</strong>
                <small>{selectedMode.hint}</small>
              </div>
            </div>
            <p className="mode-info-text">{activeModeInfo.body}</p>
            <div className="mode-info-disclaimer">
              {t.home.modeInfoDisclaimer || "Сигнал носит информационный характер и не является гарантией результата сделки."}
            </div>
            <button className="action-sheet-close" type="button" onClick={() => setIsInfoSheetOpen(false)}>
              {t.home.close || "Close"}
            </button>
          </div>
        </div>
      )}

      {isActionSheetOpen && (
        <div className="action-sheet-layer" role="presentation">
          <button
            className="action-sheet-backdrop"
            type="button"
            aria-label={t.home.close || "Close"}
            onClick={() => setIsActionSheetOpen(false)}
          />
          <div className="action-sheet" role="dialog" aria-modal="true" aria-label={t.home.sourceSheetTitle || "Upload source"}>
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="action-sheet-head">
              <div className="action-sheet-title">{t.home.sourceSheetTitle || "Upload source"}</div>
              <div className="action-sheet-copy">{t.home.sourceSheetHint || "Choose how to upload the chart."}</div>
            </div>

            <div className="action-sheet-grid">
              {quickActions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className="action-sheet-option"
                    type="button"
                    onClick={() => handleSourceAction(item.id)}
                    disabled={scanUploadState.status === "uploading"}
                  >
                    <span className="action-sheet-option-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="action-sheet-option-copy">
                      <strong>{item.label}</strong>
                      <small>
                        {item.id === "gallery"
                          ? (t.home.sourceGalleryHint || "Choose file")
                          : item.id === "camera"
                            ? (t.home.sourceCameraHint || "Take a shot")
                            : (t.home.sourceLinkHint || "Paste URL")}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>

            <button className="action-sheet-close" type="button" onClick={() => setIsActionSheetOpen(false)}>
              {t.home.close || "Close"}
            </button>
          </div>
        </div>
      )}

      {isLinkSheetOpen && (
        <div className="action-sheet-layer" role="presentation">
          <button
            className="action-sheet-backdrop"
            type="button"
            aria-label={t.home.close || "Close"}
            onClick={closeLinkSheet}
          />
          <form className="action-sheet link-upload-sheet" role="dialog" aria-modal="true" aria-label={t.home.linkSheetTitle || t.home.link || "Link"} onSubmit={submitLinkUpload}>
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="action-sheet-head">
              <div className="action-sheet-title">{t.home.linkSheetTitle || "Upload by link"}</div>
              <div className="action-sheet-copy">{t.home.linkSheetHint || "Paste a direct chart image link. We will check and save it on the server."}</div>
            </div>

            <label className="link-upload-field">
              <span>{t.home.link || "Link"}</span>
              <input
                value={linkInputValue}
                onChange={(event) => setLinkInputValue(event.target.value)}
                placeholder={t.home.linkInputPlaceholder || "https://example.com/chart.png"}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                disabled={scanUploadState.status === "uploading"}
              />
            </label>

            {scanUploadState.status === "error" && scanUploadState.detail ? (
              <div className="link-upload-error">{scanUploadState.detail}</div>
            ) : null}

            <div className="link-upload-actions">
              <button className="action-sheet-close link-upload-cancel" type="button" onClick={closeLinkSheet}>
                {t.home.close || "Close"}
              </button>
              <button className="link-upload-submit" type="submit" disabled={scanUploadState.status === "uploading" || !linkInputValue.trim()}>
                {scanUploadState.status === "uploading" ? (t.home.uploadingLink || "Checking link...") : (t.home.linkUploadAction || "Save link")}
              </button>
            </div>
          </form>
        </div>
      )}

      {pickerSheet && (
        <div className="action-sheet-layer" role="presentation">
          <button
            className="action-sheet-backdrop"
            type="button"
            aria-label={t.home.close || "Close"}
            onClick={closePickerSheet}
          />
          <div
            className={`action-sheet picker-sheet ${
              pickerSheet === "asset"
                ? "picker-sheet-assets"
                : pickerSheet === "indicator"
                  ? "picker-sheet-indicators"
                  : "picker-sheet-expirations"
            }`}
            role="dialog"
            aria-modal="true"
            aria-label={pickerSheet === "asset"
              ? (t.home.assetSheetTitle || "Currency pairs")
              : pickerSheet === "indicator"
                ? (t.home.indicatorSheetTitle || "Indicators")
                : (t.home.expirationSheetTitle || "Expiration time")}
          >
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="action-sheet-head">
              <div className="action-sheet-title">
                {pickerSheet === "asset"
                  ? (t.home.assetSheetTitle || "Currency pairs")
                  : pickerSheet === "indicator"
                    ? (t.home.indicatorSheetTitle || "Indicators")
                    : (t.home.expirationSheetTitle || "Expiration time")}
              </div>
              <div className="action-sheet-copy">
                {pickerSheet === "asset"
                  ? (t.home.assetSheetHint || "Choose an active pair from the locally synced list.")
                  : pickerSheet === "indicator"
                    ? (t.home.indicatorSheetHint || "Choose the indicator used for the signal.")
                    : (t.home.expirationSheetHint || "Choose the time used for the signal.")}
              </div>
            </div>

            {pickerSheet === "asset" && (
              <div className={`market-chip-grid picker-market-grid ${signalMode === "indicators" ? "indicators" : "basic"}`} aria-label={t.home.marketLabel || "Market"}>
                {currentMarkets.map((item) => (
                  <button
                    key={item.key}
                    className={`market-chip picker-market-chip ${marketKind === item.key ? "active" : ""}`}
                    onClick={() => {
                      setMarketKind(item.key);
                      setPickerSearch("");
                    }}
                    type="button"
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}

            {(pickerSheet === "asset" || pickerSheet === "indicator") && (
              <div className="picker-search-wrap">
                <input
                  className="field-input ref-input picker-search-input"
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder={pickerSheet === "asset"
                    ? (t.home.assetSearchPlaceholder || "Search pair, for example AUD or EUR/USD")
                    : (t.home.indicatorSearchPlaceholder || "Search indicator, for example RSI or MACD")}
                />
              </div>
            )}

            <div className={`picker-sheet-list ${pickerSheet === "expiration" ? "cards-grid compact-grid" : "cards-grid"}`}>
              {(pickerSheet === "asset" ? filteredPairs : pickerSheet === "indicator" ? filteredIndicators : expirations).map((item) => {
                const isPair = pickerSheet === "asset";
                const isIndicator = pickerSheet === "indicator";
                const isActive = isPair ? asset === item.pair : isIndicator ? selectedIndicator === item.code : expiration === item.value;
                const indicatorMeta = isIndicator ? getIndicatorMeta(item.code, item.title, item.description) : null;
                const indicatorDescription = isIndicator
                  ? getUniqueIndicatorDescription(item.description, item.title, indicatorMeta.title)
                  : "";
                const title = isPair
                  ? `${item.pair}${typeof item.payout === "number" ? ` (${item.payout}%)` : ""}`
                  : isIndicator
                    ? indicatorMeta.title
                    : item.label;
                return (
                  <button
                    key={isPair ? item.pair : isIndicator ? item.code : item.value}
                    className={`action-sheet-option picker-sheet-option ${isActive ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      if (isPair) {
                        setAsset(item.pair);
                      } else if (isIndicator) {
                        setSelectedIndicator(item.code);
                      } else {
                        setExpiration(item.value);
                      }
                      closePickerSheet();
                    }}
                  >
                    <span className="action-sheet-option-copy">
                      {isIndicator ? (
                        <span className="indicator-option-line">
                          <span className={`indicator-inline-code tone-${indicatorMeta.tone}`}>{indicatorMeta.short}</span>
                          <span className="indicator-option-copy">
                            <strong>{title}</strong>
                            {indicatorDescription ? <small>{indicatorDescription}</small> : null}
                          </span>
                        </span>
                      ) : (
                        <strong>{title}</strong>
                      )}
                    </span>
                  </button>
                );
              })}

              {(pickerSheet === "asset" || pickerSheet === "indicator") && (pickerSheet === "asset" ? filteredPairs.length === 0 : filteredIndicators.length === 0) && (
                <div className="picker-sheet-empty">
                  {pickerSheet === "asset"
                    ? (isLoading ? (t.home.loading || "Loading...") : (t.home.assetSearchEmpty || "Nothing found for this query."))
                    : (t.home.indicatorSearchEmpty || "No indicator found for this query.")}
                </div>
              )}
            </div>

            <button className="action-sheet-close" type="button" onClick={closePickerSheet}>
              {t.home.close || "Close"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
