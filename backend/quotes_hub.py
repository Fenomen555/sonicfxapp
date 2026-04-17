import asyncio
import contextlib
import json
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Set
from urllib.parse import urlencode

import websockets


SUPPORTED_QUOTE_CATEGORIES = {"forex", "otc", "commodities", "stocks", "crypto"}


def normalize_quote_category(value: Any) -> str:
    category = str(value or "").strip().lower()
    if category not in SUPPORTED_QUOTE_CATEGORIES:
        raise ValueError("Unsupported quote category")
    return category


def normalize_quote_symbol(value: Any) -> str:
    symbol = str(value or "").strip()
    if not symbol:
        raise ValueError("Quote symbol is required")
    return symbol


def normalize_subscription_item(item: Dict[str, Any]) -> Dict[str, Any]:
    normalized = {
        "category": normalize_quote_category(item.get("category")),
        "symbol": normalize_quote_symbol(item.get("symbol")),
    }
    history_seconds = item.get("history_seconds")
    if history_seconds is not None:
        try:
            normalized_history = int(history_seconds)
        except (TypeError, ValueError) as exc:
            raise ValueError("history_seconds must be an integer") from exc
        if normalized_history > 0:
            normalized["history_seconds"] = normalized_history
    return normalized


def subscription_key(item: Dict[str, Any]) -> str:
    return f"{item['category']}::{item['symbol']}"


def key_to_item(key: str) -> Dict[str, Any]:
    category, symbol = key.split("::", 1)
    return {"category": category, "symbol": symbol}


def _extract_event_keys(payload: Dict[str, Any]) -> Set[str]:
    keys: Set[str] = set()
    if payload.get("category") and payload.get("symbol"):
        try:
            keys.add(subscription_key(normalize_subscription_item(payload)))
        except ValueError:
            pass

    for field_name in ("item", "subscription"):
        item = payload.get(field_name)
        if isinstance(item, dict):
            try:
                keys.add(subscription_key(normalize_subscription_item(item)))
            except ValueError:
                pass

    items = payload.get("items")
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                keys.add(subscription_key(normalize_subscription_item(item)))
            except ValueError:
                continue
    return keys


def _parse_points(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    direct_candidates = [
        payload.get("points"),
        payload.get("history"),
        payload.get("candles"),
        payload.get("ticks"),
        payload.get("data"),
    ]
    for candidate in direct_candidates:
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]
    snapshot = payload.get("snapshot")
    if isinstance(snapshot, dict):
        for field_name in ("points", "history", "candles", "ticks", "data"):
            candidate = snapshot.get(field_name)
            if isinstance(candidate, list):
                return [item for item in candidate if isinstance(item, dict)]
    return []


@dataclass
class ClientSession:
    client_id: str
    websocket: Any
    subscriptions: Set[str] = field(default_factory=set)
    command_timestamps: Deque[float] = field(default_factory=deque)


class DevsbiteQuotesHub:
    def __init__(
        self,
        upstream_url: str,
        token: str,
        *,
        history_seconds: int = 300,
        debounce_ms: int = 220,
        client_rate_limit: int = 10,
        client_rate_window_sec: float = 3.0,
    ) -> None:
        self._upstream_url = str(upstream_url or "").strip()
        self._token = str(token or "").strip()
        self._history_seconds = max(int(history_seconds or 300), 30)
        self._debounce_ms = max(int(debounce_ms or 220), 150)
        self._client_rate_limit = max(int(client_rate_limit or 10), 4)
        self._client_rate_window_sec = max(float(client_rate_window_sec or 3.0), 1.0)

        self._clients: Dict[str, ClientSession] = {}
        self._subscribers_by_key: Dict[str, Set[str]] = defaultdict(set)
        self._upstream_payloads: Dict[str, Dict[str, Any]] = {}
        self._latest_snapshots: Dict[str, Dict[str, Any]] = {}

        self._lock = asyncio.Lock()
        self._upstream = None
        self._upstream_task: Optional[asyncio.Task] = None
        self._replace_task: Optional[asyncio.Task] = None
        self._wake_event = asyncio.Event()
        self._closed = False

    @property
    def enabled(self) -> bool:
        return bool(self._upstream_url and self._token)

    async def start(self) -> None:
        if not self.enabled:
            return
        if self._upstream_task and not self._upstream_task.done():
            return
        self._closed = False
        self._upstream_task = asyncio.create_task(self._run_upstream_loop(), name="devsbite-quotes-hub")

    async def shutdown(self) -> None:
        self._closed = True
        self._wake_event.set()
        if self._replace_task:
            self._replace_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._replace_task
        if self._upstream_task:
            self._upstream_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._upstream_task
        self._upstream_task = None
        await self._close_upstream()

    async def register_client(self, websocket: Any) -> str:
        client_id = uuid.uuid4().hex
        async with self._lock:
            self._clients[client_id] = ClientSession(client_id=client_id, websocket=websocket)
        await self.start()
        return client_id

    async def unregister_client(self, client_id: str) -> None:
        async with self._lock:
            session = self._clients.pop(client_id, None)
            if not session:
                return
            for key in list(session.subscriptions):
                subscribers = self._subscribers_by_key.get(key)
                if subscribers:
                    subscribers.discard(client_id)
                    if not subscribers:
                        self._subscribers_by_key.pop(key, None)
                        self._upstream_payloads.pop(key, None)
        await self._schedule_replace()

    async def handle_client_action(self, client_id: str, action: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return {"event": "error", "detail": "Quote stream is not configured"}

        normalized_action = str(action or "").strip().lower()
        if normalized_action not in {"subscribe", "unsubscribe", "subscribe_many", "unsubscribe_many", "replace"}:
            return {"event": "error", "detail": "Unsupported websocket action"}

        async with self._lock:
            session = self._clients.get(client_id)
            if not session:
                return {"event": "error", "detail": "Client session is not active"}
            if normalized_action != "ping" and not self._allow_client_command(session):
                return {"event": "error", "detail": "Too many subscription changes, slow down a little"}

            if normalized_action in {"subscribe", "unsubscribe"}:
                items = [normalize_subscription_item(payload)]
            else:
                raw_items = payload.get("items")
                if not isinstance(raw_items, list):
                    return {"event": "error", "detail": "Items must be an array"}
                items = [normalize_subscription_item(item) for item in raw_items if isinstance(item, dict)]

            if normalized_action == "subscribe":
                self._merge_subscriptions(session, items)
            elif normalized_action == "unsubscribe":
                self._remove_subscriptions(session, items)
            elif normalized_action == "subscribe_many":
                self._merge_subscriptions(session, items)
            elif normalized_action == "unsubscribe_many":
                self._remove_subscriptions(session, items)
            elif normalized_action == "replace":
                self._replace_subscriptions(session, items)

            cached_snapshots = (
                [self._latest_snapshots.get(subscription_key(item)) for item in items]
                if normalized_action in {"subscribe", "subscribe_many", "replace"}
                else []
            )

        await self._schedule_replace()
        for cached_payload in cached_snapshots:
            if cached_payload:
                await self._send_to_client(client_id, cached_payload)
        return None

    def snapshot_state(self) -> Dict[str, Any]:
        active_items = [payload for _, payload in sorted(self._upstream_payloads.items(), key=lambda item: item[0])]
        return {
            "enabled": self.enabled,
            "active_subscriptions": active_items,
            "active_clients": len(self._clients),
            "active_symbols": len(active_items),
            "history_seconds": self._history_seconds,
            "debounce_ms": self._debounce_ms,
        }

    def _allow_client_command(self, session: ClientSession) -> bool:
        now = time.monotonic()
        timestamps = session.command_timestamps
        while timestamps and now - timestamps[0] > self._client_rate_window_sec:
            timestamps.popleft()
        if len(timestamps) >= self._client_rate_limit:
            return False
        timestamps.append(now)
        return True

    def _merge_subscriptions(self, session: ClientSession, items: List[Dict[str, Any]]) -> None:
        for item in items:
            key = subscription_key(item)
            session.subscriptions.add(key)
            self._subscribers_by_key[key].add(session.client_id)
            payload = dict(item)
            payload.setdefault("history_seconds", self._history_seconds)
            self._upstream_payloads[key] = payload

    def _remove_subscriptions(self, session: ClientSession, items: List[Dict[str, Any]]) -> None:
        for item in items:
            key = subscription_key(item)
            session.subscriptions.discard(key)
            subscribers = self._subscribers_by_key.get(key)
            if subscribers:
                subscribers.discard(session.client_id)
                if not subscribers:
                    self._subscribers_by_key.pop(key, None)
                    self._upstream_payloads.pop(key, None)

    def _replace_subscriptions(self, session: ClientSession, items: List[Dict[str, Any]]) -> None:
        next_keys = {subscription_key(item) for item in items}
        for key in list(session.subscriptions):
            if key not in next_keys:
                subscribers = self._subscribers_by_key.get(key)
                if subscribers:
                    subscribers.discard(session.client_id)
                    if not subscribers:
                        self._subscribers_by_key.pop(key, None)
                        self._upstream_payloads.pop(key, None)

        session.subscriptions.clear()
        self._merge_subscriptions(session, items)

    async def _schedule_replace(self) -> None:
        if self._closed:
            return
        if self._replace_task and not self._replace_task.done():
            self._replace_task.cancel()
        self._replace_task = asyncio.create_task(self._debounced_replace(), name="devsbite-quotes-replace")

    async def _debounced_replace(self) -> None:
        try:
            await asyncio.sleep(self._debounce_ms / 1000)
            self._wake_event.set()
            await self._push_replace()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    async def _push_replace(self) -> None:
        items = [payload for _, payload in sorted(self._upstream_payloads.items(), key=lambda item: item[0])]
        if not items:
            await self._close_upstream()
            return
        await self.start()
        websocket = await self._wait_for_upstream()
        if websocket is None:
            return
        await websocket.send(json.dumps({"action": "replace", "items": items}, ensure_ascii=False))

    async def _wait_for_upstream(self):
        for _ in range(30):
            if self._upstream is not None:
                return self._upstream
            await asyncio.sleep(0.2)
        return None

    async def _run_upstream_loop(self) -> None:
        retry_delay = 1.5
        while not self._closed:
            if not self._upstream_payloads:
                self._wake_event.clear()
                try:
                    await asyncio.wait_for(self._wake_event.wait(), timeout=30)
                except asyncio.TimeoutError:
                    continue
                continue

            websocket = None
            try:
                async with websockets.connect(
                    self._build_upstream_url(),
                    ping_interval=25,
                    ping_timeout=10,
                    close_timeout=5,
                    max_queue=256,
                ) as websocket:
                    self._upstream = websocket
                    retry_delay = 1.5
                    await self._broadcast({"event": "ready", "scope": "proxy"})
                    await self._push_replace()
                    async for raw_message in websocket:
                        payload = self._safe_load_json(raw_message)
                        if not payload:
                            continue
                        await self._handle_upstream_message(payload)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await self._broadcast({"event": "error", "detail": f"Quote stream reconnecting: {exc}"})
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 1.7, 12)
            finally:
                if self._upstream is websocket:
                    self._upstream = None

    async def _close_upstream(self) -> None:
        websocket = self._upstream
        self._upstream = None
        if websocket is not None:
            try:
                await websocket.close()
            except Exception:
                pass

    def _build_upstream_url(self) -> str:
        separator = "&" if "?" in self._upstream_url else "?"
        return f"{self._upstream_url}{separator}{urlencode({'token': self._token})}"

    async def _handle_upstream_message(self, payload: Dict[str, Any]) -> None:
        event_name = str(payload.get("event") or "").strip().lower()
        if event_name == "pong":
            return

        keys = _extract_event_keys(payload)
        if event_name == "snapshot":
            for key in keys:
                self._latest_snapshots[key] = payload
        else:
            point_items = _parse_points(payload)
            if point_items and keys:
                for key in keys:
                    cached = dict(self._latest_snapshots.get(key) or {})
                    existing_points = _parse_points(cached)
                    cached_points = [*existing_points, *point_items][-240:]
                    merged = dict(payload)
                    merged["event"] = "snapshot"
                    merged["points"] = cached_points
                    item = key_to_item(key)
                    merged.setdefault("category", item["category"])
                    merged.setdefault("symbol", item["symbol"])
                    self._latest_snapshots[key] = merged
                    await self._broadcast_to_keys({key}, merged)
                return

        if keys:
            await self._broadcast_to_keys(keys, payload)
        else:
            await self._broadcast(payload)

    async def _broadcast_to_keys(self, keys: Set[str], payload: Dict[str, Any]) -> None:
        target_client_ids: Set[str] = set()
        for key in keys:
            target_client_ids.update(self._subscribers_by_key.get(key, set()))
        if not target_client_ids:
            return
        await self._broadcast(payload, target_client_ids)

    async def _broadcast(self, payload: Dict[str, Any], target_client_ids: Optional[Set[str]] = None) -> None:
        recipients = list((target_client_ids or set(self._clients.keys())))
        if not recipients:
            return
        send_tasks = [self._send_to_client(client_id, payload) for client_id in recipients]
        if send_tasks:
            await asyncio.gather(*send_tasks, return_exceptions=True)

    async def _send_to_client(self, client_id: str, payload: Dict[str, Any]) -> None:
        session = self._clients.get(client_id)
        if not session:
            return
        try:
            await session.websocket.send_json(payload)
        except Exception:
            await self.unregister_client(client_id)

    @staticmethod
    def _safe_load_json(raw_message: Any) -> Optional[Dict[str, Any]]:
        try:
            if isinstance(raw_message, bytes):
                raw_message = raw_message.decode("utf-8", errors="ignore")
            payload = json.loads(raw_message)
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None
