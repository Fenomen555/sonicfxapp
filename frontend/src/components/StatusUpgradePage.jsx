import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../lib/api";

function normalizeCode(value) {
  return String(value || "trader").trim().toLowerCase() || "trader";
}

function getModeLimitText(status, mode) {
  const enabled = Number(status?.[`${mode}_enabled`] || 0) === 1;
  if (!enabled) return "Нет доступа";
  const code = normalizeCode(status?.code);
  if (code === "trader" && mode === "scanner") return "1 пробный";
  if (code === "trader" && (mode === "live" || mode === "indicators")) return "1 общий";
  const limit = Number(status?.[`${mode}_limit`] ?? 0);
  if (limit < 0) return "Безлимит";
  const hours = Number(status?.[`${mode}_window_hours`] || 3);
  if (limit === 0) return "Нет доступа";
  return `${limit} / ${hours} ч`;
}

function getStatusTone(code) {
  if (code === "unlimited") return "unlimited";
  if (code === "vip") return "vip";
  if (code === "premium") return "premium";
  return "trader";
}

const MODE_ROWS = [
  { key: "scanner", label: "Scanner" },
  { key: "live", label: "Live" },
  { key: "indicators", label: "Indicators" }
];

export default function StatusUpgradePage({ user, onClose, onUserUpdate, notify }) {
  const [items, setItems] = useState([]);
  const [currentStatus, setCurrentStatus] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [traderId, setTraderId] = useState(user?.trader_id || "");
  const [registrationUrl, setRegistrationUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let isActive = true;
    setLoading(true);
    apiFetchJson("/api/statuses")
      .then((data) => {
        if (!isActive) return;
        setItems(Array.isArray(data?.available_items) ? data.available_items : data?.items || []);
        setCurrentStatus(data?.current_status || null);
        setTraderId(data?.trader_id || user?.trader_id || "");
        setRegistrationUrl(data?.registration_url || "");
      })
      .catch((error) => {
        if (!isActive) return;
        notify?.({
          type: "error",
          title: "Не удалось загрузить статусы",
          message: error.message || "Попробуйте открыть раздел ещё раз."
        });
      })
      .finally(() => {
        if (isActive) setLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [notify, user?.trader_id]);

  const currentOrder = Number(currentStatus?.sort_order || user?.account_status?.sort_order || 0);
  const visibleItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    return sorted.filter((item) => Number(item.sort_order || 0) >= currentOrder || normalizeCode(item.code) === normalizeCode(user?.account_tier));
  }, [currentOrder, items, user?.account_tier]);

  useEffect(() => {
    setActiveIndex((prev) => Math.min(Math.max(prev, 0), Math.max(visibleItems.length - 1, 0)));
  }, [visibleItems.length]);

  const activeItem = visibleItems[activeIndex] || visibleItems[0] || null;
  const activeCode = normalizeCode(activeItem?.code);
  const isCurrent = activeCode === normalizeCode(user?.account_tier);
  const isUnlocked = Number(activeItem?.sort_order || 0) <= currentOrder;
  const hasStoredTraderId = Boolean(String(user?.trader_id || "").trim());

  const goPrev = () => setActiveIndex((prev) => Math.max(prev - 1, 0));
  const goNext = () => setActiveIndex((prev) => Math.min(prev + 1, Math.max(visibleItems.length - 1, 0)));

  const handleTouchStart = (event) => {
    setTouchStartX(event.touches?.[0]?.clientX ?? null);
  };

  const handleTouchEnd = (event) => {
    if (touchStartX == null) return;
    const endX = event.changedTouches?.[0]?.clientX ?? touchStartX;
    const deltaX = endX - touchStartX;
    setTouchStartX(null);
    if (Math.abs(deltaX) < 42) return;
    if (deltaX < 0) {
      goNext();
    } else {
      goPrev();
    }
  };

  const saveTraderId = async () => {
    setSaving(true);
    try {
      const data = await apiFetchJson("/api/user/trader-id", {
        method: "POST",
        body: JSON.stringify({ trader_id: traderId.trim() })
      });
      onUserUpdate?.(data?.user || {});
      notify?.({
        type: "success",
        title: "Trader ID сохранён",
        message: "Теперь админ сможет быстрее выдать нужный статус."
      });
    } catch (error) {
      notify?.({
        type: "error",
        title: "Не удалось сохранить Trader ID",
        message: error.message || "Проверьте значение и попробуйте ещё раз."
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="status-upgrade-page">
      <div className="status-upgrade-head status-page-head">
        <h1>Открой следующий уровень</h1>
      </div>

      {loading ? (
        <div className="status-upgrade-empty status-page-empty">Загружаем статусы...</div>
      ) : activeItem ? (
        <>
          <div
            className="status-page-slider"
            aria-live="polite"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => setTouchStartX(null)}
          >
            <article className={`status-upgrade-card status-page-card tone-${getStatusTone(activeCode)} ${isCurrent ? "current" : ""}`} key={activeCode}>
              <div className="status-upgrade-card-top status-page-card-top">
                <span>{activeItem.badge_text || activeItem.name}</span>
                <strong>{activeItem.name}</strong>
                <i>{isCurrent ? "Текущий" : isUnlocked ? "Есть доступ" : `от $${Number(activeItem.min_deposit || 0)}`}</i>
              </div>
              <p>{activeItem.description || "Статус SonicFX с индивидуальными лимитами."}</p>
              <div className="status-upgrade-lines">
                {(activeItem.marketing_text || "").split("\n").filter(Boolean).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              <div className="status-upgrade-limits">
                {MODE_ROWS.map((mode) => (
                  <span key={mode.key}>
                    {mode.label}
                    <b>{getModeLimitText(activeItem, mode.key)}</b>
                  </span>
                ))}
              </div>
            </article>
          </div>

          <div className="status-page-controls">
            <button type="button" onClick={goPrev} disabled={activeIndex <= 0}>
              Предыдущий
            </button>
            <div className="status-page-dots" aria-label="Навигация по статусам">
              {visibleItems.map((item, index) => (
                <button
                  type="button"
                  className={index === activeIndex ? "active" : ""}
                  key={item.code || index}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Открыть статус ${item.name || index + 1}`}
                />
              ))}
            </div>
            <button type="button" onClick={goNext} disabled={activeIndex >= visibleItems.length - 1}>
              Далее
            </button>
          </div>
        </>
      ) : (
        <div className="status-upgrade-empty status-page-empty">Статусы пока не настроены.</div>
      )}

      <div className="status-upgrade-form status-page-form">
        <label>
          <span>Trader ID для получения доступа</span>
          <input
            type="text"
            maxLength="128"
            value={traderId}
            onChange={(event) => setTraderId(event.target.value)}
            placeholder="Введите Trader ID"
          />
        </label>
        <button type="button" onClick={saveTraderId} disabled={saving}>
          {saving ? "Сохраняем..." : traderId.trim() ? "Повысить" : "Сохранить Trader ID"}
        </button>
        {!hasStoredTraderId && registrationUrl ? (
          <a className="status-register-link" href={registrationUrl} target="_blank" rel="noreferrer">
            Зарегистрироваться
          </a>
        ) : null}
      </div>

      <p className="status-page-disclaimer">
        Выбери доступ под свой стиль торговли. Текущий уровень и следующие статусы собраны в одном разделе.
      </p>
    </section>
  );
}
