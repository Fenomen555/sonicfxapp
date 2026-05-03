import { useEffect, useMemo, useState } from "react";
import { apiAdminFetchJson } from "../lib/api";
import { getDeviceProfile } from "../lib/device";
import { getIndicatorMeta } from "../lib/indicatorMeta";
import "./admin.css";

const TABS = [
  { id: "stats", label: "Обзор", subtitle: "Статистика и активность" },
  { id: "users", label: "Пользователи", subtitle: "Карточки, поиск и фильтры" },
  { id: "statuses", label: "Статусы", subtitle: "Доступы и лимиты" },
  { id: "flags", label: "Функции", subtitle: "Управление режимами" },
  { id: "market", label: "Рынок", subtitle: "Пары и синхронизация" },
  { id: "indicators", label: "Индикаторы", subtitle: "Каталог и доступность" },
  { id: "support", label: "Поддержка", subtitle: "Ссылки и контакты" }
];

const FLAG_META = {
  mode_scanner_enabled: {
    title: "Сканер",
    short: "SCN",
    description: "AI анализ графика по скриншоту или ссылке."
  },
  mode_ai_enabled: {
    title: "Авто режим",
    short: "AI",
    description: "Автоматический live-поток сигналов по выбранной паре."
  },
  mode_indicators_enabled: {
    title: "Индикаторы",
    short: "IND",
    description: "Сигналы по рынку, тикеру, экспирации и индикатору."
  }
};

const SCANNER_MODE_META = {
  aggressive: {
    title: "Агрессивный",
    short: "AGG",
    description: "Максимум сигналов. Подойдет, когда важна частота входов."
  },
  adaptive: {
    title: "Адаптивный",
    short: "ADP",
    description: "Баланс между частотой и качеством. Оптимальный режим по умолчанию."
  },
  minimal: {
    title: "Минимальный",
    short: "MIN",
    description: "Только самые чистые сценарии с повышенной точностью."
  }
};

const MODE_FLAG_KEYS = ["mode_scanner_enabled", "mode_ai_enabled", "mode_indicators_enabled"];

const ACCOUNT_TIER_META = {
  trader: { label: "Trader", tone: "accent" },
  premium: { label: "Premium", tone: "success" },
  pro: { label: "Premium", tone: "success" },
  vip: { label: "VIP", tone: "warning" },
  unlimited: { label: "Unlimited", tone: "success" }
};

const STATUS_EDITOR_DEFAULT = {
  code: "",
  name: "",
  description: "",
  is_enabled: 1,
  sort_order: 100,
  access_required: 0,
  min_deposit: 0,
  scanner_enabled: 0,
  scanner_limit: 0,
  scanner_window_hours: 3,
  live_enabled: 0,
  live_limit: 0,
  live_window_hours: 3,
  indicators_enabled: 0,
  indicators_limit: 0,
  indicators_window_hours: 3,
  badge_text: "",
  marketing_text: ""
};

const normalizeStatusCode = (value = "") => (
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
);

const CYRILLIC_STATUS_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
};

const transliterateStatusName = (value = "") => (
  String(value || "")
    .toLowerCase()
    .split("")
    .map((char) => CYRILLIC_STATUS_MAP[char] ?? char)
    .join("")
);

const buildStatusCodeFromName = (value = "") => normalizeStatusCode(transliterateStatusName(value));

const buildStatusBadgeFromName = (value = "") => {
  const code = buildStatusCodeFromName(value);
  if (!code) return "";
  return code.replace(/_/g, "").slice(0, 12).toUpperCase();
};

const normalizeStatusSortOrderForEditor = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return numeric > 9 && numeric % 10 === 0 ? numeric / 10 : numeric;
};

const FILTER_DEFAULTS = {
  status: "all",
  access: "all",
  deposit: "all",
  registered: "all"
};

const EMPTY_MARKET_SETTINGS = {
  market_pairs_sync_interval_min: 5,
  interval_options: [],
  items: []
};

const EMPTY_INDICATOR_SETTINGS = {
  items: [],
  summary: {
    total: 0,
    enabled: 0,
    disabled: 0
  }
};

const EMPTY_SUPPORT_SETTINGS = {
  channel_url: "https://t.me/+TthmjdpAkv5hNjdi",
  support_url: "https://t.me/WaySonic"
};

const EMPTY_REGISTRATION_SETTINGS = {
  registration_url: ""
};

const EMPTY_SCANNER_SETTINGS = {
  analysis_mode: "adaptive",
  analysis_mode_label: "АДАПТИВНЫЙ",
  api_key_configured: false,
  api_key_preview: "",
  model: "gpt-4.1-mini",
  active_signals_limit: 3,
  active_signals_limit_options: [1, 2, 3],
  mode_options: [
    { key: "aggressive", label: "АГРЕССИВНЫЙ" },
    { key: "adaptive", label: "АДАПТИВНЫЙ" },
    { key: "minimal", label: "МИНИМАЛЬНЫЙ" }
  ]
};

function TabGlyph({ kind }) {
  if (kind === "stats") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 19h14" />
        <path d="M7.5 15.5v-4" />
        <path d="M12 15.5V8.5" />
        <path d="M16.5 15.5v-6" />
      </svg>
    );
  }
  if (kind === "users") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="2.5" />
        <path d="M4.8 17.2a4.8 4.8 0 0 1 8.4 0" />
        <circle cx="16.8" cy="10.2" r="2" />
        <path d="M14.3 17.2a4.1 4.1 0 0 1 5-.8" />
      </svg>
    );
  }
  if (kind === "flags") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 6.5h10l-2.4 3.2L17 13H7V6.5Z" />
        <path d="M7 5v14" />
      </svg>
    );
  }
  if (kind === "indicators") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 18h12" />
        <path d="M8 16V8" />
        <path d="M12 16V5" />
        <path d="M16 16v-6" />
        <path d="M5 10.5h3" />
        <path d="M11 8.5h3" />
        <path d="M15 12.5h3" />
      </svg>
    );
  }
  if (kind === "support") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 17.5H6a3 3 0 0 1-3-3v-2a8.5 8.5 0 0 1 17 0v2a3 3 0 0 1-3 3h-.5" />
        <path d="M7 12.5v3.2a2 2 0 0 1-2 2" />
        <path d="M17 12.5v3.2a2 2 0 0 0 2 2" />
        <path d="M9.5 19h5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 18.5h14.4" />
      <path d="M8 16v-4.8" />
      <path d="M12 16V8.5" />
      <path d="M16 16v-6.2" />
      <path d="m6.8 11.7 2.6-1.8 2.4 1.4 5-3.3" />
    </svg>
  );
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("ru-RU").format(numeric);
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function getFlagMeta(key) {
  return FLAG_META[key] || {
    title: key,
    short: "FX",
    description: "Служебный переключатель приложения."
  };
}

function compactSecretPreview(value, isConfigured) {
  if (!isConfigured) return "Не задан";
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean) return "sk-...активен";

  const normalized = clean
    .replace(/[•*]+/g, "…")
    .replace(/\.{2,}/g, "…")
    .replace(/…+/g, "…");

  if (normalized.includes("…")) {
    const [startPart, ...tailParts] = normalized.split("…");
    const tail = tailParts.join("").slice(-4);
    return `${startPart.slice(0, 8) || "sk"}...${tail || "****"}`;
  }

  if (normalized.length <= 14) return normalized;
  return `${normalized.slice(0, 7)}...${normalized.slice(-4)}`;
}

function getAccountTierMeta(tier, statuses = []) {
  const code = String(tier || "trader").toLowerCase();
  const status = statuses.find((item) => String(item.code || "").toLowerCase() === code);
  if (status) {
    return {
      label: status.name || ACCOUNT_TIER_META[code]?.label || code,
      tone: ACCOUNT_TIER_META[code]?.tone || (Number(status.is_enabled || 0) === 1 ? "success" : "neutral")
    };
  }
  return ACCOUNT_TIER_META[code] || ACCOUNT_TIER_META.trader;
}

function isWithinRegistrationRange(value, filter) {
  if (!value || filter === "all") return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (filter === "today") {
    return date >= startToday;
  }

  const days = filter === "week" ? 7 : filter === "month" ? 30 : filter === "quarter" ? 90 : null;
  if (!days) return true;

  const threshold = new Date(now);
  threshold.setDate(now.getDate() - days);
  return date >= threshold;
}

function buildToast(type, title, message) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    message
  };
}

export default function AdminApp({ authError }) {
  const [tab, setTab] = useState("stats");
  const [menuExpanded, setMenuExpanded] = useState(true);
  const [marketDetailsExpanded, setMarketDetailsExpanded] = useState(false);
  const [device, setDevice] = useState(() => getDeviceProfile());
  const [safeAreaTop, setSafeAreaTop] = useState(0);
  const [contentAreaTop, setContentAreaTop] = useState(56);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [accountStatuses, setAccountStatuses] = useState([]);
  const [statusEditor, setStatusEditor] = useState(STATUS_EDITOR_DEFAULT);
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);
  const [statusSavingCode, setStatusSavingCode] = useState("");
  const [flags, setFlags] = useState([]);
  const [marketSettings, setMarketSettings] = useState(EMPTY_MARKET_SETTINGS);
  const [indicatorSettings, setIndicatorSettings] = useState(EMPTY_INDICATOR_SETTINGS);
  const [supportSettings, setSupportSettings] = useState(EMPTY_SUPPORT_SETTINGS);
  const [supportEditor, setSupportEditor] = useState(EMPTY_SUPPORT_SETTINGS);
  const [registrationSettings, setRegistrationSettings] = useState(EMPTY_REGISTRATION_SETTINGS);
  const [registrationEditor, setRegistrationEditor] = useState(EMPTY_REGISTRATION_SETTINGS);
  const [scannerSettings, setScannerSettings] = useState(EMPTY_SCANNER_SETTINGS);
  const [scannerEditor, setScannerEditor] = useState({ analysis_mode: "adaptive", api_key: "", active_signals_limit: 3 });
  const [scannerSettingsOpen, setScannerSettingsOpen] = useState(false);
  const [marketInterval, setMarketInterval] = useState("5");
  const [marketSaving, setMarketSaving] = useState(false);
  const [marketSavingKey, setMarketSavingKey] = useState("");
  const [supportSaving, setSupportSaving] = useState(false);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [scannerSaving, setScannerSaving] = useState(false);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [indicatorSavingCode, setIndicatorSavingCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [toastItems, setToastItems] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [userFilters, setUserFilters] = useState(FILTER_DEFAULTS);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userEditor, setUserEditor] = useState({ account_tier: "trader", trader_id: "" });
  const [userSaving, setUserSaving] = useState(false);
  const [userDeleting, setUserDeleting] = useState(false);
  const [flagSavingKey, setFlagSavingKey] = useState("");

  const pushToast = (type, title, message) => {
    const nextToast = buildToast(type, title, message);
    setToastItems((prev) => [...prev, nextToast]);
    window.setTimeout(() => {
      setToastItems((prev) => prev.filter((item) => item.id !== nextToast.id));
    }, 3600);
  };

  const selectedUser = useMemo(
    () => users.find((item) => item.user_id === selectedUserId) || null,
    [users, selectedUserId]
  );
  const accountStatusOptions = useMemo(() => {
    if (accountStatuses.length > 0) return accountStatuses;
    return [
      { code: "trader", name: "Trader", is_enabled: 1 },
      { code: "premium", name: "Premium", is_enabled: 1 },
      { code: "vip", name: "VIP", is_enabled: 1 },
      { code: "unlimited", name: "Unlimited", is_enabled: 1 }
    ];
  }, [accountStatuses]);

  const nextStatusSortOrder = useMemo(() => {
    const values = accountStatusOptions
      .map((item) => normalizeStatusSortOrderForEditor(item.sort_order))
      .filter((value) => Number.isFinite(value));
    return Math.max(0, ...values) + 1;
  }, [accountStatusOptions]);

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

    if (tg.onEvent) {
      tg.onEvent("contentSafeAreaChanged", updateInsets);
      tg.onEvent("safeAreaChanged", updateInsets);
    }

    return () => {
      if (tg.offEvent) {
        tg.offEvent("contentSafeAreaChanged", updateInsets);
        tg.offEvent("safeAreaChanged", updateInsets);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
    setUserEditor({
      account_tier: selectedUser.account_tier || "trader",
      trader_id: selectedUser.trader_id || ""
    });
  }, [selectedUser]);
  const loadCurrentTab = async (targetTab = tab, options = {}) => {
    const { silent = false } = options;
    if (!silent) setLoading(true);
    try {
      if (targetTab === "stats") {
        const data = await apiAdminFetchJson("/api/admin/stats");
        setStats(data);
      }
      if (targetTab === "users") {
        const [data, statusesData] = await Promise.all([
          apiAdminFetchJson("/api/admin/users?limit=200"),
          apiAdminFetchJson("/api/admin/statuses")
        ]);
        setUsers(data?.items || []);
        setAccountStatuses(statusesData?.items || []);
      }
      if (targetTab === "statuses") {
        const data = await apiAdminFetchJson("/api/admin/statuses");
        setAccountStatuses(data?.items || []);
      }
      if (targetTab === "flags") {
        const [flagsData, scannerData, registrationData] = await Promise.all([
          apiAdminFetchJson("/api/admin/feature-flags"),
          apiAdminFetchJson("/api/admin/scanner-settings"),
          apiAdminFetchJson("/api/admin/registration-settings")
        ]);
        setFlags(flagsData?.items || []);
        const nextScanner = { ...EMPTY_SCANNER_SETTINGS, ...(scannerData || {}) };
        const nextRegistration = { ...EMPTY_REGISTRATION_SETTINGS, ...(registrationData || {}) };
        setScannerSettings(nextScanner);
        setRegistrationSettings(nextRegistration);
        setRegistrationEditor(nextRegistration);
        setScannerEditor({
          analysis_mode: nextScanner.analysis_mode || "adaptive",
          api_key: "",
          active_signals_limit: Number(nextScanner.active_signals_limit || 3)
        });
      }
      if (targetTab === "market") {
        const data = await apiAdminFetchJson("/api/admin/market-settings");
        setMarketSettings(data || EMPTY_MARKET_SETTINGS);
        setMarketInterval(String(data?.market_pairs_sync_interval_min || 5));
      }
      if (targetTab === "indicators") {
        const data = await apiAdminFetchJson("/api/admin/indicators");
        setIndicatorSettings(data || EMPTY_INDICATOR_SETTINGS);
      }
      if (targetTab === "support") {
        const data = await apiAdminFetchJson("/api/admin/support-settings");
        const next = { ...EMPTY_SUPPORT_SETTINGS, ...(data || {}) };
        setSupportSettings(next);
        setSupportEditor(next);
      }
    } catch (error) {
      pushToast("error", "Не удалось загрузить раздел", error.message || "Попробуйте обновить данные ещё раз.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (authError) return;
    loadCurrentTab(tab);
  }, [tab, authError]);

  const refreshActiveTab = async () => {
    await loadCurrentTab(tab, { silent: true });
    pushToast("success", "Данные обновлены", "Панель получила актуальное состояние по выбранному разделу.");
  };

  const handleFilterChange = (key, value) => {
    setUserFilters((prev) => ({ ...prev, [key]: value }));
  };

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((item) => {
      const haystack = [
        String(item.user_id || ""),
        item.trader_id || "",
        item.tg_username || "",
        item.mini_username || "",
        item.first_name || ""
      ]
        .join(" ")
        .toLowerCase();

      if (query && !haystack.includes(query)) return false;
      if (userFilters.status !== "all" && item.account_tier !== userFilters.status) return false;
      if (userFilters.access === "with_access" && !item.scanner_access) return false;
      if (userFilters.access === "without_access" && item.scanner_access) return false;
      if (userFilters.deposit === "with_deposit" && Number(item.deposit_amount || 0) <= 0) return false;
      if (userFilters.deposit === "without_deposit" && Number(item.deposit_amount || 0) > 0) return false;
      if (!isWithinRegistrationRange(item.created_at, userFilters.registered)) return false;
      return true;
    });
  }, [userFilters, userSearch, users]);

  const statsCards = useMemo(() => {
    const usersTotal = Number(stats?.users_total || 0);
    const activatedTotal = Number(stats?.activated_total || 0);
    const scannerTotal = Number(stats?.scanner_total || 0);
    const signalsToday = Number(stats?.signals_today || 0);
    const activationRate = usersTotal > 0 ? (activatedTotal / usersTotal) * 100 : 0;
    const scannerRate = usersTotal > 0 ? (scannerTotal / usersTotal) * 100 : 0;
    const inactiveTotal = Math.max(usersTotal - activatedTotal, 0);

    return [
      { key: "users_total", label: "Всего пользователей", value: formatNumber(usersTotal), note: "База mini app", tone: "accent" },
      { key: "activated_total", label: "Активировано", value: formatNumber(activatedTotal), note: `Конверсия ${formatPercent(activationRate)}`, tone: "success" },
      { key: "scanner_total", label: "Доступ к сканеру", value: formatNumber(scannerTotal), note: `Охват ${formatPercent(scannerRate)}`, tone: "info" },
      { key: "signals_today", label: "Сигналов сегодня", value: formatNumber(signalsToday), note: "Текущая активность", tone: "warm" },
      { key: "inactive_total", label: "Без активации", value: formatNumber(inactiveTotal), note: "Потенциал для возврата", tone: "neutral" }
    ];
  }, [stats]);

  const statsHighlights = useMemo(() => {
    const usersTotal = Number(stats?.users_total || 0);
    const activatedTotal = Number(stats?.activated_total || 0);
    const scannerTotal = Number(stats?.scanner_total || 0);
    const signalsToday = Number(stats?.signals_today || 0);

    return [
      {
        key: "conversion",
        title: "Активация базы",
        value: usersTotal > 0 ? formatPercent((activatedTotal / usersTotal) * 100) : "0%",
        description: "Доля пользователей с доступом к продукту."
      },
      {
        key: "scanner_share",
        title: "Охват сканера",
        value: usersTotal > 0 ? formatPercent((scannerTotal / usersTotal) * 100) : "0%",
        description: `Сегодня отправлено ${formatNumber(signalsToday)} сигналов.`
      }
    ];
  }, [stats]);

  const tabCards = useMemo(() => {
    return TABS.map((item) => {
      if (item.id === "stats") {
        return { ...item, metric: `${formatNumber(stats?.users_total || 0)} пользователей` };
      }
      if (item.id === "users") {
        return { ...item, metric: `${formatNumber(users.length)} карточек` };
      }
      if (item.id === "statuses") {
        const activeStatuses = accountStatuses.filter((status) => Number(status.is_enabled || 0) === 1).length;
        return { ...item, metric: `${formatNumber(activeStatuses)} активных` };
      }
      if (item.id === "flags") {
        return {
          ...item,
          metric: `${formatNumber(
            MODE_FLAG_KEYS.filter((key) => Number(flags.find((flag) => flag.key === key)?.is_enabled ?? 1) === 1).length
          )} активных`
        };
      }
      if (item.id === "indicators") {
        return { ...item, metric: `${formatNumber(indicatorSettings.summary?.enabled || 0)} включено` };
      }
      if (item.id === "support") {
        const configured = [supportSettings.channel_url, supportSettings.support_url].filter(Boolean).length;
        return { ...item, metric: `${formatNumber(configured)} ссылки` };
      }
      const activeMarketCount = (marketSettings.items || []).filter((market) => Number(market.is_enabled ?? 1) === 1).length;
      return { ...item, metric: `${formatNumber(activeMarketCount)} активных` };
    });
  }, [
    flags,
    accountStatuses,
    indicatorSettings.summary?.enabled,
    marketSettings.items,
    stats?.users_total,
    supportSettings.channel_url,
    supportSettings.support_url,
    users.length
  ]);

  const modeFlags = useMemo(
    () =>
      MODE_FLAG_KEYS.map((key) => flags.find((item) => item.key === key) || { key, is_enabled: 1, updated_at: null }).filter(
        (item) => Boolean(FLAG_META[item.key])
      ),
    [flags]
  );

  const marketSummary = useMemo(() => {
    const items = marketSettings.items || [];
    const totals = items.reduce(
      (acc, item) => {
        acc.totalPairs += Number(item.total_count || 0);
        acc.activePairs += Number(item.active_count || 0);
        if (Number(item.is_enabled ?? 1) === 1) {
          acc.activeMarkets += 1;
        }
        if (item.last_seen_at && (!acc.lastSeenAt || new Date(item.last_seen_at) > new Date(acc.lastSeenAt))) {
          acc.lastSeenAt = item.last_seen_at;
        }
        return acc;
      },
      { totalPairs: 0, activePairs: 0, activeMarkets: 0, lastSeenAt: null }
    );

    return [
      { key: "active_pairs", label: "Активных пар", value: formatNumber(totals.activePairs), note: "Сейчас доступны в локальном кеше" },
      { key: "total_pairs", label: "Всего пар", value: formatNumber(totals.totalPairs), note: "Полный объём по всем рынкам" },
      { key: "markets_total", label: "Активных рынков", value: formatNumber(totals.activeMarkets), note: `Всего категорий: ${formatNumber(items.length)}` },
      { key: "last_sync", label: "Последний sync", value: totals.lastSeenAt ? formatDateTime(totals.lastSeenAt) : "-", note: "Время последнего обновления" }
    ];
  }, [marketSettings.items]);

  const indicatorItems = useMemo(() => {
    const query = indicatorSearch.trim().toLowerCase();
    return (indicatorSettings.items || []).filter((item) => {
      const meta = getIndicatorMeta(item.code, item.title, item.description);
      const haystack = `${item.code || ""} ${item.title || ""} ${item.description || ""} ${meta.short} ${meta.title}`.toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [indicatorSearch, indicatorSettings.items]);

  const indicatorSummaryCards = useMemo(() => {
    const summary = indicatorSettings.summary || EMPTY_INDICATOR_SETTINGS.summary;
    return [
      {
        key: "total",
        label: "Всего индикаторов",
        value: formatNumber(summary.total),
        note: "Полный каталог для режима индикаторов"
      },
      {
        key: "enabled",
        label: "Включено",
        value: formatNumber(summary.enabled),
        note: "Показываются пользователю в Mini App"
      },
      {
        key: "disabled",
        label: "Скрыто",
        value: formatNumber(summary.disabled),
        note: "Отключены и не выдаются на фронт"
      }
    ];
  }, [indicatorSettings.summary]);

  const headerTopOffset = device.isDesktop
    ? 8
    : Math.max(contentAreaTop - (device.isCompactPhone ? 34 : 36), safeAreaTop + 8);
  const shellTopPadding = Math.max(
    headerTopOffset + (device.isDesktop ? 56 : 60),
    device.isDesktop ? 84 : safeAreaTop + 72
  );

  const toggleFlag = async (item) => {
    setFlagSavingKey(item.key);
    try {
      const enabled = item.is_enabled === 1;
      await apiAdminFetchJson("/api/admin/feature-flags", {
        method: "POST",
        body: JSON.stringify({ key: item.key, is_enabled: enabled ? 0 : 1 })
      });
      const data = await apiAdminFetchJson("/api/admin/feature-flags");
      setFlags(data?.items || []);
      pushToast("success", enabled ? "Функция выключена" : "Функция включена", `${getFlagMeta(item.key).title} обновлена без ошибок.`);
    } catch (error) {
      pushToast("error", "Не удалось изменить функцию", error.message || "Попробуйте ещё раз.");
    } finally {
      setFlagSavingKey("");
    }
  };

  const refreshStatuses = async () => {
    const data = await apiAdminFetchJson("/api/admin/statuses");
    setAccountStatuses(data?.items || []);
  };

  const startCreateStatus = () => {
    setStatusEditor({
      ...STATUS_EDITOR_DEFAULT,
      code: "",
      name: "",
      badge_text: "",
      sort_order: nextStatusSortOrder
    });
    setStatusEditorOpen(true);
  };

  const editStatus = (item) => {
    const nextItem = { ...STATUS_EDITOR_DEFAULT, ...(item || {}) };
    setStatusEditor({
      ...nextItem,
      code: nextItem.code || buildStatusCodeFromName(nextItem.name),
      badge_text: nextItem.badge_text || buildStatusBadgeFromName(nextItem.name),
      sort_order: normalizeStatusSortOrderForEditor(nextItem.sort_order)
    });
    setStatusEditorOpen(true);
  };

  const updateStatusField = (key, value) => {
    setStatusEditor((prev) => ({ ...prev, [key]: value }));
  };

  const updateStatusName = (value) => {
    setStatusEditor((prev) => ({
      ...prev,
      name: value,
      code: buildStatusCodeFromName(value),
      badge_text: buildStatusBadgeFromName(value)
    }));
  };

  const updateStatusNumberField = (key, value) => {
    const nextValue = value === "" ? "" : Number(value);
    updateStatusField(key, Number.isNaN(nextValue) ? "" : nextValue);
  };

  const toggleStatusInline = (item) => {
    saveStatus({ ...item, is_enabled: Number(item?.is_enabled || 0) === 1 ? 0 : 1 });
  };

  const formatStatusLimit = (enabled, limit, windowHours) => {
    if (Number(enabled || 0) !== 1) return "Нет доступа";
    const numericLimit = Number(limit || 0);
    if (numericLimit < 0) return "Безлимит";
    if (numericLimit === 0) return "0 запросов";
    return `${numericLimit} / ${Number(windowHours || 1)} ч`;
  };

  const saveStatus = async (item = statusEditor) => {
    const payload = { ...STATUS_EDITOR_DEFAULT, ...(item || {}) };
    if (!String(payload.name || "").trim()) {
      pushToast("error", "Название обязательно", "Укажи имя статуса перед сохранением.");
      return;
    }
    const normalizedCode = buildStatusCodeFromName(payload.code || payload.name);
    if (!normalizedCode) {
      pushToast("error", "Код обязателен", "Для русских названий укажи латинский код, например premium_plus.");
      return;
    }
    payload.code = normalizedCode;
    payload.badge_text = payload.badge_text || buildStatusBadgeFromName(payload.name);
    [
      "sort_order",
      "access_required",
      "min_deposit",
      "scanner_enabled",
      "scanner_limit",
      "scanner_window_hours",
      "live_enabled",
      "live_limit",
      "live_window_hours",
      "indicators_enabled",
      "indicators_limit",
      "indicators_window_hours"
    ].forEach((key) => {
      if (payload[key] === "") payload[key] = STATUS_EDITOR_DEFAULT[key] ?? 0;
    });
    setStatusSavingCode(payload.code || "new");
    try {
      const data = await apiAdminFetchJson("/api/admin/statuses", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setAccountStatuses(data?.items || []);
      setStatusEditor(STATUS_EDITOR_DEFAULT);
      setStatusEditorOpen(false);
      pushToast("success", "Статус сохранён", `${payload.name} обновлён в системе доступов.`);
    } catch (error) {
      pushToast("error", "Не удалось сохранить статус", error.message || "Проверь поля и повтори.");
    } finally {
      setStatusSavingCode("");
    }
  };

  const deleteStatus = async (item) => {
    if (!item?.code) return;
    const confirmed = window.confirm(`Удалить статус ${item.name}? Пользователи с этим статусом останутся с ним.`);
    if (!confirmed) return;
    setStatusSavingCode(item.code);
    try {
      const data = await apiAdminFetchJson(`/api/admin/statuses/${encodeURIComponent(item.code)}`, { method: "DELETE" });
      setAccountStatuses(data?.items || []);
      pushToast("success", "Статус удалён", `${item.name} больше не показывается как доступный.`);
    } catch (error) {
      pushToast("error", "Не удалось удалить статус", error.message || "Попробуй ещё раз.");
    } finally {
      setStatusSavingCode("");
    }
  };

  const saveScannerSettings = async () => {
    setScannerSaving(true);
    try {
      const payload = {
        analysis_mode: scannerEditor.analysis_mode || "adaptive",
        api_key: scannerEditor.api_key.trim(),
        active_signals_limit: Number(scannerEditor.active_signals_limit || 3)
      };
      const data = await apiAdminFetchJson("/api/admin/scanner-settings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = { ...EMPTY_SCANNER_SETTINGS, ...(data || {}) };
      setScannerSettings(next);
      setScannerEditor({
        analysis_mode: next.analysis_mode || "adaptive",
        api_key: "",
        active_signals_limit: Number(next.active_signals_limit || 3)
      });
      pushToast(
        "success",
        "Сканер обновлён",
        payload.api_key ? "Режим анализа и GPT-ключ сохранены." : "Режим анализа сохранён. Текущий GPT-ключ оставлен без изменений."
      );
    } catch (error) {
      pushToast("error", "Не удалось сохранить сканер", error.message || "Проверьте ключ и повторите попытку.");
    } finally {
      setScannerSaving(false);
    }
  };

  const toggleIndicator = async (item) => {
    const enabled = Number(item?.is_enabled || 0) === 1;
    setIndicatorSavingCode(item.code);
    try {
      await apiAdminFetchJson("/api/admin/indicators", {
        method: "POST",
        body: JSON.stringify({ code: item.code, is_enabled: enabled ? 0 : 1 })
      });
      const data = await apiAdminFetchJson("/api/admin/indicators");
      setIndicatorSettings(data || EMPTY_INDICATOR_SETTINGS);
      const meta = getIndicatorMeta(item.code, item.title, item.description);
      pushToast(
        "success",
        enabled ? "Индикатор скрыт" : "Индикатор включён",
        `${meta.short} ${meta.title} ${enabled ? "убран из выдачи" : "снова доступен пользователям"}.`
      );
    } catch (error) {
      pushToast("error", "Не удалось обновить индикатор", error.message || "Попробуйте ещё раз.");
    } finally {
      setIndicatorSavingCode("");
    }
  };

  const saveMarketSettings = async () => {
    setMarketSaving(true);
    try {
      const nextValue = Number(marketInterval || 5);
      await apiAdminFetchJson("/api/admin/market-settings", {
        method: "POST",
        body: JSON.stringify({ market_pairs_sync_interval_min: nextValue })
      });
      const data = await apiAdminFetchJson("/api/admin/market-settings");
      setMarketSettings(data || EMPTY_MARKET_SETTINGS);
      setMarketInterval(String(data?.market_pairs_sync_interval_min || nextValue));
      pushToast("success", "Интервал обновлён", `Синхронизация валютных пар теперь идёт раз в ${nextValue} мин.`);
    } catch (error) {
      pushToast("error", "Не удалось сохранить интервал", error.message || "Проверьте значение и повторите попытку.");
    } finally {
      setMarketSaving(false);
    }
  };

  const saveSupportSettings = async () => {
    setSupportSaving(true);
    try {
      const payload = {
        channel_url: supportEditor.channel_url.trim(),
        support_url: supportEditor.support_url.trim()
      };
      const data = await apiAdminFetchJson("/api/admin/support-settings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = { ...EMPTY_SUPPORT_SETTINGS, ...(data || payload) };
      setSupportSettings(next);
      setSupportEditor(next);
      pushToast("success", "Ссылки поддержки сохранены", "Mini app получит актуальные кнопки поддержки.");
    } catch (error) {
      pushToast("error", "Не удалось сохранить поддержку", error.message || "Проверьте Telegram-ссылки и повторите попытку.");
    } finally {
      setSupportSaving(false);
    }
  };

  const saveRegistrationSettings = async () => {
    setRegistrationSaving(true);
    try {
      const payload = {
        registration_url: registrationEditor.registration_url.trim()
      };
      const data = await apiAdminFetchJson("/api/admin/registration-settings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = { ...EMPTY_REGISTRATION_SETTINGS, ...(data || payload) };
      setRegistrationSettings(next);
      setRegistrationEditor(next);
      pushToast("success", "Регистрация обновлена", "Кнопка регистрации на странице статусов получила актуальную ссылку.");
    } catch (error) {
      pushToast("error", "Не удалось сохранить регистрацию", error.message || "Проверьте ссылку и повторите попытку.");
    } finally {
      setRegistrationSaving(false);
    }
  };

  const toggleMarketStatus = async (item) => {
    const enabled = Number(item?.is_enabled ?? 1) === 1;
    const key = item?.key || "";
    if (!key) return;
    setMarketSavingKey(key);
    try {
      await apiAdminFetchJson("/api/admin/market-status", {
        method: "POST",
        body: JSON.stringify({ key, is_enabled: enabled ? 0 : 1 })
      });
      const data = await apiAdminFetchJson("/api/admin/market-settings");
      setMarketSettings(data || EMPTY_MARKET_SETTINGS);
      setMarketInterval(String(data?.market_pairs_sync_interval_min || marketInterval || 5));
      pushToast(
        "success",
        enabled ? "Рынок выключен" : "Рынок включён",
        `${item.title || key} ${enabled ? "скрыт из mini app" : "снова доступен пользователям"}.`
      );
    } catch (error) {
      pushToast("error", "Не удалось обновить рынок", error.message || "Попробуйте ещё раз.");
    } finally {
      setMarketSavingKey("");
    }
  };

  const saveUserCard = async () => {
    if (!selectedUser) return;
    setUserSaving(true);
    try {
      await apiAdminFetchJson("/api/admin/users/set-activation", {
        method: "POST",
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          account_tier: userEditor.account_tier,
          trader_id: userEditor.trader_id || ""
        })
      });

      const data = await apiAdminFetchJson("/api/admin/users?limit=200");
      setUsers(data?.items || []);
      const nextStats = await apiAdminFetchJson("/api/admin/stats");
      setStats(nextStats);
      pushToast("success", "Пользователь обновлён", `Карточка ${selectedUser.user_id} успешно сохранена.`);
    } catch (error) {
      pushToast("error", "Не удалось сохранить пользователя", error.message || "Изменения не были применены.");
    } finally {
      setUserSaving(false);
    }
  };

  const deleteUserCard = async () => {
    if (!selectedUser) return;
    const confirmed = window.confirm(`Удалить пользователя ${selectedUser.user_id}? Это действие нельзя отменить.`);
    if (!confirmed) return;

    setUserDeleting(true);
    try {
      await apiAdminFetchJson(`/api/admin/users/${selectedUser.user_id}`, { method: "DELETE" });
      setSelectedUserId(null);
      const data = await apiAdminFetchJson("/api/admin/users?limit=200");
      setUsers(data?.items || []);
      const nextStats = await apiAdminFetchJson("/api/admin/stats");
      setStats(nextStats);
      pushToast("success", "Пользователь удалён", `Карточка ${selectedUser.user_id} удалена из базы.`);
    } catch (error) {
      pushToast("error", "Не удалось удалить пользователя", error.message || "Попробуйте повторить действие позже.");
    } finally {
      setUserDeleting(false);
    }
  };
  if (authError) {
    return (
      <div
        className={`admin-shell ${device.isDesktop ? "admin-shell-desktop" : "admin-shell-mobile"}`}
        style={{
          "--admin-top-padding": `${shellTopPadding}px`,
          "--admin-header-top": `${headerTopOffset}px`
        }}
      >
        <header className="app-header admin-app-header">
          <button
            type="button"
            className="brand-pill brand-pill-button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="SonicFX admin"
          >
            <span className="brand-main">Sonic</span>
            <span className="brand-fx">fx</span>
          </button>
        </header>

        <div className="admin-card admin-empty-state">
          <div className="admin-empty-icon">!</div>
          <div className="admin-empty-copy">
            <strong>Админ-панель недоступна</strong>
            <span>{authError}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`admin-shell ${device.isDesktop ? "admin-shell-desktop" : "admin-shell-mobile"}`}
      style={{
        "--admin-top-padding": `${shellTopPadding}px`,
        "--admin-header-top": `${headerTopOffset}px`
      }}
    >
      <header className="app-header admin-app-header">
        <button
          type="button"
          className="brand-pill brand-pill-button"
          onClick={() => setTab("stats")}
          aria-label="Обзор админки"
        >
          <span className="brand-main">Sonic</span>
          <span className="brand-fx">fx</span>
        </button>
      </header>

      <section className="admin-toolbar admin-card">
        <div className="admin-toolbar-copy">
          <span className="admin-kicker">SonicFX Control</span>
          <h1>Центр управления</h1>
          <p>Пользователи, режимы, рынок и индикаторы в одном месте.</p>
        </div>
        <div className="admin-toolbar-actions">
          {loading && <span className="admin-sync-pill">Обновляем...</span>}
          <button className="admin-ghost-button" type="button" onClick={() => setMenuExpanded((prev) => !prev)}>
            {menuExpanded ? "Свернуть разделы" : "Развернуть разделы"}
          </button>
          <button className="admin-primary-button" type="button" onClick={refreshActiveTab}>
            Обновить данные
          </button>
        </div>
      </section>

      {menuExpanded && (
        <nav className="admin-section-grid admin-nav-grid" aria-label="Разделы админки">
          {tabCards.map((item) => (
            <button
              className={`admin-section-card ${tab === item.id ? "active" : ""}`}
              data-tab={item.id}
              key={item.id}
              onClick={() => setTab(item.id)}
              type="button"
            >
              <span className="admin-section-card-head">
                <span className="admin-section-accent" aria-hidden="true">
                  <TabGlyph kind={item.id} />
                </span>
                <span className="admin-section-metric">{item.metric}</span>
              </span>
              <span className="admin-section-content">
                <strong>{item.label}</strong>
                <small>{item.subtitle}</small>
              </span>
            </button>
          ))}
        </nav>
      )}

      <main className="admin-page-stack">
        {tab === "stats" && (
          <>
            <section className="admin-highlight-grid">
              {statsHighlights.map((item) => (
                <article className="admin-card admin-highlight-card" key={item.key}>
                  <span className="admin-highlight-title">{item.title}</span>
                  <strong>{item.value}</strong>
                  <p>{item.description}</p>
                </article>
              ))}
            </section>

            <section className="admin-kpi-grid">
              {statsCards.map((item) => (
                <article className={`admin-card admin-kpi-card tone-${item.tone}`} key={item.key}>
                  <span className="admin-kpi-label">{item.label}</span>
                  <strong className="admin-kpi-value">{item.value}</strong>
                  <span className="admin-kpi-note">{item.note}</span>
                </article>
              ))}
            </section>
          </>
        )}
        {tab === "users" && (
          <>
            <section className="admin-card admin-filter-card">
              <div className="admin-filter-head">
                <div>
                  <div className="admin-section-title">Поиск и фильтры</div>
                  <div className="admin-muted-text">Ищем по user id, trader id, username и имени пользователя.</div>
                </div>
                <div className="admin-filter-meta">Найдено: {filteredUsers.length}</div>
              </div>

              <div className="admin-filter-grid">
                <label className="admin-field admin-field-wide">
                  <span>Поиск</span>
                  <input
                    className="admin-input"
                    type="text"
                    placeholder="Например: 7097, TR-1024, devsbite"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </label>

                <label className="admin-field">
                  <span>Статус</span>
                  <select className="admin-select" value={userFilters.status} onChange={(e) => handleFilterChange("status", e.target.value)}>
                    <option value="all">Все статусы</option>
                    {accountStatusOptions.map((item) => (
                      <option key={item.code} value={item.code}>{item.name}</option>
                    ))}
                  </select>
                </label>

                <label className="admin-field">
                  <span>Доступ</span>
                  <select className="admin-select" value={userFilters.access} onChange={(e) => handleFilterChange("access", e.target.value)}>
                    <option value="all">Любой доступ</option>
                    <option value="with_access">Есть доступ</option>
                    <option value="without_access">Нет доступа</option>
                  </select>
                </label>

                <label className="admin-field">
                  <span>Депозит</span>
                  <select className="admin-select" value={userFilters.deposit} onChange={(e) => handleFilterChange("deposit", e.target.value)}>
                    <option value="all">Любой депозит</option>
                    <option value="with_deposit">Есть депозит</option>
                    <option value="without_deposit">Нет депозита</option>
                  </select>
                </label>

                <label className="admin-field">
                  <span>Дата регистрации</span>
                  <select className="admin-select" value={userFilters.registered} onChange={(e) => handleFilterChange("registered", e.target.value)}>
                    <option value="all">Все даты</option>
                    <option value="today">Сегодня</option>
                    <option value="week">Последние 7 дней</option>
                    <option value="month">Последние 30 дней</option>
                    <option value="quarter">Последние 90 дней</option>
                  </select>
                </label>
              </div>
            </section>

            {filteredUsers.length === 0 && (
              <section className="admin-card admin-empty-state">
                <div className="admin-empty-icon">0</div>
                <div className="admin-empty-copy">
                  <strong>Ничего не найдено</strong>
                  <span>Измени строку поиска или фильтры, чтобы увидеть другие карточки пользователей.</span>
                </div>
              </section>
            )}

            <section className="admin-user-grid">
              {filteredUsers.map((item) => {
                const tierMeta = getAccountTierMeta(item.account_tier, accountStatusOptions);
                return (
                  <button
                    className={`admin-user-card ${selectedUserId === item.user_id ? "active" : ""}`}
                    key={item.user_id}
                    onClick={() => setSelectedUserId(item.user_id)}
                    type="button"
                  >
                    <div className="admin-user-card-top">
                      <div>
                        <strong>{item.first_name || item.tg_username || "Без имени"}</strong>
                        <span>#{item.user_id}</span>
                      </div>
                      <span className={`admin-badge tone-${tierMeta.tone}`}>{tierMeta.label}</span>
                    </div>

                    <div className="admin-user-card-body">
                      <div className="admin-user-line">@{item.tg_username || "-"}</div>
                      <div className="admin-user-line">Trader ID: {item.trader_id || "-"}</div>
                    </div>

                    <div className="admin-user-chip-row">
                      <span className={`admin-mini-chip ${item.scanner_access ? "is-on" : ""}`}>{item.scanner_access ? "Сканер: да" : "Сканер: нет"}</span>
                      <span className={`admin-mini-chip ${item.trader_id ? "is-on" : ""}`}>Trader ID: {item.trader_id || "-"}</span>
                    </div>

                    <div className="admin-user-card-footer">Регистрация: {formatDate(item.created_at)}</div>
                  </button>
                );
              })}
            </section>
          </>
        )}

        {tab === "statuses" && (
          <>
            <section className="admin-card admin-status-hero">
              <div>
                <div className="admin-section-title">Статусы и доступы</div>
                <p>Настраиваем витрину статусов, депозитный порог и лимиты запросов по каждому режиму анализа.</p>
              </div>
              <button className="admin-primary-button" type="button" onClick={startCreateStatus}>
                Новый статус
              </button>
            </section>

            <section className="admin-status-list-grid">
              {accountStatusOptions.map((item) => {
                const enabled = Number(item.is_enabled || 0) === 1;
                return (
                  <article className={`admin-card admin-status-card ${enabled ? "is-enabled" : "is-disabled"}`} key={item.code}>
                    <div className="admin-status-card-head">
                      <div>
                        <span className="admin-status-code">{item.badge_text || item.code}</span>
                        <strong>{item.name}</strong>
                      </div>
                      <button
                        className={`admin-mode-switch ${enabled ? "is-on" : ""}`}
                        type="button"
                        disabled={statusSavingCode === item.code}
                        onClick={() => toggleStatusInline(item)}
                        aria-pressed={enabled}
                      >
                        <span>{statusSavingCode === item.code ? "..." : enabled ? "Включён" : "Выключен"}</span>
                        <i aria-hidden="true" />
                      </button>
                    </div>

                    <p>{item.description || "Статус без описания."}</p>

                    <div className="admin-status-limit-grid">
                      <span><b>Scanner</b>{formatStatusLimit(item.scanner_enabled, item.scanner_limit, item.scanner_window_hours)}</span>
                      <span><b>Live</b>{formatStatusLimit(item.live_enabled, item.live_limit, item.live_window_hours)}</span>
                      <span><b>Indicators</b>{formatStatusLimit(item.indicators_enabled, item.indicators_limit, item.indicators_window_hours)}</span>
                    </div>

                    <div className="admin-status-card-meta">
                      <span>Доступ: {Number(item.access_required || 0) === 1 ? "требуется" : "не требуется"}</span>
                      <span>Депозит: ${Number(item.min_deposit || 0)}</span>
                    </div>

                    <div className="admin-status-actions">
                      <button className="admin-ghost-button" type="button" onClick={() => editStatus(item)}>
                        Редактировать
                      </button>
                      <button
                        className="admin-danger-button"
                        type="button"
                        disabled={item.code === "trader" || statusSavingCode === item.code}
                        onClick={() => deleteStatus(item)}
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>

            {statusEditorOpen && (
            <section className="admin-card admin-status-editor-card">
              <div className="admin-filter-head">
                <div>
                  <div className="admin-section-title">{statusEditor.code ? `Редактируем ${statusEditor.name || statusEditor.code}` : "Новый статус"}</div>
                  <div className="admin-muted-text">Код нужен латиницей, если название на русском. Лимит -1 означает безлимит.</div>
                </div>
                <button className="admin-ghost-button" type="button" onClick={() => {
                  setStatusEditor(STATUS_EDITOR_DEFAULT);
                  setStatusEditorOpen(false);
                }}>
                  Закрыть
                </button>
              </div>

              <div className="admin-status-editor-grid">
                <label className="admin-field">
                  <span>Код</span>
                  <input className="admin-input" value={statusEditor.code || buildStatusCodeFromName(statusEditor.name)} readOnly placeholder="Автоматически" />
                  <span className="admin-field-hint">Создаётся из названия. Нужен системе для лимитов и выдачи статуса.</span>
                </label>
                <label className="admin-field">
                  <span>Название</span>
                  <input className="admin-input" value={statusEditor.name} onChange={(e) => updateStatusName(e.target.value)} placeholder="Premium" />
                </label>
                <label className="admin-field">
                  <span>Бейдж</span>
                  <input className="admin-input" value={statusEditor.badge_text || buildStatusBadgeFromName(statusEditor.name)} readOnly placeholder="Автоматически" />
                  <span className="admin-field-hint">Показывается в карточках и тоже формируется автоматически.</span>
                </label>
                <label className="admin-field">
                  <span>Порядок</span>
                  <input className="admin-input" type="number" value={statusEditor.sort_order} onChange={(e) => updateStatusNumberField("sort_order", e.target.value)} />
                  <span className="admin-field-hint">Обычный номер позиции: 1, 2, 3, 4.</span>
                </label>
                <label className="admin-field">
                  <span>Доступ по регистрации</span>
                  <select className="admin-select" value={Number(statusEditor.access_required || 0)} onChange={(e) => updateStatusNumberField("access_required", e.target.value)}>
                    <option value={0}>Не требуется</option>
                    <option value={1}>Требуется</option>
                  </select>
                </label>
                <label className="admin-field">
                  <span>Депозит от, $</span>
                  <input className="admin-input" type="number" min="0" step="0.01" value={statusEditor.min_deposit} onChange={(e) => updateStatusNumberField("min_deposit", e.target.value)} />
                </label>
                <label className="admin-field admin-field-wide">
                  <span>Описание</span>
                  <input className="admin-input" value={statusEditor.description || ""} onChange={(e) => updateStatusField("description", e.target.value)} placeholder="Коротко: кому подходит статус" />
                </label>
                <label className="admin-field admin-field-wide">
                  <span>Текст для mini app</span>
                  <textarea className="admin-textarea" value={statusEditor.marketing_text || ""} onChange={(e) => updateStatusField("marketing_text", e.target.value)} placeholder="Каждая строка станет пунктом в карточке статуса." />
                </label>
              </div>

              <div className="admin-status-mode-grid">
                {[
                  { key: "scanner", label: "Scanner" },
                  { key: "live", label: "Live" },
                  { key: "indicators", label: "Indicators" }
                ].map((mode) => {
                  const enabledKey = `${mode.key}_enabled`;
                  const limitKey = `${mode.key}_limit`;
                  const windowKey = `${mode.key}_window_hours`;
                  const enabled = Number(statusEditor[enabledKey] || 0) === 1;
                  return (
                    <article className={`admin-status-mode-card ${enabled ? "is-enabled" : "is-disabled"}`} key={mode.key}>
                      <div className="admin-status-mode-head">
                        <strong>{mode.label}</strong>
                        <button
                          className={`admin-mode-switch ${enabled ? "is-on" : ""}`}
                          type="button"
                          onClick={() => updateStatusNumberField(enabledKey, enabled ? 0 : 1)}
                          aria-pressed={enabled}
                        >
                          <span>{enabled ? "Есть" : "Нет"}</span>
                          <i aria-hidden="true" />
                        </button>
                      </div>
                      <label className="admin-field">
                        <span>Лимит запросов</span>
                        <input className="admin-input" type="number" value={statusEditor[limitKey]} onChange={(e) => updateStatusNumberField(limitKey, e.target.value)} placeholder="-1" />
                        <span className="admin-field-hint">-1 означает безлимитное количество запросов без ограничений.</span>
                      </label>
                      <label className="admin-field">
                        <span>Окно восстановления</span>
                        <select className="admin-select" value={Number(statusEditor[windowKey] || 3)} onChange={(e) => updateStatusNumberField(windowKey, e.target.value)}>
                          {[1, 3, 8, 12, 24].map((hours) => (
                            <option key={hours} value={hours}>{hours} ч</option>
                          ))}
                        </select>
                        <span className="admin-field-hint">
                          {Number(statusEditor[limitKey] || 0) < 0 ? "При безлимите окно не применяется, но значение можно оставить для будущих лимитов." : "Через это время запрос становится доступен снова."}
                        </span>
                      </label>
                    </article>
                  );
                })}
              </div>

              <div className="admin-status-editor-actions">
                <button className="admin-primary-button" type="button" disabled={Boolean(statusSavingCode)} onClick={() => saveStatus()}>
                  {statusSavingCode ? "Сохраняем..." : "Сохранить статус"}
                </button>
              </div>
            </section>
            )}
          </>
        )}

        {tab === "flags" && (
          <>
            <section className="admin-card admin-tab-intro">
              <div>
                <span className="admin-kicker">Функции</span>
                <strong>Что доступно в mini app</strong>
                <p>Здесь включаются режимы анализа, настраивается GPT для Scanner и ссылка регистрации для Trader ID.</p>
              </div>
            </section>

            <section className="admin-control-grid admin-mode-control-grid">
              {modeFlags.map((item) => {
                const meta = getFlagMeta(item.key);
                const enabled = item.is_enabled === 1;
                const isScannerCard = item.key === "mode_scanner_enabled";
                const scannerModeTitle = SCANNER_MODE_META[scannerEditor.analysis_mode]?.title || "Адаптивный";
                return (
                  <article
                    className={`admin-card admin-control-card admin-mode-control-card ${enabled ? "is-enabled" : "is-disabled"}`}
                    key={item.key}
                  >
                    <div className="admin-control-head">
                      <div className="admin-control-title-row">
                        <strong>{meta.title}</strong>
                      </div>
                      <button
                        className={`admin-mode-switch ${enabled ? "is-on" : ""}`}
                        disabled={flagSavingKey === item.key}
                        onClick={() => toggleFlag(item)}
                        type="button"
                        aria-pressed={enabled}
                      >
                        <span>{flagSavingKey === item.key ? "..." : enabled ? "Включено" : "Выключено"}</span>
                        <i aria-hidden="true" />
                      </button>
                    </div>

                    <p>{meta.description}</p>

                    {isScannerCard && (
                      <div className="admin-feature-summary">
                        <span>GPT режим</span>
                        <strong>{scannerModeTitle}</strong>
                        <small>{scannerSettings.model || "gpt-4.1-mini"} · {compactSecretPreview(scannerSettings.api_key_preview, scannerSettings.api_key_configured)}</small>
                      </div>
                    )}

                    <div className="admin-control-footer">
                      <span className={`admin-badge ${enabled ? "tone-success" : "tone-neutral"}`}>
                        {enabled ? "Отображается в mini app" : "Скрыт из mini app"}
                      </span>
                      <span className="admin-muted-text">Изменено: {formatDateTime(item.updated_at)}</span>
                    </div>

                    {isScannerCard && (
                      <button
                        className="admin-card-ghost-button"
                        type="button"
                        onClick={() => setScannerSettingsOpen((prev) => !prev)}
                      >
                        {scannerSettingsOpen ? "Скрыть настройки" : "Настройки"}
                      </button>
                    )}
                  </article>
                );
              })}
            </section>

            {scannerSettingsOpen && (
              <section className="admin-card admin-scanner-settings-panel">
                <div className="admin-scanner-panel-head">
                  <div className="admin-scanner-panel-title">
                    <span>GPT анализ скриншота</span>
                    <strong>Настройки SonicFX Scanner</strong>
                    <p>Выбери стиль анализа и обнови OpenAI ключ без перегруза карточек функций.</p>
                  </div>
                  <div className="admin-scanner-panel-badges">
                    <span className="admin-badge tone-accent">{scannerSettings.model || "gpt-4.1-mini"}</span>
                    <span className={`admin-badge ${scannerSettings.api_key_configured ? "tone-success" : "tone-neutral"}`}>
                      {compactSecretPreview(scannerSettings.api_key_preview, scannerSettings.api_key_configured)}
                    </span>
                  </div>
                </div>

                <div className="admin-scanner-mode-grid">
                  {(scannerSettings.mode_options || EMPTY_SCANNER_SETTINGS.mode_options).map((modeItem) => {
                    const modeMeta = SCANNER_MODE_META[modeItem.key] || SCANNER_MODE_META.adaptive;
                    const isActive = scannerEditor.analysis_mode === modeItem.key;
                    return (
                      <button
                        key={modeItem.key}
                        type="button"
                        className={`admin-scanner-mode-card ${isActive ? "active" : ""}`}
                        onClick={() => setScannerEditor((prev) => ({ ...prev, analysis_mode: modeItem.key }))}
                      >
                        <span className="admin-scanner-mode-top">
                          {isActive ? <span className="admin-badge tone-success">Выбран</span> : <span />}
                        </span>
                        <strong>{modeMeta.title}</strong>
                        <p>{modeMeta.description}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="admin-scanner-settings-grid">
                  <label className="admin-field admin-field-wide">
                    <span>OpenAI API key</span>
                    <input
                      className="admin-input"
                      type="password"
                      autoComplete="off"
                      placeholder={scannerSettings.api_key_configured ? "Новый ключ или оставить пустым" : "sk-..."}
                      value={scannerEditor.api_key}
                      onChange={(e) => setScannerEditor((prev) => ({ ...prev, api_key: e.target.value }))}
                    />
                  </label>

                  <div className="admin-card admin-scanner-key-panel">
                    <span className="admin-kpi-label">Текущий ключ</span>
                    <strong>{compactSecretPreview(scannerSettings.api_key_preview, scannerSettings.api_key_configured)}</strong>
                    <span className="admin-kpi-note">Пустое поле при сохранении оставит текущий ключ без изменений.</span>
                  </div>
                </div>

                <div className="admin-active-limit-panel">
                  <div className="admin-active-limit-copy">
                    <span>Активные сигналы</span>
                    <strong>Лимит одновременно открытых сделок</strong>
                    <small>Если пользователь достиг лимита, новый анализ не стартует до завершения одной из сделок.</small>
                  </div>
                  <div className="admin-active-limit-options" role="group" aria-label="Лимит активных сигналов">
                    {(scannerSettings.active_signals_limit_options || [1, 2, 3]).map((value) => {
                      const isActive = Number(scannerEditor.active_signals_limit || 3) === Number(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          className={`admin-active-limit-option ${isActive ? "active" : ""}`}
                          onClick={() => setScannerEditor((prev) => ({ ...prev, active_signals_limit: Number(value) }))}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="admin-scanner-save-row">
                  <span className="admin-muted-text">Эти параметры применятся ко всем новым анализам скриншотов.</span>
                  <button className="admin-primary-button" type="button" disabled={scannerSaving} onClick={saveScannerSettings}>
                    {scannerSaving ? "Сохраняем..." : "Сохранить настройки"}
                  </button>
                </div>
              </section>
            )}

            <section className="admin-card admin-registration-settings-panel">
              <div className="admin-scanner-panel-head">
                <div className="admin-scanner-panel-title">
                  <span>Регистрация</span>
                  <strong>Кнопка получения Trader ID</strong>
                  <p>Эта ссылка используется на странице статусов, если пользователь ещё не указал Trader ID.</p>
                </div>
                <span className={`admin-badge ${registrationSettings.registration_url ? "tone-success" : "tone-neutral"}`}>
                  {registrationSettings.registration_url ? "Ссылка активна" : "Ссылка не задана"}
                </span>
              </div>
              <div className="admin-registration-row">
                <label className="admin-field">
                  <span>Ссылка регистрации</span>
                  <input
                    className="admin-input"
                    type="url"
                    value={registrationEditor.registration_url}
                    onChange={(event) => setRegistrationEditor((prev) => ({ ...prev, registration_url: event.target.value }))}
                    placeholder="https://..."
                  />
                </label>
                <button className="admin-primary-button" type="button" disabled={registrationSaving} onClick={saveRegistrationSettings}>
                  {registrationSaving ? "Сохраняем..." : "Сохранить регистрацию"}
                </button>
              </div>
            </section>
          </>
        )}
        {tab === "indicators" && (
          <>
            <section className="admin-kpi-grid admin-indicator-summary-grid">
              {indicatorSummaryCards.map((item) => (
                <article className="admin-card admin-kpi-card tone-info" key={item.key}>
                  <span className="admin-kpi-label">{item.label}</span>
                  <strong className="admin-kpi-value small">{item.value}</strong>
                  <span className="admin-kpi-note">{item.note}</span>
                </article>
              ))}
            </section>

            <section className="admin-card admin-indicator-filter-card">
              <div className="admin-filter-head">
                <div>
                  <div className="admin-section-title">Управление индикаторами</div>
                  <div className="admin-muted-text">Короткий код, понятное название и моментальное включение или скрытие из режима индикаторов.</div>
                </div>
                <div className="admin-filter-meta">Показываем: {indicatorItems.length}</div>
              </div>

              <label className="admin-field">
                <span>Поиск по коду, названию или описанию</span>
                <input
                  className="admin-input"
                  type="text"
                  placeholder="Например: RSI, MACD, Bollinger"
                  value={indicatorSearch}
                  onChange={(e) => setIndicatorSearch(e.target.value)}
                />
              </label>
            </section>

            {indicatorItems.length === 0 && (
              <section className="admin-card admin-empty-state">
                <div className="admin-empty-icon">0</div>
                <div className="admin-empty-copy">
                  <strong>Индикаторы не найдены</strong>
                  <span>Попробуй изменить поисковый запрос или проверь, что каталог уже проинициализирован в базе.</span>
                </div>
              </section>
            )}

            <section className="admin-indicator-grid">
              {indicatorItems.map((item) => {
                const meta = getIndicatorMeta(item.code, item.title, item.description);
                const enabled = Number(item.is_enabled || 0) === 1;
                return (
                  <article className={`admin-card admin-indicator-card ${enabled ? "is-enabled" : "is-disabled"}`} key={item.code}>
                    <div className="admin-indicator-head">
                      <div className="admin-indicator-copy">
                        <span className={`admin-indicator-badge tone-${meta.tone}`}>{meta.short}</span>
                        <div>
                          <strong>{meta.title}</strong>
                          <span>{item.description || "Индикатор доступен для ручной генерации сигнала."}</span>
                        </div>
                      </div>
                      <button
                        className={`admin-indicator-switch ${enabled ? "is-on" : ""}`}
                        disabled={indicatorSavingCode === item.code}
                        onClick={() => toggleIndicator(item)}
                        type="button"
                        aria-pressed={enabled}
                      >
                        <span>{indicatorSavingCode === item.code ? "..." : enabled ? "Активный" : "Не активный"}</span>
                        <i aria-hidden="true" />
                      </button>
                    </div>

                    <div className="admin-indicator-footer">
                      <span className={`admin-badge ${enabled ? "tone-success" : "tone-neutral"}`}>
                        {enabled ? "Отображается в mini app" : "Скрыт из mini app"}
                      </span>
                      <span className="admin-muted-text">Обновлён: {formatDateTime(item.updated_at)}</span>
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}
        {tab === "market" && (
          <>
            <section className="admin-card admin-market-hero">
              <div className="admin-market-hero-copy">
                <div className="admin-section-title">Синхронизация рынков</div>
                <p>Пары подтягиваются из DevsBite, сохраняются локально и переключаются по актуальному списку без лишних запросов с клиента.</p>
              </div>

              <div className="admin-market-settings">
                <label className="admin-field">
                  <span>Интервал обновления</span>
                  <select className="admin-select" value={marketInterval} onChange={(e) => setMarketInterval(e.target.value)} disabled={marketSaving}>
                    {(marketSettings.interval_options || []).map((item) => (
                      <option key={item} value={item}>{item} мин</option>
                    ))}
                  </select>
                </label>
                <button className="admin-primary-button" disabled={marketSaving} onClick={saveMarketSettings} type="button">
                  {marketSaving ? "Сохраняем..." : "Сохранить"}
                </button>
              </div>
            </section>

            <section className="admin-kpi-grid market-summary-grid">
              {marketSummary.map((item) => (
                <article className="admin-card admin-kpi-card tone-info" key={item.key}>
                  <span className="admin-kpi-label">{item.label}</span>
                  <strong className="admin-kpi-value small">{item.value}</strong>
                  <span className="admin-kpi-note">{item.note}</span>
                </article>
              ))}
            </section>

            <section className="admin-market-grid">
              {(marketSettings.items || []).map((item) => {
                const totalCount = Number(item.total_count || 0);
                const activeCount = Number(item.active_count || 0);
                const progress = totalCount > 0 ? Math.min((activeCount / totalCount) * 100, 100) : 0;
                const marketEnabled = Number(item.is_enabled ?? 1) === 1;
                return (
                  <article className={`admin-card admin-market-card ${marketEnabled ? "is-enabled" : "is-disabled"}`} key={item.key}>
                    <div className="admin-market-card-head">
                      <strong>{item.title}</strong>
                      <button
                        className={`admin-market-switch ${marketEnabled ? "is-on" : ""}`}
                        disabled={marketSavingKey === item.key}
                        onClick={() => toggleMarketStatus(item)}
                        type="button"
                        aria-pressed={marketEnabled}
                      >
                        <span>{marketSavingKey === item.key ? "..." : marketEnabled ? "Активный" : "Не активный"}</span>
                        <i aria-hidden="true" />
                      </button>
                    </div>
                    <div className="admin-market-main-metric">{formatNumber(totalCount)}</div>
                    <div className="admin-market-subtitle">Всего пар в кеше</div>
                    <div className="admin-progress-track">
                      <span className="admin-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="admin-market-meta-row">
                      <span className={`admin-badge ${marketEnabled ? "tone-success" : "tone-neutral"}`}>Активно {activeCount}</span>
                      <span>Покрытие: {formatPercent(progress)}</span>
                      <span>{formatDateTime(item.last_seen_at)}</span>
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="admin-card admin-details-panel">
              <div className="admin-details-panel-head">
                <div>
                  <div className="admin-section-title">Подробности по рынкам</div>
                  <div className="admin-muted-text">Сводка по локально сохранённым парам и времени последнего обновления.</div>
                </div>
                <button className="admin-ghost-button" type="button" onClick={() => setMarketDetailsExpanded((prev) => !prev)}>
                  {marketDetailsExpanded ? "Свернуть" : "Развернуть"}
                </button>
              </div>

              {marketDetailsExpanded && (
                <div className="admin-market-detail-list">
                  {(marketSettings.items || []).map((item) => (
                    <div className="admin-market-detail-row" key={item.key}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{formatDateTime(item.last_seen_at)}</span>
                      </div>
                      <div className="admin-market-detail-metrics">
                        <span>Активно: {formatNumber(item.active_count)}</span>
                        <span>Всего: {formatNumber(item.total_count)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        {tab === "support" && (
          <>
            <section className="admin-card admin-support-hero">
              <div className="admin-support-hero-copy">
                <div className="admin-section-title">Поддержка в профиле</div>
                <p>Эти ссылки показываются пользователю в плитке “Поддержка”: канал для быстрых ответов и прямой контакт, если вопрос остался.</p>
              </div>
              <div className="admin-support-preview-actions">
                <a className="admin-ghost-button" href={supportSettings.channel_url} target="_blank" rel="noreferrer">
                  Проверить канал
                </a>
                <a className="admin-ghost-button" href={supportSettings.support_url} target="_blank" rel="noreferrer">
                  Проверить контакт
                </a>
              </div>
            </section>

            <section className="admin-support-grid">
              <article className="admin-card admin-support-card">
                <div className="admin-support-card-head">
                  <span className="admin-support-code">TG</span>
                  <div>
                    <strong>Telegram-канал</strong>
                    <span>Кнопка для перехода в канал SonicFX.</span>
                  </div>
                </div>
                <label className="admin-field">
                  <span>Ссылка на канал</span>
                  <input
                    className="admin-input"
                    type="url"
                    value={supportEditor.channel_url}
                    onChange={(event) => setSupportEditor((prev) => ({ ...prev, channel_url: event.target.value }))}
                    placeholder="https://t.me/+..."
                  />
                </label>
              </article>

              <article className="admin-card admin-support-card">
                <div className="admin-support-card-head">
                  <span className="admin-support-code">DM</span>
                  <div>
                    <strong>Контакт поддержки</strong>
                    <span>Кнопка “Написать в поддержку”.</span>
                  </div>
                </div>
                <label className="admin-field">
                  <span>Ссылка на поддержку</span>
                  <input
                    className="admin-input"
                    type="url"
                    value={supportEditor.support_url}
                    onChange={(event) => setSupportEditor((prev) => ({ ...prev, support_url: event.target.value }))}
                    placeholder="https://t.me/WaySonic"
                  />
                </label>
              </article>
            </section>

            <section className="admin-card admin-support-save-panel">
              <div>
                <div className="admin-section-title">Сохранение</div>
                <div className="admin-muted-text">Разрешены только Telegram-ссылки t.me или telegram.me.</div>
              </div>
              <button className="admin-primary-button" type="button" disabled={supportSaving} onClick={saveSupportSettings}>
                {supportSaving ? "Сохраняем..." : "Сохранить ссылки"}
              </button>
            </section>
          </>
        )}
      </main>

      {selectedUser && (
        <div className="admin-modal-layer" role="presentation">
          <button className="admin-modal-backdrop" type="button" aria-label="Закрыть карточку пользователя" onClick={() => setSelectedUserId(null)} />
          <section className="admin-modal-card" role="dialog" aria-modal="true" aria-label="Карточка пользователя">
            <div className="admin-modal-head">
              <div>
                <span className="admin-kicker">Карточка пользователя</span>
                <h2>{selectedUser.first_name || selectedUser.tg_username || "Без имени"}</h2>
                <p>Основные данные, Trader ID и статус аккаунта.</p>
              </div>
              <button className="admin-modal-close" type="button" onClick={() => setSelectedUserId(null)}>x</button>
            </div>
            <div className="admin-user-detail-grid">
              <article className="admin-card admin-user-detail-card">
                <div className="admin-user-detail-head">
                  <strong>Управление пользователем</strong>
                  <span className={`admin-badge tone-${getAccountTierMeta(selectedUser.account_tier, accountStatusOptions).tone}`}>
                    {getAccountTierMeta(selectedUser.account_tier, accountStatusOptions).label}
                  </span>
                </div>
                <div className="admin-info-list">
                  <div><span>User ID</span><strong>{selectedUser.user_id}</strong></div>
                  <div><span>Trader ID</span><strong>{selectedUser.trader_id || "-"}</strong></div>
                  <div><span>Username</span><strong>@{selectedUser.tg_username || "-"}</strong></div>
                  <div><span>Статус</span><strong>{getAccountTierMeta(selectedUser.account_tier, accountStatusOptions).label}</strong></div>
                  <div><span>Сканер</span><strong>{selectedUser.scanner_access ? "Есть доступ" : "Нет доступа"}</strong></div>
                  <div><span>Блокировка</span><strong>{selectedUser.is_blocked ? "Заблокирован" : "Не заблокирован"}</strong></div>
                  <div><span>Язык</span><strong>{selectedUser.lang || "-"}</strong></div>
                  <div><span>Тема</span><strong>{selectedUser.theme || "-"}</strong></div>
                  <div><span>Регистрация</span><strong>{formatDateTime(selectedUser.created_at)}</strong></div>
                  <div><span>Последняя активность</span><strong>{formatDateTime(selectedUser.last_active_at)}</strong></div>
                </div>

                <div className="admin-editor-grid">
                  <label className="admin-field">
                    <span>Статус</span>
                    <select
                      className="admin-select"
                      value={userEditor.account_tier}
                      onChange={(e) => setUserEditor((prev) => ({ ...prev, account_tier: e.target.value }))}
                    >
                      {accountStatusOptions.map((item) => (
                        <option key={item.code} value={item.code}>{item.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Trader ID</span>
                    <input
                      className="admin-input"
                      type="text"
                      maxLength="128"
                      placeholder="Если не указан, будет -"
                      value={userEditor.trader_id}
                      onChange={(e) => setUserEditor((prev) => ({ ...prev, trader_id: e.target.value }))}
                    />
                  </label>

                </div>

                <div className="admin-modal-actions">
                  <button className="admin-ghost-button" type="button" onClick={() => setSelectedUserId(null)}>Закрыть</button>
                  <button className="admin-danger-button" disabled={userDeleting || userSaving} type="button" onClick={deleteUserCard}>
                    {userDeleting ? "Удаляем..." : "Удалить пользователя"}
                  </button>
                  <button className="admin-primary-button" disabled={userSaving || userDeleting} type="button" onClick={saveUserCard}>
                    {userSaving ? "Сохраняем..." : "Сохранить изменения"}
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>
      )}

      {toastItems.length > 0 && (
        <div className="admin-toast-stack" aria-live="polite">
          {toastItems.map((item) => (
            <article className={`admin-toast admin-toast-${item.type}`} key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.message}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
