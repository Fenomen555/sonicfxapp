import { useEffect, useMemo, useState } from "react";
import AdminApp from "./admin/AdminApp";
import BottomNav from "./components/BottomNav";
import { apiAdminFetchJson, apiFetchJson, isAdminRoute, isTelegramWebAppAvailable } from "./lib/api";
import { getDeviceProfile } from "./lib/device";
import { initTelegramApp } from "./lib/tgSetup";
import { texts } from "./locales/texts";
import HomePage from "./pages/HomePage";
import NewsPage from "./pages/NewsPage";
import ProfilePage from "./pages/ProfilePage";

const THEME_STORAGE_KEY = "sonicfx_theme";

function getStoredTheme() {
  if (typeof window === "undefined") return "dark";
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

const FALLBACK_USER = {
  user_id: 0,
  tg_username: "",
  first_name: "",
  mini_username: "",
  lang: "ru",
  timezone: "Europe/Kiev",
  theme: getStoredTheme(),
  activation_status: "inactive",
  scanner_access: 0,
  deposit_amount: 0
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(FALLBACK_USER);
  const [tab, setTab] = useState("home");
  const [isTgWebApp, setIsTgWebApp] = useState(true);
  const [botUsername, setBotUsername] = useState("");
  const [safeAreaTop, setSafeAreaTop] = useState(0);
  const [contentAreaTop, setContentAreaTop] = useState(56);
  const [device, setDevice] = useState(() => getDeviceProfile());
  const [adminInitDone, setAdminInitDone] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [adminAuthError, setAdminAuthError] = useState("");

  const adminMode = useMemo(() => isAdminRoute(), []);
  const lang = useMemo(() => (texts[user.lang] ? user.lang : "ru"), [user.lang]);
  const t = texts[lang];
  const isDesktop = device.isDesktop;

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    const updateDevice = () => {
      setDevice(getDeviceProfile());
    };

    updateDevice();
    window.addEventListener("resize", updateDevice);
    if (tg?.onEvent) tg.onEvent("viewportChanged", updateDevice);

    return () => {
      window.removeEventListener("resize", updateDevice);
      if (tg?.offEvent) tg.offEvent("viewportChanged", updateDevice);
    };
  }, []);

  useEffect(() => {
    const nextTheme = user.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {}
  }, [user.theme]);

  useEffect(() => {
    let isActive = true;
    async function bootstrap() {
      const hasTg = isTelegramWebAppAvailable();
      if (!hasTg) {
        setIsTgWebApp(false);
        try {
          const info = await apiFetchJson("/api/webapp/bot-info");
          if (isActive) setBotUsername(info?.bot_username || "");
        } catch {
          if (isActive) setBotUsername("");
        } finally {
          if (isActive) setIsLoading(false);
        }
        return;
      }

      setIsTgWebApp(true);
      try {
        await initTelegramApp();

        if (adminMode) {
          try {
            const me = await apiAdminFetchJson("/api/admin/me");
            if (!isActive) return;
            setAdminUser(me?.user || null);
            setAdminAuthError("");
          } catch (error) {
            if (!isActive) return;
            setAdminUser(null);
            setAdminAuthError(error.message || "Admin auth failed");
          } finally {
            if (isActive) {
              setAdminInitDone(true);
              setIsLoading(false);
            }
          }
          return;
        }

        await apiFetchJson("/api/user/sync", { method: "POST" });
        const profile = await apiFetchJson("/api/user/profile", { method: "POST" });
        if (!isActive) return;
        setUser({ ...FALLBACK_USER, ...(profile || {}), theme: (profile?.theme === "light" ? "light" : getStoredTheme()) });
      } catch {
        if (!isActive) return;
        setUser({ ...FALLBACK_USER, theme: getStoredTheme() });
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    bootstrap();
    return () => {
      isActive = false;
    };
  }, [adminMode]);

  useEffect(() => {
    if (adminMode) return;
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const updateInsets = () => {
      const root = window.getComputedStyle(document.documentElement);
      const cssSafeTop = parseFloat(root.getPropertyValue("--tg-safe-area-inset-top")) || 0;
      const cssContentTop = parseFloat(root.getPropertyValue("--tg-content-safe-area-inset-top")) || 0;

      const platform = (tg?.platform || "").toLowerCase();
      const isDesktopPlatform = platform === "tdesktop" || platform === "web" || platform === "macos";

      let sTop = Number(tg?.safeAreaInset?.top ?? cssSafeTop ?? 0);
      let cTop = Number(tg?.contentSafeAreaInset?.top ?? cssContentTop ?? 0);

      if (isDesktopPlatform) {
        if (!sTop) sTop = 0;
        if (!cTop) cTop = 0;
      } else if (!cTop || cTop <= sTop) {
        cTop = Math.max(sTop + 56, 60);
      }

      setSafeAreaTop(sTop);
      setContentAreaTop(cTop);
    };

    if (typeof tg.requestSafeArea === "function") tg.requestSafeArea();
    if (typeof tg.requestContentSafeArea === "function") tg.requestContentSafeArea();
    updateInsets();
    const timer = setTimeout(updateInsets, 300);

    if (tg.onEvent) {
      tg.onEvent("contentSafeAreaChanged", updateInsets);
      tg.onEvent("safeAreaChanged", updateInsets);
    }
    if (tg.BackButton?.hide) {
      tg.BackButton.hide();
    }

    return () => {
      clearTimeout(timer);
      if (tg.offEvent) {
        tg.offEvent("contentSafeAreaChanged", updateInsets);
        tg.offEvent("safeAreaChanged", updateInsets);
      }
    };
  }, [adminMode]);

  if (isLoading) return <div className="loading-screen">Loading...</div>;

  if (!isTgWebApp) {
    return (
      <div className="open-via-bot">
        <h1>{t.openViaBotTitle}</h1>
        <p>{t.openViaBotHint}</p>
        {botUsername && (
          <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">
            @{botUsername}
          </a>
        )}
      </div>
    );
  }

  if (adminMode) {
    if (!adminInitDone) return <div className="loading-screen">Loading...</div>;
    return <AdminApp adminUser={adminUser} authError={adminAuthError} />;
  }

  const tabs = [
    { id: "news", label: t.nav.news || "Новости" },
    { id: "home", label: t.nav.home || "Главная" },
    { id: "profile", label: t.nav.profile || "Профиль" }
  ];

  const headerTopOffset = isDesktop
    ? 8
    : Math.max(contentAreaTop - (device.isCompactPhone ? 34 : 36), safeAreaTop + 8);
  const topPadding = Math.max(
    headerTopOffset + (isDesktop ? 56 : 60),
    isDesktop ? 78 : safeAreaTop + 64
  );
  const stableViewportHeight = Math.max(device.stableHeight || 0, window.innerHeight || 0, 640);

  return (
    <div
      className={`app-shell ${isDesktop ? "app-shell-desktop" : "app-shell-mobile"} ${device.isCompactPhone ? "app-shell-compact-phone" : ""}`}
      style={{
        "--top-padding": `${topPadding}px`,
        "--app-stable-height": `${stableViewportHeight}px`,
        "--app-header-top": `${headerTopOffset}px`
      }}
    >
      <header className="app-header">
        <button
          type="button"
          className="brand-pill brand-pill-button"
          onClick={() => setTab("home")}
          aria-label={t.nav.home || "Главная"}
        >
          <span className="brand-main">Sonic</span>
          <span className="brand-fx">fx</span>
        </button>
      </header>

      <main className="app-main">
        {tab === "news" && <NewsPage t={t} lang={lang} />}
        {tab === "home" && <HomePage t={t} />}
        {tab === "profile" && (
          <ProfilePage
            t={t}
            user={user}
            onUserUpdate={(next) => setUser((prev) => ({ ...prev, ...(next || {}) }))}
            onThemePreview={(theme) => setUser((prev) => ({ ...prev, theme }))}
            onLangPreview={(nextLang) => setUser((prev) => ({ ...prev, lang: nextLang }))}
          />
        )}
      </main>

      <BottomNav tabs={tabs} activeTab={tab} onChange={setTab} />
    </div>
  );
}

