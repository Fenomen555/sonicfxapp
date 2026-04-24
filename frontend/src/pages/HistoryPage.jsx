import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiFetchJson } from "../lib/api";

function getLocale(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "uk") return "uk-UA";
  return "ru-RU";
}

function formatHistoryDate(value, lang) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(getLocale(lang), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatHistoryPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return numeric.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function formatHistoryAsset(asset, marketMode) {
  const normalizedAsset = String(asset || "").trim() || "не определен";
  const normalizedMode = String(marketMode || "").trim().toUpperCase();
  if (normalizedAsset === "не определен") return normalizedAsset;
  if (normalizedMode === "OTC" && !/\bOTC\b/i.test(normalizedAsset)) return `${normalizedAsset} OTC`;
  return normalizedAsset;
}

function getSignalTone(signal) {
  const value = String(signal || "").trim().toLowerCase();
  if (value === "buy") return "buy";
  if (value === "sell") return "sell";
  return "neutral";
}

function getHistoryCopy(lang) {
  const ru = {
    title: "История анализов",
    subtitle: "Последние 20 анализов",
    lead: "Scanner и Live сохраняются здесь после каждого анализа.",
    loading: "Загружаем историю...",
    error: "Не удалось загрузить историю",
    retry: "Повторить",
    empty: "История пока пустая",
    emptyHint: "Запустите анализ скрина или live-графика, и запись появится здесь.",
    archived: "Файл уже в архиве",
    noPreview: "Превью недоступно",
    scanner: "Scanner",
    auto: "Live",
    total: "Всего",
    close: "Закрыть",
    openMedia: "Открыть изображение",
    price: "Цена",
    confidence: "Уверенность",
    expiration: "Экспирация",
    aiExpiration: "ИИ"
  };
  if (lang === "en") {
    return {
      ...ru,
      title: "Analysis History",
      subtitle: "Last 20 analyses",
      lead: "Scanner and Live results are saved here after every analysis.",
      loading: "Loading history...",
      error: "Could not load history",
      retry: "Retry",
      empty: "History is empty",
      emptyHint: "Run screenshot or live chart analysis and it will appear here.",
      archived: "File archived",
      noPreview: "Preview unavailable",
      total: "Total",
      close: "Close",
      openMedia: "Open image",
      price: "Price",
      confidence: "Confidence",
      expiration: "Expiration",
      aiExpiration: "AI"
    };
  }
  if (lang === "uk") {
    return {
      ...ru,
      title: "Історія аналізів",
      subtitle: "Останні 20 аналізів",
      lead: "Scanner і Live зберігаються тут після кожного аналізу.",
      loading: "Завантажуємо історію...",
      error: "Не вдалося завантажити історію",
      retry: "Повторити",
      empty: "Історія поки порожня",
      emptyHint: "Запустіть аналіз скрина або live-графіка, і запис з'явиться тут.",
      archived: "Файл уже в архіві",
      noPreview: "Прев'ю недоступне",
      total: "Усього",
      close: "Закрити",
      openMedia: "Відкрити зображення",
      price: "Ціна",
      confidence: "Впевненість",
      expiration: "Експірація",
      aiExpiration: "ШІ"
    };
  }
  return ru;
}

export default function HistoryPage({ lang = "ru" }) {
  const copy = useMemo(() => getHistoryCopy(lang), [lang]);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [previewUrls, setPreviewUrls] = useState({});
  const [openPreview, setOpenPreview] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const summary = useMemo(() => {
    const scanner = items.filter((item) => item?.source_type !== "auto").length;
    const live = items.filter((item) => item?.source_type === "auto").length;
    return { total: items.length, scanner, live };
  }, [items]);

  useEffect(() => {
    let isActive = true;
    const objectUrls = [];

    async function loadHistory() {
      setStatus("loading");
      setPreviewUrls((prev) => {
        Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      try {
        const data = await apiFetchJson("/api/analysis/history?limit=20");
        if (!isActive) return;
        const nextItems = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
        setItems(nextItems);
        setStatus("ready");

        const previews = {};
        await Promise.all(nextItems.map(async (item) => {
          if (!item?.preview_path || !item?.upload_id) return;
          try {
            const response = await apiFetch(item.preview_path);
            if (!response.ok) return;
            const blob = await response.blob();
            if (!isActive) return;
            const objectUrl = URL.createObjectURL(blob);
            objectUrls.push(objectUrl);
            previews[item.id] = objectUrl;
          } catch {
            // Archived files stay readable in metadata; preview can be unavailable after retention.
          }
        }));
        if (isActive) setPreviewUrls(previews);
      } catch {
        if (!isActive) return;
        setItems([]);
        setStatus("error");
      }
    }

    loadHistory();

    return () => {
      isActive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [reloadKey]);

  return (
    <section className="page page-history page-history-ref">
      <div className="history-page-head">
        <span className="history-kicker">{copy.title}</span>
        <h1>{copy.subtitle}</h1>
        <p>{copy.lead}</p>
        <div className="history-summary-strip" aria-label={copy.title}>
          <span><b>{summary.total}</b>{copy.total}</span>
          <span><b>{summary.scanner}</b>{copy.scanner}</span>
          <span><b>{summary.live}</b>{copy.auto}</span>
        </div>
      </div>

      {status === "loading" && (
        <div className="history-state-card">{copy.loading}</div>
      )}

      {status === "error" && (
        <div className="history-state-card error">
          <strong>{copy.error}</strong>
          <button type="button" onClick={() => setReloadKey((value) => value + 1)}>{copy.retry}</button>
        </div>
      )}

      {status === "ready" && items.length === 0 && (
        <div className="history-state-card">
          <strong>{copy.empty}</strong>
          <span>{copy.emptyHint}</span>
        </div>
      )}

      {status === "ready" && items.length > 0 && (
        <div className="history-list">
          {items.map((item) => {
            const tone = getSignalTone(item.signal);
            const previewUrl = previewUrls[item.id];
            return (
              <article className={`history-card tone-${tone}`} key={item.id}>
                <button
                  className="history-card-media"
                  type="button"
                  onClick={() => previewUrl && setOpenPreview({ url: previewUrl, title: formatHistoryAsset(item.asset, item.market_mode) })}
                  disabled={!previewUrl}
                  aria-label={copy.openMedia}
                >
                  {previewUrl ? (
                    <img src={previewUrl} alt="" />
                  ) : (
                    <span>{item.is_archived ? copy.archived : copy.noPreview}</span>
                  )}
                </button>

                <div className="history-card-body">
                  <div className="history-card-topline">
                    <span>{item.source_type === "auto" ? copy.auto : copy.scanner}</span>
                    <b className={`signal-${tone}`}>{item.signal || "NO TRADE"}</b>
                  </div>

                  <strong>{formatHistoryAsset(item.asset, item.market_mode)}</strong>
                  <p>{item.comment || item.result?.comment || "-"}</p>

                  <div className="history-card-stats">
                    <span>
                      <small>{copy.price}</small>
                      <b>{formatHistoryPrice(item.entry_price)}</b>
                    </span>
                    <span>
                      <small>{copy.confidence}</small>
                      <b>{Number(item.confidence || 0)}%</b>
                    </span>
                    <span>
                      <small>{copy.expiration}</small>
                      <b>{item.selected_expiration || "-"}</b>
                      {Number(item.expiration_minutes || 0) > 0 ? <em>{copy.aiExpiration}: {item.expiration_minutes} мин</em> : null}
                    </span>
                  </div>

                  <time>{formatHistoryDate(item.created_at, lang)}</time>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {openPreview?.url ? (
        <div className="history-preview-viewer" role="dialog" aria-modal="true" onClick={() => setOpenPreview(null)}>
          <div className="history-preview-panel" onClick={(event) => event.stopPropagation()}>
            <div className="history-preview-head">
              <strong>{openPreview.title}</strong>
              <button type="button" onClick={() => setOpenPreview(null)}>{copy.close}</button>
            </div>
            <img src={openPreview.url} alt="" />
          </div>
        </div>
      ) : null}
    </section>
  );
}
