import { useEffect, useMemo, useState } from "react";
import ReactCountryFlag from "react-country-flag";
import { apiFetchJson } from "../lib/api";

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

function formatProfileDate(value, lang) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const locale = lang === "en" ? "en-GB" : lang === "uk" ? "uk-UA" : "ru-RU";
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getStatusMeta(status, t) {
  if (status === "active_scanner") {
    return {
      label: t.profile.statusScanner || "Сканер активен",
      tone: "scanner"
    };
  }
  if (status === "active") {
    return {
      label: t.profile.statusActive || "Активен",
      tone: "active"
    };
  }
  return {
    label: t.profile.statusInactive || "Не активирован",
    tone: "inactive"
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

  useEffect(() => {
    setLang(user?.lang || "ru");
    setTheme(user?.theme || "dark");
    setTimezone(user?.timezone || "Europe/Kiev");
    setAvatarFailed(false);
  }, [user]);

  const profileName = useMemo(() => {
    const full = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    return full || user?.tg_username || t.profile.nameFallback || "Trader";
  }, [t.profile.nameFallback, user]);

  const statusMeta = useMemo(
    () => getStatusMeta(user?.activation_status || "inactive", t),
    [t, user?.activation_status]
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

  const languageOptions = useMemo(
    () => [
      { id: "ru", label: t.profile.langRu || "Русский", flag: "RU" },
      { id: "en", label: t.profile.langEn || "English", flag: "GB" },
      { id: "uk", label: t.profile.langUk || "Український", flag: "UA" }
    ],
    [t.profile.langEn, t.profile.langRu, t.profile.langUk]
  );

  const themeOptions = useMemo(
    () => [
      { id: "dark", label: t.profile.themeDark || "Темная", tone: "dark" },
      { id: "light", label: t.profile.themeLight || "Светлая", tone: "light" }
    ],
    [t.profile.themeDark, t.profile.themeLight]
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

          <div className={`profile-status-chip ${statusMeta.tone}`}>{statusMeta.label}</div>
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
      </div>

      <div className="card profile-section profile-settings-shell">
        <div className="profile-section-head">
          <strong>{t.profile.settingsTitle || "Настройки"}</strong>
          <span>{t.profile.settingsHint || "Язык, тема и часовой пояс применяются сразу."}</span>
        </div>

        <div className="profile-settings-grid">
          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.timezone || "Часовой пояс"}</label>
            <input className="field-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
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
            <div className="profile-theme-switch">
              {themeOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`profile-theme-chip ${theme === item.id ? "active" : ""}`}
                  onClick={() => {
                    setTheme(item.id);
                    onThemePreview(item.id);
                  }}
                >
                  <span className={`profile-theme-swatch ${item.tone}`} aria-hidden="true" />
                  <span className="profile-theme-copy">{item.label}</span>
                </button>
              ))}
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
