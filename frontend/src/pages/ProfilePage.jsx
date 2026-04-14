import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../lib/api";

const LANGS = ["ru", "en", "uk"];
const THEMES = ["dark", "light"];

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
  const [miniUsername, setMiniUsername] = useState(user?.mini_username || "");
  const [timezone, setTimezone] = useState(user?.timezone || "Europe/Kiev");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState("success");
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setLang(user?.lang || "ru");
    setTheme(user?.theme || "dark");
    setMiniUsername(user?.mini_username || "");
    setTimezone(user?.timezone || "Europe/Kiev");
    setAvatarFailed(false);
  }, [user]);

  const profileName = useMemo(() => {
    const full = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    return full || user?.mini_username || user?.tg_username || t.profile.nameFallback || "Trader";
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
      },
      {
        key: "lastSeen",
        label: t.profile.lastSeen || "Последняя активность",
        value: formatProfileDate(user?.last_active_at, lang)
      }
    ],
    [lang, t, user]
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
          mini_username: miniUsername,
          timezone
        })
      });
      onUserUpdate(data?.user || user);
      onThemePreview(theme);
      onLangPreview(lang);
      setStatusTone("success");
      setStatusMessage(t.profile.saved);
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
            <span className="profile-kicker">{t.profile.title}</span>
            <h1 className="page-title">{profileName}</h1>
            <p>{user?.tg_username ? `@${user.tg_username}` : (t.profile.noUsername || "@username not set")}</p>
          </div>

          <div className={`profile-status-chip ${statusMeta.tone}`}>{statusMeta.label}</div>
        </div>

        <div className="profile-identity-list">
          <div>
            <span>{t.profile.userId}</span>
            <strong>{user?.user_id || "-"}</strong>
          </div>
          <div>
            <span>{t.profile.miniUsername}</span>
            <strong>{user?.mini_username || "—"}</strong>
          </div>
          <div>
            <span>{t.profile.username}</span>
            <strong>{user?.tg_username ? `@${user.tg_username}` : "—"}</strong>
          </div>
        </div>

        <div className="profile-summary-grid">
          {summaryCards.map((item) => (
            <article className="profile-summary-card" key={item.key}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>

        <div className="profile-note">{t.profile.avatarHint || "Аватар и данные Telegram автоматически обновляются при открытии Mini App."}</div>
      </div>

      <div className="card profile-section">
        <div className="profile-section-head">
          <strong>{t.profile.accountCardTitle || "Профиль в приложении"}</strong>
          <span>{t.profile.profileHint || "Управляй отображением профиля и визуальным стилем приложения."}</span>
        </div>

        <label className="field-label">{t.profile.miniUsername}</label>
        <input
          className="field-input"
          value={miniUsername}
          onChange={(e) => setMiniUsername(e.target.value)}
          maxLength={64}
        />

        <label className="field-label">{t.profile.timezone}</label>
        <input className="field-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </div>

      <div className="card profile-section">
        <div className="profile-section-head">
          <strong>{t.profile.appearanceTitle || "Интерфейс"}</strong>
          <span>{t.profile.appearanceHint || "Выбери язык и тему. Предпросмотр меняется сразу."}</span>
        </div>

        <label className="field-label">{t.profile.lang}</label>
        <div className="profile-chip-group">
          {LANGS.map((item) => (
            <button
              key={item}
              type="button"
              className={`profile-chip ${lang === item ? "active" : ""}`}
              onClick={() => {
                setLang(item);
                onLangPreview(item);
              }}
            >
              {item === "ru" ? t.profile.langRu : item === "en" ? t.profile.langEn : t.profile.langUk}
            </button>
          ))}
        </div>

        <label className="field-label">{t.profile.theme}</label>
        <div className="profile-chip-group">
          {THEMES.map((item) => (
            <button
              key={item}
              type="button"
              className={`profile-chip ${theme === item ? "active" : ""}`}
              onClick={() => {
                setTheme(item);
                onThemePreview(item);
              }}
            >
              {item === "dark" ? t.profile.themeDark : t.profile.themeLight}
            </button>
          ))}
        </div>

        <button className="primary-btn profile-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? (t.profile.saving || "Saving...") : t.profile.save}
        </button>
        {statusMessage && <div className={`form-status ${statusTone}`}>{statusMessage}</div>}
      </div>
    </section>
  );
}
