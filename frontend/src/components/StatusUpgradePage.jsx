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
  const [linkedTraderId, setLinkedTraderId] = useState(user?.trader_id || "");
  const [registrationUrl, setRegistrationUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState(null);
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
        setLinkedTraderId(data?.trader_id || user?.trader_id || "");
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
  const storedTraderId = String(linkedTraderId || user?.trader_id || "").trim();
  const hasStoredTraderId = Boolean(storedTraderId);

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

  const buildVerificationMessage = (result, nextUser) => {
    const code = result?.code || "";
    const nextStatus = result?.next_status || nextUser?.next_account_status || null;
    const deposit = Number(result?.deposit_amount ?? nextUser?.deposit_amount ?? 0);
    const required = Number(nextStatus?.min_deposit || 0);
    if (code === "upgraded") {
      return {
        type: "success",
        title: copy.verifyUpgradedTitle || "Status upgraded",
        message: copy.verifyUpgradedMessage || "Pocket confirmed your deposit. New access is active."
      };
    }
    if (code === "deposit_too_low") {
      const missing = Math.max(required - deposit, 0);
      return {
        type: "warning",
        title: copy.verifyDepositLowTitle || "Deposit is not enough yet",
        message: (copy.verifyDepositLowMessage || "Current deposit: {deposit}. Need {required}. Missing {missing}.")
          .replace("{deposit}", `$${deposit.toFixed(2)}`)
          .replace("{required}", `$${required.toFixed(2)}`)
          .replace("{missing}", `$${missing.toFixed(2)}`)
      };
    }
    if (code === "user_not_found") {
      return {
        type: "error",
        title: copy.verifyNotFoundTitle || "Referral not found",
        message: copy.verifyNotFoundMessage || "You are not fixed in our team yet. Start with registration."
      };
    }
    if (code === "trader_id_taken") {
      return { type: "error", title: copy.verifyTaken || "Trader ID is already linked", message: copy.verifyTakenMessage || "This Trader ID is already attached to another profile." };
    }
    if (code === "bad_trader_id" || code === "trader_id_required") {
      return { type: "error", title: copy.verifyBadId || "Check Trader ID", message: copy.verifyBadIdMessage || "Use 3-64 letters, digits, dots, dashes or underscores." };
    }
    if (code === "not_configured") {
      return { type: "error", title: copy.verifyNotConfigured || "Pocket is not configured", message: copy.verifyNotConfiguredMessage || "Admin needs to add Cabinet ID and API token." };
    }
    if (code === "pocket_error") {
      return { type: "error", title: copy.verifyPocketError || "Pocket request failed", message: copy.verifyPocketErrorMessage || "Please try again a little later." };
    }
    if (code === "already_max") {
      return { type: "success", title: copy.verifyAlreadyMaxTitle || "Maximum status", message: copy.verifyAlreadyMaxMessage || "You already have the highest available access." };
    }
    return { type: "info", title: copy.verifyNoChangeTitle || "Status checked", message: copy.verifyNoChangeMessage || "Pocket data was refreshed, status remains unchanged." };
  };

  const saveTraderId = async () => {
    const valueToSend = hasStoredTraderId ? "" : traderId.trim();
    if (!hasStoredTraderId && !valueToSend) {
      const notice = {
        type: "error",
        title: copy.verifyBadId || "Check Trader ID",
        message: copy.verifyRequired || "Enter Trader ID or register first."
      };
      setVerification(notice);
      notify?.(notice);
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetchJson("/api/user/trader-id", {
        method: "POST",
        body: JSON.stringify({ trader_id: valueToSend })
      });
      const nextUser = data?.user || {};
      setTraderId(nextUser.trader_id || traderId);
      setLinkedTraderId(nextUser.trader_id || linkedTraderId);
      onUserUpdate?.(nextUser);
      const notice = buildVerificationMessage(data?.verification || {}, nextUser);
      setVerification({ ...notice, code: data?.verification?.code || "" });
      notify?.(notice);
    } catch (error) {
      const notice = {
        type: "error",
        title: copy.traderErrorTitle || "Unable to save Trader ID",
        message: error.message || copy.traderErrorMessage || "Check the value and try again."
      };
      setVerification(notice);
      notify?.(notice);
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
        {hasStoredTraderId ? (
          <div className="status-trader-linked">
            <span>{copy.linkedTraderLabel || "Linked Trader ID"}</span>
            <strong>{storedTraderId}</strong>
            <small>{copy.linkedTraderHint || "We will refresh Pocket data and upgrade the status if deposit requirements are met."}</small>
          </div>
        ) : (
          <label>
            <span>{copy.traderLabel || "Trader ID for access"}</span>
            <input
              type="text"
              maxLength="128"
              value={traderId}
              onChange={(event) => {
                setTraderId(event.target.value);
                setVerification(null);
              }}
              placeholder={copy.traderPlaceholder || "Enter Trader ID"}
            />
          </label>
        )}
        {verification ? (
          <div className={`status-verification-message tone-${verification.type || "info"}`}>
            <strong>{verification.title}</strong>
            <span>{verification.message}</span>
          </div>
        ) : null}
        <button type="button" onClick={saveTraderId} disabled={saving}>
          {saving ? (copy.checking || copy.saving || "Checking...") : hasStoredTraderId ? (copy.checkAndUpgrade || copy.upgrade || "Check and upgrade") : (copy.saveTrader || "Save Trader ID")}
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
