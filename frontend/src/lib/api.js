export const getTelegramWebApp = () => window.Telegram?.WebApp || null;

export const getTelegramInitData = () => {
  const tg = getTelegramWebApp();
  return (tg?.initData || "").trim();
};

export const isTelegramWebAppAvailable = () => Boolean(getTelegramWebApp() && getTelegramInitData());

export const buildApiWebSocketUrl = (path) => {
  const target = new URL(path || "/api/ws/quotes", window.location.origin);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  const initData = getTelegramInitData();
  if (initData) {
    target.searchParams.set("tg_init_data", initData);
  }
  return target.toString();
};

export const getAdminTokenFromPath = () => {
  const pathname = (window.location.pathname || "").replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0].toLowerCase() === "admin") {
    return decodeURIComponent(parts[1] || "");
  }
  return "";
};

export const isAdminRoute = () => Boolean(getAdminTokenFromPath());

export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const initData = getTelegramInitData();

  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (initData) {
    headers.set("X-TG-Init-Data", initData);
  }
  return fetch(url, { ...options, headers });
}

export async function apiFetchJson(url, options = {}) {
  const response = await apiFetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = data?.detail || data?.error || text || "Request failed";
    throw new Error(message);
  }
  return data;
}

export async function apiAdminFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAdminTokenFromPath();
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("X-Admin-Token", token);
  }
  return apiFetch(url, { ...options, headers });
}

export async function apiAdminFetchJson(url, options = {}) {
  const response = await apiAdminFetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = data?.detail || data?.error || text || "Request failed";
    throw new Error(message);
  }
  return data;
}
