import { buildApiWebSocketUrl } from "./api";

const DEFAULT_PING_INTERVAL_MS = 25000;
const DEFAULT_REPLACE_DEBOUNCE_MS = 220;
const DEFAULT_RECONNECT_BASE_MS = 1200;

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSymbol(value) {
  return String(value || "").trim();
}

function normalizeItem(item) {
  const category = normalizeCategory(item?.category);
  const symbol = normalizeSymbol(item?.symbol);
  if (!category || !symbol) return null;
  const normalized = { category, symbol };
  if (item?.history_seconds) {
    normalized.history_seconds = Number(item.history_seconds) || 300;
  }
  return normalized;
}

function itemKey(item) {
  return `${item.category}::${item.symbol}`;
}

function subscriptionsEqual(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].map(itemKey).sort();
  const right = [...b].map(itemKey).sort();
  return left.every((value, index) => value === right[index]);
}

export class QuoteStreamClient {
  constructor({
    url = "/api/ws/quotes",
    historySeconds = 300,
    replaceDebounceMs = DEFAULT_REPLACE_DEBOUNCE_MS,
    pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
    reconnectBaseMs = DEFAULT_RECONNECT_BASE_MS,
    onEvent,
    onStateChange
  } = {}) {
    this.url = url;
    this.historySeconds = historySeconds;
    this.replaceDebounceMs = replaceDebounceMs;
    this.pingIntervalMs = pingIntervalMs;
    this.reconnectBaseMs = reconnectBaseMs;
    this.onEvent = onEvent;
    this.onStateChange = onStateChange;

    this.activeSubscriptions = [];
    this.socket = null;
    this.replaceTimer = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.idleCloseTimer = null;
    this.destroyed = false;
    this.ready = false;
    this.reconnectAttempt = 0;
  }

  setSubscriptions(items) {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeItem({ ...item, history_seconds: item?.history_seconds || this.historySeconds }))
      .filter(Boolean);

    if (subscriptionsEqual(normalized, this.activeSubscriptions)) {
      return;
    }

    if (this.idleCloseTimer) {
      window.clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }

    this.activeSubscriptions = normalized;
    if (!normalized.length) {
      this._sendReplace(true);
      return;
    }

    this._ensureSocket();
    this._scheduleReplace();
  }

  clearSubscriptions() {
    if (this.idleCloseTimer) {
      window.clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
    this.activeSubscriptions = [];
    this._sendReplace(true);
    this.idleCloseTimer = window.setTimeout(() => {
      this.idleCloseTimer = null;
      if (!this.activeSubscriptions.length) {
        this._closeSocket();
      }
    }, 180);
  }

  destroy() {
    this.destroyed = true;
    this.activeSubscriptions = [];
    this._clearTimers();
    this._closeSocket();
  }

  _emitState(status, detail = "") {
    if (typeof this.onStateChange === "function") {
      this.onStateChange({ status, detail });
    }
  }

  _emitEvent(payload) {
    if (typeof this.onEvent === "function") {
      this.onEvent(payload);
    }
  }

  _ensureSocket() {
    if (this.destroyed || this.socket) return;

    this.ready = false;
    this._emitState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const socket = new WebSocket(buildApiWebSocketUrl(this.url));
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this._emitState("connected");
      this._startPing();
    });

    socket.addEventListener("message", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        payload = null;
      }
      if (!payload || typeof payload !== "object") return;

      const eventName = String(payload.event || "").trim().toLowerCase();
      if (eventName === "ready") {
        this.ready = true;
        this._emitState("ready");
        this._sendReplace();
      } else if (eventName === "pong") {
        this._emitState("alive");
      } else if (eventName === "error") {
        this._emitState("error", payload.detail || "Quote stream error");
      }
      this._emitEvent(payload);
    });

    socket.addEventListener("close", () => {
      this.ready = false;
      this._stopPing();
      this.socket = null;
      if (this.destroyed) {
        this._emitState("closed");
        return;
      }
      if (!this.activeSubscriptions.length) {
        this._emitState("idle");
        return;
      }
      this._scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      this._emitState("error", "Quote stream connection failed");
    });
  }

  _scheduleReplace() {
    if (this.replaceTimer) {
      window.clearTimeout(this.replaceTimer);
    }
    this.replaceTimer = window.setTimeout(() => {
      this.replaceTimer = null;
      this._sendReplace();
    }, this.replaceDebounceMs);
  }

  _sendReplace(force = false) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (!force && this.activeSubscriptions.length) {
        this._ensureSocket();
      }
      return;
    }
    if (!this.ready && !force) return;
    const payload = {
      action: "replace",
      items: this.activeSubscriptions
    };
    try {
      this.socket.send(JSON.stringify(payload));
      if (!payload.items.length) {
        this._emitState("idle");
      }
    } catch {
      this._scheduleReconnect();
    }
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = window.setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      try {
        this.socket.send(JSON.stringify({ action: "ping" }));
      } catch {
        this._scheduleReconnect();
      }
    }, this.pingIntervalMs);
  }

  _stopPing() {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.destroyed || !this.activeSubscriptions.length) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectBaseMs * this.reconnectAttempt, 6000);
    this._emitState("reconnecting", "Reconnecting to quote stream");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this._ensureSocket();
    }, delay);
  }

  _clearTimers() {
    if (this.replaceTimer) {
      window.clearTimeout(this.replaceTimer);
      this.replaceTimer = null;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.idleCloseTimer) {
      window.clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
    this._stopPing();
  }

  _closeSocket() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch {
      // noop
    }
    this.socket = null;
  }
}
