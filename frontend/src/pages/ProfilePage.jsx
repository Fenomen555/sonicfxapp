import { useEffect, useState } from "react";
import { apiFetchJson } from "../lib/api";

const LANGS = ["ru", "en", "uk"];
const THEMES = ["dark", "light"];

export default function ProfilePage({ t, user, onUserUpdate, onThemePreview, onLangPreview }) {
  const [lang, setLang] = useState(user?.lang || "ru");
  const [theme, setTheme] = useState(user?.theme || "dark");
  const [miniUsername, setMiniUsername] = useState(user?.mini_username || "");
  const [timezone, setTimezone] = useState(user?.timezone || "Europe/Kiev");
  const [statusMessage, setStatusMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLang(user?.lang || "ru");
    setTheme(user?.theme || "dark");
    setMiniUsername(user?.mini_username || "");
    setTimezone(user?.timezone || "Europe/Kiev");
  }, [user]);

  const onSave = async () => {
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
      setStatusMessage(t.profile.saved);
    } catch (error) {
      setStatusMessage(error.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page page-profile">
      <h1 className="page-title">{t.profile.title}</h1>

      <div className="card profile-top">
        <div><strong>{t.profile.userId}:</strong> {user?.user_id || "-"}</div>
        <div><strong>{t.profile.username}:</strong> @{user?.tg_username || "-"}</div>
        <div><strong>{t.profile.status}:</strong> {user?.activation_status || "inactive"}</div>
      </div>

      <div className="card form-card">
        <label className="field-label">{t.profile.miniUsername}</label>
        <input
          className="field-input"
          value={miniUsername}
          onChange={(e) => setMiniUsername(e.target.value)}
          maxLength={64}
        />

        <label className="field-label">{t.profile.lang}</label>
        <select
          className="field-input"
          value={lang}
          onChange={(e) => {
            const next = e.target.value;
            setLang(next);
            onLangPreview(next);
          }}
        >
          {LANGS.map((item) => (
            <option key={item} value={item}>
              {item === "ru" ? t.profile.langRu : item === "en" ? t.profile.langEn : t.profile.langUk}
            </option>
          ))}
        </select>

        <label className="field-label">{t.profile.theme}</label>
        <select
          className="field-input"
          value={theme}
          onChange={(e) => {
            const next = e.target.value;
            setTheme(next);
            onThemePreview(next);
          }}
        >
          {THEMES.map((item) => (
            <option key={item} value={item}>
              {item === "dark" ? t.profile.themeDark : t.profile.themeLight}
            </option>
          ))}
        </select>

        <label className="field-label">{t.profile.timezone}</label>
        <input className="field-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />

        <button className="primary-btn" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : t.profile.save}
        </button>
        {statusMessage && <div className="form-status">{statusMessage}</div>}
      </div>
    </section>
  );
}
