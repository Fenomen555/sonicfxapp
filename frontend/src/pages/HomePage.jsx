import { useEffect, useMemo, useState } from "react";
import {
  AutoModeIcon,
  CameraIcon,
  GalleryIcon,
  IndicatorModeIcon,
  LinkIcon,
  ScannerModeIcon,
  SparkIcon
} from "../components/AppIcons";
import UploadScanAnimation from "../components/UploadScanAnimation";
import { apiFetchJson } from "../lib/api";

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

const SIGNAL_MODES = [
  {
    id: "scanner",
    label: "Сканер",
    hint: "Скриншот + AI разбор",
    icon: ScannerModeIcon
  },
  {
    id: "automatic",
    label: "Автоматический",
    hint: "AI ведет поток сигнала",
    icon: AutoModeIcon
  },
  {
    id: "indicators",
    label: "Индикаторы",
    hint: "Рынок, тикер и экспирация",
    icon: IndicatorModeIcon
  }
];

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

  const quickActions = [
    { id: "gallery", label: t.home.gallery || "Gallery", icon: GalleryIcon },
    { id: "camera", label: t.home.camera || "Camera", icon: CameraIcon },
    { id: "link", label: t.home.link || "Link", icon: LinkIcon }
  ];

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
  const selectedMode = SIGNAL_MODES.find((item) => item.id === signalMode) || SIGNAL_MODES[0];
  const SelectedModeIcon = selectedMode.icon;
  const selectedPairMeta = pairs.find((item) => item?.pair === asset) || null;
  const selectedExpirationMeta = expirations.find((item) => item?.value === expiration) || null;
  const actionLabel = signalMode === "automatic"
    ? "Запустить авто режим"
    : signalMode === "indicators"
      ? "Получить сигнал"
      : (t.home.analyze || "Анализировать");

  const configTitle = signalMode === "automatic"
    ? "Автоматический поток"
    : signalMode === "indicators"
      ? "Режим по индикаторам"
      : "Параметры сканера";

  const configHint = signalMode === "automatic"
    ? "Подберем актив и время для автоматического сценария."
    : signalMode === "indicators"
      ? "Выберите рынок, тикер и экспирацию для ручного сигнала."
      : "Сканер остается главным режимом и работает вместе с загрузкой графика.";

  const pairSearchValue = pickerSearch.trim().toLowerCase();
  const filteredPairs = pairSearchValue
    ? pairs.filter((item) => {
        const label = `${item?.pair || ""} ${typeof item?.payout === "number" ? `${item.payout}` : ""}`.toLowerCase();
        return label.includes(pairSearchValue);
      })
    : pairs;

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

      <button className="upload-zone" type="button" onClick={() => setIsActionSheetOpen(true)}>
        <span className="frame-corner tl" />
        <span className="frame-corner tr" />
        <span className="frame-corner bl" />
        <span className="frame-corner br" />

        <div className="upload-icon" aria-hidden="true">
          <UploadScanAnimation />
        </div>
        <div className="upload-title">{t.home.upload || "Upload chart"}</div>
        <div className="upload-hint">{t.home.uploadHint || "JPG, PNG or HEIC"}</div>
        <div className="upload-subhint">{t.home.sourceHint || "Выберите источник загрузки"}</div>
      </button>

      <div className="signal-panel">
        <button
          className={`signal-panel-toggle ${isSignalModeExpanded ? "expanded" : ""}`}
          type="button"
          onClick={() => setIsSignalModeExpanded((prev) => !prev)}
        >
          <span className="signal-panel-toggle-copy">
            <span className="signal-panel-label">{t.home.signalModeLabel || "Режим генерации сигнала"}</span>
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
            <span className="signal-panel-state">{isSignalModeExpanded ? "Свернуть" : "Выбрать"}</span>
            <span className={`signal-panel-chevron ${isSignalModeExpanded ? "expanded" : ""}`} aria-hidden="true" />
          </span>
        </button>

        {isSignalModeExpanded && (
          <div className="signal-mode-grid">
            {SIGNAL_MODES.filter((item) => item.id !== signalMode).map((item) => {
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
                  <span className="signal-mode-cta">Выбрать</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button className="primary-btn ref-primary primary-btn-top primary-btn-scanner" type="button">
        <SparkIcon className="primary-btn-icon" aria-hidden="true" />
        <span>{actionLabel}</span>
      </button>

      <div className="card form-card ref-form-card generator-panel">
        <div className="generator-panel-head">
          <div className="generator-panel-copy">
            <strong>{configTitle}</strong>
            <span>{configHint}</span>
          </div>
          <span className="generator-panel-badge">{selectedMode.label}</span>
        </div>

        <label className="field-label">{t.home.marketLabel || "Рынок"}</label>
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
                <small>{t.home.assetPickerHint || "Нажмите, чтобы выбрать валютную пару"}</small>
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
                <small>{t.home.expirationPickerHint || "Выбрать время"}</small>
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
            aria-label="Закрыть выбор источника"
            onClick={() => setIsActionSheetOpen(false)}
          />
          <div className="action-sheet" role="dialog" aria-modal="true" aria-label="Выбор источника">
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="action-sheet-head">
              <div className="action-sheet-title">Источник загрузки</div>
              <div className="action-sheet-copy">Откройте график из галереи, камеры или вставьте ссылку.</div>
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
                          ? "Выбрать файл"
                          : item.id === "camera"
                            ? "Сделать снимок"
                            : "Вставить URL"}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>

            <button className="action-sheet-close" type="button" onClick={() => setIsActionSheetOpen(false)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {pickerSheet && (
        <div className="action-sheet-layer" role="presentation">
          <button
            className="action-sheet-backdrop"
            type="button"
            aria-label="Закрыть выбор"
            onClick={closePickerSheet}
          />
          <div
            className={`action-sheet picker-sheet ${pickerSheet === "asset" ? "picker-sheet-assets" : "picker-sheet-expirations"}`}
            role="dialog"
            aria-modal="true"
            aria-label={pickerSheet === "asset" ? "Выбор валютной пары" : "Выбор экспирации"}
          >
            <div className="action-sheet-handle" aria-hidden="true" />
            <div className="action-sheet-head">
              <div className="action-sheet-title">
                {pickerSheet === "asset" ? (t.home.assetSheetTitle || "Валютные пары") : (t.home.expirationSheetTitle || "Время экспирации")}
              </div>
              <div className="action-sheet-copy">
                {pickerSheet === "asset"
                  ? (t.home.assetSheetHint || "Выберите активную пару из локально синхронизированного списка.")
                  : (t.home.expirationSheetHint || "Выберите время, которое будем использовать для сигнала.")}
              </div>
            </div>

            {pickerSheet === "asset" && (
              <div className="picker-search-wrap">
                <input
                  className="field-input ref-input picker-search-input"
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder={t.home.assetSearchPlaceholder || "Поиск пары, например AUD или EUR/USD"}
                />
              </div>
            )}

            <div className={`picker-sheet-list ${pickerSheet === "asset" ? "cards-grid" : "cards-grid compact-grid"}`}>
              {(pickerSheet === "asset" ? filteredPairs : expirations).map((item) => {
                const isPair = pickerSheet === "asset";
                const isActive = isPair ? asset === item.pair : expiration === item.value;
                const title = isPair
                  ? `${item.pair}${typeof item.payout === "number" ? ` (${item.payout}%)` : ""}`
                  : item.label;
                return (
                  <button
                    key={isPair ? item.pair : item.value}
                    className={`action-sheet-option picker-sheet-option ${isActive ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      if (isPair) {
                        setAsset(item.pair);
                      } else {
                        setExpiration(item.value);
                      }
                      closePickerSheet();
                    }}
                  >
                    <span className="action-sheet-option-copy">
                      <strong>{title}</strong>
                    </span>
                  </button>
                );
              })}

              {pickerSheet === "asset" && filteredPairs.length === 0 && (
                <div className="picker-sheet-empty">
                  {t.home.assetSearchEmpty || "Ничего не найдено по этому запросу."}
                </div>
              )}
            </div>

            <button className="action-sheet-close" type="button" onClick={closePickerSheet}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
