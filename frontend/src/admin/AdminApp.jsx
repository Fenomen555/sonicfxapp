import { useEffect, useState } from "react";
import { apiAdminFetchJson } from "../lib/api";
import "./admin.css";

const TABS = [
  { id: "stats", label: "Stats" },
  { id: "users", label: "Users" },
  { id: "flags", label: "Flags" }
];

export default function AdminApp({ authError, adminUser }) {
  const [tab, setTab] = useState("stats");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [flags, setFlags] = useState([]);
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
      </main>
    </div>
  );
}
