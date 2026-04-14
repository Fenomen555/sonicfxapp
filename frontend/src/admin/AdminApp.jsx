import { useEffect, useState } from "react";
import { apiAdminFetchJson } from "../lib/api";
import "./admin.css";

const TABS = [
  { id: "stats", label: "Stats" },
  { id: "users", label: "Users" },
  { id: "flags", label: "Flags" },
  { id: "market", label: "Market" }
];

export default function AdminApp({ authError, adminUser }) {
  const [tab, setTab] = useState("stats");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [flags, setFlags] = useState([]);
  const [marketSettings, setMarketSettings] = useState({ market_pairs_sync_interval_min: 5, interval_options: [], items: [] });
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

  if (authError) {
    return (
      <div className="admin-shell">
        <div className="admin-card">
          <h2>Access denied</h2>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-card admin-header">
        <div className="admin-title">SonicFX Admin</div>
        <div className="admin-user">ID {adminUser?.user_id || "-"}</div>
      </header>

      <nav className="admin-tabs admin-card">
        {TABS.map((item) => (
          <button
            className={`admin-tab ${tab === item.id ? "active" : ""}`}
            key={item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="admin-main">
        {loading && <div className="admin-card">Loading...</div>}

        {!loading && tab === "stats" && (
          <div className="admin-card stack">
            <div>Total users: {stats?.users_total ?? "-"}</div>
            <div>Activated: {stats?.activated_total ?? "-"}</div>
            <div>Scanner access: {stats?.scanner_total ?? "-"}</div>
            <div>Signals today: {stats?.signals_today ?? "-"}</div>
          </div>
        )}

        {!loading && tab === "users" && (
          <div className="admin-card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Username</th>
                  <th>Status</th>
                  <th>Deposit</th>
                  <th>Scanner</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.user_id}>
                    <td>{item.user_id}</td>
                    <td>@{item.tg_username || "-"}</td>
                    <td>{item.activation_status}</td>
                    <td>{item.deposit_amount}</td>
                    <td>{item.scanner_access ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === "flags" && (
          <div className="admin-card stack">
            {flags.map((item) => (
              <div className="flag-row" key={item.key}>
                <span>{item.key}</span>
                <button onClick={() => toggleFlag(item)}>{item.is_enabled ? "Enabled" : "Disabled"}</button>
              </div>
            ))}
          </div>
        )}

        {!loading && tab === "market" && (
          <div className="stack">
            <div className="admin-card stack">
              <div className="admin-section-title">Market Sync</div>
              <div className="market-settings-row">
                <label className="admin-label" htmlFor="market-sync-interval">Pair refresh interval</label>
                <div className="market-settings-controls">
                  <select
                    id="market-sync-interval"
                    className="admin-select"
                    value={marketInterval}
                    onChange={(e) => setMarketInterval(e.target.value)}
                    disabled={marketSaving}
                  >
                    {(marketSettings.interval_options || []).map((item) => (
                      <option key={item} value={item}>{item} min</option>
                    ))}
                  </select>
                  <button className="admin-action" onClick={saveMarketSettings} disabled={marketSaving}>
                    {marketSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
              <div className="admin-note">Pairs are synced from DevsBite, stored locally, and deactivated when they disappear from upstream.</div>
            </div>

            <div className="admin-card table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Active</th>
                    <th>Total</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(marketSettings.items || []).map((item) => (
                    <tr key={item.key}>
                      <td>{item.title}</td>
                      <td>{item.active_count}</td>
                      <td>{item.total_count}</td>
                      <td>{item.last_seen_at ? new Date(item.last_seen_at).toLocaleString() : "-"}</td>
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
