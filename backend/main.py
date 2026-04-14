import asyncio
import json
import os
import secrets
import time
from datetime import datetime, timezone
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


def build_main_menu_keyboard(current_lang: str) -> InlineKeyboardMarkup:
    lang = normalize_user_lang(current_lang)
    labels = WELCOME_TEXTS[lang]
    lang_btns = []
    for item in ("ru", "en", "uk"):
        mark = " " + ("*" if item == lang else "")
        lang_btns.append(InlineKeyboardButton(text=f"{item.upper()}{mark}", callback_data=f"lang:{item}"))
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=labels["open_app"],
                    web_app=WebAppInfo(url=build_main_webapp_url()),
                )
            ],
            lang_btns,
        ]
    )


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
    return "otc" if str(kind or "").strip().lower() == "otc" else "forex"


def _normalize_pairs(payload: Any) -> List[Dict[str, Any]]:
    rows = payload if isinstance(payload, list) else []
    normalized: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        pair_raw = row.get("pair") or row.get("symbol") or row.get("name") or ""
        pair = str(pair_raw).strip()
        if not pair:
            continue
        payout_raw = row.get("payout")
        try:
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


async def _fetch_devsbite_pairs(kind: str, min_payout: int) -> tuple[List[Dict[str, Any]], bool]:
    if not DEVSBITE_TOKEN:
        return ([], False)
    pair_kind = _pair_kind_normalized(kind)
    url = f"{DEVSBITE_API_BASE_URL}/pairs/{pair_kind}"
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
    pairs_payload = data.get("pairs", []) if isinstance(data, dict) else []
    return (_normalize_pairs(pairs_payload), True)


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
    for kind in ("forex", "otc"):
        try:
            result[kind] = await sync_market_pairs_kind(kind, DEVSBITE_MIN_PAYOUT)
        except Exception:
            result[kind] = False
    return result


async def market_pairs_sync_loop() -> None:
    await asyncio.sleep(2)
    while True:
        try:
            await sync_market_pairs_once()
        except Exception:
            pass
        await asyncio.sleep(max(MARKET_SYNC_INTERVAL_SEC, 30))


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
        "pairs": pairs,
        "expirations": expirations,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    return payload


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


@app.get("/api/expirations")
async def get_expiration_options(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    expirations = await _fetch_expiration_options()
    return {"expirations": expirations}


@app.get("/api/news")
async def get_news(
    limit: int = Query(default=25, ge=1, le=100),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT id, title, summary, image_url, source_name, source_url, published_at
                FROM news_items
                WHERE is_visible = 1
                ORDER BY COALESCE(published_at, created_at) DESC
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = await cur.fetchall()
    items = []
    for row in rows:
        items.append(
            {
                "id": int(row["id"]),
                "title": row.get("title") or "",
                "summary": row.get("summary") or "",
                "image_url": row.get("image_url") or "",
                "source_name": row.get("source_name") or "",
                "source_url": row.get("source_url") or "",
                "published_at": row.get("published_at").isoformat() if row.get("published_at") else None,
            }
        )
    return {"items": items}


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
        reply_markup=build_main_menu_keyboard(lang),
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
                reply_markup=build_main_menu_keyboard(lang),
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


async def main():
    await bootstrap_database()
    try:
        await sync_market_pairs_once()
    except Exception:
        pass
    try:
        await asyncio.gather(start_bot(), start_api(), market_pairs_sync_loop())
    finally:
        await shutdown_database()
        if bot is not None:
            await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
