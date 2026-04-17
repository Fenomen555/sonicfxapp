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
        <div className={`profile-ribbon profile-ribbon-${statusMeta.tone}`}>
          <span>{statusMeta.label}</span>
        </div>

        <div className="profile-hero-top">
          <div className="profile-avatar-shell">
            {user?.photo_url && !avatarFailed ? (
              <img className="profile-avatar-image" src={user.photo_url} alt="" onError={() => setAvatarFailed(true)} />
            ) : (
              <div className="profile-avatar-fallback">{getInitials(user, "SF")}</div>
            )}
          </div>

          <div className="profile-hero-copy">
            <h1 className="page-title">{profileName}</h1>
            <p>{user?.tg_username ? `@${user.tg_username}` : ""}</p>
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
      </div>

      <div className="card profile-section profile-settings-shell">
        <div className="profile-settings-grid">

          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.lang}</label>
            <div className="profile-chip-group profile-chip-group-languages">
              {languageOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`profile-chip ${lang === item.id ? "active" : ""}`}
                  onClick={() => {
                    setLang(item.id);
                    onLangPreview(item.id);
                  }}
                >
                  <ReactCountryFlag svg countryCode={item.flag} />
                </button>
              ))}
            </div>
          </div>

          <div className="profile-setting-block profile-setting-block-wide">
            <button
              type="button"
              className={`profile-theme-switch ${theme === "dark" ? "is-dark" : "is-light"}`}
              onClick={() => {
                const nextTheme = theme === "dark" ? "light" : "dark";
                setTheme(nextTheme);
                onThemePreview(nextTheme);
              }}
            >
              <span className={`profile-theme-thumb ${activeThemeMeta.id}`}>
                {activeThemeMeta.symbol}
              </span>
            </button>
          </div>

        </div>

        <button className="primary-btn" onClick={handleSave} disabled={saving}>
          Save
        </button>
      </div>
    </section>
  );
}
