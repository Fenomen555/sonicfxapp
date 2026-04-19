import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminApp from "./admin/AdminApp";
import AppToasts from "./components/AppToasts";
import BottomNav from "./components/BottomNav";
import OnboardingScreen from "./components/OnboardingScreen";
import { apiAdminFetchJson, apiFetchJson, isAdminRoute, isTelegramWebAppAvailable } from "./lib/api";
import { getDeviceProfile } from "./lib/device";
import { initTelegramApp } from "./lib/tgSetup";
import { texts } from "./locales/texts";
import HomePage from "./pages/HomePage";
import NewsPage from "./pages/NewsPage";
import ProfilePage from "./pages/ProfilePage";

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function normalizeLang(value) {
  return texts[value] ? value : "ru";
}

const FALLBACK_USER = {
  user_id: 0,
  tg_username: "",
  first_name: "",
  mini_username: "",
  lang: "ru",
  timezone: "Europe/Kiev",
  theme: "dark",
  activation_status: "inactive",
  scanner_access: 0,
  deposit_amount: 0,
  onboarding_seen: 0
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(FALLBACK_USER);
  const [tab, setTab] = useState("home");
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [manualOnboarding, setManualOnboarding] = useState(false);
  const [isTgWebApp, setIsTgWebApp] = useState(true);
  const [botUsername, setBotUsername] = useState("");
  const [safeAreaTop, setSafeAreaTop] = useState(0);
  const [contentAreaTop, setContentAreaTop] = useState(56);
  const [device, setDevice] = useState(() => getDeviceProfile());
  const [adminInitDone, setAdminInitDone] = useState(false);
  const [adminUser, setAdminUser] = useState(null);
  const [adminAuthError, setAdminAuthError] = useState("");
  const [toastItems, setToastItems] = useState([]);
  const toastTimersRef = useRef(new Map());

  const adminMode = useMemo(() => isAdminRoute(), []);
  const lang = useMemo(() => normalizeLang(user.lang), [user.lang]);
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
    document.documentElement.setAttribute("data-theme", normalizeTheme(user.theme));
  }, [user.theme]);

  useEffect(() => () => {
    toastTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    toastTimersRef.current.clear();
  }, []);

  const dismissToast = useCallback((id) => {
    const timerId = toastTimersRef.current.get(id);
    if (timerId) {
      window.clearTimeout(timerId);
      toastTimersRef.current.delete(id);
    }
    setToastItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(({ type = "info", title = "", message = "", duration = 3800 }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextToast = { id, type, title, message };
    setToastItems((prev) => [...prev.slice(-3), nextToast]);
    const timerId = window.setTimeout(() => {
      toastTimersRef.current.delete(id);
      setToastItems((prev) => prev.filter((item) => item.id !== id));
    }, Math.max(Number(duration) || 3800, 1600));
    toastTimersRef.current.set(id, timerId);
  }, []);

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

        setUser({
          ...FALLBACK_USER,
          ...(profile || {}),
          theme: normalizeTheme(profile?.theme),
          lang: normalizeLang(profile?.lang)
        });
        setManualOnboarding(false);
        setShowOnboarding(!Number(profile?.onboarding_seen || 0));
      } catch {
        if (!isActive) return;
        setUser(FALLBACK_USER);
        setShowOnboarding(true);
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

  async function handleOnboardingFinish() {
    setShowOnboarding(false);
    if (manualOnboarding) {
      setManualOnboarding(false);
      return;
    }
    try {
      const result = await apiFetchJson("/api/user/onboarding/seen", { method: "POST" });
      if (result?.user) {
        setUser((prev) => ({
          ...prev,
          ...result.user,
          theme: normalizeTheme(result.user.theme),
          lang: normalizeLang(result.user.lang)
        }));
      } else {
        setUser((prev) => ({ ...prev, onboarding_seen: 1 }));
      }
    } catch {
      setUser((prev) => ({ ...prev, onboarding_seen: 1 }));
    }
  }

  function openOnboardingFromProfile() {
    setManualOnboarding(true);
    setShowOnboarding(true);
  }

  if (isLoading) return <div className="loading-screen">Loading...</div>;

  const headerTopOffset = isDesktop
    ? 8
    : Math.max(contentAreaTop - (device.isCompactPhone ? 34 : 36), safeAreaTop + 8);
  const topPadding = Math.max(
    headerTopOffset + (isDesktop ? 56 : 60),
    isDesktop ? 78 : safeAreaTop + 64
  );
  const stableViewportHeight = showOnboarding
    ? Math.max(device.stableHeight || 0, window.innerHeight || 0, 1)
    : Math.max(device.stableHeight || 0, window.innerHeight || 0, 640);

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

  return (
    <div
      className={`app-shell ${showOnboarding ? "app-shell-onboarding" : ""} ${isDesktop ? "app-shell-desktop" : "app-shell-mobile"} ${device.isCompactPhone ? "app-shell-compact-phone" : ""}`}
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

      <main className={`app-main ${showOnboarding ? "app-main-onboarding" : ""}`}>
        {showOnboarding ? (
          <OnboardingScreen t={t.onboarding} onFinish={handleOnboardingFinish} />
        ) : (
          <>
            {tab === "news" && <NewsPage t={t} lang={lang} />}
            {tab === "home" && <HomePage t={t} notify={notify} />}
            {tab === "profile" && (
              <ProfilePage
                t={t}
                user={user}
                notify={notify}
                onUserUpdate={(next) => setUser((prev) => ({ ...prev, ...(next || {}) }))}
                onThemePreview={(theme) => setUser((prev) => ({ ...prev, theme: normalizeTheme(theme) }))}
                onLangPreview={(nextLang) => setUser((prev) => ({ ...prev, lang: normalizeLang(nextLang) }))}
                onOpenOnboarding={openOnboardingFromProfile}
              />
            )}
          </>
        )}
      </main>

      {!showOnboarding && <BottomNav tabs={tabs} activeTab={tab} onChange={setTab} />}
      <AppToasts items={toastItems} onDismiss={dismissToast} />
    </div>
  );
}

