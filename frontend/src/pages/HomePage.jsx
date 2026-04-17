import { useEffect, useMemo, useRef, useState } from "react";
import {
  AutoModeIcon,
  CameraIcon,
  GalleryIcon,
  IndicatorModeIcon,
  LinkIcon,
  ScannerModeIcon,
  SparkIcon
} from "../components/AppIcons";
import lightningCtaIcon from "../assets/cta-lightning.png";
import LiveQuoteChart from "../components/LiveQuoteChart";
import UploadScanAnimation from "../components/UploadScanAnimation";
import { apiFetchJson } from "../lib/api";
import { getIndicatorMeta } from "../lib/indicatorMeta";
import { QuoteStreamClient } from "../lib/quoteStream";

const FALLBACK_EXPIRATIONS = [
  { value: "5s", label: "5s" },
  { value: "15s", label: "15s" },
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" }
];

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
  { code: "keltner_channel", title: "Keltner Channel", description: "ATR-based channel" },
  { code: "supertrend", title: "SuperTrend", description: "Trend-following overlay" },
  { code: "parabolic_sar", title: "Parabolic SAR", description: "Stop and reverse trend marker" },
  { code: "vortex", title: "Vortex", description: "Directional trend strength" },
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


export default function HomePage({ t }) {
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
  const quoteClientRef = useRef(null);

  const quickActions = [
    { id: "gallery", label: t.home.gallery || "Gallery", icon: GalleryIcon },
    { id: "camera", label: t.home.camera || "Camera", icon: CameraIcon },
    { id: "link", label: t.home.link || "Link", icon: LinkIcon }
  ];

  const signalModes = useMemo(
    () => [
      {
        id: "scanner",
        label: t.home.signalModeScannerLabel || "Scanner",
        hint: t.home.signalModeScannerHint || "Screenshot + AI breakdown",
        icon: ScannerModeIcon
      },
      {
        id: "automatic",
        label: t.home.signalModeAutomaticLabel || "Automatic",
        hint: t.home.signalModeAutomaticHint || "AI drives the signal flow",
        icon: AutoModeIcon
      },
      {
        id: "indicators",
        label: t.home.signalModeIndicatorsLabel || "Indicators",
        hint: t.home.signalModeIndicatorsHint || "Market, symbol and expiration",
        icon: IndicatorModeIcon
      }
    ],
    [t.home]
  );

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
    let isActive = true;

    async function loadOptions() {
      setIsLoading(true);
      setErrorText("");

      try {
        const data = await apiFetchJson(`/api/market/options?kind=${marketKind}`);
        if (!isActive) return;

        const nextPairs = Array.isArray(data?.pairs) ? data.pairs : [];
        const nextExp = Array.isArray(data?.expirations) && data.expirations.length > 0
          ? data.expirations
          : FALLBACK_EXPIRATIONS;
        const nextMarkets = Array.isArray(data?.available_markets) ? data.available_markets : [];

        setPairs(nextPairs);
        setExpirations(nextExp);
        setAvailableMarkets(nextMarkets);

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

  const currentMarkets = signalMode === "indicators" ? indicatorMarkets : BASIC_MARKETS;
  const selectedMode = signalModes.find((item) => item.id === signalMode) || signalModes[0];
  const SelectedModeIcon = selectedMode.icon;
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
    ? (t.home.automaticAction || "Start auto mode")
    : signalMode === "indicators"
      ? (t.home.indicatorAction || "Get signal")
      : (t.home.analyze || "Analyze");

  const configTitle = signalMode === "automatic"
    ? (t.home.automaticConfigTitle || "Automatic flow")
    : signalMode === "indicators"
      ? (t.home.indicatorsConfigTitle || "Indicator mode")
      : (t.home.scannerConfigTitle || "Scanner settings");

  const configHint = signalMode === "automatic"
    ? (t.home.automaticConfigHint || "We will pick the asset and timing for the automated scenario.")
    : signalMode === "indicators"
      ? (t.home.indicatorsConfigHint || "Choose market, symbol and expiration for the manual signal.")
      : (t.home.scannerConfigHint || "Scanner stays the primary mode and works together with chart upload.");

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
    if (!isAutomaticMode) return [];
    const symbol = selectedPairMeta?.pair || asset;
    if (!symbol) return [];
    return [{
      category: marketKind,
      symbol,
      history_seconds: quotesConfig.history_seconds || 300
    }];
  }, [asset, isAutomaticMode, marketKind, quotesConfig.history_seconds, selectedPairMeta]);

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
        const eventName = String(payload?.event || "").trim().toLowerCase();
        if (eventName === "quote" || eventName === "snapshot" || eventName === "subscribed") {
          setQuotePayload(payload);
        }
        if (eventName === "unsubscribed" && !isAutomaticMode) {
          setQuotePayload(null);
        }
        if (eventName === "error") {
          setQuoteState({ status: "error", detail: payload?.detail || "Quote stream error" });
        }
      }
    });

    quoteClientRef.current = client;
    if (autoQuoteSubscription.length) {
      client.setSubscriptions(autoQuoteSubscription);
    }

    const handleBeforeUnload = () => client.destroy();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      client.destroy();
      if (quoteClientRef.current === client) {
        quoteClientRef.current = null;
      }
    };
  }, [
    autoQuoteSubscription,
    isAutomaticMode,
    quotesConfig.enabled,
    quotesConfig.history_seconds,
    quotesConfig.replace_debounce_ms,
    quotesConfig.websocket_url,
    t.home.quoteUnavailable
  ]);

  useEffect(() => {
    const client = quoteClientRef.current;
    if (!client) return;

    if (isAutomaticMode && autoQuoteSubscription.length) {
      client.setSubscriptions(autoQuoteSubscription);
      return;
    }

    client.clearSubscriptions();
    setQuotePayload(null);
    setQuoteState({ status: "idle", detail: "" });
  }, [autoQuoteSubscription, isAutomaticMode]);

  function openPickerSheet(type) {
    setPickerSearch("");
    setPickerSheet(type);
  }

  function closePickerSheet() {
    setPickerSearch("");
    setPickerSheet(null);
  }

  return (
    <section className="page page-home-ref">
      <div className="home-quota">
        <div className="quota-left">
          <SparkIcon className="quota-left-icon" aria-hidden="true" />
          <span>{t.home.quota || "Analyses: 3 / 3"}</span>
        </div>
        <button className="quota-btn" type="button">
          {t.home.pro || "Get PRO"}
        </button>
      </div>

      <button
        className={`upload-zone ${isIndicatorsMode ? "upload-zone-indicator" : isAutomaticMode ? "upload-zone-live" : ""}`}
        type="button"
        onClick={() => (isIndicatorsMode ? openPickerSheet("indicator") : isAutomaticMode ? openPickerSheet("asset") : setIsActionSheetOpen(true))}
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
        ) : isAutomaticMode ? (
          <LiveQuoteChart
            symbol={selectedPairMeta?.pair || asset || (t.home.quoteAwaitPair || "Choose a pair")}
            marketLabel={currentMarkets.find((item) => item.key === marketKind)?.label || marketKind.toUpperCase()}
            payload={quotePayload}
            state={quoteState}
            title={t.home.automaticChartTitle || "Live quote stream"}
            hint={quoteState?.detail || t.home.automaticChartHint || "Live chart preview for the selected pair"}
          />
        ) : (
          <>
            <div className="upload-icon" aria-hidden="true">
              <UploadScanAnimation />
            </div>
            <div className="upload-title">{t.home.upload || "Upload chart"}</div>
            <div className="upload-hint">{t.home.uploadHint || "JPG, PNG or HEIC"}</div>
            <div className="upload-subhint">{t.home.sourceHint || "Choose a chart source"}</div>
          </>
        )}
      </button>

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

      <button className="primary-btn ref-primary primary-btn-top primary-btn-scanner" type="button">
        <span>{actionLabel}</span>
        <img className="primary-btn-icon primary-btn-icon-accent" src={lightningCtaIcon} alt="" loading="lazy" aria-hidden="true" />
      </button>

      <div className="card form-card ref-form-card generator-panel">
        <div className="generator-panel-head">
          <div className="generator-panel-copy">
            <strong>{configTitle}</strong>
            <span>{configHint}</span>
          </div>
          <span className="generator-panel-badge">{selectedMode.label}</span>
        </div>

        <label className="field-label">{t.home.marketLabel || "Market"}</label>
        <div className={`market-chip-grid ${signalMode === "indicators" ? "indicators" : "basic"}`}>
          {currentMarkets.map((item) => (
            <button
              key={item.key}
              className={`market-chip ${marketKind === item.key ? "active" : ""}`}
              onClick={() => setMarketKind(item.key)}
              type="button"
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className={`field-row ${signalMode === "indicators" ? "field-row-indicators" : ""}`}>
          <div className="field-grow">
            <label className="field-label">{t.home.asset || "Symbol"}</label>
            <button
              type="button"
              className="field-input ref-input field-picker-trigger"
              onClick={() => openPickerSheet("asset")}
              disabled={isLoading || pairs.length === 0}
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
        </div>

        {errorText && <div className="form-error">{errorText}</div>}
      </div>

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
                    onClick={() => setIsActionSheetOpen(false)}
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
                    ? (t.home.assetSearchEmpty || "Nothing found for this query.")
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
