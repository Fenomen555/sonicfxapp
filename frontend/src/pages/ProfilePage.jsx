import { useEffect, useMemo, useRef, useState } from "react";
import ReactCountryFlag from "react-country-flag";
import profileFaqIcon from "../assets/profile-faq.png";
import profileHistoryIcon from "../assets/profile-history.png";
import { apiFetchJson } from "../lib/api";

const TIMEZONE_OPTIONS = [
  { id: "Europe/Kiev", city: "Kyiv", flag: "UA" },
  { id: "Europe/London", city: "London", flag: "GB" },
  { id: "Europe/Berlin", city: "Berlin", flag: "DE" },
  { id: "Europe/Moscow", city: "Moscow", flag: "RU" },
  { id: "America/New_York", city: "New York", flag: "US" },
  { id: "Asia/Dubai", city: "Dubai", flag: "AE" }
];

const PROFILE_TOP_ACTIONS = [
  { key: "history", fallback: "История", image: profileHistoryIcon },
  { key: "faq", fallback: "FAQ", image: profileFaqIcon }
];

const PROFILE_BOTTOM_ACTIONS = [
  { key: "support", fallback: "Поддержка", icon: "✦" },
  { key: "notifications", fallback: "Уведомления", icon: "•" }
];

function getInitials(user, fallback) {
  const source = [user?.first_name, user?.last_name, user?.tg_username].filter(Boolean).join(" ").trim();
  if (!source) return fallback;
  return source
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getLocale(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "uk") return "uk-UA";
  return "ru-RU";
}

function formatProfileDate(value, lang) {
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

function formatTimezoneNow(timeZone, lang) {
  try {
    return new Intl.DateTimeFormat(getLocale(lang), {
      timeZone,
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return "--:--";
  }
}

function formatTimezoneOffset(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
    return offset.replace("GMT", "UTC");
  } catch {
    return "UTC";
  }
}

function getStatusMeta(tier, t) {
  if (tier === "vip") {
    return {
      label: t.profile.tierVip || "VIP",
      tone: "vip"
    };
  }
  if (tier === "pro") {
    return {
      label: t.profile.tierPro || "PRO",
      tone: "pro"
    };
  }
  return {
    label: t.profile.tierTrader || "Trader",
    tone: "trader"
  };
}

export default function ProfilePage({ t, user, onUserUpdate, onThemePreview, onLangPreview }) {
  const [lang, setLang] = useState(user?.lang || "ru");
  const [theme, setTheme] = useState(user?.theme || "dark");
  const [timezone, setTimezone] = useState(user?.timezone || "Europe/Kiev");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("success");
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [isTimezoneExpanded, setIsTimezoneExpanded] = useState(false);
  const settingsRequestRef = useRef(0);

  useEffect(() => {
    setLang(user?.lang || "ru");
    setTheme(user?.theme || "dark");
    setTimezone(user?.timezone || "Europe/Kiev");
    setAvatarFailed(false);
    setIsTimezoneExpanded(false);
  }, [user]);

  const profileName = useMemo(() => {
    const full = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    return full || user?.tg_username || t.profile.nameFallback || "Trader";
  }, [t.profile.nameFallback, user]);

  const statusMeta = useMemo(
    () => getStatusMeta(user?.account_tier || "trader", t),
    [t, user?.account_tier]
  );

  const summaryCards = useMemo(
    () => [
      {
        key: "user_id",
        label: t.profile.userId || "Telegram ID",
        value: user?.user_id || "-"
      },
      {
        key: "username",
        label: t.profile.username || "Username",
        value: user?.tg_username ? `@${user.tg_username}` : "-"
      },
      {
        key: "balance",
        label: t.profile.balanceLabel || "Баланс",
        value: `$${Number(user?.deposit_amount || 0).toFixed(2)}`
      },
      {
        key: "joined",
        label: t.profile.joined || "Регистрация",
        value: formatProfileDate(user?.created_at, lang)
      }
    ],
    [lang, t, user]
  );

  const handleUpgradeStatus = () => {
    setStatusTone("success");
    setStatusMessage(t.profile.upgradeStatusSoon || "Скоро здесь появится апгрейд статуса.");
  };

  const languageOptions = useMemo(
    () => [
      { id: "ru", label: t.profile.langRu || "Русский", flag: "RU" },
      { id: "en", label: t.profile.langEn || "English", flag: "GB" },
      { id: "uk", label: t.profile.langUk || "Українська", flag: "UA" }
    ],
    [t.profile.langEn, t.profile.langRu, t.profile.langUk]
  );

  const activeThemeMeta = useMemo(
    () => (
      theme === "light"
        ? { id: "light", symbol: "\u2600" }
        : { id: "dark", symbol: "\u263E" }
    ),
    [theme]
  );

  const timezoneOptions = useMemo(
    () => TIMEZONE_OPTIONS.map((item) => ({
      ...item,
      currentTime: formatTimezoneNow(item.id, lang),
      currentOffset: formatTimezoneOffset(item.id)
    })),
    [lang]
  );

  const selectedTimezoneOption = useMemo(
    () => timezoneOptions.find((item) => item.id === timezone) || timezoneOptions[0] || TIMEZONE_OPTIONS[0],
    [timezone, timezoneOptions]
  );

  const profileActions = useMemo(() => ({
    top: PROFILE_TOP_ACTIONS.map((item) => ({
      ...item,
      label: t.profile?.actions?.[item.key] || item.fallback
    })),
    bottom: PROFILE_BOTTOM_ACTIONS.map((item) => ({
      ...item,
      label: t.profile?.actions?.[item.key] || item.fallback
    }))
  }), [t.profile?.actions]);

  const beginSettingsRequest = () => {
    settingsRequestRef.current += 1;
    return settingsRequestRef.current;
  };

  const saveSettings = async (payload, successMessage, requestId = beginSettingsRequest()) => {
    const data = await apiFetchJson("/api/user/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (requestId === settingsRequestRef.current) {
      onUserUpdate?.(data?.user || user);
      setStatusTone("success");
      setStatusMessage(successMessage || t.profile.saved || "Настройки сохранены");
    }
    return data;
  };

  const handleThemeToggle = async () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const requestId = beginSettingsRequest();
    setTheme(nextTheme);
    onThemePreview?.(nextTheme);
    setStatusMessage("");
    try {
      await saveSettings({ theme: nextTheme }, t.profile.saved || "Настройки сохранены", requestId);
    } catch (error) {
      if (requestId === settingsRequestRef.current) {
        setTheme(user?.theme || "dark");
        onThemePreview?.(user?.theme || "dark");
        setStatusTone("error");
        setStatusMessage(error.message || "Failed");
      }
    }
  };

  const handleLangSelect = async (nextLang) => {
    if (nextLang === lang) return;
    const requestId = beginSettingsRequest();
    setLang(nextLang);
    onLangPreview?.(nextLang);
    setStatusMessage("");
    try {
      await saveSettings({ lang: nextLang }, t.profile.saved || "Настройки сохранены", requestId);
    } catch (error) {
      if (requestId === settingsRequestRef.current) {
        setLang(user?.lang || "ru");
        onLangPreview?.(user?.lang || "ru");
        setStatusTone("error");
        setStatusMessage(error.message || "Failed");
      }
    }
  };

  const handleSave = async () => {
    const requestId = beginSettingsRequest();
    setSaving(true);
    setStatusMessage("");
    try {
      await saveSettings({ lang, theme, timezone }, t.profile.saved || "Настройки сохранены", requestId);
    } catch (error) {
      if (requestId === settingsRequestRef.current) {
        setStatusTone("error");
        setStatusMessage(error.message || "Failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page page-profile page-profile-ref">
      <div className="card profile-hero">
        <div className={`profile-ribbon profile-ribbon-${statusMeta.tone}`}>
          <span>{statusMeta.label}</span>
        </div>
        <div className="profile-hero-top">
          <div className="profile-avatar-shell">
            {user?.photo_url && !avatarFailed ? (
              <img
                className="profile-avatar-image"
                src={user.photo_url}
                alt={profileName}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className="profile-avatar-fallback">{getInitials(user, "SF")}</div>
            )}
          </div>

          <div className="profile-hero-copy">
            <h1 className="page-title">{profileName}</h1>
            <p>{user?.tg_username ? `@${user.tg_username}` : (t.profile.noUsername || "@username not set")}</p>
          </div>
        </div>

        <div className="profile-summary-grid compact">
          {summaryCards.map((item) => (
            <article className="profile-summary-card" key={item.key}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>

        <button type="button" className="profile-upgrade-btn" onClick={handleUpgradeStatus}>
          {t.profile.upgradeStatus || "Повысить статус"}
        </button>
      </div>

      <div className="profile-action-grid profile-action-grid-top" aria-label={t.profile.quickActions || "Быстрые действия"}>
        {profileActions.top.map((item) => (
          <button type="button" className="profile-action-tile" key={item.key}>
            <span className="profile-action-icon">
              {item.image ? <img src={item.image} alt="" draggable="false" /> : item.icon}
            </span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      <div className="profile-action-grid profile-action-grid-bottom" aria-label={t.profile.quickActions || "Быстрые действия"}>
        {profileActions.bottom.map((item) => (
          <button type="button" className="profile-action-tile" key={item.key}>
            <span className="profile-action-icon">
              {item.image ? <img src={item.image} alt="" draggable="false" /> : item.icon}
            </span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      <div className="card profile-section profile-settings-shell">
        <div className="profile-section-head">
          <strong>{t.profile.settingsTitle || "Настройки"}</strong>
          <span>{t.profile.settingsHint || "Язык, тема и часовой пояс применяются сразу."}</span>
        </div>

        <div className="profile-settings-grid">
          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.timezone || "Часовой пояс"}</label>
            <div className="profile-timezone-selector">
              <button
                type="button"
                className={`profile-timezone-summary ${isTimezoneExpanded ? "expanded" : ""}`}
                onClick={() => setIsTimezoneExpanded((prev) => !prev)}
              >
                <span className="profile-timezone-summary-copy">
                  <span className="profile-timezone-summary-top">
                    <ReactCountryFlag svg countryCode={selectedTimezoneOption.flag} aria-hidden="true" className="profile-timezone-flag" />
                    <strong>{selectedTimezoneOption.city}</strong>
                  </span>
                  <span className="profile-timezone-summary-meta">
                    <span>{selectedTimezoneOption.id}</span>
                    <span>{selectedTimezoneOption.currentOffset} · {selectedTimezoneOption.currentTime}</span>
                  </span>
                </span>
                <span className="profile-timezone-summary-side">
                  <span className="profile-timezone-summary-state">
                    {isTimezoneExpanded
                      ? (t.profile.timezoneCollapse || "Свернуть")
                      : (t.profile.timezoneChoose || "Выбрать")}
                  </span>
                  <span className={`profile-timezone-chevron ${isTimezoneExpanded ? "expanded" : ""}`} aria-hidden="true" />
                </span>
              </button>

              {isTimezoneExpanded && (
                <div className="profile-timezone-grid">
                  {timezoneOptions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`profile-timezone-chip ${timezone === item.id ? "active" : ""}`}
                      onClick={() => {
                        setTimezone(item.id);
                        setIsTimezoneExpanded(false);
                      }}
                    >
                      <span className="profile-timezone-top">
                        <ReactCountryFlag svg countryCode={item.flag} aria-hidden="true" className="profile-timezone-flag" />
                        <span className="profile-timezone-city">{item.city}</span>
                      </span>
                      <span className="profile-timezone-zone">{item.id}</span>
                      <span className="profile-timezone-current-row">
                        <span className="profile-timezone-offset">{item.currentOffset}</span>
                        <span className="profile-timezone-current">
                          {(t.profile.timezoneCurrent || "Сейчас")}: {item.currentTime}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.lang || "Язык"}</label>
            <div className="profile-chip-group profile-chip-group-languages">
              {languageOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`profile-chip profile-chip-language ${lang === item.id ? "active" : ""}`}
                  onClick={() => handleLangSelect(item.id)}
                >
                  <ReactCountryFlag svg countryCode={item.flag} aria-hidden="true" className="profile-chip-flag" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="profile-setting-block profile-setting-block-wide">
            <div className="profile-theme-row">
              <label className="field-label">{t.profile.theme || "Тема"}</label>
              <button
                type="button"
                className={`profile-theme-switch ${theme === "dark" ? "is-dark" : "is-light"}`}
                onClick={handleThemeToggle}
                role="switch"
                aria-checked={theme === "dark"}
                aria-label={t.profile.theme || "Тема"}
              >
                <span className="profile-theme-switch-track">
                  <span className={`profile-theme-thumb ${activeThemeMeta.id}`} aria-hidden="true">
                    <span className={`profile-theme-badge ${activeThemeMeta.id}`}>{activeThemeMeta.symbol}</span>
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <button className="primary-btn profile-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? (t.profile.saving || "Saving...") : (t.profile.save || "Save")}
        </button>
        {statusMessage && <div className={`form-status ${statusTone}`}>{statusMessage}</div>}
      </div>
    </section>
  );
}
