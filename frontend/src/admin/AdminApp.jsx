import { useEffect, useMemo, useState } from "react";
import { apiAdminFetchJson } from "../lib/api";
import "./admin.css";

const TABS = [
  { id: "stats", label: "Обзор", subtitle: "Статистика и активность", accent: "A" },
  { id: "users", label: "Пользователи", subtitle: "Карточки, поиск и фильтры", accent: "U" },
  { id: "flags", label: "Функции", subtitle: "Управление режимами", accent: "F" },
  { id: "market", label: "Рынок", subtitle: "Пары и синхронизация", accent: "M" }
];

const FLAG_META = {
  mode_ai_enabled: {
    title: "Автоматический режим",
    description: "Разрешает потоковую генерацию сигналов и связанные сценарии."
  },
  mode_indicators_enabled: {
    title: "Индикаторы",
    description: "Открывает ручной режим по рынку, тикеру и экспирации."
  },
  mode_scanner_enabled: {
    title: "Сканер",
    description: "Оставляет доступным основной режим анализа по скриншоту графика."
  },
  news_enabled: {
    title: "Новости",
    description: "Показывает новостную ленту внутри mini app."
  }
};

const USER_STATUS_META = {
  inactive: { label: "Не активирован", tone: "neutral" },
  active: { label: "Активен", tone: "success" },
  active_scanner: { label: "Сканер активен", tone: "accent" }
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

function formatDeposit(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function getFlagMeta(key) {
  return FLAG_META[key] || {
    title: key,
    description: "Служебный переключатель приложения."
  };
}

function getUserStatusMeta(status) {
  return USER_STATUS_META[status] || { label: status || "-", tone: "neutral" };
}

function getRegistrationFilterLabel(value) {
  const labels = {
    all: "Все даты",
    today: "Сегодня",
    week: "Последние 7 дней",
    month: "Последние 30 дней",
    quarter: "Последние 90 дней"
  };
  return labels[value] || labels.all;
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
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [flags, setFlags] = useState([]);
  const [marketSettings, setMarketSettings] = useState(EMPTY_MARKET_SETTINGS);
  const [marketInterval, setMarketInterval] = useState("5");
  const [marketSaving, setMarketSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toastItems, setToastItems] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [userFilters, setUserFilters] = useState(FILTER_DEFAULTS);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userEditor, setUserEditor] = useState({ activation_status: "inactive", deposit_amount: "0" });
  const [userSaving, setUserSaving] = useState(false);
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

  useEffect(() => {
    if (!selectedUser) return;
    setUserEditor({
      activation_status: selectedUser.activation_status || "inactive",
      deposit_amount: String(selectedUser.deposit_amount ?? 0)
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
        const data = await apiAdminFetchJson("/api/admin/users?limit=200");
        setUsers(data?.items || []);
      }
      if (targetTab === "flags") {
        const data = await apiAdminFetchJson("/api/admin/feature-flags");
        setFlags(data?.items || []);
      }
      if (targetTab === "market") {
        const data = await apiAdminFetchJson("/api/admin/market-settings");
        setMarketSettings(data || EMPTY_MARKET_SETTINGS);
        setMarketInterval(String(data?.market_pairs_sync_interval_min || 5));
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
        item.tg_username || "",
        item.mini_username || "",
        item.first_name || ""
      ]
        .join(" ")
        .toLowerCase();

      if (query && !haystack.includes(query)) return false;
      if (userFilters.status !== "all" && item.activation_status !== userFilters.status) return false;
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
      if (item.id === "flags") {
        return { ...item, metric: `${formatNumber(flags.filter((flag) => flag.is_enabled === 1).length)} активных` };
      }
      const marketCount = (marketSettings.items || []).length;
      return { ...item, metric: `${formatNumber(marketCount)} рынков` };
    });
  }, [flags, marketSettings.items, stats?.users_total, users.length]);

  const marketSummary = useMemo(() => {
    const items = marketSettings.items || [];
    const totals = items.reduce(
      (acc, item) => {
        acc.totalPairs += Number(item.total_count || 0);
        acc.activePairs += Number(item.active_count || 0);
        if (item.last_seen_at && (!acc.lastSeenAt || new Date(item.last_seen_at) > new Date(acc.lastSeenAt))) {
          acc.lastSeenAt = item.last_seen_at;
        }
        return acc;
      },
      { totalPairs: 0, activePairs: 0, lastSeenAt: null }
    );

    return [
      { key: "active_pairs", label: "Активных пар", value: formatNumber(totals.activePairs), note: "Сейчас доступны в локальном кеше" },
      { key: "total_pairs", label: "Всего пар", value: formatNumber(totals.totalPairs), note: "Полный объём по всем рынкам" },
      { key: "markets_total", label: "Рынков", value: formatNumber(items.length), note: "Категории, которые мониторим" },
      { key: "last_sync", label: "Последний sync", value: totals.lastSeenAt ? formatDateTime(totals.lastSeenAt) : "-", note: "Время последнего обновления" }
    ];
  }, [marketSettings.items]);
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

  const saveUserCard = async () => {
    if (!selectedUser) return;
    setUserSaving(true);
    try {
      await apiAdminFetchJson("/api/admin/users/set-activation", {
        method: "POST",
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          activation_status: userEditor.activation_status,
          deposit_amount: Number(userEditor.deposit_amount || 0)
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

  if (authError) {
    return (
      <div className="admin-shell">
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
    <div className="admin-shell">
      <section className="admin-topbar admin-card">
        <div className="admin-topbar-copy">
          <span className="admin-kicker">Управление SonicFX</span>
          <h1>Админка mini app</h1>
          <p>Собранный центр управления пользователями, режимами и рыночными данными.</p>
        </div>
        <div className="admin-topbar-actions">
          <button className="admin-ghost-button" type="button" onClick={() => setMenuExpanded((prev) => !prev)}>
            {menuExpanded ? "Свернуть разделы" : "Развернуть разделы"}
          </button>
          <button className="admin-primary-button" type="button" onClick={refreshActiveTab}>
            Обновить данные
          </button>
        </div>
      </section>

      {menuExpanded && (
        <nav className="admin-section-grid">
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
        {loading && (
          <div className="admin-card admin-empty-state">
            <div className="admin-empty-icon">...</div>
            <div className="admin-empty-copy">
              <strong>Загружаем раздел</strong>
              <span>Собираю актуальные данные для текущей вкладки.</span>
            </div>
          </div>
        )}

        {!loading && tab === "stats" && (
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
        {!loading && tab === "users" && (
          <>
            <section className="admin-card admin-filter-card">
              <div className="admin-filter-head">
                <div>
                  <div className="admin-section-title">Поиск и фильтры</div>
                  <div className="admin-muted-text">Ищем по user id, username, mini username и имени пользователя.</div>
                </div>
                <div className="admin-filter-meta">Найдено: {filteredUsers.length}</div>
              </div>

              <div className="admin-filter-grid">
                <label className="admin-field admin-field-wide">
                  <span>Поиск</span>
                  <input
                    className="admin-input"
                    type="text"
                    placeholder="Например: 7097, devsbite, Test"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </label>

                <label className="admin-field">
                  <span>Статус</span>
                  <select className="admin-select" value={userFilters.status} onChange={(e) => handleFilterChange("status", e.target.value)}>
                    <option value="all">Все статусы</option>
                    <option value="inactive">Не активирован</option>
                    <option value="active">Активен</option>
                    <option value="active_scanner">Сканер активен</option>
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
                const statusMeta = getUserStatusMeta(item.activation_status);
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
                      <span className={`admin-badge tone-${statusMeta.tone}`}>{statusMeta.label}</span>
                    </div>

                    <div className="admin-user-card-body">
                      <div className="admin-user-line">@{item.tg_username || "-"}</div>
                      <div className="admin-user-line">Mini app: {item.mini_username || "-"}</div>
                    </div>

                    <div className="admin-user-chip-row">
                      <span className={`admin-mini-chip ${item.scanner_access ? "is-on" : ""}`}>{item.scanner_access ? "Сканер: да" : "Сканер: нет"}</span>
                      <span className={`admin-mini-chip ${Number(item.deposit_amount || 0) > 0 ? "is-on" : ""}`}>Депозит: {formatDeposit(item.deposit_amount)}</span>
                    </div>

                    <div className="admin-user-card-footer">Регистрация: {formatDate(item.created_at)}</div>
                  </button>
                );
              })}
            </section>
          </>
        )}

        {!loading && tab === "flags" && (
          <section className="admin-control-grid">
            {flags.map((item) => {
              const meta = getFlagMeta(item.key);
              const enabled = item.is_enabled === 1;
              return (
                <article className="admin-card admin-control-card" key={item.key}>
                  <div className="admin-control-head">
                    <div>
                      <strong>{meta.title}</strong>
                      <span>Ключ: {item.key}</span>
                    </div>
                    <span className={`admin-badge ${enabled ? "tone-success" : "tone-neutral"}`}>
                      {enabled ? "Включено" : "Выключено"}
                    </span>
                  </div>
                  <p>{meta.description}</p>
                  <div className="admin-control-footer">
                    <span className="admin-muted-text">Изменено: {formatDateTime(item.updated_at)}</span>
                    <button
                      className="admin-primary-button"
                      disabled={flagSavingKey === item.key}
                      onClick={() => toggleFlag(item)}
                      type="button"
                    >
                      {flagSavingKey === item.key ? "Сохраняем..." : enabled ? "Отключить" : "Включить"}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
        {!loading && tab === "market" && (
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
                return (
                  <article className="admin-card admin-market-card" key={item.key}>
                    <div className="admin-market-card-head">
                      <strong>{item.title}</strong>
                      <span className="admin-badge tone-success">Активно {activeCount}</span>
                    </div>
                    <div className="admin-market-main-metric">{formatNumber(totalCount)}</div>
                    <div className="admin-market-subtitle">Всего пар в кеше</div>
                    <div className="admin-progress-track">
                      <span className="admin-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="admin-market-meta-row">
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
      </main>

      {selectedUser && (
        <div className="admin-modal-layer" role="presentation">
          <button className="admin-modal-backdrop" type="button" aria-label="Закрыть карточку пользователя" onClick={() => setSelectedUserId(null)} />
          <section className="admin-modal-card" role="dialog" aria-modal="true" aria-label="Карточка пользователя">
            <div className="admin-modal-head">
              <div>
                <span className="admin-kicker">Карточка пользователя</span>
                <h2>{selectedUser.first_name || selectedUser.tg_username || "Без имени"}</h2>
                <p>Полный профиль пользователя, доступы и ручное изменение статуса.</p>
              </div>
              <button className="admin-modal-close" type="button" onClick={() => setSelectedUserId(null)}>x</button>
            </div>
            <div className="admin-user-detail-grid">
              <article className="admin-card admin-user-detail-card">
                <div className="admin-user-detail-head">
                  <strong>Основное</strong>
                  <span className={`admin-badge tone-${getUserStatusMeta(selectedUser.activation_status).tone}`}>
                    {getUserStatusMeta(selectedUser.activation_status).label}
                  </span>
                </div>
                <div className="admin-info-list">
                  <div><span>User ID</span><strong>{selectedUser.user_id}</strong></div>
                  <div><span>Username</span><strong>@{selectedUser.tg_username || "-"}</strong></div>
                  <div><span>Mini app</span><strong>{selectedUser.mini_username || "-"}</strong></div>
                  <div><span>Язык</span><strong>{selectedUser.lang || "-"}</strong></div>
                  <div><span>Тема</span><strong>{selectedUser.theme || "-"}</strong></div>
                  <div><span>Регистрация</span><strong>{formatDateTime(selectedUser.created_at)}</strong></div>
                  <div><span>Последняя активность</span><strong>{formatDateTime(selectedUser.last_active_at)}</strong></div>
                </div>
              </article>

              <article className="admin-card admin-user-detail-card">
                <div className="admin-user-detail-head">
                  <strong>Доступы и финансы</strong>
                  <span className={`admin-badge ${selectedUser.is_blocked ? "tone-danger" : "tone-success"}`}>
                    {selectedUser.is_blocked ? "Заблокирован" : "Не заблокирован"}
                  </span>
                </div>
                <div className="admin-info-list">
                  <div><span>Сканер</span><strong>{selectedUser.scanner_access ? "Есть доступ" : "Нет доступа"}</strong></div>
                  <div><span>Депозит</span><strong>{formatDeposit(selectedUser.deposit_amount)}</strong></div>
                  <div><span>Фильтр даты</span><strong>{getRegistrationFilterLabel(userFilters.registered)}</strong></div>
                </div>

                <div className="admin-editor-grid">
                  <label className="admin-field">
                    <span>Новый статус</span>
                    <select
                      className="admin-select"
                      value={userEditor.activation_status}
                      onChange={(e) => setUserEditor((prev) => ({ ...prev, activation_status: e.target.value }))}
                    >
                      <option value="inactive">Не активирован</option>
                      <option value="active">Активен</option>
                      <option value="active_scanner">Сканер активен</option>
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Депозит</span>
                    <input
                      className="admin-input"
                      inputMode="decimal"
                      type="number"
                      min="0"
                      step="0.01"
                      value={userEditor.deposit_amount}
                      onChange={(e) => setUserEditor((prev) => ({ ...prev, deposit_amount: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="admin-modal-actions">
                  <button className="admin-ghost-button" type="button" onClick={() => setSelectedUserId(null)}>Закрыть</button>
                  <button className="admin-primary-button" disabled={userSaving} type="button" onClick={saveUserCard}>
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
