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

export default function StatusUpgradeModal({ isOpen, user, onClose, onUserUpdate, notify }) {
  const [items, setItems] = useState([]);
  const [currentStatus, setCurrentStatus] = useState(null);
  const [traderId, setTraderId] = useState(user?.trader_id || "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    setLoading(true);
    apiFetchJson("/api/statuses")
      .then((data) => {
        if (!isActive) return;
        setItems(Array.isArray(data?.available_items) ? data.available_items : data?.items || []);
        setCurrentStatus(data?.current_status || null);
        setTraderId(data?.trader_id || user?.trader_id || "");
      })
      .catch((error) => {
        if (!isActive) return;
        notify?.({
          type: "error",
          title: "Не удалось загрузить статусы",
          message: error.message || "Попробуйте открыть окно ещё раз."
        });
      })
      .finally(() => {
        if (isActive) setLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen, notify, user?.trader_id]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const currentOrder = Number(currentStatus?.sort_order || user?.account_status?.sort_order || 0);
  const visibleItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    return sorted.filter((item) => Number(item.sort_order || 0) >= currentOrder || item.code === user?.account_tier);
  }, [currentOrder, items, user?.account_tier]);

  if (!isOpen) return null;

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
    <div className="status-upgrade-layer" role="presentation" onClick={onClose}>
      <section className="status-upgrade-panel card" role="dialog" aria-modal="true" aria-label="Повысить статус" onClick={(event) => event.stopPropagation()}>
        <div className="status-upgrade-head">
          <span className="status-upgrade-kicker">Статусы SonicFX</span>
          <h2>Открой следующий уровень</h2>
          <p>Выбери доступ под свой стиль торговли. Ниже показываем текущий статус и следующие доступные уровни.</p>
        </div>

        {loading ? (
          <div className="status-upgrade-empty">Загружаем статусы...</div>
        ) : (
          <div className="status-upgrade-track">
            {visibleItems.map((item) => {
              const code = normalizeCode(item.code);
              const isCurrent = code === normalizeCode(user?.account_tier);
              const isUnlocked = Number(item.sort_order || 0) <= currentOrder;
              return (
                <article className={`status-upgrade-card tone-${getStatusTone(code)} ${isCurrent ? "current" : ""}`} key={code}>
                  <div className="status-upgrade-card-top">
                    <span>{item.badge_text || item.name}</span>
                    <strong>{item.name}</strong>
                    <i>{isCurrent ? "Текущий" : isUnlocked ? "Есть доступ" : `от $${Number(item.min_deposit || 0)}`}</i>
                  </div>
                  <p>{item.description || "Статус SonicFX с индивидуальными лимитами."}</p>
                  <div className="status-upgrade-lines">
                    {(item.marketing_text || "").split("\n").filter(Boolean).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                  <div className="status-upgrade-limits">
                    <span>Scanner <b>{getModeLimitText(item, "scanner")}</b></span>
                    <span>Live <b>{getModeLimitText(item, "live")}</b></span>
                    <span>Indicators <b>{getModeLimitText(item, "indicators")}</b></span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="status-upgrade-form">
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
        </div>

        <button className="status-upgrade-close" type="button" onClick={onClose}>
          Закрыть
        </button>
      </section>
    </div>
  );
}
