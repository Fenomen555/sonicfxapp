import { useEffect, useMemo, useState } from "react";
import ReactCountryFlag from "react-country-flag";
import { apiFetchJson } from "../lib/api";

const TIMEZONE_OPTIONS = [
  { id: "Europe/Kiev", city: "Kyiv", flag: "UA" },
  { id: "Europe/London", city: "London", flag: "GB" },
  { id: "Europe/Berlin", city: "Berlin", flag: "DE" },
  { id: "Europe/Moscow", city: "Moscow", flag: "RU" },
  { id: "America/New_York", city: "New York", flag: "US" },
  { id: "Asia/Dubai", city: "Dubai", flag: "AE" }
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
  } catch (_error) {
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
  } catch (_error) {
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
        key: "access",
        label: t.profile.accessLabel || "Доступ",
        value: user?.scanner_access ? (t.profile.accessOn || "Есть") : (t.profile.accessOff || "Нет")
      },
      {
        key: "deposit",
        label: t.profile.depositLabel || "Депозит",
        value: Number(user?.deposit_amount || 0) > 0 ? `$${Number(user.deposit_amount || 0).toFixed(2)}` : (t.profile.noDeposit || "Не внесен")
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
        ? {
            id: "light",
            label: t.profile.themeDayMode || "DAY MODE",
            hint: t.profile.themeLight || "Светлая",
            symbol: "\u2600"
          }
        : {
            id: "dark",
            label: t.profile.themeNightMode || "NIGHT MODE",
            hint: t.profile.themeDark || "Темная",
            symbol: "\u263E"
          }
    ),
    [theme, t.profile.themeDark, t.profile.themeDayMode, t.profile.themeLight, t.profile.themeNightMode]
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

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage("");
    try {
      const data = await apiFetchJson("/api/user/settings", {
        method: "POST",
        body: JSON.stringify({
          lang,
          theme,
          timezone
        })
      });
      onUserUpdate(data?.user || user);
      onThemePreview(theme);
      onLangPreview(lang);
      setStatusTone("success");
      setStatusMessage(t.profile.saved || "Настройки сохранены");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(error.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page page-profile page-profile-ref">
      <div className="card profile-hero">
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

          <div className="profile-status-stack">
            <span className="profile-status-kicker">{t.profile.status || "Статус"}</span>
            <div className={`profile-status-chip ${statusMeta.tone}`}>{statusMeta.label}</div>
          </div>
        </div>

        <div className="profile-identity-list compact">
          <div>
            <span>{t.profile.userId || "Telegram ID"}</span>
            <strong>{user?.user_id || "-"}</strong>
          </div>
          <div>
            <span>{t.profile.username || "Username"}</span>
            <strong>{user?.tg_username ? `@${user.tg_username}` : "-"}</strong>
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
                  onClick={() => {
                    setLang(item.id);
                    onLangPreview(item.id);
                  }}
                >
                  <ReactCountryFlag svg countryCode={item.flag} aria-hidden="true" className="profile-chip-flag" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.theme || "Тема"}</label>
            <div className="profile-theme-section-head">
              <span>{t.profile.themeSwitchHint || "Переключай внешний вид одним тапом."}</span>
            </div>
            <button
              type="button"
              className={`profile-theme-switch ${theme === "dark" ? "is-dark" : "is-light"}`}
              onClick={() => {
                const nextTheme = theme === "dark" ? "light" : "dark";
                setTheme(nextTheme);
                onThemePreview(nextTheme);
              }}
              role="switch"
              aria-checked={theme === "dark"}
              aria-label={t.profile.theme || "Тема"}
            >
              <span className="profile-theme-switch-track">
                <span className={`profile-theme-thumb ${activeThemeMeta.id}`} aria-hidden="true">
                  <span className={`profile-theme-badge ${activeThemeMeta.id}`}>{activeThemeMeta.symbol}</span>
                </span>
                <span className="profile-theme-switch-copy">
                  <strong>{activeThemeMeta.label}</strong>
                  <small>{activeThemeMeta.hint}</small>
                </span>
              </span>
            </button>
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
