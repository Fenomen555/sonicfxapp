import argparse
import asyncio
import hashlib
import json
import mimetypes
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiomysql
import httpx
import uvicorn
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from db_bootstrap import (
    ensure_database_schema,
    normalize_activation_status,
    normalize_user_lang,
    scanner_access_from_deposit,
)
from telegram_auth import get_telegram_user

load_dotenv()


def get_env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if 1 <= value <= 65535 else default


def parse_runtime_mode() -> str:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--mode",
        choices=("all", "api", "bot"),
        default=(os.getenv("APP_MODE") or "all").strip().lower() or "all",
    )
    args, _ = parser.parse_known_args()
    return str(args.mode or "all").strip().lower() or "all"


API_HOST = (os.getenv("API_HOST") or "0.0.0.0").strip() or "0.0.0.0"
API_PORT = get_env_int("API_PORT", 8000)
WEB_APP_URL = (os.getenv("WEB_APP_URL") or "").strip().rstrip("/")
BOT_USERNAME = (os.getenv("BOT_USERNAME") or "").strip().lstrip("@")
BOT_TOKEN = (os.getenv("BOT_TOKEN") or "").strip()
LANGS = {"ru", "en", "uk"}
THEMES = {"dark", "light"}
ACTIVATION_STATUSES = {"inactive", "active", "active_scanner"}
DEVSBITE_API_BASE_URL = (os.getenv("DEVSBITE_API_BASE_URL") or "https://api.devsbite.com").strip().rstrip("/")
DEVSBITE_TOKEN = (os.getenv("DEVSBITE_TOKEN") or "").strip()
DEVSBITE_MIN_PAYOUT = int((os.getenv("DEVSBITE_MIN_PAYOUT") or "60").strip() or "60")
MARKET_SYNC_INTERVAL_SEC = int((os.getenv("MARKET_SYNC_INTERVAL_SEC") or "300").strip() or "300")
EXPIRATION_OPTIONS = (os.getenv("EXPIRATION_OPTIONS") or "5s,15s,1m,5m,15m,1h").strip()
DEVSBITE_EXPIRATIONS_URL = (os.getenv("DEVSBITE_EXPIRATIONS_URL") or "").strip()
FINNHUB_TOKEN = (os.getenv("FINNHUB_TOKEN") or "").strip()
DEFAULT_MARKET_SYNC_INTERVAL_MIN = min(max(max(MARKET_SYNC_INTERVAL_SEC, 120) // 60, 2), 30)
DEFAULT_NEWS_SYNC_INTERVAL_MIN = 60
VALID_NEWS_FEEDS = {"economic", "market"}
NEWS_GENERAL_CATEGORY = "general"
MARKET_KIND_CONFIG = {
    "forex": {"title": "Forex", "path": "forex"},
    "otc": {"title": "OTC", "path": "otc"},
    "commodities": {"title": "Metals", "path": "otc/commodities"},
    "stocks": {"title": "Stocks", "path": "otc/stocks"},
    "crypto": {"title": "Crypto", "path": "otc/crypto"},
}
MARKET_KIND_ALIASES = {
    "metal": "commodities",
    "metals": "commodities",
    "commodity": "commodities",
    "commodities": "commodities",
    "stock": "stocks",
    "stocks": "stocks",
    "crypto": "crypto",
    "crypta": "crypto",
}

COUNTRY_TO_CURRENCY = {
    "US": "USD", "GB": "GBP", "CA": "CAD", "AU": "AUD", "NZ": "NZD",
    "JP": "JPY", "CH": "CHF", "CN": "CNY", "RU": "RUB", "TR": "TRY",
    "ZA": "ZAR", "MX": "MXN", "BR": "BRL", "IN": "INR", "KR": "KRW",
    "EU": "EUR", "DE": "EUR", "FR": "EUR", "IT": "EUR", "ES": "EUR",
}

DB_CONFIG = {
    "host": (os.getenv("DB_HOST") or "127.0.0.1").strip(),
    "port": get_env_int("DB_PORT", 3306),
    "user": (os.getenv("DB_USER") or "").strip(),
    "password": (os.getenv("DB_PASS") or "").strip(),
    "db": (os.getenv("DB_NAME") or "").strip(),
    "autocommit": True,
}

app = FastAPI(title="SonicFX API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

db_pool: Optional[aiomysql.Pool] = None
bot: Optional[Bot] = None
dp = Dispatcher()

media_dir = Path(__file__).resolve().parent / "media"
media_dir.mkdir(parents=True, exist_ok=True)
news_media_dir = media_dir / "news"
news_media_dir.mkdir(parents=True, exist_ok=True)
admin_token_file_path = media_dir / "admin.token"
admin_panel_token = (os.getenv("ADMIN_PANEL_TOKEN") or "").strip()

WELCOME_TEXTS = {
    "ru": {
        "welcome": (
            "Привет, <b>{name}</b>.\n\n"
            "Добро пожаловать в <b>SonicFX</b>.\n"
            "Нажми кнопку ниже, чтобы открыть Mini App."
        ),
        "open_app": "Open SonicFX",
        "admin_panel": "Admin Panel",
        "lang_title": "Language",
        "lang_saved": "Язык сохранен",
    },
    "en": {
        "welcome": (
            "Hi, <b>{name}</b>.\n\n"
            "Welcome to <b>SonicFX</b>.\n"
            "Tap the button below to open the Mini App."
        ),
        "open_app": "Open SonicFX",
        "admin_panel": "Admin Panel",
        "lang_title": "Language",
        "lang_saved": "Language saved",
    },
    "uk": {
        "welcome": (
            "Привiт, <b>{name}</b>.\n\n"
            "Ласкаво просимо до <b>SonicFX</b>.\n"
            "Натисни кнопку нижче, щоб вiдкрити Mini App."
        ),
        "open_app": "Open SonicFX",
        "admin_panel": "Admin Panel",
        "lang_title": "Мова",
        "lang_saved": "Мову збережено",
    },
}


class UserSettingsUpdate(BaseModel):
    lang: Optional[str] = None
    theme: Optional[str] = None
    mini_username: Optional[str] = Field(default=None, max_length=64)
    timezone: Optional[str] = Field(default=None, max_length=64)


class AdminSetActivationRequest(BaseModel):
    user_id: int
    activation_status: str
    deposit_amount: Optional[float] = None


class AdminFlagUpdateRequest(BaseModel):
    key: str
    is_enabled: int


class AdminMarketSettingsUpdateRequest(BaseModel):
    market_pairs_sync_interval_min: int = Field(ge=2, le=30)


class AdminIndicatorUpdateRequest(BaseModel):
    code: str
    is_enabled: int


def _normalize_tg_language(raw: str) -> str:
    lang = (raw or "").strip().lower()
    if "-" in lang:
        lang = lang.split("-", 1)[0]
    if lang in LANGS:
        return lang
    return "ru"


def _coerce_theme(raw: str) -> str:
    theme = (raw or "").strip().lower()
    if theme in THEMES:
        return theme
    return "dark"


def _coerce_activation(raw: str) -> str:
    status = normalize_activation_status(raw)
    if status in ACTIVATION_STATUSES:
        return status
    return "inactive"


def get_admin_panel_token() -> str:
    global admin_panel_token
    if admin_panel_token:
        return admin_panel_token
    if admin_token_file_path.exists():
        try:
            value = admin_token_file_path.read_text(encoding="utf-8").strip()
            if value:
                admin_panel_token = value
                return value
        except Exception:
            pass
    token = secrets.token_urlsafe(32)
    try:
        admin_token_file_path.write_text(token, encoding="utf-8")
    except Exception:
        pass
    admin_panel_token = token
    return token


def build_admin_webapp_url() -> str:
    token = get_admin_panel_token()
    if not WEB_APP_URL:
        return f"/admin/{token}"
    return f"{WEB_APP_URL}/admin/{token}"


def build_main_webapp_url() -> str:
    return WEB_APP_URL or "https://example.com"


async def require_db_pool() -> aiomysql.Pool:
    if db_pool is None:
        raise HTTPException(status_code=503, detail="Database pool is not initialized")
    return db_pool


async def is_admin_user(user_id: int) -> bool:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT user_id
                FROM admin_users
                WHERE user_id = %s AND is_active = 1
                LIMIT 1
                """,
                (int(user_id),),
            )
            row = await cur.fetchone()
    return bool(row)


async def get_admin_user(
    user: Dict[str, Any] = Depends(get_telegram_user),
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
):
    expected = get_admin_panel_token()
    provided = (x_admin_token or "").strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Admin token is invalid")
    if not await is_admin_user(int(user["user_id"])):
        raise HTTPException(status_code=403, detail="Admin access denied")
    return user


async def upsert_user_from_telegram(tg_user: Dict[str, Any], forced_lang: Optional[str] = None) -> None:
    pool = await require_db_pool()
    user_id = int(tg_user["user_id"])
    username = (tg_user.get("username") or "").strip()
    first_name = (tg_user.get("first_name") or "").strip()
    last_name = (tg_user.get("last_name") or "").strip()
    photo_url = (tg_user.get("photo_url") or "").strip()
    lang_code = normalize_user_lang(forced_lang or _normalize_tg_language(tg_user.get("language_code") or ""))
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                INSERT INTO users (
                    user_id, tg_username, first_name, last_name, photo_url, lang, last_active_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    tg_username = VALUES(tg_username),
                    first_name = VALUES(first_name),
                    last_name = VALUES(last_name),
                    photo_url = VALUES(photo_url),
                    lang = IF(lang IS NULL OR lang = '', VALUES(lang), lang),
                    last_active_at = VALUES(last_active_at)
                """,
                (user_id, username, first_name, last_name, photo_url, lang_code, now_utc),
            )


async def update_user_lang(user_id: int, lang: str) -> None:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET lang = %s, last_active_at = NOW()
                WHERE user_id = %s
                """,
                (normalize_user_lang(lang), int(user_id)),
            )


async def get_user_lang(user_id: int, fallback: str = "ru") -> str:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT lang FROM users WHERE user_id = %s LIMIT 1", (int(user_id),))
            row = await cur.fetchone()
    if not row:
        return normalize_user_lang(fallback)
    return normalize_user_lang(str(row.get("lang") or fallback))


async def build_main_menu_keyboard(current_lang: str, user_id: Optional[int] = None) -> InlineKeyboardMarkup:
    lang = normalize_user_lang(current_lang)
    labels = WELCOME_TEXTS[lang]
    lang_btns = []
    for item in ("ru", "en", "uk"):
        mark = " " + ("*" if item == lang else "")
        lang_btns.append(InlineKeyboardButton(text=f"{item.upper()}{mark}", callback_data=f"lang:{item}"))
    inline_keyboard = [
        [
            InlineKeyboardButton(
                text=labels["open_app"],
                web_app=WebAppInfo(url=build_main_webapp_url()),
            )
        ]
    ]
    if user_id is not None and await is_admin_user(int(user_id)):
        inline_keyboard.append(
            [
                InlineKeyboardButton(
                    text=labels["admin_panel"],
                    web_app=WebAppInfo(url=build_admin_webapp_url()),
                )
            ]
        )
    inline_keyboard.append(lang_btns)
    return InlineKeyboardMarkup(inline_keyboard=inline_keyboard)


def build_welcome_message(lang: str, name: str) -> str:
    normalized = normalize_user_lang(lang)
    template = WELCOME_TEXTS[normalized]["welcome"]
    return template.format(name=name or "Trader")


async def fetch_user_profile(user_id: int) -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM users WHERE user_id = %s LIMIT 1", (int(user_id),))
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": int(row["user_id"]),
        "tg_username": row.get("tg_username") or "",
        "first_name": row.get("first_name") or "",
        "last_name": row.get("last_name") or "",
        "photo_url": row.get("photo_url") or "",
        "mini_username": row.get("mini_username") or "",
        "lang": normalize_user_lang(row.get("lang") or "ru"),
        "timezone": row.get("timezone") or "Europe/Kiev",
        "theme": _coerce_theme(row.get("theme") or "dark"),
        "activation_status": _coerce_activation(row.get("activation_status") or "inactive"),
        "deposit_amount": float(row.get("deposit_amount") or 0),
        "scanner_access": int(row.get("scanner_access") or 0),
        "is_blocked": int(row.get("is_blocked") or 0),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        "last_active_at": row.get("last_active_at").isoformat() if row.get("last_active_at") else None,
    }


async def add_admin_audit(admin_user_id: int, action_key: str, payload: Dict[str, Any]) -> None:
    pool = await require_db_pool()
    serialized = json.dumps(payload or {}, ensure_ascii=True)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO admin_audit_log (admin_user_id, action_key, payload_json)
                VALUES (%s, %s, %s)
                """,
                (int(admin_user_id), action_key, serialized),
            )


def _sanitize_market_sync_interval_min(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = DEFAULT_MARKET_SYNC_INTERVAL_MIN
    return min(max(numeric, 2), 30)


async def get_app_setting(key: str, default: str) -> str:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT value_text FROM app_settings WHERE `key` = %s LIMIT 1", (key,))
            row = await cur.fetchone()
    return str((row or {}).get("value_text") or default)


async def set_app_setting(key: str, value: str) -> None:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO app_settings (`key`, value_text)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)
                """,
                (key, str(value)),
            )


async def get_market_sync_interval_min() -> int:
    raw = await get_app_setting("market_pairs_sync_interval_min", str(DEFAULT_MARKET_SYNC_INTERVAL_MIN))
    return _sanitize_market_sync_interval_min(raw)


async def get_news_sync_interval_min() -> int:
    raw = await get_app_setting("news_sync_interval_min", str(DEFAULT_NEWS_SYNC_INTERVAL_MIN))
    try:
        numeric = int(raw)
    except (TypeError, ValueError):
        numeric = DEFAULT_NEWS_SYNC_INTERVAL_MIN
    return max(numeric, DEFAULT_NEWS_SYNC_INTERVAL_MIN)


def parse_expiration_options(raw: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for chunk in (raw or "").split(","):
        value = (chunk or "").strip().lower()
        if not value:
            continue
        label = value
        if value.endswith("s") and value[:-1].isdigit():
            label = f"{int(value[:-1])}s"
        elif value.endswith("m") and value[:-1].isdigit():
            label = f"{int(value[:-1])}m"
        elif value.endswith("h") and value[:-1].isdigit():
            label = f"{int(value[:-1])}h"
        items.append({"value": value, "label": label})
    if not items:
        return [{"value": "5m", "label": "5m"}]
    return items


def _pair_kind_normalized(kind: str) -> str:
    raw = str(kind or "").strip().lower()
    if raw in MARKET_KIND_CONFIG:
        return raw
    if raw in MARKET_KIND_ALIASES:
        return MARKET_KIND_ALIASES[raw]
    return "otc" if raw == "otc" else "forex"


def _normalize_pairs(payload: Any) -> List[Dict[str, Any]]:
    rows = payload if isinstance(payload, list) else []
    normalized: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        pair = _pair_label(row)
        if not pair:
            continue
        symbol = _pair_symbol(row, pair)
        normalized_symbol = _normalize_pair_symbol(symbol or pair)
        if not normalized_symbol or normalized_symbol in seen:
            continue
        seen.add(normalized_symbol)
        payout_raw = row.get("payout")
        try:
            if payout_raw is None:
                payout_raw = row.get("profit", row.get("percent"))
            payout = int(float(payout_raw)) if payout_raw is not None else None
        except (TypeError, ValueError):
            payout = None
        normalized.append(
            {
                "pair": pair,
                "payout": payout,
            }
        )
    normalized.sort(key=lambda item: item["pair"])
    return normalized


def _extract_pairs_payload(payload: Any) -> List[Any]:
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []

    for key in ("pairs", "data", "items", "results", "assets", "symbols", "instruments"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            nested = _extract_pairs_payload(value)
            if nested:
                return nested
    return []


def _pair_label(item: Dict[str, Any]) -> str:
    direct = (
        item.get("pair")
        or item.get("name")
        or item.get("label")
        or item.get("asset")
        or item.get("display_name")
        or item.get("display")
        or item.get("title")
        or item.get("ticker")
        or item.get("symbol")
    )
    label = str(direct or "").strip()
    if label:
        return label

    base = str(item.get("base") or item.get("base_asset") or item.get("currency_base") or "").strip()
    quote = str(item.get("quote") or item.get("quote_asset") or item.get("currency_quote") or "").strip()
    if base and quote:
        return f"{base}/{quote}"
    return ""


def _pair_symbol(item: Dict[str, Any], label: str) -> str:
    raw = (
        item.get("symbol")
        or item.get("ticker")
        or item.get("code")
        or item.get("asset")
        or item.get("slug")
        or item.get("pair_code")
        or item.get("instrument")
    )
    symbol = str(raw or "").strip()
    if symbol:
        return symbol
    return label


def _normalize_pair_symbol(raw: str) -> str:
    return (
        str(raw or "")
        .strip()
        .upper()
        .replace(" ", "")
        .replace("/", "")
        .replace("-", "")
        .replace("_", "")
    )


async def _fetch_devsbite_pairs(kind: str, min_payout: int) -> tuple[List[Dict[str, Any]], bool]:
    if not DEVSBITE_TOKEN:
        return ([], False)
    pair_kind = _pair_kind_normalized(kind)
    pair_path = MARKET_KIND_CONFIG.get(pair_kind, MARKET_KIND_CONFIG["forex"])["path"]
    url = f"{DEVSBITE_API_BASE_URL}/pairs/{pair_path}"
    headers = {
        "accept": "application/json",
        "X-Client-Token": DEVSBITE_TOKEN,
        "Cache-Control": "no-cache",
    }
    params = {
        "min_payout": max(int(min_payout or 0), 0),
        "_t": int(time.time()),
    }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=12.0)
            response.raise_for_status()
            data = response.json()
    except Exception:
        return ([], False)
    pairs_payload = _extract_pairs_payload(data)
    parsed_pairs = _normalize_pairs(pairs_payload)
    if not parsed_pairs:
        return ([], False)
    return (parsed_pairs, True)


async def _fetch_expiration_options() -> List[Dict[str, Any]]:
    defaults = parse_expiration_options(EXPIRATION_OPTIONS)
    if not DEVSBITE_TOKEN or not DEVSBITE_EXPIRATIONS_URL:
        return defaults
    headers = {
        "accept": "application/json",
        "X-Client-Token": DEVSBITE_TOKEN,
        "Cache-Control": "no-cache",
    }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(DEVSBITE_EXPIRATIONS_URL, headers=headers, timeout=10.0)
            response.raise_for_status()
            data = response.json()
    except Exception:
        return defaults
    if isinstance(data, dict):
        values = data.get("expirations") or data.get("items") or data.get("data") or []
    elif isinstance(data, list):
        values = data
    else:
        values = []
    parsed_raw = ",".join(str(item) for item in values)
    parsed = parse_expiration_options(parsed_raw)
    return parsed if parsed else defaults


async def _upsert_market_pairs(kind: str, pairs: List[Dict[str, Any]]) -> None:
    pool = await require_db_pool()
    pair_kind = _pair_kind_normalized(kind)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for item in pairs:
                pair = str(item.get("pair") or "").strip()
                if not pair:
                    continue
                payout = item.get("payout")
                await cur.execute(
                    """
                    INSERT INTO market_pairs (pair_kind, pair, payout, is_active, source, last_seen_at)
                    VALUES (%s, %s, %s, 1, 'devsbite', NOW())
                    ON DUPLICATE KEY UPDATE
                        payout = VALUES(payout),
                        is_active = 1,
                        source = 'devsbite',
                        last_seen_at = NOW(),
                        updated_at = NOW()
                    """,
                    (pair_kind, pair, payout),
                )


async def _deactivate_missing_market_pairs(kind: str, active_pairs: List[str]) -> None:
    pool = await require_db_pool()
    pair_kind = _pair_kind_normalized(kind)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            if not active_pairs:
                await cur.execute(
                    """
                    UPDATE market_pairs
                    SET is_active = 0, updated_at = NOW()
                    WHERE pair_kind = %s AND source = 'devsbite'
                    """,
                    (pair_kind,),
                )
                return

            placeholders = ", ".join(["%s"] * len(active_pairs))
            params: List[Any] = [pair_kind, *active_pairs]
            await cur.execute(
                f"""
                UPDATE market_pairs
                SET is_active = 0, updated_at = NOW()
                WHERE pair_kind = %s
                  AND source = 'devsbite'
                  AND pair NOT IN ({placeholders})
                """,
                tuple(params),
            )


async def sync_market_pairs_kind(kind: str, min_payout: int) -> bool:
    pairs, ok = await _fetch_devsbite_pairs(kind, min_payout)
    if not ok:
        return False
    await _upsert_market_pairs(kind, pairs)
    await _deactivate_missing_market_pairs(kind, [str(item["pair"]) for item in pairs if item.get("pair")])
    return True


async def sync_market_pairs_once() -> Dict[str, bool]:
    result: Dict[str, bool] = {}
    for kind in MARKET_KIND_CONFIG:
        try:
            result[kind] = await sync_market_pairs_kind(kind, DEVSBITE_MIN_PAYOUT)
        except Exception:
            result[kind] = False
    return result


async def market_pairs_sync_loop() -> None:
    await asyncio.sleep(2)
    while True:
        started_at = time.monotonic()
        try:
            await sync_market_pairs_once()
        except Exception:
            pass
        while True:
            interval_min = await get_market_sync_interval_min()
            interval_sec = max(interval_min * 60, 120)
            elapsed = time.monotonic() - started_at
            remaining = interval_sec - elapsed
            if remaining <= 0:
                break
            await asyncio.sleep(min(30, remaining))


async def _get_active_pairs_from_db(kind: str, min_payout: int) -> List[Dict[str, Any]]:
    pool = await require_db_pool()
    pair_kind = _pair_kind_normalized(kind)
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT pair, payout
                FROM market_pairs
                WHERE pair_kind = %s
                  AND is_active = 1
                  AND (%s <= 0 OR payout IS NULL OR payout >= %s)
                ORDER BY pair ASC
                """,
                (pair_kind, int(min_payout), int(min_payout)),
            )
            rows = await cur.fetchall()
    return [
        {
            "pair": str(row.get("pair") or ""),
            "payout": int(row["payout"]) if row.get("payout") is not None else None,
        }
        for row in rows
        if row.get("pair")
    ]


async def get_market_options_payload(kind: str, min_payout: int) -> Dict[str, Any]:
    pair_kind = _pair_kind_normalized(kind)
    pairs = await _get_active_pairs_from_db(pair_kind, min_payout)
    if not pairs:
        await sync_market_pairs_kind(pair_kind, min_payout)
        pairs = await _get_active_pairs_from_db(pair_kind, min_payout)

    expirations = await _fetch_expiration_options()
    payload = {
        "kind": pair_kind,
        "market_title": MARKET_KIND_CONFIG.get(pair_kind, MARKET_KIND_CONFIG["forex"])["title"],
        "available_markets": [
            {"key": key, "title": value["title"]}
            for key, value in MARKET_KIND_CONFIG.items()
        ],
        "pairs": pairs,
        "expirations": expirations,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    return payload


async def get_enabled_indicators_payload() -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT `code`, title, description
                FROM signal_indicators
                WHERE is_enabled = 1
                ORDER BY sort_order ASC, title ASC
                """
            )
            rows = await cur.fetchall()
    items = [
        {
            "code": str(row.get("code") or ""),
            "title": str(row.get("title") or ""),
            "description": str(row.get("description") or ""),
        }
        for row in rows
        if row.get("code") and row.get("title")
    ]
    return {
        "items": items,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


async def get_admin_indicators_payload() -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT `code`, title, description, is_enabled, sort_order, updated_at
                FROM signal_indicators
                ORDER BY sort_order ASC, title ASC, `code` ASC
                """
            )
            rows = await cur.fetchall()

    items = [
        {
            "code": str(row.get("code") or ""),
            "title": str(row.get("title") or ""),
            "description": str(row.get("description") or ""),
            "is_enabled": int(row.get("is_enabled") or 0),
            "sort_order": int(row.get("sort_order") or 100),
            "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        }
        for row in rows
        if row.get("code") and row.get("title")
    ]
    enabled_total = sum(1 for item in items if item["is_enabled"] == 1)
    return {
        "items": items,
        "summary": {
            "total": len(items),
            "enabled": enabled_total,
            "disabled": max(len(items) - enabled_total, 0),
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/health")
async def api_health():
    return {"status": "ok", "service": "sonicfx-api"}


@app.get("/api/support/links")
async def get_support_links():
    channel_url = (os.getenv("CHANNEL_URL") or "").strip()
    support_url = (os.getenv("SUPPORT_URL") or "").strip()
    return {"channel_url": channel_url, "support_url": support_url}


@app.get("/api/webapp/bot-info")
async def get_webapp_bot_info():
    if BOT_USERNAME:
        return {"bot_username": BOT_USERNAME}
    if not BOT_TOKEN:
        return {"bot_username": ""}
    local_bot = bot if bot is not None else Bot(token=BOT_TOKEN)
    try:
        me = await local_bot.get_me()
        return {"bot_username": (me.username or "").strip()}
    except Exception:
        return {"bot_username": ""}
    finally:
        if bot is None:
            await local_bot.session.close()


@app.post("/api/user/sync")
async def sync_user(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    profile = await fetch_user_profile(int(user["user_id"]))
    return {"status": "success", "user": profile}


@app.post("/api/user/profile")
async def get_profile(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    return await fetch_user_profile(int(user["user_id"]))


@app.post("/api/user/settings")
async def update_user_settings(
    payload: UserSettingsUpdate,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    fields: List[str] = []
    values: List[Any] = []

    if payload.lang is not None:
        fields.append("lang = %s")
        values.append(normalize_user_lang(payload.lang))
    if payload.theme is not None:
        fields.append("theme = %s")
        values.append(_coerce_theme(payload.theme))
    if payload.mini_username is not None:
        fields.append("mini_username = %s")
        values.append((payload.mini_username or "").strip())
    if payload.timezone is not None:
        fields.append("timezone = %s")
        values.append((payload.timezone or "").strip() or "Europe/Kiev")

    if fields:
        values.append(user_id)
        pool = await require_db_pool()
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"UPDATE users SET {', '.join(fields)}, last_active_at = NOW() WHERE user_id = %s",
                    tuple(values),
                )
    return {"status": "success", "user": await fetch_user_profile(user_id)}


@app.get("/api/market/options")
async def get_market_options(
    kind: str = Query(default="forex"),
    min_payout: int = Query(default=DEVSBITE_MIN_PAYOUT, ge=0, le=100),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    return await get_market_options_payload(kind=kind, min_payout=min_payout)


@app.get("/api/indicators/options")
async def get_indicator_options(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    return await get_enabled_indicators_payload()


@app.get("/api/pairs/forex")
async def get_forex_pairs(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    payload = await get_market_options_payload(kind="forex", min_payout=DEVSBITE_MIN_PAYOUT)
    return {"pairs": payload["pairs"]}


@app.get("/api/pairs/otc")
async def get_otc_pairs(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    payload = await get_market_options_payload(kind="otc", min_payout=DEVSBITE_MIN_PAYOUT)
    return {"pairs": payload["pairs"]}


@app.get("/api/pairs")
async def get_pairs_by_kind(
    kind: str = Query(default="forex"),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    payload = await get_market_options_payload(kind=kind, min_payout=DEVSBITE_MIN_PAYOUT)
    return {
        "kind": payload["kind"],
        "market_title": payload["market_title"],
        "pairs": payload["pairs"],
    }


@app.get("/api/expirations")
async def get_expiration_options(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    expirations = await _fetch_expiration_options()
    return {"expirations": expirations}


def _parse_finnhub_event_time(raw_value: Any) -> Optional[datetime]:
    value = str(raw_value or "").strip()
    if not value:
        return None
    normalized = value.replace("T", " ").replace("Z", "").strip()
    patterns = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    )
    for pattern in patterns:
        try:
            parsed = datetime.strptime(normalized, pattern)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _normalize_finnhub_impact(raw_value: Any) -> str:
    value = str(raw_value or "").strip().lower()
    mapping = {
        "high": "high",
        "h": "high",
        "3": "high",
        "medium": "medium",
        "med": "medium",
        "moderate": "medium",
        "2": "medium",
        "low": "low",
        "l": "low",
        "1": "low",
    }
    return mapping.get(value, "medium")


def _parse_finnhub_market_datetime(raw_value: Any) -> Optional[datetime]:
    if raw_value is None:
        return None
    if isinstance(raw_value, (int, float)):
        try:
            return datetime.fromtimestamp(float(raw_value), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            return None
    value = str(raw_value or "").strip()
    if not value:
        return None
    if re.fullmatch(r"\d+(\.\d+)?", value):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            return None
    return _parse_finnhub_event_time(value)


def _coerce_news_text(raw_value: Any, max_len: Optional[int] = None) -> str:
    text = re.sub(r"\s+", " ", str(raw_value or "")).strip()
    if max_len and len(text) > max_len:
        return f"{text[: max_len - 1].rstrip()}…"
    return text


def _normalize_news_title(raw_title: Any) -> str:
    title = _coerce_news_text(raw_title, max_len=320)
    replacements = {
        r"\bMoM\b": "m/m",
        r"\bYoY\b": "y/y",
        r"\bQoQ\b": "q/q",
        r"\bQoQ\s+Annualized\b": "q/q annualized",
    }
    for pattern, value in replacements.items():
        title = re.sub(pattern, value, title, flags=re.IGNORECASE)
    return title


def _guess_market_country_code(*parts: Any) -> str:
    haystack = f" {' '.join(_coerce_news_text(part, max_len=600) for part in parts if part)} ".lower()
    if not haystack.strip():
        return ""
    keyword_map = {
        " united states ": "US",
        " u.s. ": "US",
        " us ": "US",
        " america ": "US",
        " euro zone ": "EU",
        " eurozone ": "EU",
        " european union ": "EU",
        " britain ": "GB",
        " united kingdom ": "GB",
        " uk ": "GB",
        " england ": "GB",
        " australia ": "AU",
        " australian ": "AU",
        " japan ": "JP",
        " japanese ": "JP",
        " china ": "CN",
        " chinese ": "CN",
        " india ": "IN",
        " indian ": "IN",
        " iran ": "IR",
        " turkey ": "TR",
        " turkish ": "TR",
        " nigeria ": "NG",
        " canada ": "CA",
        " canadian ": "CA",
        " new zealand ": "NZ",
        " switzerland ": "CH",
        " swiss ": "CH",
        " germany ": "DE",
        " german ": "DE",
        " france ": "FR",
        " french ": "FR",
        " italy ": "IT",
        " italian ": "IT",
        " spain ": "ES",
        " spanish ": "ES",
        " south africa ": "ZA",
        " brazil ": "BR",
        " brazilian ": "BR",
        " mexico ": "MX",
        " mexican ": "MX",
        " russia ": "RU",
        " russian ": "RU",
    }
    for needle, code in keyword_map.items():
        if needle in haystack:
            return code
    return ""


def _resolve_news_image_suffix(source_url: str, content_type: str) -> str:
    suffix = mimetypes.guess_extension((content_type or "").split(";", 1)[0].strip()) or ""
    if suffix in {".jpe", ".jpeg", ".jpg", ".png", ".webp", ".svg", ".gif"}:
        return ".jpg" if suffix == ".jpe" else suffix
    parsed = Path((source_url or "").split("?", 1)[0])
    ext = parsed.suffix.lower()
    if ext in {".jpeg", ".jpg", ".png", ".webp", ".svg", ".gif"}:
        return ".jpg" if ext == ".jpeg" else ext
    return ".img"


async def _resolve_cached_news_image_path(news_item_id: int, source_url: str) -> Optional[Path]:
    if not news_item_id or not source_url:
        return None
    source_hash = hashlib.sha1(source_url.encode("utf-8")).hexdigest()[:16]
    existing = next(iter(news_media_dir.glob(f"{news_item_id}-{source_hash}.*")), None)
    if existing and existing.is_file():
        return existing
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            response = await client.get(source_url, timeout=12.0)
        if response.status_code != 200 or not response.content:
            return None
        content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
        if content_type in {"text/html", "application/json", "text/plain"}:
            return None
        suffix = _resolve_news_image_suffix(source_url, response.headers.get("content-type", ""))
        target = news_media_dir / f"{news_item_id}-{source_hash}{suffix}"
        target.write_bytes(response.content)
        return target
    except Exception as exc:
        print(f"News image cache error [{news_item_id}]: {exc}")
        return None


def _build_news_external_id(feed_type: str, *parts: Any) -> str:
    seed = "::".join(_coerce_news_text(part) for part in parts if _coerce_news_text(part))
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
    return f"{feed_type}:{digest}"


def _format_news_metric_value(raw_value: Any, unit: str = "") -> str:
    value = _coerce_news_text(raw_value, max_len=64)
    if not value:
        return ""
    suffix = _coerce_news_text(unit, max_len=16)
    return f"{value}{suffix}" if suffix else value


def _serialize_news_row(row: Dict[str, Any]) -> Dict[str, Any]:
    published_at = row.get("published_at")
    updated_at = row.get("updated_at")
    published_iso = published_at.isoformat() if published_at else None
    row_id = int(row.get("id") or 0)
    image_url = row.get("image_url") or ""
    return {
        "db_id": row_id,
        "id": row.get("external_id") or str(row.get("id") or ""),
        "title": row.get("title") or "",
        "summary": row.get("summary") or "",
        "image_url": f"/api/news/image/{row_id}" if row_id and image_url else "",
        "source_name": row.get("source_name") or "",
        "source_url": row.get("source_url") or "",
        "feed_type": row.get("feed_type") or "market",
        "category": row.get("news_category") or "",
        "related": row.get("related_symbols") or "",
        "country_code": (row.get("country_code") or "").strip().upper(),
        "currency": (row.get("currency_code") or "").strip().upper(),
        "impact": (row.get("impact_level") or "medium").strip().lower() or "medium",
        "actual": row.get("actual_value") or "",
        "forecast": row.get("forecast_value") or "",
        "previous": row.get("previous_value") or "",
        "unit": row.get("unit") or "",
        "published_at": published_iso,
        "updated_at": updated_at.isoformat() if updated_at else published_iso,
        "time_label": published_at.strftime("%H:%M") if published_at else "--:--",
    }


async def _fetch_finnhub_json(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    if not FINNHUB_TOKEN:
        return None
    url = f"https://finnhub.io/api/v1/{path.lstrip('/')}"
    request_params = dict(params or {})
    request_params["token"] = FINNHUB_TOKEN
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=request_params, timeout=8.0)
            if response.status_code != 200:
                return None
            return response.json()
    except Exception as exc:
        print(f"Finnhub API Error [{path}]: {exc}")
        return None


async def _replace_news_feed(feed_type: str, items: List[Dict[str, Any]]) -> None:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE news_items
                SET is_visible = 0, updated_at = NOW()
                WHERE feed_type = %s
                """,
                (feed_type,),
            )
            if not items:
                return
            await cur.executemany(
                """
                INSERT INTO news_items (
                    external_id, feed_type, news_category, title, summary, image_url, related_symbols,
                    source_name, source_url, country_code, currency_code, impact_level,
                    actual_value, forecast_value, previous_value, unit, published_at, is_visible
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1
                )
                ON DUPLICATE KEY UPDATE
                    news_category = VALUES(news_category),
                    title = VALUES(title),
                    summary = VALUES(summary),
                    image_url = VALUES(image_url),
                    related_symbols = VALUES(related_symbols),
                    source_name = VALUES(source_name),
                    source_url = VALUES(source_url),
                    country_code = VALUES(country_code),
                    currency_code = VALUES(currency_code),
                    impact_level = VALUES(impact_level),
                    actual_value = VALUES(actual_value),
                    forecast_value = VALUES(forecast_value),
                    previous_value = VALUES(previous_value),
                    unit = VALUES(unit),
                    published_at = VALUES(published_at),
                    is_visible = 1,
                    updated_at = NOW()
                """,
                [
                    (
                        item["external_id"],
                        item["feed_type"],
                        item["news_category"],
                        item["title"],
                        item["summary"],
                        item["image_url"],
                        item["related_symbols"],
                        item["source_name"],
                        item["source_url"],
                        item["country_code"],
                        item["currency_code"],
                        item["impact_level"],
                        item["actual_value"],
                        item["forecast_value"],
                        item["previous_value"],
                        item["unit"],
                        item["published_at"],
                    )
                    for item in items
                ],
            )


async def _sync_economic_news() -> int:
    raw_data = await _fetch_finnhub_json("calendar/economic")
    events = raw_data.get("economicCalendar", []) if isinstance(raw_data, dict) else []
    now = datetime.now(timezone.utc)
    today = now.date()
    tomorrow = today + timedelta(days=1)
    prepared_items: List[Dict[str, Any]] = []

    for event in events:
        if not isinstance(event, dict):
            continue
        event_time = _parse_finnhub_event_time(event.get("time"))
        if event_time is None:
            continue
        event_date = event_time.date()
        if event_date == today:
            if event_time <= now - timedelta(hours=2):
                continue
        elif event_date != tomorrow:
            continue

        country = _coerce_news_text(event.get("country"), max_len=8).upper()
        title = _normalize_news_title(event.get("event") or event.get("title"))
        if not title:
            continue
        unit = _coerce_news_text(event.get("unit"), max_len=16)
        actual_value = _format_news_metric_value(event.get("actual"), unit)
        forecast_value = _format_news_metric_value(event.get("estimate") or event.get("forecast"), unit)
        previous_value = _format_news_metric_value(event.get("prev") or event.get("previous"), unit)
        currency_code = COUNTRY_TO_CURRENCY.get(country, "")
        summary_parts = [
            part
            for part in (
                f"Actual {actual_value}" if actual_value else "",
                f"Forecast {forecast_value}" if forecast_value else "",
                f"Previous {previous_value}" if previous_value else "",
            )
            if part
        ]
        prepared_items.append(
            {
                "external_id": _build_news_external_id("economic", event_time.isoformat(), country, title),
                "feed_type": "economic",
                "news_category": "economic",
                "title": title,
                "summary": " · ".join(summary_parts),
                "image_url": "",
                "related_symbols": "",
                "source_name": "Finnhub",
                "source_url": "https://finnhub.io/",
                "country_code": country,
                "currency_code": currency_code,
                "impact_level": _normalize_finnhub_impact(event.get("impact")),
                "actual_value": actual_value,
                "forecast_value": forecast_value,
                "previous_value": previous_value,
                "unit": unit,
                "published_at": event_time.strftime("%Y-%m-%d %H:%M:%S"),
            }
        )

    await _replace_news_feed("economic", prepared_items)
    return len(prepared_items)


async def _sync_market_news() -> int:
    now = datetime.now(timezone.utc)
    today = now.date()
    prepared_items: List[Dict[str, Any]] = []

    raw_items = await _fetch_finnhub_json("news", {"category": NEWS_GENERAL_CATEGORY})
    if not isinstance(raw_items, list):
        raw_items = []

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        published_at = _parse_finnhub_market_datetime(item.get("datetime"))
        if published_at is None or published_at.date() != today:
            continue
        title = _normalize_news_title(item.get("headline") or item.get("title"))
        if not title:
            continue
        summary = _coerce_news_text(item.get("summary"), max_len=700)
        source_name = _coerce_news_text(item.get("source"), max_len=128)
        source_url = _coerce_news_text(item.get("url"), max_len=500)
        image_url = _coerce_news_text(item.get("image"), max_len=500)
        related = _coerce_news_text(item.get("related"), max_len=255)
        news_category = _coerce_news_text(item.get("category"), max_len=64).lower() or NEWS_GENERAL_CATEGORY
        country_code = _coerce_news_text(item.get("country"), max_len=8).upper()
        if not country_code:
            country_code = _guess_market_country_code(title, summary, related, source_name)
        prepared_items.append(
            {
                "external_id": _build_news_external_id(
                    "market",
                    news_category,
                    item.get("id"),
                    published_at.isoformat(),
                    title,
                ),
                "feed_type": "market",
                "news_category": news_category,
                "title": title,
                "summary": summary,
                "image_url": image_url,
                "related_symbols": related,
                "source_name": source_name or "Finnhub",
                "source_url": source_url,
                "country_code": country_code,
                "currency_code": "",
                "impact_level": "",
                "actual_value": "",
                "forecast_value": "",
                "previous_value": "",
                "unit": "",
                "published_at": published_at.strftime("%Y-%m-%d %H:%M:%S"),
            }
        )

    await _replace_news_feed("market", prepared_items)
    return len(prepared_items)


async def sync_news_once() -> Dict[str, int]:
    if not FINNHUB_TOKEN:
        return {"economic": 0, "market": 0}
    result = {"economic": 0, "market": 0}
    try:
        result["economic"] = await _sync_economic_news()
    except Exception as exc:
        print(f"News sync economic error: {exc}")
    try:
        result["market"] = await _sync_market_news()
    except Exception as exc:
        print(f"News sync market error: {exc}")
    return result


async def news_sync_loop() -> None:
    await asyncio.sleep(4)
    while True:
        started_at = time.monotonic()
        try:
            await sync_news_once()
        except Exception:
            pass
        while True:
            interval_min = await get_news_sync_interval_min()
            interval_sec = max(interval_min * 60, DEFAULT_NEWS_SYNC_INTERVAL_MIN * 60)
            elapsed = time.monotonic() - started_at
            remaining = interval_sec - elapsed
            if remaining <= 0:
                break
            await asyncio.sleep(min(30, remaining))


async def _get_news_updated_at(feed_type: str) -> str:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT MAX(updated_at) AS updated_at
                FROM news_items
                WHERE feed_type = %s AND is_visible = 1
                """,
                (feed_type,),
            )
            row = await cur.fetchone()
    value = (row or {}).get("updated_at")
    return value.isoformat() if value else datetime.now(timezone.utc).isoformat()


async def _load_economic_news_from_db(limit: int) -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT *
                FROM news_items
                WHERE feed_type = 'economic' AND is_visible = 1
                ORDER BY published_at ASC
                LIMIT %s
                """,
                (int(max(limit * 2, 50)),),
            )
            rows = await cur.fetchall()

    now = datetime.now(timezone.utc)
    today = now.date()
    tomorrow = today + timedelta(days=1)
    today_items: List[Dict[str, Any]] = []
    tomorrow_items: List[Dict[str, Any]] = []
    for row in rows:
        published_at = row.get("published_at")
        if not published_at:
            continue
        serialized = _serialize_news_row(row)
        published_date = published_at.date()
        if published_date == today:
            today_items.append(serialized)
        elif published_date == tomorrow:
            tomorrow_items.append(serialized)

    today_items = today_items[: int(limit)]
    tomorrow_items = tomorrow_items[: int(limit)]
    return {
        "feed": "economic",
        "items": [*today_items, *tomorrow_items],
        "today_items": today_items,
        "tomorrow_items": tomorrow_items,
        "updated_at": await _get_news_updated_at("economic"),
    }


async def _load_market_news_from_db(category: str, limit: int) -> Dict[str, Any]:
    pool = await require_db_pool()
    normalized_category = (category or "all").strip().lower() or "all"
    params: List[Any] = []
    query = """
        SELECT *
        FROM news_items
        WHERE feed_type = 'market' AND is_visible = 1
    """
    if normalized_category != "all":
        query += " AND news_category = %s"
        params.append(normalized_category)
    query += " ORDER BY published_at DESC LIMIT %s"
    params.append(int(limit))

    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(query, tuple(params))
            rows = await cur.fetchall()
            await cur.execute(
                """
                SELECT news_category, COUNT(*) AS cnt
                FROM news_items
                WHERE feed_type = 'market'
                  AND is_visible = 1
                  AND DATE(published_at) = UTC_DATE()
                GROUP BY news_category
                ORDER BY cnt DESC, news_category ASC
                """
            )
            category_rows = await cur.fetchall()

    categories = [
        {
            "key": "all",
            "count": sum(int(item.get("cnt") or 0) for item in category_rows),
        }
    ]
    categories.extend(
        {
            "key": (item.get("news_category") or "").strip().lower(),
            "count": int(item.get("cnt") or 0),
        }
        for item in category_rows
        if item.get("news_category")
    )
    return {
        "feed": "market",
        "items": [_serialize_news_row(row) for row in rows],
        "categories": categories,
        "selected_category": normalized_category,
        "updated_at": await _get_news_updated_at("market"),
    }


async def fetch_news_data(feed: str = "economic", category: str = "all", limit: int = 25) -> Dict[str, Any]:
    normalized_feed = (feed or "economic").strip().lower()
    if normalized_feed not in VALID_NEWS_FEEDS:
        normalized_feed = "economic"

    payload = (
        await _load_economic_news_from_db(limit)
        if normalized_feed == "economic"
        else await _load_market_news_from_db(category, limit)
    )
    if payload.get("items"):
        return payload

    await sync_news_once()
    return (
        await _load_economic_news_from_db(limit)
        if normalized_feed == "economic"
        else await _load_market_news_from_db(category, limit)
    )


@app.get("/api/news")
async def get_news(
    feed: str = Query(default="economic"),
    category: str = Query(default="all"),
    limit: int = Query(default=25, ge=1, le=100),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    return await fetch_news_data(feed=feed, category=category, limit=limit)


@app.get("/api/news/image/{news_item_id}")
async def get_news_image(news_item_id: int):
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT id, image_url
                FROM news_items
                WHERE id = %s AND is_visible = 1
                LIMIT 1
                """,
                (int(news_item_id),),
            )
            row = await cur.fetchone()
    if not row or not row.get("image_url"):
        raise HTTPException(status_code=404, detail="News image not found")
    cached_path = await _resolve_cached_news_image_path(int(row["id"]), str(row.get("image_url") or ""))
    if not cached_path or not cached_path.exists():
        raise HTTPException(status_code=404, detail="News image is unavailable")
    return FileResponse(cached_path)


@app.get("/api/stats/daily")
async def get_daily_stats(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses
                FROM signals
                WHERE user_id = %s
                  AND DATE(created_at) = UTC_DATE()
                """,
                (user_id,),
            )
            row = await cur.fetchone()
    total = int((row or {}).get("total") or 0)
    wins = int((row or {}).get("wins") or 0)
    losses = int((row or {}).get("losses") or 0)
    winrate = round((wins / total) * 100, 2) if total > 0 else 0.0
    return {"total": total, "wins": wins, "losses": losses, "winrate": winrate}


@app.get("/api/admin/me")
async def admin_me(admin: Dict[str, Any] = Depends(get_admin_user)):
    return {
        "status": "success",
        "user": {
            "user_id": int(admin["user_id"]),
            "username": admin.get("username") or "",
            "first_name": admin.get("first_name") or "",
        },
    }


@app.get("/api/admin/stats")
async def admin_stats(admin: Dict[str, Any] = Depends(get_admin_user)):
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT COUNT(*) AS cnt FROM users")
            users_total = int((await cur.fetchone() or {}).get("cnt") or 0)

            await cur.execute("SELECT COUNT(*) AS cnt FROM users WHERE activation_status IN ('active','active_scanner')")
            activated_total = int((await cur.fetchone() or {}).get("cnt") or 0)

            await cur.execute("SELECT COUNT(*) AS cnt FROM users WHERE scanner_access = 1")
            scanner_total = int((await cur.fetchone() or {}).get("cnt") or 0)

            await cur.execute("SELECT COUNT(*) AS cnt FROM signals WHERE DATE(created_at) = UTC_DATE()")
            signals_today = int((await cur.fetchone() or {}).get("cnt") or 0)

    return {
        "users_total": users_total,
        "activated_total": activated_total,
        "scanner_total": scanner_total,
        "signals_today": signals_today,
    }


@app.get("/api/admin/users")
async def admin_users(
    limit: int = Query(default=50, ge=1, le=200),
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT
                    user_id, tg_username, first_name, mini_username, lang, theme,
                    activation_status, deposit_amount, scanner_access, is_blocked,
                    created_at, last_active_at
                FROM users
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = await cur.fetchall()
    data = []
    for row in rows:
        data.append(
            {
                "user_id": int(row["user_id"]),
                "tg_username": row.get("tg_username") or "",
                "first_name": row.get("first_name") or "",
                "mini_username": row.get("mini_username") or "",
                "lang": normalize_user_lang(row.get("lang") or "ru"),
                "theme": _coerce_theme(row.get("theme") or "dark"),
                "activation_status": _coerce_activation(row.get("activation_status") or "inactive"),
                "deposit_amount": float(row.get("deposit_amount") or 0),
                "scanner_access": int(row.get("scanner_access") or 0),
                "is_blocked": int(row.get("is_blocked") or 0),
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                "last_active_at": row.get("last_active_at").isoformat() if row.get("last_active_at") else None,
            }
        )
    return {"items": data}


@app.post("/api/admin/users/set-activation")
async def admin_set_activation(
    payload: AdminSetActivationRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    status = _coerce_activation(payload.activation_status)
    deposit_amount = float(payload.deposit_amount or 0)
    scanner_access = scanner_access_from_deposit(deposit_amount, 1 if status == "active_scanner" else 0)
    if status == "active_scanner":
        scanner_access = 1
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET activation_status = %s,
                    deposit_amount = %s,
                    scanner_access = %s,
                    updated_at = NOW()
                WHERE user_id = %s
                """,
                (status, deposit_amount, int(scanner_access), int(payload.user_id)),
            )
    await add_admin_audit(int(admin["user_id"]), "admin_set_activation", payload.model_dump())
    return {"status": "success"}


@app.get("/api/admin/feature-flags")
async def admin_get_feature_flags(admin: Dict[str, Any] = Depends(get_admin_user)):
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT `key`, is_enabled, updated_at FROM feature_flags ORDER BY `key` ASC")
            rows = await cur.fetchall()
    items = []
    for row in rows:
        items.append(
            {
                "key": row.get("key") or "",
                "is_enabled": int(row.get("is_enabled") or 0),
                "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
            }
        )
    return {"items": items}


@app.post("/api/admin/feature-flags")
async def admin_update_feature_flag(
    payload: AdminFlagUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    key = (payload.key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Flag key is required")
    enabled = 1 if int(payload.is_enabled or 0) == 1 else 0
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO feature_flags (`key`, is_enabled)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled)
                """,
                (key, enabled),
            )
    await add_admin_audit(int(admin["user_id"]), "admin_update_feature_flag", payload.model_dump())
    return {"status": "success"}


@app.get("/api/admin/market-settings")
async def admin_get_market_settings(admin: Dict[str, Any] = Depends(get_admin_user)):
    interval_min = await get_market_sync_interval_min()
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT
                    pair_kind,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                    COUNT(*) AS total_count,
                    MAX(last_seen_at) AS last_seen_at
                FROM market_pairs
                GROUP BY pair_kind
                ORDER BY pair_kind ASC
                """
            )
            rows = await cur.fetchall()

    items = []
    for key, config in MARKET_KIND_CONFIG.items():
        row = next((item for item in rows if (item.get("pair_kind") or "") == key), None)
        items.append(
            {
                "key": key,
                "title": config["title"],
                "active_count": int((row or {}).get("active_count") or 0),
                "total_count": int((row or {}).get("total_count") or 0),
                "last_seen_at": ((row or {}).get("last_seen_at").isoformat() if (row or {}).get("last_seen_at") else None),
            }
        )

    return {
        "market_pairs_sync_interval_min": interval_min,
        "interval_options": list(range(2, 31)),
        "items": items,
    }


@app.post("/api/admin/market-settings")
async def admin_update_market_settings(
    payload: AdminMarketSettingsUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    interval_min = _sanitize_market_sync_interval_min(payload.market_pairs_sync_interval_min)
    await set_app_setting("market_pairs_sync_interval_min", str(interval_min))
    await add_admin_audit(
        int(admin["user_id"]),
        "admin_update_market_settings",
        {"market_pairs_sync_interval_min": interval_min},
    )
    return {"status": "success", "market_pairs_sync_interval_min": interval_min}


@app.get("/api/admin/indicators")
async def admin_get_indicators(admin: Dict[str, Any] = Depends(get_admin_user)):
    return await get_admin_indicators_payload()


@app.post("/api/admin/indicators")
async def admin_update_indicator(
    payload: AdminIndicatorUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    code = str(payload.code or "").strip().lower()
    if not code:
        raise HTTPException(status_code=400, detail="Indicator code is required")

    is_enabled = 1 if int(payload.is_enabled or 0) == 1 else 0
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE signal_indicators
                SET is_enabled = %s
                WHERE `code` = %s
                """,
                (is_enabled, code),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Indicator not found")

    await add_admin_audit(
        int(admin["user_id"]),
        "admin_update_indicator",
        {"code": code, "is_enabled": is_enabled},
    )
    return {"status": "success", "code": code, "is_enabled": is_enabled}


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    from_user = message.from_user
    if not from_user:
        return
    tg_payload = {
        "user_id": int(from_user.id),
        "username": from_user.username or "",
        "first_name": from_user.first_name or "",
        "last_name": from_user.last_name or "",
        "photo_url": "",
        "language_code": from_user.language_code or "",
    }
    await upsert_user_from_telegram(tg_payload)
    lang = await get_user_lang(int(from_user.id), fallback=from_user.language_code or "ru")
    welcome_text = build_welcome_message(lang, from_user.first_name or from_user.username or "Trader")
    await message.answer(
        welcome_text,
        parse_mode="HTML",
        disable_web_page_preview=True,
        reply_markup=await build_main_menu_keyboard(lang, int(from_user.id)),
    )


@dp.callback_query(F.data.startswith("lang:"))
async def on_language_change(callback: types.CallbackQuery):
    if not callback.from_user:
        return
    lang = (callback.data or "").split(":", 1)[-1].strip().lower()
    if lang not in LANGS:
        await callback.answer("Unsupported language", show_alert=False)
        return
    user_id = int(callback.from_user.id)
    await update_user_lang(user_id, lang)
    welcome_text = build_welcome_message(lang, callback.from_user.first_name or callback.from_user.username or "Trader")

    if callback.message:
        try:
            await callback.message.edit_text(
                welcome_text,
                parse_mode="HTML",
                disable_web_page_preview=True,
                reply_markup=await build_main_menu_keyboard(lang, int(callback.from_user.id)),
            )
        except Exception:
            pass
    await callback.answer(WELCOME_TEXTS[lang]["lang_saved"], show_alert=False)


async def start_bot():
    global bot
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is required")
    bot = Bot(token=BOT_TOKEN)
    try:
        await bot.set_my_commands(
            [
                types.BotCommand(command="start", description="Open SonicFX menu"),
            ]
        )
    except Exception as exc:
        print(f"[Bot] set_my_commands error: {exc}")
    await dp.start_polling(bot)


async def start_api():
    config = uvicorn.Config(app, host=API_HOST, port=API_PORT)
    server = uvicorn.Server(config)
    await server.serve()


async def bootstrap_database() -> None:
    global db_pool
    db_pool = await aiomysql.create_pool(**DB_CONFIG)
    await ensure_database_schema(db_pool)


async def shutdown_database() -> None:
    global db_pool
    if db_pool is not None:
        db_pool.close()
        await db_pool.wait_closed()
        db_pool = None


async def main(mode: str = "all"):
    await bootstrap_database()
    try:
        if mode in {"all", "api"}:
            await sync_market_pairs_once()
            await sync_news_once()
    except Exception:
        pass
    try:
        tasks = []
        if mode in {"all", "bot"}:
            tasks.append(start_bot())
        if mode in {"all", "api"}:
            tasks.append(start_api())
            tasks.append(market_pairs_sync_loop())
            tasks.append(news_sync_loop())
        if not tasks:
            raise RuntimeError(f"Unsupported runtime mode: {mode}")
        await asyncio.gather(*tasks)
    finally:
        await shutdown_database()
        if bot is not None:
            await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main(parse_runtime_mode()))
    except KeyboardInterrupt:
        pass
