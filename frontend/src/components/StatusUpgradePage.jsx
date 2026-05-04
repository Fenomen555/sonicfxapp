import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../lib/api";

function normalizeCode(value) {
  return String(value || "trader").trim().toLowerCase() || "trader";
}

function getModeLimitText(status, mode, copy) {
  const enabled = Number(status?.[`${mode}_enabled`] || 0) === 1;
  if (!enabled) return copy.noAccess || "No access";
  const code = normalizeCode(status?.code);
  if (code === "trader" && mode === "scanner") return copy.trialScanner || "1 trial";
  if (code === "trader" && (mode === "live" || mode === "indicators")) return copy.sharedSignal || "1 shared";
  const limit = Number(status?.[`${mode}_limit`] ?? 0);
  if (limit < 0) return copy.unlimited || "Unlimited";
  const hours = Number(status?.[`${mode}_window_hours`] || 3);
  if (limit === 0) return copy.noAccess || "No access";
  return `${limit} / ${hours} ${copy.hourShort || "h"}`;
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

function getLocalizedStatus(item, copy) {
  const code = normalizeCode(item?.code);
  const preset = copy.statuses?.[code] || null;
  return {
    ...item,
    name: preset?.name || item?.name || code,
    badge_text: preset?.badge || item?.badge_text || item?.name || code,
    description: preset?.description || item?.description || copy.defaultDescription || "SonicFX status with custom limits.",
    marketingLines: Array.isArray(preset?.lines)
      ? preset.lines
      : String(item?.marketing_text || "").split("\n").filter(Boolean)
  };
}

export default function StatusUpgradePage({ user, t = {}, onClose, onUserUpdate, notify }) {
  const [items, setItems] = useState([]);
  const [currentStatus, setCurrentStatus] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);
  const [traderId, setTraderId] = useState(user?.trader_id || "");
  const [registrationUrl, setRegistrationUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const copy = t.statusUpgrade || {};

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
          title: copy.loadErrorTitle || "Unable to load statuses",
          message: error.message || copy.loadErrorMessage || "Try opening this section again."
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

  const rawActiveItem = visibleItems[activeIndex] || visibleItems[0] || null;
  const activeItem = rawActiveItem ? getLocalizedStatus(rawActiveItem, copy) : null;
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
        title: copy.traderSavedTitle || "Trader ID saved",
        message: copy.traderSavedMessage || "The admin will be able to assign the right status faster."
      });
    } catch (error) {
      notify?.({
        type: "error",
        title: copy.traderErrorTitle || "Unable to save Trader ID",
        message: error.message || copy.traderErrorMessage || "Check the value and try again."
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="status-upgrade-page">
      <div className="status-upgrade-head status-page-head">
        <h1>{copy.title || "Unlock the next level"}</h1>
      </div>

      {loading ? (
        <div className="status-upgrade-empty status-page-empty">{copy.loading || "Loading statuses..."}</div>
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
                <i>{isCurrent ? (copy.current || "Current") : isUnlocked ? (copy.unlocked || "Unlocked") : `${copy.from || "from"} $${Number(activeItem.min_deposit || 0)}`}</i>
              </div>
              <p>{activeItem.description}</p>
              <div className="status-upgrade-lines">
                {activeItem.marketingLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              <div className="status-upgrade-limits">
                {MODE_ROWS.map((mode) => (
                  <span key={mode.key}>
                    {copy.modes?.[mode.key] || mode.label}
                    <b>{getModeLimitText(activeItem, mode.key, copy)}</b>
                  </span>
                ))}
              </div>
            </article>
          </div>

          <div className="status-page-controls">
            <button type="button" onClick={goPrev} disabled={activeIndex <= 0}>
              {copy.prev || "Previous"}
            </button>
            <div className="status-page-dots" aria-label={copy.dotsLabel || "Status navigation"}>
              {visibleItems.map((item, index) => (
                <button
                  type="button"
                  className={index === activeIndex ? "active" : ""}
                  key={item.code || index}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`${copy.openStatus || "Open status"} ${getLocalizedStatus(item, copy).name || index + 1}`}
                />
              ))}
            </div>
            <button type="button" onClick={goNext} disabled={activeIndex >= visibleItems.length - 1}>
              {copy.next || "Next"}
            </button>
          </div>
        </>
      ) : (
        <div className="status-upgrade-empty status-page-empty">{copy.empty || "No statuses configured yet."}</div>
      )}

      <div className="status-upgrade-form status-page-form">
        <label>
          <span>{copy.traderLabel || "Trader ID for access"}</span>
          <input
            type="text"
            maxLength="128"
            value={traderId}
            onChange={(event) => setTraderId(event.target.value)}
            placeholder={copy.traderPlaceholder || "Enter Trader ID"}
          />
        </label>
        <button type="button" onClick={saveTraderId} disabled={saving}>
          {saving ? (copy.saving || "Saving...") : traderId.trim() ? (copy.upgrade || "Upgrade") : (copy.saveTrader || "Save Trader ID")}
        </button>
        {!hasStoredTraderId && registrationUrl ? (
          <a className="status-register-link" href={registrationUrl} target="_blank" rel="noreferrer">
            {copy.register || "Register"}
          </a>
        ) : null}
      </div>

      <p className="status-page-disclaimer">
        {copy.disclaimer || "Choose access for your trading style. Your current level and next statuses are collected in one section."}
      </p>
    </section>
  );
}
