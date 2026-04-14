import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../lib/api";

const MODE_OPTIONS = [
  { id: "otc", label: "OTC" },
  { id: "forex", label: "Forex" }
];

const FALLBACK_EXPIRATIONS = [
  { value: "5s", label: "5s" },
  { value: "15s", label: "15s" },
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" }
];

export default function HomePage({ t }) {
  const [kind, setKind] = useState("forex");
  const [pairs, setPairs] = useState([]);
  const [expirations, setExpirations] = useState(FALLBACK_EXPIRATIONS);
  const [asset, setAsset] = useState("");
  const [expiration, setExpiration] = useState("5m");
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let isActive = true;
    async function loadOptions() {
      setIsLoading(true);
      setErrorText("");
      try {
        const data = await apiFetchJson(`/api/market/options?kind=${kind}`);
        if (!isActive) return;

        const nextPairs = Array.isArray(data?.pairs) ? data.pairs : [];
        const nextExp = Array.isArray(data?.expirations) && data.expirations.length > 0
          ? data.expirations
          : FALLBACK_EXPIRATIONS;

        setPairs(nextPairs);
        setExpirations(nextExp);

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
        setErrorText(error.message || "Failed to load market data");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadOptions();
    return () => {
      isActive = false;
    };
  }, [kind]);

  const quickExpirations = useMemo(() => expirations.slice(0, 6), [expirations]);

  return (
    <section className="page page-home-ref">
      <div className="home-quota">
        <div className="quota-left">⚡ Анализов: 3 / 3</div>
        <button className="quota-btn" type="button">Получить PRO</button>
      </div>

      <h1 className="home-title">{t.home.title || "Загрузите скриншот графика"}</h1>
      <p className="home-subtitle">{t.home.sub || "AI анализ за 30 секунд"}</p>

      <button className="upload-zone" type="button">
        <span className="frame-corner tl" />
        <span className="frame-corner tr" />
        <span className="frame-corner bl" />
        <span className="frame-corner br" />
        <div className="upload-icon">⌗</div>
        <div className="upload-title">Загрузите график</div>
        <div className="upload-hint">JPG, PNG или HEIC</div>
      </button>

      <div className="quick-actions">
        <button className="quick-action" type="button"><span>🖼</span><em>Галерея</em></button>
        <button className="quick-action" type="button"><span>📷</span><em>Камера</em></button>
        <button className="quick-action" type="button"><span>🔗</span><em>Ссылка</em></button>
      </div>

      <div className="card form-card ref-form-card">
        <label className="field-label">{t.home.mode || "Режим анализа"}</label>
        <div className="mode-toggle">
          {MODE_OPTIONS.map((item) => (
            <button
              key={item.id}
              className={`mode-btn ${kind === item.id ? "active" : ""}`}
              onClick={() => setKind(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="field-row">
          <div className="field-grow">
            <label className="field-label">{t.home.asset || "Тикер"}</label>
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="field-input ref-input"
              disabled={isLoading || pairs.length === 0}
            >
              {pairs.length === 0 && <option value="">{isLoading ? "Загрузка..." : "Нет доступных пар"}</option>}
              {pairs.map((item) => (
                <option key={item.pair} value={item.pair}>
                  {item.pair}{typeof item.payout === "number" ? ` (${item.payout}%)` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field-mini">
            <label className="field-label">{t.home.expiration || "Экспирация"}</label>
            <select
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
              className="field-input ref-input"
            >
              {expirations.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="tf-chip-row">
          {quickExpirations.map((item) => (
            <button
              key={item.value}
              className={`tf-chip ${expiration === item.value ? "active" : ""}`}
              onClick={() => setExpiration(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        {errorText && <div className="form-error">{errorText}</div>}
        <button className="primary-btn ref-primary" type="button">⚡ {t.home.analyze || "Анализировать"}</button>
      </div>
    </section>
  );
}
