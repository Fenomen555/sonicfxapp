import { useEffect, useState } from "react";
import { apiAdminFetchJson } from "../lib/api";
import "./admin.css";

const TABS = [
  { id: "stats", label: "Обзор", subtitle: "Статистика и активность" },
  { id: "users", label: "Пользователи", subtitle: "Статусы и доступ" },
  { id: "flags", label: "Функции", subtitle: "Управление режимами" },
  { id: "market", label: "Рынок", subtitle: "Пары и синхронизация" }
];

const FLAG_META = {
  mode_ai_enabled: {
    title: "AI-режим",
    description: "Автоматическая генерация сигналов и связанные сценарии."
  },
  mode_indicators_enabled: {
    title: "Индикаторы",
    description: "Ручной режим по рынку, тикеру и экспирации."
  },
  mode_scanner_enabled: {
    title: "Сканер",
    description: "Главный режим анализа по скриншоту графика."
  },
  news_enabled: {
    title: "Новости",
    description: "Показывать ленту новостей внутри mini app."
  }
};

const USER_STATUS_LABELS = {
  inactive: "Не активирован",
  active: "Активен",
  active_scanner: "Сканер активен"
};

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

function getFlagMeta(key) {
  return FLAG_META[key] || {
    title: key,
    description: "Служебный переключатель приложения."
  };
}

function getUserStatusLabel(status) {
  return USER_STATUS_LABELS[status] || status || "-";
}

export default function AdminApp({ authError }) {
  const [tab, setTab] = useState("stats");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [flags, setFlags] = useState([]);
  const [marketSettings, setMarketSettings] = useState({
    market_pairs_sync_interval_min: 5,
    interval_options: [],
    items: []
  });
  const [marketInterval, setMarketInterval] = useState("5");
  const [marketSaving, setMarketSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authError) return;
    let isActive = true;

    async function load() {
      setLoading(true);
      try {
        if (tab === "stats") {
          const data = await apiAdminFetchJson("/api/admin/stats");
          if (isActive) setStats(data);
        }
        if (tab === "users") {
          const data = await apiAdminFetchJson("/api/admin/users");
          if (isActive) setUsers(data?.items || []);
        }
        if (tab === "flags") {
          const data = await apiAdminFetchJson("/api/admin/feature-flags");
          if (isActive) setFlags(data?.items || []);
        }
        if (tab === "market") {
          const data = await apiAdminFetchJson("/api/admin/market-settings");
          if (isActive) {
            setMarketSettings(data || { market_pairs_sync_interval_min: 5, interval_options: [], items: [] });
            setMarketInterval(String(data?.market_pairs_sync_interval_min || 5));
          }
        }
      } finally {
        if (isActive) setLoading(false);
      }
    }

    load();
    return () => {
      isActive = false;
    };
  }, [tab, authError]);

  const toggleFlag = async (item) => {
    await apiAdminFetchJson("/api/admin/feature-flags", {
      method: "POST",
      body: JSON.stringify({
        key: item.key,
        is_enabled: item.is_enabled === 1 ? 0 : 1
      })
    });
    const data = await apiAdminFetchJson("/api/admin/feature-flags");
    setFlags(data?.items || []);
  };

  const saveMarketSettings = async () => {
    setMarketSaving(true);
    try {
      const nextValue = Number(marketInterval || 5);
      await apiAdminFetchJson("/api/admin/market-settings", {
        method: "POST",
        body: JSON.stringify({
          market_pairs_sync_interval_min: nextValue
        })
      });
      const data = await apiAdminFetchJson("/api/admin/market-settings");
      setMarketSettings(data || { market_pairs_sync_interval_min: 5, interval_options: [], items: [] });
      setMarketInterval(String(data?.market_pairs_sync_interval_min || nextValue));
    } finally {
      setMarketSaving(false);
    }
  };

  const statsCards = [
    {
      key: "users_total",
      label: "Всего пользователей",
      value: stats?.users_total ?? "-",
      note: "Зарегистрированы в системе"
    },
    {
      key: "activated_total",
      label: "Активировано",
      value: stats?.activated_total ?? "-",
      note: "Есть доступ к продукту"
    },
    {
      key: "scanner_total",
      label: "Доступ к сканеру",
      value: stats?.scanner_total ?? "-",
      note: "Могут запускать сканер"
    },
    {
      key: "signals_today",
      label: "Сигналов сегодня",
      value: stats?.signals_today ?? "-",
      note: "Активность за текущие сутки"
    }
  ];

  if (authError) {
    return (
      <div className="admin-shell">
        <div className="admin-card admin-state-card">
          <div className="admin-state-badge">Доступ ограничен</div>
          <h2>Админ-панель недоступна</h2>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-tabs">
        {TABS.map((item) => (
          <button
            className={`admin-tab ${tab === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            <span>{item.label}</span>
            <small>{item.subtitle}</small>
          </button>
        ))}
      </nav>

      <main className="admin-main">
        {loading && (
          <div className="admin-card admin-state-card">
            <div className="admin-state-badge">Загрузка</div>
            <h2>Подтягиваем данные</h2>
            <p>Секунду, собираю актуальную информацию для этого раздела.</p>
          </div>
        )}

        {!loading && tab === "stats" && (
          <div className="admin-main stack">
            <section className="admin-stats-grid">
              {statsCards.map((item) => (
                <article className="admin-card admin-stat-card" key={item.key}>
                  <span className="admin-stat-label">{item.label}</span>
                  <strong className="admin-stat-value">{item.value}</strong>
                  <span className="admin-stat-note">{item.note}</span>
                </article>
              ))}
            </section>
          </div>
        )}

        {!loading && tab === "users" && (
          <div className="admin-main stack">
            <section className="admin-card admin-summary-card">
              <div>
                <div className="admin-section-title">Пользователи</div>
                <div className="admin-note">Всего записей: {users.length}</div>
              </div>
            </section>

            <div className="admin-card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Пользователь</th>
                    <th>Статус</th>
                    <th>Депозит</th>
                    <th>Сканер</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.user_id}>
                      <td>{item.user_id}</td>
                      <td>
                        <div className="admin-table-main">@{item.tg_username || "-"}</div>
                        <div className="admin-table-sub">Mini app: {item.mini_username || "-"}</div>
                      </td>
                      <td>
                        <span className={`admin-status-badge status-${item.activation_status || "inactive"}`}>
                          {getUserStatusLabel(item.activation_status)}
                        </span>
                      </td>
                      <td>{item.deposit_amount}</td>
                      <td>{item.scanner_access ? "Да" : "Нет"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && tab === "flags" && (
          <div className="admin-main stack">
            {flags.map((item) => {
              const meta = getFlagMeta(item.key);
              const enabled = item.is_enabled === 1;
              return (
                <article className="admin-card flag-card" key={item.key}>
                  <div className="flag-card-copy">
                    <div className="flag-card-title-row">
                      <strong>{meta.title}</strong>
                      <span className={`admin-status-badge ${enabled ? "status-on" : "status-off"}`}>
                        {enabled ? "Включено" : "Выключено"}
                      </span>
                    </div>
                    <p>{meta.description}</p>
                    <span className="admin-note">Ключ: {item.key}</span>
                  </div>
                  <button className="admin-action" onClick={() => toggleFlag(item)} type="button">
                    {enabled ? "Отключить" : "Включить"}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {!loading && tab === "market" && (
          <div className="admin-main stack">
            <section className="admin-card admin-market-hero">
              <div className="admin-market-hero-copy">
                <div className="admin-section-title">Синхронизация рынков</div>
                <p>Пары подтягиваются из DevsBite, сохраняются локально и отключаются, если исчезают из апстрима.</p>
              </div>
              <div className="market-settings-row">
                <label className="admin-label" htmlFor="market-sync-interval">Интервал обновления пар</label>
                <div className="market-settings-controls">
                  <select
                    id="market-sync-interval"
                    className="admin-select"
                    value={marketInterval}
                    onChange={(e) => setMarketInterval(e.target.value)}
                    disabled={marketSaving}
                  >
                    {(marketSettings.interval_options || []).map((item) => (
                      <option key={item} value={item}>{item} мин</option>
                    ))}
                  </select>
                  <button className="admin-action" onClick={saveMarketSettings} disabled={marketSaving} type="button">
                    {marketSaving ? "Сохраняем..." : "Сохранить"}
                  </button>
                </div>
              </div>
            </section>

            <section className="admin-market-grid">
              {(marketSettings.items || []).map((item) => (
                <article className="admin-card admin-market-card" key={item.key}>
                  <div className="admin-market-card-head">
                    <strong>{item.title}</strong>
                    <span className="admin-status-badge status-on">Активно {item.active_count}</span>
                  </div>
                  <div className="admin-market-card-value">Всего пар: {item.total_count}</div>
                  <div className="admin-market-card-note">Последнее обновление: {formatDateTime(item.last_seen_at)}</div>
                </article>
              ))}
            </section>

            <div className="admin-card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Рынок</th>
                    <th>Активно</th>
                    <th>Всего</th>
                    <th>Последнее обновление</th>
                  </tr>
                </thead>
                <tbody>
                  {(marketSettings.items || []).map((item) => (
                    <tr key={item.key}>
                      <td>{item.title}</td>
                      <td>{item.active_count}</td>
                      <td>{item.total_count}</td>
                      <td>{formatDateTime(item.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
