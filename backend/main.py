import argparse
import asyncio
import base64
import hashlib
import html
import json
import mimetypes
import os
import re
import secrets
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import aiomysql
import httpx
import uvicorn
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import CommandStart
from aiogram.types import FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from db_bootstrap import (
    ensure_database_schema,
    normalize_activation_status,
    normalize_user_lang,
    scanner_access_from_deposit,
)
from quotes_hub import DevsbiteQuotesHub, SUPPORTED_QUOTE_CATEGORIES, normalize_quote_category, normalize_quote_symbol
from telegram_auth import get_telegram_user, verify_telegram_init_data

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
BOT_MENU_IMAGE_PATH = Path(__file__).resolve().parent / "assets" / "sonicfx_bot_menu.png"
THEMES = {"dark", "light"}
ACTIVATION_STATUSES = {"inactive", "active", "active_scanner"}
DEVSBITE_API_BASE_URL = (os.getenv("DEVSBITE_API_BASE_URL") or "https://api.devsbite.com").strip().rstrip("/")
DEVSBITE_TOKEN = (os.getenv("DEVSBITE_TOKEN") or "").strip()
DEVSBITE_CLIENT_TOKEN = (os.getenv("DEVSBITE_CLIENT_TOKEN") or DEVSBITE_TOKEN).strip()
DEVSBITE_MIN_PAYOUT = int((os.getenv("DEVSBITE_MIN_PAYOUT") or "60").strip() or "60")
DEVSBITE_QUOTES_WS_URL = (
    os.getenv("DEVSBITE_QUOTES_WS_URL") or "wss://api.devsbite.com/ws/quotes/live/multi"
).strip()
QUOTE_HISTORY_SECONDS = int((os.getenv("QUOTE_HISTORY_SECONDS") or "300").strip() or "300")
QUOTE_REPLACE_DEBOUNCE_MS = int((os.getenv("QUOTE_REPLACE_DEBOUNCE_MS") or "220").strip() or "220")
MARKET_SYNC_INTERVAL_SEC = int((os.getenv("MARKET_SYNC_INTERVAL_SEC") or "300").strip() or "300")
CORE_EXPIRATION_OPTIONS = "5s,15s,1m,3m,5m,15m,1h"
EXPIRATION_OPTIONS = (os.getenv("EXPIRATION_OPTIONS") or CORE_EXPIRATION_OPTIONS).strip()
DEVSBITE_EXPIRATIONS_URL = (os.getenv("DEVSBITE_EXPIRATIONS_URL") or "").strip()
FINNHUB_TOKEN = (os.getenv("FINNHUB_TOKEN") or "").strip()
SCAN_UPLOAD_MAX_BYTES = int((os.getenv("SCAN_UPLOAD_MAX_BYTES") or str(15 * 1024 * 1024)).strip() or str(15 * 1024 * 1024))
SCAN_UPLOAD_RETENTION_DAYS = int((os.getenv("SCAN_UPLOAD_RETENTION_DAYS") or "7").strip() or "7")
SCAN_UPLOAD_ARCHIVE_INTERVAL_SEC = int((os.getenv("SCAN_UPLOAD_ARCHIVE_INTERVAL_SEC") or str(6 * 60 * 60)).strip() or str(6 * 60 * 60))
DEFAULT_MARKET_SYNC_INTERVAL_MIN = min(max(max(MARKET_SYNC_INTERVAL_SEC, 120) // 60, 2), 30)
DEFAULT_NEWS_SYNC_INTERVAL_MIN = 60
DEFAULT_SUPPORT_CHANNEL_URL = (
    os.getenv("SUPPORT_CHANNEL_URL") or os.getenv("CHANNEL_URL") or "https://t.me/+TthmjdpAkv5hNjdi"
).strip()
DEFAULT_SUPPORT_CONTACT_URL = (
    os.getenv("SUPPORT_CONTACT_URL") or os.getenv("SUPPORT_URL") or "https://t.me/WaySonic"
).strip()
DEFAULT_REGISTRATION_URL = (os.getenv("REGISTRATION_URL") or "").strip()
DEFAULT_SCANNER_ANALYSIS_MODE = "adaptive"
DEFAULT_SCANNER_OPENAI_MODEL = (os.getenv("OPENAI_MODEL") or "gpt-4.1-mini").strip() or "gpt-4.1-mini"
DEFAULT_SCANNER_OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()
DEFAULT_ACTIVE_SIGNALS_LIMIT = 3
OPENAI_API_BASE_URL = (os.getenv("OPENAI_API_BASE_URL") or "https://api.openai.com/v1").strip().rstrip("/")
SCANNER_ANALYSIS_MODE_CHOICES = ("aggressive", "adaptive", "minimal")
SCANNER_ANALYSIS_MODE_LABELS = {
    "aggressive": "АГРЕССИВНЫЙ",
    "adaptive": "АДАПТИВНЫЙ",
    "minimal": "МИНИМАЛЬНЫЙ",
}
OPENAI_SCAN_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
INDICATOR_ANALYSIS_CODE_MAP = {
    "rsi": ("RSI",),
    "stochastic_oscillator": ("STOCH",),
    "cci": ("CCI",),
    "williams_r": ("WILLR",),
    "macd": ("MACD",),
    "ema_9_50_200": ("EMA9", "EMA50", "EMA200"),
    "adx": ("ADX",),
    "atr": ("ATR",),
    "bollinger_bands": ("BB",),
    "parabolic_sar": ("PSAR",),
    "momentum": ("MOM",),
    "rate_of_change": ("ROC",),
}
INDICATOR_ANALYSIS_SUPPORTED_CODES = set(INDICATOR_ANALYSIS_CODE_MAP)
INDICATOR_ANALYSIS_INTERVALS = {"5min", "15min", "30min", "1h"}
INDICATOR_LOCAL_HISTORY_SECONDS = 1800
SCANNER_ANALYSIS_PROMPT = """Ты — профессиональный трейдинг-аналитик SonicFX.
Анализируешь скриншот свечного графика Forex или OTC и выдаёшь короткий, но профессиональный торговый сценарий.

Режим анализа задаётся параметром:
АГРЕССИВНЫЙ / АДАПТИВНЫЙ / МИНИМАЛЬНЫЙ.

Проверка изображения:
- если нет свечного графика, движения цены или шкалы;
- если изображение слишком размытое, перекрыто интерфейсом или структуру цены нельзя прочитать;
тогда верни status="graph_not_found".

Если график читаемый, status="ok". Не ставь graph_not_found из-за отсутствия названия актива.

Актив:
- если актив видно, укажи его в формате AUD/CAD, EUR/USD и т.п.;
- если актив не видно, укажи "не определен";
- если видишь OTC или суффикс OTC, market_mode="OTC", иначе market_mode="MARKET".

Что обязательно оценить:
- направление последних 8-15 свечей;
- тренд или локальный диапазон;
- ближайшую реакцию от поддержки/сопротивления;
- силу импульса и качество отката;
- наличие ложного пробоя, зажатия, истощения или продолжения;
- рыночный шум, особенно для OTC.

Главный принцип:
Если структура читаемая и есть торговое преимущество, выбирай BUY или SELL.
NO TRADE — только когда преимущества действительно нет: хаотичный флет без границ, равные встречные импульсы, отсутствие направления, сильная нечитабельность или явный конфликт сигналов.
Не используй NO TRADE как осторожный ответ по умолчанию.

ЛОГИКА ПО РЕЖИМАМ

АГРЕССИВНЫЙ:
- цель: больше рабочих сигналов;
- достаточно одного подтверждения: серия свечей, отбой, пробой, направленный импульс или явное давление покупателя/продавца;
- слабый шум допустим;
- NO TRADE только при полном хаосе или отсутствии направления.

АДАПТИВНЫЙ:
- цель: баланс частоты и качества;
- сигнал даётся при одном сильном подтверждении или двух средних;
- допускается умеренный откат, если направление сохраняется;
- NO TRADE только при плоском рынке без границ, противоречивых свечах или отсутствии реакции цены.

МИНИМАЛЬНЫЙ:
- цель: точность, но не чрезмерная пассивность;
- сигнал даётся при чистом импульсе, понятном тренде, отбое от уровня или пробое с продолжением;
- если структура читаемая, но слабее идеальной, можно дать сигнал с умеренной уверенностью;
- NO TRADE только при слабой структуре без преимущества.

НАПРАВЛЕНИЕ
BUY: восходящий импульс, удержание поддержки, пробой вверх, серия повышающихся минимумов или восстановление после ложного прокола вниз.
SELL: нисходящий импульс, реакция от сопротивления, пробой вниз, серия понижающихся максимумов или слабый отскок после падения.

ИНДИКАТОРЫ, если они видны:
- RSI выше 70 усиливает SELL, ниже 30 усиливает BUY;
- MACD вверх усиливает BUY, вниз усиливает SELL;
- если индикатор спорит с ценой, в АГРЕССИВНОМ режиме снизь уверенность, в АДАПТИВНОМ ищи подтверждение свечами, в МИНИМАЛЬНОМ ставь NO TRADE только при явном конфликте.

УВЕРЕННОСТЬ:
- АГРЕССИВНЫЙ: 50-72%;
- АДАПТИВНЫЙ: 55-78%;
- МИНИМАЛЬНЫЙ: 62-85%;
- ниже 50% допускается только для NO TRADE;
- 85% не превышать.

ЭКСПИРАЦИЯ:
- резкий импульс: 1-2 минуты;
- среднее движение или отбой: 2-3 минуты;
- устойчивый тренд: 3-5 минут.

Комментарий:
- 18-34 слова;
- профессиональный, без шаблонов и повторов;
- объясни причину: структура цены + подтверждение + риск/условие;
- не пиши гарантий прибыли и не добавляй дисклеймер.

Запрещено:
- придумывать актив, цену или индикаторы;
- давать сигнал без логики;
- писать markdown или пояснения вне JSON.

Верни только строгий JSON без markdown и без пояснений по схеме:
{
  "status": "ok" | "graph_not_found",
  "asset": "string",
  "market_mode": "OTC" | "MARKET" | "UNKNOWN",
  "signal": "BUY" | "SELL" | "NO TRADE",
  "confidence": 0,
  "expiration_minutes": 0,
  "comment": "string 18-34 слова"
}"""
SCANNER_CONFIRMATION_PROMPT = """Ты выполняешь второй этап валидации торгового сигнала SonicFX.

На входе:
1. Исходный анализ скриншота графика.
2. Свежие котировки и последние свечи по уже определенным активу и рынку.

Задача:
- не переанализировать всё с нуля, а уточнить исходный сценарий свежими данными;
- подтвердить направление, скорректировать уверенность и экспирацию;
- отменять сигнал только при явном ухудшении сценария.

Правила:
- не выдумывай новые данные;
- не меняй актив без явной причины;
- если актив уже определен, используй его как основной;
- свежие свечи являются дополнительным фильтром, а не поводом автоматически ставить NO TRADE;
- если цена продолжает исходное направление или делает нормальный откат, сохраняй BUY/SELL;
- если движение ослабло, но направление ещё читается, снизь уверенность вместо отмены;
- ставь NO TRADE только при явном развороте против сигнала, хаотичном флете без границ, резком выносе после входной зоны или полном отсутствии преимущества;
- если данных мало, но они не противоречат исходному анализу, сохраняй исходный сигнал с умеренной уверенностью;
- NO TRADE должен иметь confidence ниже 50;
- комментарий 18-34 слова, профессиональный и разнообразный: что изменилось, что подтверждает или ослабляет сценарий.

Учитывай:
- текущую цену;
- изменение;
- последние свечи;
- рыночный шум, особенно в OTC;
- исходный режим анализа: АГРЕССИВНЫЙ / АДАПТИВНЫЙ / МИНИМАЛЬНЫЙ.

Верни только строгий JSON без markdown и без пояснений по схеме:
{
  "status": "ok" | "graph_not_found",
  "asset": "string",
  "market_mode": "OTC" | "MARKET" | "UNKNOWN",
  "signal": "BUY" | "SELL" | "NO TRADE",
  "confidence": 0,
  "expiration_minutes": 0,
  "comment": "string 18-34 слова"
}"""
VALID_NEWS_FEEDS = {"economic", "market"}
NEWS_GENERAL_CATEGORY = "general"
NEWS_NOTIFICATION_LEAD_OPTIONS = (5, 15, 30, 60)
NEWS_NOTIFICATION_CHECK_INTERVAL_SEC = int((os.getenv("NEWS_NOTIFICATION_CHECK_INTERVAL_SEC") or "60").strip() or "60")
MODE_FEATURE_FLAG_KEYS = ("mode_scanner_enabled", "mode_ai_enabled", "mode_indicators_enabled")
FEATURE_FLAG_DEFAULTS = {
    "mode_scanner_enabled": 1,
    "mode_ai_enabled": 1,
    "mode_indicators_enabled": 1,
    "news_enabled": 1,
}
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
quotes_hub = DevsbiteQuotesHub(
    DEVSBITE_QUOTES_WS_URL,
    DEVSBITE_CLIENT_TOKEN,
    history_seconds=QUOTE_HISTORY_SECONDS,
    debounce_ms=QUOTE_REPLACE_DEBOUNCE_MS,
)

media_dir = Path(__file__).resolve().parent / "media"
media_dir.mkdir(parents=True, exist_ok=True)
news_media_dir = media_dir / "news"
news_media_dir.mkdir(parents=True, exist_ok=True)
scan_upload_dir = media_dir / "scan_uploads"
scan_upload_dir.mkdir(parents=True, exist_ok=True)
scan_archive_dir = media_dir / "scan_archives"
scan_archive_dir.mkdir(parents=True, exist_ok=True)
admin_token_file_path = media_dir / "admin.token"
admin_panel_token = (os.getenv("ADMIN_PANEL_TOKEN") or "").strip()

SCAN_UPLOAD_SOURCE_TYPES = {"gallery", "camera", "link", "auto"}
SCAN_UPLOAD_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
SCAN_UPLOAD_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

WELCOME_TEXTS = {
    "ru": {
        "welcome": (
            "Привет, <b>{name}</b>.\n\n"
            "Добро пожаловать в SonicFX.\n"
            "Нажми кнопку ниже, чтобы открыть Mini App."
        ),
        "open_app": "Открыть SonicFX",
        "admin_panel": "Админ-панель",
        "lang_title": "Язык",
        "lang_saved": "Язык сохранен",
    },
    "en": {
        "welcome": (
            "Hi, <b>{name}</b>.\n\n"
            "Welcome to SonicFX.\n"
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
            "Ласкаво просимо до SonicFX.\n"
            "Натисни кнопку нижче, щоб вiдкрити Mini App."
        ),
        "open_app": "Вiдкрити SonicFX",
        "admin_panel": "Адмiн-панель",
        "lang_title": "Мова",
        "lang_saved": "Мову збережено",
    },
}


class UserSettingsUpdate(BaseModel):
    lang: Optional[str] = None
    theme: Optional[str] = None
    mini_username: Optional[str] = Field(default=None, max_length=64)
    timezone: Optional[str] = Field(default=None, max_length=64)


class UserSignalModeUpdate(BaseModel):
    mode: str = Field(min_length=3, max_length=16)


class UserTraderIdUpdate(BaseModel):
    trader_id: str = Field(default="", max_length=128)


class ScanLinkUploadRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class AdminSetActivationRequest(BaseModel):
    user_id: int
    activation_status: Optional[str] = None
    account_tier: Optional[str] = Field(default=None, max_length=32)
    deposit_amount: Optional[float] = None
    trader_id: Optional[str] = Field(default=None, max_length=128)


class AccountStatusUpsertRequest(BaseModel):
    code: Optional[str] = Field(default=None, max_length=32)
    name: str = Field(min_length=2, max_length=64)
    description: Optional[str] = Field(default="", max_length=2000)
    is_enabled: int = Field(default=1, ge=0, le=1)
    sort_order: int = Field(default=100, ge=0, le=9999)
    access_required: int = Field(default=0, ge=0, le=1)
    min_deposit: float = Field(default=0, ge=0)
    scanner_enabled: int = Field(default=0, ge=0, le=1)
    scanner_limit: int = Field(default=0, ge=-1, le=100000)
    scanner_window_hours: int = Field(default=3, ge=1, le=24)
    live_enabled: int = Field(default=0, ge=0, le=1)
    live_limit: int = Field(default=0, ge=-1, le=100000)
    live_window_hours: int = Field(default=3, ge=1, le=24)
    indicators_enabled: int = Field(default=0, ge=0, le=1)
    indicators_limit: int = Field(default=0, ge=-1, le=100000)
    indicators_window_hours: int = Field(default=3, ge=1, le=24)
    badge_text: Optional[str] = Field(default="", max_length=64)
    marketing_text: Optional[str] = Field(default="", max_length=2000)


class AdminFlagUpdateRequest(BaseModel):
    key: str
    is_enabled: int


class AdminMarketSettingsUpdateRequest(BaseModel):
    market_pairs_sync_interval_min: int = Field(ge=2, le=30)


class AdminMarketStatusUpdateRequest(BaseModel):
    key: str
    is_enabled: int


class AdminIndicatorUpdateRequest(BaseModel):
    code: str
    is_enabled: int


class AdminSupportSettingsUpdateRequest(BaseModel):
    channel_url: str = Field(min_length=8, max_length=500)
    support_url: str = Field(min_length=8, max_length=500)


class AdminRegistrationSettingsUpdateRequest(BaseModel):
    registration_url: str = Field(default="", max_length=500)


class AdminScannerSettingsUpdateRequest(BaseModel):
    analysis_mode: str = Field(min_length=4, max_length=16)
    api_key: Optional[str] = Field(default=None, max_length=512)
    active_signals_limit: Optional[int] = Field(default=None, ge=1, le=3)


class ScannerAnalyzeRequest(BaseModel):
    upload_id: Optional[int] = Field(default=None, ge=1)
    selected_expiration: Optional[str] = Field(default=None, max_length=16)


class AutoAnalyzeRequest(BaseModel):
    category: str = Field(min_length=2, max_length=32)
    symbol: str = Field(min_length=3, max_length=64)
    image_data_url: str = Field(min_length=32, max_length=8_000_000)
    selected_expiration: Optional[str] = Field(default=None, max_length=16)


class IndicatorAnalyzeRequest(BaseModel):
    category: str = Field(min_length=2, max_length=32)
    symbol: str = Field(min_length=3, max_length=64)
    indicator_code: Optional[str] = Field(default=None, max_length=64)
    selected_expiration: Optional[str] = Field(default=None, max_length=16)
    interval: Optional[str] = Field(default=None, max_length=16)


class AnalysisSettlementRequest(BaseModel):
    selected_expiration: Optional[str] = Field(default=None, max_length=16)


class UserNewsNotificationSettingsUpdate(BaseModel):
    news_enabled: int = 0
    signals_enabled: int = 1
    economic_enabled: int = 1
    market_enabled: int = 1
    impact_high_enabled: int = 1
    impact_medium_enabled: int = 1
    impact_low_enabled: int = 1
    lead_minutes: int = 15


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


def _normalize_scan_upload_source(raw_source: str) -> str:
    source = (raw_source or "").strip().lower()
    if source in SCAN_UPLOAD_SOURCE_TYPES:
        return source
    raise HTTPException(status_code=400, detail="Unsupported upload source")


def _resolve_scan_upload_suffix(original_name: str, content_type: str) -> str:
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_type in SCAN_UPLOAD_ALLOWED_CONTENT_TYPES:
        guessed = mimetypes.guess_extension(normalized_type) or ""
        if guessed == ".jpe":
            return ".jpg"
        if guessed in SCAN_UPLOAD_ALLOWED_SUFFIXES:
            return guessed

    suffix = Path((original_name or "").split("?", 1)[0]).suffix.lower()
    if suffix == ".jpe":
        return ".jpg"
    if suffix in SCAN_UPLOAD_ALLOWED_SUFFIXES:
        return suffix
    return ""


def _build_scan_upload_name(user_id: int, suffix: str, upload_date: datetime, sequence_number: int) -> str:
    safe_suffix = suffix if suffix.startswith(".") else f".{suffix}"
    date_key = upload_date.strftime("%Y%m%d")
    return f"scaner-{int(user_id)}-{date_key}-{int(sequence_number):04d}{safe_suffix}"


async def _next_scan_upload_sequence(user_id: int, upload_date: datetime) -> int:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT COALESCE(MAX(sequence_number), 0)
                FROM scan_uploads
                WHERE user_id = %s AND upload_date = %s
                """,
                (int(user_id), upload_date.date()),
            )
            row = await cur.fetchone()
    current_max = int((row or [0])[0] or 0)
    return current_max + 1


def _serialize_scan_upload(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    created_at = row.get("created_at")
    archived_at = row.get("archived_at")
    upload_date = row.get("upload_date")
    return {
        "id": int(row.get("id") or 0),
        "user_id": int(row.get("user_id") or 0),
        "source_type": row.get("source_type") or "gallery",
        "original_name": row.get("original_name") or "",
        "content_type": row.get("content_type") or "",
        "file_size": int(row.get("file_size") or 0),
        "file_path": row.get("file_path") or "",
        "public_path": row.get("public_path") or "",
        "source_url": row.get("source_url") or "",
        "is_current": bool(row.get("is_current", 1)),
        "upload_date": upload_date.isoformat() if hasattr(upload_date, "isoformat") else (str(upload_date) if upload_date else None),
        "sequence_number": int(row.get("sequence_number") or 0),
        "archive_path": row.get("archive_path") or "",
        "archived_at": archived_at.isoformat() if archived_at else None,
        "created_at": created_at.isoformat() if created_at else None,
    }


async def _record_scan_upload(
    *,
    user_id: int,
    source_type: str,
    original_name: str,
    content_type: str,
    file_size: int,
    file_path: Path,
    upload_date: datetime,
    sequence_number: int,
    source_url: str = "",
    is_current: bool = True,
) -> Dict[str, Any]:
    public_path = f"/api/uploads/scan/{user_id}/{file_path.name}"
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                INSERT INTO scan_uploads (
                    user_id, source_type, original_name, content_type, file_size,
                    file_path, public_path, source_url, is_current, upload_date, sequence_number
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    int(user_id),
                    source_type,
                    (original_name or "")[:255],
                    (content_type or "")[:128],
                    int(file_size or 0),
                    str(file_path),
                    public_path,
                    source_url or None,
                    1 if is_current else 0,
                    upload_date.date(),
                    int(sequence_number),
                ),
            )
            upload_id = int(cur.lastrowid or 0)
            if is_current:
                await cur.execute(
                    "UPDATE scan_uploads SET is_current = 0 WHERE user_id = %s AND is_current = 1 AND id <> %s",
                    (int(user_id), upload_id),
                )
            await cur.execute("SELECT * FROM scan_uploads WHERE id = %s LIMIT 1", (upload_id,))
            row = await cur.fetchone()
    serialized = _serialize_scan_upload(row)
    if not serialized:
        raise HTTPException(status_code=500, detail="Unable to save upload metadata")
    return serialized


async def _save_scan_upload_file(
    *,
    user_id: int,
    source_type: str,
    original_name: str,
    content_type: str,
    chunks,
    source_url: str = "",
    is_current: bool = True,
) -> Dict[str, Any]:
    suffix = _resolve_scan_upload_suffix(original_name, content_type)
    if not suffix:
        raise HTTPException(status_code=415, detail="Only chart images in JPG, PNG, WEBP or HEIC are supported")

    user_dir = scan_upload_dir / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    upload_date = datetime.now(timezone.utc)
    sequence_number = await _next_scan_upload_sequence(user_id, upload_date)
    target = user_dir / _build_scan_upload_name(user_id, suffix, upload_date, sequence_number)
    total_size = 0

    try:
        while True:
            try:
                handle = target.open("xb")
                break
            except FileExistsError:
                sequence_number += 1
                target = user_dir / _build_scan_upload_name(user_id, suffix, upload_date, sequence_number)

        with handle:
            async for chunk in chunks:
                if not chunk:
                    continue
                total_size += len(chunk)
                if total_size > SCAN_UPLOAD_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="File is too large")
                handle.write(chunk)
    except HTTPException:
        if target.exists():
            target.unlink(missing_ok=True)
        raise
    except Exception as exc:
        if target.exists():
            target.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Unable to save uploaded file") from exc

    if total_size <= 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Downloaded file is empty")

    return await _record_scan_upload(
        user_id=user_id,
        source_type=source_type,
        original_name=original_name,
        content_type=content_type,
        file_size=total_size,
        file_path=target,
        upload_date=upload_date,
        sequence_number=sequence_number,
        source_url=source_url,
        is_current=is_current,
    )


async def _single_bytes_chunk(payload: bytes):
    yield payload


async def _save_scan_upload_bytes(
    *,
    user_id: int,
    source_type: str,
    original_name: str,
    content_type: str,
    payload: bytes,
    source_url: str = "",
    is_current: bool = True,
) -> Dict[str, Any]:
    return await _save_scan_upload_file(
        user_id=user_id,
        source_type=source_type,
        original_name=original_name,
        content_type=content_type,
        chunks=_single_bytes_chunk(payload),
        source_url=source_url,
        is_current=is_current,
    )


async def _upload_file_chunks(upload_file: UploadFile):
    while True:
        chunk = await upload_file.read(1024 * 1024)
        if not chunk:
            break
        yield chunk


def _scan_archive_name(user_id: int, upload_date: Any) -> str:
    if hasattr(upload_date, "strftime"):
        date_key = upload_date.strftime("%Y%m%d")
    else:
        date_key = str(upload_date or datetime.now(timezone.utc).date()).replace("-", "")[:8]
    return f"scaner-{int(user_id)}-{date_key}.zip"


def _zip_arcname_unique(zip_file: zipfile.ZipFile, filename: str) -> str:
    existing = set(zip_file.namelist())
    if filename not in existing:
        return filename

    path = Path(filename)
    stem = path.stem
    suffix = path.suffix
    index = 2
    while True:
        candidate = f"{stem}-{index}{suffix}"
        if candidate not in existing:
            return candidate
        index += 1


async def archive_expired_scan_uploads_once(limit: int = 250) -> int:
    retention_days = max(SCAN_UPLOAD_RETENTION_DAYS, 1)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT id, user_id, file_path, upload_date, created_at
                FROM scan_uploads
                WHERE archived_at IS NULL AND created_at < %s
                ORDER BY created_at ASC, id ASC
                LIMIT %s
                """,
                (cutoff.replace(tzinfo=None), int(limit)),
            )
            rows = await cur.fetchall()

    if not rows:
        return 0

    archived_items = []
    missing_items: List[int] = []

    for row in rows:
        upload_id = int(row.get("id") or 0)
        user_id = int(row.get("user_id") or 0)
        file_path = Path(row.get("file_path") or "")
        if not upload_id or not user_id:
            continue

        if not file_path.is_file():
            missing_items.append(upload_id)
            continue

        upload_date = row.get("upload_date") or row.get("created_at") or datetime.now(timezone.utc)
        user_archive_dir = scan_archive_dir / str(user_id)
        user_archive_dir.mkdir(parents=True, exist_ok=True)
        archive_path = user_archive_dir / _scan_archive_name(user_id, upload_date)

        try:
            with zipfile.ZipFile(archive_path, mode="a", compression=zipfile.ZIP_DEFLATED) as zip_file:
                zip_file.write(file_path, arcname=_zip_arcname_unique(zip_file, file_path.name))
            file_path.unlink(missing_ok=True)
            archived_items.append((str(archive_path), upload_id))
        except Exception as exc:
            print(f"[ScanArchive] failed to archive upload {upload_id}: {exc}")

    if not archived_items and not missing_items:
        return 0

    archived_at = datetime.now(timezone.utc).replace(tzinfo=None)
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            for archive_path, upload_id in archived_items:
                await cur.execute(
                    """
                    UPDATE scan_uploads
                    SET archived_at = %s, archive_path = %s, is_current = 0
                    WHERE id = %s
                    """,
                    (archived_at, archive_path, upload_id),
                )
            for upload_id in missing_items:
                await cur.execute(
                    """
                    UPDATE scan_uploads
                    SET archived_at = %s, is_current = 0
                    WHERE id = %s
                    """,
                    (archived_at, upload_id),
                )

    return len(archived_items) + len(missing_items)


async def scan_upload_archive_loop():
    while True:
        try:
            archived_count = await archive_expired_scan_uploads_once()
            if archived_count:
                print(f"[ScanArchive] archived {archived_count} expired uploads")
        except Exception as exc:
            print(f"[ScanArchive] loop error: {exc}")
        await asyncio.sleep(max(SCAN_UPLOAD_ARCHIVE_INTERVAL_SEC, 60))


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


def get_ws_quote_backend_url(websocket: Optional[WebSocket] = None) -> str:
    if websocket is not None:
        scheme = "wss" if websocket.url.scheme == "https" else "ws"
        return f"{scheme}://{websocket.url.netloc}/api/ws/quotes"
    if WEB_APP_URL:
        if WEB_APP_URL.startswith("https://"):
            return f"wss://{WEB_APP_URL.removeprefix('https://')}/api/ws/quotes"
        if WEB_APP_URL.startswith("http://"):
            return f"ws://{WEB_APP_URL.removeprefix('http://')}/api/ws/quotes"
    return "/api/ws/quotes"


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


async def get_feature_flags_payload() -> Dict[str, int]:
    flags = dict(FEATURE_FLAG_DEFAULTS)
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT `key`, is_enabled FROM feature_flags")
            rows = await cur.fetchall()
    for row in rows or []:
        key = str(row.get("key") or "").strip()
        if key:
            flags[key] = int(row.get("is_enabled") or 0)
    return flags


STATUS_MODE_MAP = {
    "scanner": ("scanner", "Scanner"),
    "automatic": ("live", "Live"),
    "auto": ("live", "Live"),
    "live": ("live", "Live"),
    "indicators": ("indicators", "Indicators"),
}


def _normalize_status_code(value: str, fallback: str = "trader") -> str:
    code = re.sub(r"[^a-z0-9_]+", "_", str(value or "").strip().lower()).strip("_")
    if code == "pro":
        return "premium"
    return code or fallback


def _sanitize_status_limit(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = 0
    return max(-1, min(numeric, 100000))


def _sanitize_status_window(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = 3
    return min(max(numeric, 1), 24)


def _serialize_account_status(row: Dict[str, Any]) -> Dict[str, Any]:
    code = _normalize_status_code(row.get("code") or "trader")
    return {
        "id": int(row.get("id") or 0),
        "code": code,
        "name": row.get("name") or code.title(),
        "description": row.get("description") or "",
        "is_enabled": int(row.get("is_enabled") or 0),
        "sort_order": int(row.get("sort_order") or 100),
        "access_required": int(row.get("access_required") or 0),
        "min_deposit": float(row.get("min_deposit") or 0),
        "scanner_enabled": int(row.get("scanner_enabled") or 0),
        "scanner_limit": _sanitize_status_limit(row.get("scanner_limit")),
        "scanner_window_hours": _sanitize_status_window(row.get("scanner_window_hours")),
        "live_enabled": int(row.get("live_enabled") or 0),
        "live_limit": _sanitize_status_limit(row.get("live_limit")),
        "live_window_hours": _sanitize_status_window(row.get("live_window_hours")),
        "indicators_enabled": int(row.get("indicators_enabled") or 0),
        "indicators_limit": _sanitize_status_limit(row.get("indicators_limit")),
        "indicators_window_hours": _sanitize_status_window(row.get("indicators_window_hours")),
        "badge_text": row.get("badge_text") or (row.get("name") or code.title()).upper(),
        "marketing_text": row.get("marketing_text") or "",
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


def _fallback_status_config(code: str = "trader") -> Dict[str, Any]:
    defaults = {
        "trader": {
            "code": "trader",
            "name": "Trader",
            "description": "Базовый статус каждого пользователя.",
            "is_enabled": 1,
            "sort_order": 10,
            "access_required": 0,
            "min_deposit": 0,
            "scanner_enabled": 1,
            "scanner_limit": 1,
            "scanner_window_hours": 24,
            "live_enabled": 1,
            "live_limit": 1,
            "live_window_hours": 3,
            "indicators_enabled": 1,
            "indicators_limit": 1,
            "indicators_window_hours": 3,
            "badge_text": "TRADER",
            "marketing_text": "🎯 1 Live или Indicator анализ\n🎁 1 пробный Scanner\nОткрой Premium для полного доступа",
        },
        "premium": {
            "code": "premium",
            "name": "Premium",
            "description": "Live и индикаторы для активного сценария.",
            "is_enabled": 1,
            "sort_order": 20,
            "access_required": 1,
            "min_deposit": 10,
            "scanner_enabled": 0,
            "scanner_limit": 0,
            "scanner_window_hours": 3,
            "live_enabled": 1,
            "live_limit": 3,
            "live_window_hours": 3,
            "indicators_enabled": 1,
            "indicators_limit": 3,
            "indicators_window_hours": 3,
            "badge_text": "PREMIUM",
            "marketing_text": "⚡ Live сигналы\n📊 Индикаторы\nЛимит: 3 сигнала / 3 часа",
        },
        "vip": {
            "code": "vip",
            "name": "VIP",
            "description": "Scanner, Live и индикаторы с расширенным лимитом.",
            "is_enabled": 1,
            "sort_order": 30,
            "access_required": 1,
            "min_deposit": 50,
            "scanner_enabled": 1,
            "scanner_limit": 10,
            "scanner_window_hours": 3,
            "live_enabled": 1,
            "live_limit": 10,
            "live_window_hours": 3,
            "indicators_enabled": 1,
            "indicators_limit": 10,
            "indicators_window_hours": 3,
            "badge_text": "VIP",
            "marketing_text": "🔥 Scanner\n⚡ Live + Индикаторы\nЛимит: 10 сигналов / 3 часа",
        },
        "unlimited": {
            "code": "unlimited",
            "name": "Unlimited",
            "description": "Полный доступ без лимитов.",
            "is_enabled": 1,
            "sort_order": 40,
            "access_required": 1,
            "min_deposit": 250,
            "scanner_enabled": 1,
            "scanner_limit": -1,
            "scanner_window_hours": 1,
            "live_enabled": 1,
            "live_limit": -1,
            "live_window_hours": 1,
            "indicators_enabled": 1,
            "indicators_limit": -1,
            "indicators_window_hours": 1,
            "badge_text": "UNLIMITED",
            "marketing_text": "🚀 Полный доступ\n♾ Без лимитов\n⚡ Максимальная скорость сигналов",
        },
    }
    return _serialize_account_status(defaults.get(_normalize_status_code(code), defaults["trader"]))


async def list_account_statuses(include_disabled: bool = False) -> List[Dict[str, Any]]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            where_sql = "" if include_disabled else "WHERE is_enabled = 1"
            await cur.execute(
                f"""
                SELECT *
                FROM account_statuses
                {where_sql}
                ORDER BY sort_order ASC, id ASC
                """
            )
            rows = await cur.fetchall()
    statuses = [_serialize_account_status(row) for row in rows or []]
    if statuses:
        return statuses
    if not include_disabled:
        return []
    return [
        _fallback_status_config("trader"),
        _fallback_status_config("premium"),
        _fallback_status_config("vip"),
        _fallback_status_config("unlimited"),
    ]


async def get_account_status_config(code: str) -> Dict[str, Any]:
    normalized = _normalize_status_code(code)
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM account_statuses WHERE `code` = %s LIMIT 1", (normalized,))
            row = await cur.fetchone()
    return _serialize_account_status(row) if row else _fallback_status_config(normalized)


async def count_user_source_signals(user_id: int, source_types: List[str], window_hours: Optional[int] = None) -> int:
    sources = [str(item or "").strip() for item in source_types if str(item or "").strip()]
    if not sources:
        return 0
    placeholders = ", ".join(["%s"] * len(sources))
    window_sql = ""
    params: List[Any] = [int(user_id), *sources]
    if window_hours:
        window_sql = "AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(), INTERVAL %s HOUR)"
        params.append(int(window_hours))
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM analysis_history
                WHERE user_id = %s
                  AND source_type IN ({placeholders})
                  AND UPPER(TRIM(COALESCE(`signal`, ''))) IN ('BUY', 'SELL')
                  {window_sql}
                """,
                tuple(params),
            )
            row = await cur.fetchone()
    return int((row or {}).get("total") or 0)


async def count_user_mode_signals(user_id: int, source_type: str, window_hours: Optional[int] = None) -> int:
    return await count_user_source_signals(user_id, [source_type], window_hours)


async def ensure_status_analysis_access(user_id: int, signal_mode: str) -> Dict[str, Any]:
    mode_key, mode_label = STATUS_MODE_MAP.get(str(signal_mode or "").strip().lower(), ("scanner", "Scanner"))
    profile = await fetch_user_profile(int(user_id))
    status_config = profile.get("account_status") or await get_account_status_config(profile.get("account_tier") or "trader")
    enabled = int(status_config.get(f"{mode_key}_enabled") or 0) == 1
    limit = _sanitize_status_limit(status_config.get(f"{mode_key}_limit"))
    window_hours = _sanitize_status_window(status_config.get(f"{mode_key}_window_hours"))

    if not enabled or limit == 0:
        raise HTTPException(
            status_code=403,
            detail=f"Режим {mode_label} недоступен на статусе {status_config.get('name') or 'Trader'}. Повышение статуса откроет доступ.",
        )
    if limit < 0:
        return {"status": status_config, "mode": mode_key, "remaining": -1}

    status_code = _normalize_status_code(status_config.get("code"))
    if status_code == "trader" and mode_key == "scanner":
        used_total = await count_user_mode_signals(int(user_id), "scanner", None)
        if used_total >= limit:
            raise HTTPException(
                status_code=403,
                detail="Пробный Scanner уже использован. Откройте Premium или VIP для продолжения.",
            )
        return {"status": status_config, "mode": mode_key, "remaining": max(limit - used_total, 0)}

    if status_code == "trader" and mode_key in {"live", "indicators"}:
        shared_limit = max(
            _sanitize_status_limit(status_config.get("live_limit")),
            _sanitize_status_limit(status_config.get("indicators_limit")),
            limit,
        )
        used_total = await count_user_source_signals(int(user_id), ["auto", "indicators"], None)
        if used_total >= shared_limit:
            raise HTTPException(
                status_code=403,
                detail="Пробный Live/Indicators анализ уже использован. Откройте Premium для продолжения.",
            )
        return {"status": status_config, "mode": mode_key, "remaining": max(shared_limit - used_total, 0)}

    source_type = "auto" if mode_key == "live" else mode_key
    used = await count_user_mode_signals(int(user_id), source_type, window_hours)
    if used >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Лимит статуса {status_config.get('name')}: {limit} сигналов за {window_hours} ч. Новый слот откроется автоматически.",
        )
    return {"status": status_config, "mode": mode_key, "remaining": max(limit - used, 0)}


async def get_user_account_usage_payload(user_id: int, status_config: Dict[str, Any]) -> Dict[str, Any]:
    status_code = _normalize_status_code(status_config.get("code"))
    payload: Dict[str, Any] = {}
    mode_sources = {
        "scanner": ["scanner"],
        "live": ["auto"],
        "indicators": ["indicators"],
    }

    trader_shared_used: Optional[int] = None
    trader_shared_limit = max(
        _sanitize_status_limit(status_config.get("live_limit")),
        _sanitize_status_limit(status_config.get("indicators_limit")),
    )

    for mode_key, sources in mode_sources.items():
        enabled = int(status_config.get(f"{mode_key}_enabled") or 0) == 1
        limit = _sanitize_status_limit(status_config.get(f"{mode_key}_limit"))
        window_hours = _sanitize_status_window(status_config.get(f"{mode_key}_window_hours"))

        if not enabled or limit == 0:
            payload[mode_key] = {
                "enabled": 0,
                "limit": 0,
                "used": 0,
                "remaining": 0,
                "window_hours": window_hours,
                "is_unlimited": 0,
            }
            continue

        if limit < 0:
            payload[mode_key] = {
                "enabled": 1,
                "limit": -1,
                "used": 0,
                "remaining": -1,
                "window_hours": window_hours,
                "is_unlimited": 1,
            }
            continue

        if status_code == "trader" and mode_key == "scanner":
            used = await count_user_mode_signals(int(user_id), "scanner", None)
        elif status_code == "trader" and mode_key in {"live", "indicators"}:
            if trader_shared_used is None:
                trader_shared_used = await count_user_source_signals(int(user_id), ["auto", "indicators"], None)
            used = trader_shared_used
            limit = max(trader_shared_limit, limit)
            window_hours = 0
        else:
            used = await count_user_source_signals(int(user_id), sources, window_hours)

        payload[mode_key] = {
            "enabled": 1,
            "limit": limit,
            "used": max(int(used), 0),
            "remaining": max(limit - int(used), 0),
            "window_hours": window_hours,
            "is_unlimited": 0,
        }

    return payload


def _build_inline_button(**kwargs: Any) -> InlineKeyboardButton:
    try:
        return InlineKeyboardButton(**kwargs)
    except Exception:
        safe_kwargs = {key: value for key, value in kwargs.items() if key not in {"style", "icon_custom_emoji_id"}}
        return InlineKeyboardButton(**safe_kwargs)


async def build_main_menu_keyboard(current_lang: str, user_id: Optional[int] = None) -> InlineKeyboardMarkup:
    lang = normalize_user_lang(current_lang)
    labels = WELCOME_TEXTS[lang]
    lang_flags = {"ru": "🇷🇺", "en": "🇬🇧", "uk": "🇺🇦"}
    lang_btns = []
    for item in ("ru", "en", "uk"):
        mark = " " + ("*" if item == lang else "")
        lang_btns.append(
            InlineKeyboardButton(
                text=f"{lang_flags[item]} {item.upper()}{mark}",
                callback_data=f"lang:{item}",
            )
        )
    inline_keyboard = [
        [
            _build_inline_button(
                text=labels["open_app"],
                web_app=WebAppInfo(url=build_main_webapp_url()),
                style="success",
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


async def send_main_menu_message(message: types.Message, text: str, lang: str, user_id: int) -> None:
    reply_markup = await build_main_menu_keyboard(lang, user_id)
    if BOT_MENU_IMAGE_PATH.is_file():
        await message.answer_photo(
            FSInputFile(BOT_MENU_IMAGE_PATH),
            caption=text,
            parse_mode="HTML",
            reply_markup=reply_markup,
        )
        return
    await message.answer(
        text,
        parse_mode="HTML",
        disable_web_page_preview=True,
        reply_markup=reply_markup,
    )


async def edit_main_menu_message(message: types.Message, text: str, lang: str, user_id: int) -> None:
    reply_markup = await build_main_menu_keyboard(lang, user_id)
    if message.photo:
        await message.edit_caption(
            caption=text,
            parse_mode="HTML",
            reply_markup=reply_markup,
        )
        return
    await message.edit_text(
        text,
        parse_mode="HTML",
        disable_web_page_preview=True,
        reply_markup=reply_markup,
    )


async def fetch_user_profile(user_id: int) -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT * FROM users WHERE user_id = %s LIMIT 1", (int(user_id),))
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    feature_flags = await get_feature_flags_payload()
    account_tier = _normalize_status_code(row.get("account_tier") or "trader")
    account_status = await get_account_status_config(account_tier)
    account_usage = await get_user_account_usage_payload(int(row["user_id"]), account_status)
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
        "preferred_signal_mode": _normalize_preferred_signal_mode(row.get("preferred_signal_mode") or "scanner"),
        "account_tier": account_tier,
        "account_status": account_status,
        "account_usage": account_usage,
        "trader_id": row.get("trader_id") or "",
        "activation_status": _coerce_activation(row.get("activation_status") or "inactive"),
        "deposit_amount": float(row.get("deposit_amount") or 0),
        "scanner_access": int(row.get("scanner_access") or 0),
        "onboarding_seen": int(row.get("onboarding_seen") or 0),
        "is_blocked": int(row.get("is_blocked") or 0),
        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
        "last_active_at": row.get("last_active_at").isoformat() if row.get("last_active_at") else None,
        "feature_flags": feature_flags,
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


def _normalize_scanner_analysis_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode in SCANNER_ANALYSIS_MODE_CHOICES:
        return mode
    return DEFAULT_SCANNER_ANALYSIS_MODE


def _sanitize_active_signals_limit(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError):
        numeric = DEFAULT_ACTIVE_SIGNALS_LIMIT
    return min(max(numeric, 1), 3)


def _normalize_preferred_signal_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode in {"scanner", "automatic", "indicators"}:
        return mode
    return "scanner"


async def get_active_signals_limit() -> int:
    value = await get_app_setting("active_signals_limit", str(DEFAULT_ACTIVE_SIGNALS_LIMIT))
    return _sanitize_active_signals_limit(value)


def _mask_secret(value: str) -> str:
    secret = str(value or "").strip()
    if not secret:
        return ""
    if len(secret) <= 8:
        return "•" * len(secret)
    return f"{secret[:4]}{'•' * (len(secret) - 8)}{secret[-4:]}"


def _trim_comment_words(value: Any, limit: int = 34) -> str:
    words = str(value or "").strip().split()
    if not words:
        return ""
    return " ".join(words[: max(int(limit), 1)])


def _build_scanner_analysis_text(result: Dict[str, Any]) -> str:
    if (result.get("status") or "") == "graph_not_found":
        return "График не обнаружен"

    confidence = int(result.get("confidence") or 0)
    expiration_minutes = int(result.get("expiration_minutes") or 0)
    expiration_label = f"{expiration_minutes} мин" if expiration_minutes > 0 else "-"
    comment = str(result.get("comment") or "").strip() or "-"
    price = result.get("entry_price")
    price_label = str(price) if price is not None else "-"
    return "\n".join(
        [
            f"Актив: {result.get('asset') or 'не определен'}",
            f"Цена: {price_label}",
            f"Режим: {result.get('market_mode') or 'UNKNOWN'}",
            f"Сигнал: {result.get('signal') or 'NO TRADE'}",
            f"Уверенность: {confidence}%",
            f"Экспирация: {expiration_label}",
            f"Комментарий: {comment}",
        ]
    )


def _sanitize_scanner_analysis_result(payload: Dict[str, Any]) -> Dict[str, Any]:
    status = str(payload.get("status") or "graph_not_found").strip().lower()
    if status not in {"ok", "graph_not_found"}:
        status = "graph_not_found"

    asset = str(payload.get("asset") or "").strip() or "не определен"
    market_mode = str(payload.get("market_mode") or "UNKNOWN").strip().upper()
    if market_mode not in {"OTC", "MARKET", "UNKNOWN"}:
        market_mode = "UNKNOWN"

    signal = str(payload.get("signal") or "NO TRADE").strip().upper()
    if signal not in {"BUY", "SELL", "NO TRADE"}:
        signal = "NO TRADE"

    try:
        confidence = int(payload.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    confidence = min(max(confidence, 0), 85)

    try:
        expiration_minutes = int(payload.get("expiration_minutes") or 0)
    except (TypeError, ValueError):
        expiration_minutes = 0
    expiration_minutes = min(max(expiration_minutes, 0), 5)

    comment = _trim_comment_words(payload.get("comment") or "", 34)

    if status == "graph_not_found":
        return {
            "status": "graph_not_found",
            "asset": "не определен",
            "market_mode": "UNKNOWN",
            "signal": "NO TRADE",
            "confidence": 0,
            "expiration_minutes": 0,
            "entry_price": None,
            "comment": "",
            "formatted_text": "График не обнаружен",
        }

    if confidence < 50:
        signal = "NO TRADE"

    if signal == "NO TRADE":
        expiration_minutes = 0

    sanitized = {
        "status": "ok",
        "asset": asset,
        "market_mode": market_mode,
        "signal": signal,
        "confidence": confidence,
        "expiration_minutes": expiration_minutes,
        "entry_price": None,
        "comment": comment,
    }
    sanitized["formatted_text"] = _build_scanner_analysis_text(sanitized)
    return sanitized


def _build_scanner_response_schema(name: str = "scanner_signal") -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "status": {"type": "string", "enum": ["ok", "graph_not_found"]},
                    "asset": {"type": "string"},
                    "market_mode": {"type": "string", "enum": ["OTC", "MARKET", "UNKNOWN"]},
                    "signal": {"type": "string", "enum": ["BUY", "SELL", "NO TRADE"]},
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 85},
                    "expiration_minutes": {"type": "integer", "minimum": 0, "maximum": 5},
                    "comment": {"type": "string"},
                },
                "required": ["status", "asset", "market_mode", "signal", "confidence", "expiration_minutes", "comment"],
            },
        },
    }


async def _request_scanner_openai_json(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_content: List[Dict[str, Any]],
    schema_name: str,
) -> Dict[str, Any]:
    request_payload = {
        "model": model,
        "temperature": 0.2,
        "response_format": _build_scanner_response_schema(schema_name),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    url = f"{OPENAI_API_BASE_URL}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
            response = await client.post(url, headers=headers, json=request_payload)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("error", {}).get("message", "")
        except Exception:
            detail = exc.response.text.strip() if exc.response is not None else ""
        raise HTTPException(status_code=502, detail=detail or "OpenAI request failed") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

    raw_content = ""
    try:
        content = payload["choices"][0]["message"]["content"]
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OpenAI response is invalid") from exc
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        raw_content = "".join(parts).strip()
    else:
        raw_content = str(content or "").strip()
    if not raw_content:
        raise HTTPException(status_code=502, detail="OpenAI response is empty")

    try:
        parsed_result = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="OpenAI response is not JSON") from exc
    if not isinstance(parsed_result, dict):
        raise HTTPException(status_code=502, detail="OpenAI response is invalid")
    return parsed_result


def _compact_quote_snapshot_for_prompt(payload: Any, candle_limit: int = 36) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None

    compact: Dict[str, Any] = {
        "category": payload.get("category"),
        "requested_symbol": payload.get("requested_symbol"),
        "resolved_symbol": payload.get("resolved_symbol"),
        "price": payload.get("price"),
        "change": payload.get("change"),
        "last_updated": payload.get("last_updated"),
        "seconds_since_change": payload.get("seconds_since_change"),
        "market_status": payload.get("market_status"),
        "source": payload.get("source"),
    }

    candles = payload.get("candles")
    compact_candles: List[Dict[str, Any]] = []
    if isinstance(candles, list):
        for candle in candles[-max(int(candle_limit), 1):]:
            if not isinstance(candle, dict):
                continue
            compact_candles.append(
                {
                    "ts": candle.get("ts"),
                    "open": candle.get("open"),
                    "high": candle.get("high"),
                    "low": candle.get("low"),
                    "close": candle.get("close"),
                }
            )
    compact["candles"] = compact_candles
    return compact


def _merge_scanner_confirmation_result(
    initial_result: Dict[str, Any],
    confirmed_result: Dict[str, Any],
) -> Dict[str, Any]:
    if (confirmed_result.get("status") or "") != "ok":
        return initial_result

    merged = dict(initial_result)
    initial_signal = str(initial_result.get("signal") or "NO TRADE").strip().upper()
    confirmed_signal = str(confirmed_result.get("signal") or initial_signal or "NO TRADE").strip().upper()
    try:
        initial_confidence = int(initial_result.get("confidence") or 0)
    except (TypeError, ValueError):
        initial_confidence = 0
    try:
        confirmed_confidence = int(confirmed_result.get("confidence") or initial_confidence or 0)
    except (TypeError, ValueError):
        confirmed_confidence = initial_confidence
    confirmed_asset = str(confirmed_result.get("asset") or "").strip()
    confirmed_market_mode = str(confirmed_result.get("market_mode") or "").strip().upper()

    if confirmed_asset and confirmed_asset != "не определен":
        merged["asset"] = confirmed_asset
    if confirmed_market_mode in {"OTC", "MARKET"}:
        merged["market_mode"] = confirmed_market_mode

    merged["signal"] = confirmed_signal
    if initial_signal == confirmed_signal and confirmed_signal in {"BUY", "SELL"}:
        confidence_delta = confirmed_confidence - initial_confidence
        if confidence_delta < 0:
            merged_confidence = initial_confidence + max(int(round(confidence_delta * 0.35)), -8)
        elif confidence_delta > 0:
            merged_confidence = initial_confidence + min(int(round(confidence_delta * 0.25)), 5)
        else:
            merged_confidence = initial_confidence
        merged["confidence"] = min(max(merged_confidence, 50), 85)
    elif confirmed_signal == "NO TRADE":
        if initial_signal in {"BUY", "SELL"} and initial_confidence >= 55 and confirmed_confidence >= 35:
            merged["signal"] = initial_signal
            merged["confidence"] = min(max(initial_confidence - 8, 50), 72)
            merged["expiration_minutes"] = int(initial_result.get("expiration_minutes") or 0)
        else:
            merged["confidence"] = min(confirmed_confidence, 49)
    elif initial_signal == "NO TRADE" and confirmed_signal in {"BUY", "SELL"}:
        merged["confidence"] = confirmed_confidence
    else:
        merged["signal"] = "NO TRADE"
        merged["confidence"] = min(max(min(initial_confidence, confirmed_confidence), 45), 55)
    merged["expiration_minutes"] = int(
        confirmed_result.get("expiration_minutes") or initial_result.get("expiration_minutes") or 0
    )
    merged["comment"] = str(confirmed_result.get("comment") or initial_result.get("comment") or "").strip()
    merged["status"] = "ok"
    return _sanitize_scanner_analysis_result(merged)


async def get_scanner_settings_payload() -> Dict[str, Any]:
    analysis_mode = _normalize_scanner_analysis_mode(
        await get_app_setting("scanner_analysis_mode", DEFAULT_SCANNER_ANALYSIS_MODE)
    )
    stored_key = await get_app_setting("scanner_openai_api_key", DEFAULT_SCANNER_OPENAI_API_KEY)
    model = await get_app_setting("scanner_openai_model", DEFAULT_SCANNER_OPENAI_MODEL)
    active_signals_limit = await get_active_signals_limit()
    key_present = bool(str(stored_key or "").strip())
    return {
        "analysis_mode": analysis_mode,
        "analysis_mode_label": SCANNER_ANALYSIS_MODE_LABELS[analysis_mode],
        "api_key_configured": key_present,
        "api_key_preview": _mask_secret(stored_key),
        "model": str(model or DEFAULT_SCANNER_OPENAI_MODEL).strip() or DEFAULT_SCANNER_OPENAI_MODEL,
        "active_signals_limit": active_signals_limit,
        "active_signals_limit_options": [1, 2, 3],
        "mode_options": [
            {"key": key, "label": SCANNER_ANALYSIS_MODE_LABELS[key]}
            for key in SCANNER_ANALYSIS_MODE_CHOICES
        ],
    }


async def _load_scan_upload_for_analysis(user_id: int, upload_id: Optional[int] = None) -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            if upload_id:
                await cur.execute(
                    """
                    SELECT *
                    FROM scan_uploads
                    WHERE id = %s AND user_id = %s
                    LIMIT 1
                    """,
                    (int(upload_id), int(user_id)),
                )
            else:
                await cur.execute(
                    """
                    SELECT *
                    FROM scan_uploads
                    WHERE user_id = %s AND is_current = 1
                    ORDER BY id DESC
                    LIMIT 1
                    """,
                    (int(user_id),),
                )
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Scan upload not found")
    file_path = Path(str(row.get("file_path") or "")).resolve()
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Scan file is missing on disk")
    try:
        file_path.relative_to(scan_upload_dir.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Scan file path is invalid") from exc
    row["resolved_file_path"] = str(file_path)
    return row


def _resolve_scanner_price_request(asset: Any, market_mode: Any) -> Optional[Dict[str, str]]:
    normalized_asset = str(asset or "").strip()
    normalized_market_mode = str(market_mode or "").strip().upper()
    if not normalized_asset or normalized_asset == "не определен":
        return None

    symbol = re.sub(r"\s+OTC$", "", normalized_asset, flags=re.IGNORECASE).strip()
    if not symbol:
        return None

    try:
        normalized_symbol = normalize_quote_symbol(symbol)
    except ValueError:
        return None

    category = "otc" if normalized_market_mode == "OTC" else "forex"
    try:
        normalized_category = normalize_quote_category(category)
    except ValueError:
        return None
    return {"category": normalized_category, "symbol": normalized_symbol}


def _extract_quote_price(payload: Any) -> Optional[float]:
    if not isinstance(payload, dict):
        return None

    try:
        price = float(payload.get("price"))
        if price > 0:
            return price
    except (TypeError, ValueError):
        price = None

    candles = payload.get("candles")
    if isinstance(candles, list):
        for candle in reversed(candles):
            if not isinstance(candle, dict):
                continue
            try:
                close_price = float(candle.get("close"))
            except (TypeError, ValueError):
                continue
            if close_price > 0:
                return close_price
    return None


async def _fetch_quote_price(category: str, symbol: str) -> Optional[float]:
    if not DEVSBITE_CLIENT_TOKEN:
        return None

    normalized_category = normalize_quote_category(category)
    normalized_symbol = normalize_quote_symbol(_strip_otc_suffix(symbol))
    url = f"{DEVSBITE_API_BASE_URL}/quotes/price"
    headers = {
        "accept": "application/json",
        "X-Client-Token": DEVSBITE_CLIENT_TOKEN,
        "Cache-Control": "no-cache",
    }
    params = {
        "category": normalized_category,
        "symbol": normalized_symbol,
    }

    payload: Optional[Dict[str, Any]] = None
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=10.0)
            response.raise_for_status()
            payload = response.json()
    except Exception:
        payload = None

    resolved_price = _extract_quote_price(payload)
    if resolved_price and resolved_price > 0:
        return resolved_price

    try:
        history_payload = await _fetch_quote_history(
            category=normalized_category,
            symbol=normalized_symbol,
            history_seconds=QUOTE_HISTORY_SECONDS,
        )
    except Exception:
        return None

    return _extract_quote_price(history_payload)


async def _fetch_quote_snapshot(category: str, symbol: str) -> Optional[Dict[str, Any]]:
    if not DEVSBITE_CLIENT_TOKEN:
        return None

    normalized_category = normalize_quote_category(category)
    normalized_symbol = normalize_quote_symbol(_strip_otc_suffix(symbol))
    url = f"{DEVSBITE_API_BASE_URL}/quotes/price"
    headers = {
        "accept": "application/json",
        "X-Client-Token": DEVSBITE_CLIENT_TOKEN,
        "Cache-Control": "no-cache",
    }
    params = {
        "category": normalized_category,
        "symbol": normalized_symbol,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=10.0)
            response.raise_for_status()
            payload = response.json()
    except Exception:
        payload = None

    if isinstance(payload, dict):
        payload.setdefault("category", normalized_category)
        payload.setdefault("requested_symbol", normalized_symbol)
        return payload

    return None


def _strip_otc_suffix(symbol: Any) -> str:
    return re.sub(r"\s+OTC$", "", str(symbol or "").strip(), flags=re.IGNORECASE).strip()


def _normalize_indicator_interval(value: Optional[str], selected_expiration: Optional[str] = None) -> str:
    raw = str(value or "").strip().lower()
    aliases = {
        "5m": "5min",
        "5min": "5min",
        "15m": "15min",
        "15min": "15min",
        "30m": "30min",
        "30min": "30min",
        "1h": "1h",
        "60m": "1h",
        "60min": "1h",
    }
    if raw in aliases:
        return aliases[raw]

    seconds = _get_selected_expiration_seconds(selected_expiration)
    if seconds >= 3600:
        return "1h"
    if seconds >= 1800:
        return "30min"
    if seconds >= 900:
        return "15min"
    return "5min"


def _indicator_api_codes(indicator_code: Optional[str]) -> List[str]:
    normalized = str(indicator_code or "").strip().lower()
    if not normalized:
        codes: List[str] = []
        for values in INDICATOR_ANALYSIS_CODE_MAP.values():
            codes.extend(values)
        return codes
    if normalized not in INDICATOR_ANALYSIS_CODE_MAP:
        raise HTTPException(status_code=400, detail="Indicator is not supported by local analysis")
    return list(INDICATOR_ANALYSIS_CODE_MAP[normalized])


def _coerce_indicator_expiration_minutes(*values: Any) -> int:
    for value in values:
        raw = str(value or "").strip().lower()
        if not raw:
            continue
        match = re.search(r"(\d+(?:\.\d+)?)\s*(seconds?|сек|s|minutes?|мин|m|hours?|час|h)?", raw)
        if not match:
            continue
        amount = float(match.group(1))
        unit = (match.group(2) or "m").lower()
        if unit.startswith("s") or unit.startswith("сек"):
            return max(int(round(amount / 60)), 1)
        if unit.startswith("h") or unit.startswith("час"):
            return max(int(round(amount * 60)), 1)
        return max(int(round(amount)), 1)
    return 0


def _safe_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _extract_indicator_candles(payload: Any) -> List[Dict[str, float]]:
    if not isinstance(payload, dict):
        return []
    candles = payload.get("candles")
    if not isinstance(candles, list):
        return []

    normalized: List[Dict[str, float]] = []
    for item in candles:
        if not isinstance(item, dict):
            continue
        open_price = _safe_number(item.get("open"))
        high_price = _safe_number(item.get("high"))
        low_price = _safe_number(item.get("low"))
        close_price = _safe_number(item.get("close"))
        if None in (open_price, high_price, low_price, close_price):
            continue
        ts = _safe_number(item.get("ts")) or float(len(normalized))
        normalized.append(
            {
                "ts": ts,
                "open": float(open_price),
                "high": float(high_price),
                "low": float(low_price),
                "close": float(close_price),
            }
        )
    normalized.sort(key=lambda row: row["ts"])
    return normalized


def _sma(values: List[float], period: int) -> Optional[float]:
    if period <= 0 or len(values) < period:
        return None
    chunk = values[-period:]
    return sum(chunk) / period


def _ema_series(values: List[float], period: int) -> List[Optional[float]]:
    if period <= 0 or len(values) < period:
        return [None for _ in values]
    result: List[Optional[float]] = [None for _ in values]
    initial = sum(values[:period]) / period
    result[period - 1] = initial
    multiplier = 2 / (period + 1)
    previous = initial
    for index in range(period, len(values)):
        previous = (values[index] - previous) * multiplier + previous
        result[index] = previous
    return result


def _last_number(values: List[Optional[float]]) -> Optional[float]:
    for value in reversed(values):
        if value is not None:
            return float(value)
    return None


def _calc_rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) <= period:
        return None
    gains: List[float] = []
    losses: List[float] = []
    for index in range(1, len(closes)):
        change = closes[index] - closes[index - 1]
        gains.append(max(change, 0))
        losses.append(abs(min(change, 0)))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for index in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[index]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[index]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _calc_stochastic(candles: List[Dict[str, float]], period: int = 14, smooth: int = 3) -> tuple[Optional[float], Optional[float]]:
    if len(candles) < period:
        return None, None
    k_values: List[float] = []
    for index in range(period - 1, len(candles)):
        window = candles[index - period + 1 : index + 1]
        highest = max(row["high"] for row in window)
        lowest = min(row["low"] for row in window)
        close = candles[index]["close"]
        k_values.append(50.0 if highest == lowest else ((close - lowest) / (highest - lowest)) * 100)
    k = k_values[-1] if k_values else None
    d = sum(k_values[-smooth:]) / min(len(k_values), smooth) if k_values else None
    return k, d


def _calc_cci(candles: List[Dict[str, float]], period: int = 20) -> Optional[float]:
    if len(candles) < period:
        return None
    typical = [(row["high"] + row["low"] + row["close"]) / 3 for row in candles]
    window = typical[-period:]
    average = sum(window) / period
    mean_deviation = sum(abs(value - average) for value in window) / period
    if mean_deviation == 0:
        return 0.0
    return (typical[-1] - average) / (0.015 * mean_deviation)


def _calc_williams_r(candles: List[Dict[str, float]], period: int = 14) -> Optional[float]:
    if len(candles) < period:
        return None
    window = candles[-period:]
    highest = max(row["high"] for row in window)
    lowest = min(row["low"] for row in window)
    if highest == lowest:
        return -50.0
    return ((highest - candles[-1]["close"]) / (highest - lowest)) * -100


def _true_ranges(candles: List[Dict[str, float]]) -> List[float]:
    ranges: List[float] = []
    previous_close: Optional[float] = None
    for row in candles:
        high = row["high"]
        low = row["low"]
        if previous_close is None:
            ranges.append(high - low)
        else:
            ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
        previous_close = row["close"]
    return ranges


def _calc_atr(candles: List[Dict[str, float]], period: int = 14) -> Optional[float]:
    ranges = _true_ranges(candles)
    if len(ranges) < period:
        return None
    atr = sum(ranges[:period]) / period
    for value in ranges[period:]:
        atr = ((atr * (period - 1)) + value) / period
    return atr


def _calc_adx(candles: List[Dict[str, float]], period: int = 14) -> Dict[str, Optional[float]]:
    if len(candles) <= period * 2:
        return {"adx": None, "plus_di": None, "minus_di": None}
    tr_values: List[float] = []
    plus_dm: List[float] = []
    minus_dm: List[float] = []
    for index in range(1, len(candles)):
        current = candles[index]
        previous = candles[index - 1]
        up_move = current["high"] - previous["high"]
        down_move = previous["low"] - current["low"]
        plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0.0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0.0)
        tr_values.append(max(current["high"] - current["low"], abs(current["high"] - previous["close"]), abs(current["low"] - previous["close"])))

    atr = sum(tr_values[:period])
    plus = sum(plus_dm[:period])
    minus = sum(minus_dm[:period])
    dx_values: List[float] = []
    plus_di = minus_di = None
    for index in range(period, len(tr_values)):
        atr = atr - (atr / period) + tr_values[index]
        plus = plus - (plus / period) + plus_dm[index]
        minus = minus - (minus / period) + minus_dm[index]
        if atr == 0:
            continue
        plus_di = 100 * (plus / atr)
        minus_di = 100 * (minus / atr)
        total = plus_di + minus_di
        dx_values.append(0.0 if total == 0 else 100 * abs(plus_di - minus_di) / total)
    if len(dx_values) < period:
        return {"adx": None, "plus_di": plus_di, "minus_di": minus_di}
    adx = sum(dx_values[:period]) / period
    for value in dx_values[period:]:
        adx = ((adx * (period - 1)) + value) / period
    return {"adx": adx, "plus_di": plus_di, "minus_di": minus_di}


def _calc_bollinger(closes: List[float], period: int = 20) -> Dict[str, Optional[float]]:
    if len(closes) < period:
        return {"middle": None, "upper": None, "lower": None, "width": None}
    window = closes[-period:]
    middle = sum(window) / period
    variance = sum((value - middle) ** 2 for value in window) / period
    deviation = variance ** 0.5
    upper = middle + deviation * 2
    lower = middle - deviation * 2
    width = (upper - lower) / middle if middle else None
    return {"middle": middle, "upper": upper, "lower": lower, "width": width}


def _calc_macd(closes: List[float]) -> Dict[str, Optional[float]]:
    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    macd_line: List[Optional[float]] = []
    for fast, slow in zip(ema12, ema26):
        macd_line.append(None if fast is None or slow is None else fast - slow)
    compact = [value for value in macd_line if value is not None]
    signal_series = _ema_series(compact, 9) if compact else []
    macd = _last_number(macd_line)
    signal = _last_number(signal_series)
    histogram = macd - signal if macd is not None and signal is not None else None
    previous_histogram = None
    if len(compact) >= 2 and len(signal_series) >= 2:
        previous_signal = signal_series[-2]
        previous_macd = compact[-2]
        if previous_signal is not None:
            previous_histogram = previous_macd - previous_signal
    return {"macd": macd, "signal": signal, "histogram": histogram, "previous_histogram": previous_histogram}


def _calc_psar(candles: List[Dict[str, float]], step: float = 0.02, maximum: float = 0.2) -> Optional[float]:
    if len(candles) < 3:
        return None
    bull = candles[1]["close"] >= candles[0]["close"]
    psar = candles[0]["low"] if bull else candles[0]["high"]
    extreme = candles[0]["high"] if bull else candles[0]["low"]
    acceleration = step
    for index in range(1, len(candles)):
        row = candles[index]
        psar = psar + acceleration * (extreme - psar)
        if bull:
            if row["low"] < psar:
                bull = False
                psar = extreme
                extreme = row["low"]
                acceleration = step
            else:
                if row["high"] > extreme:
                    extreme = row["high"]
                    acceleration = min(acceleration + step, maximum)
        else:
            if row["high"] > psar:
                bull = True
                psar = extreme
                extreme = row["high"]
                acceleration = step
            else:
                if row["low"] < extreme:
                    extreme = row["low"]
                    acceleration = min(acceleration + step, maximum)
    return psar


def _calc_momentum(closes: List[float], period: int = 10) -> Optional[float]:
    if len(closes) <= period:
        return None
    return closes[-1] - closes[-period - 1]


def _calc_roc(closes: List[float], period: int = 10) -> Optional[float]:
    if len(closes) <= period or closes[-period - 1] == 0:
        return None
    return ((closes[-1] - closes[-period - 1]) / closes[-period - 1]) * 100


def _vote_result(signal: str, weight: float, label: str, detail: str, *, source: str = "indicator") -> Dict[str, Any]:
    return {"signal": signal, "weight": float(weight), "label": label, "detail": detail, "source": source}


def _build_local_indicator_snapshot(candles: List[Dict[str, float]]) -> Dict[str, Any]:
    closes = [row["close"] for row in candles]
    highs = [row["high"] for row in candles]
    lows = [row["low"] for row in candles]
    ema9 = _last_number(_ema_series(closes, 9))
    ema50 = _last_number(_ema_series(closes, 50))
    ema200 = _last_number(_ema_series(closes, 200))
    atr = _calc_atr(candles)
    last_close = closes[-1] if closes else None
    previous_close = closes[-2] if len(closes) >= 2 else None
    move_20 = closes[-1] - closes[-21] if len(closes) > 20 else 0.0
    range_20 = max(highs[-20:]) - min(lows[-20:]) if len(candles) >= 20 else 0.0
    return {
        "price": last_close,
        "previous_close": previous_close,
        "rsi": _calc_rsi(closes),
        "stochastic": dict(zip(("k", "d"), _calc_stochastic(candles))),
        "cci": _calc_cci(candles),
        "williams_r": _calc_williams_r(candles),
        "macd": _calc_macd(closes),
        "ema": {"ema9": ema9, "ema50": ema50, "ema200": ema200},
        "adx": _calc_adx(candles),
        "atr": atr,
        "bollinger": _calc_bollinger(closes),
        "psar": _calc_psar(candles),
        "momentum": _calc_momentum(closes),
        "roc": _calc_roc(closes),
        "move_20": move_20,
        "range_20": range_20,
    }


def _indicator_votes(snapshot: Dict[str, Any], allowed_indicators: List[str]) -> List[Dict[str, Any]]:
    allowed = set(allowed_indicators or [])
    votes: List[Dict[str, Any]] = []
    price = _safe_number(snapshot.get("price"))

    if "RSI" in allowed:
        rsi = _safe_number(snapshot.get("rsi"))
        if rsi is not None:
            if rsi <= 30:
                votes.append(_vote_result("BUY", 2.6, "RSI", f"RSI {rsi:.1f}: зона перепроданности, возможен отскок."))
            elif rsi >= 70:
                votes.append(_vote_result("SELL", 2.6, "RSI", f"RSI {rsi:.1f}: зона перекупленности, возможен откат."))
            elif rsi >= 57:
                votes.append(_vote_result("BUY", 1.1, "RSI", f"RSI {rsi:.1f}: покупатели сохраняют умеренное давление."))
            elif rsi <= 43:
                votes.append(_vote_result("SELL", 1.1, "RSI", f"RSI {rsi:.1f}: продавцы сохраняют умеренное давление."))

    if "STOCH" in allowed:
        stochastic = snapshot.get("stochastic") or {}
        k = _safe_number(stochastic.get("k"))
        d = _safe_number(stochastic.get("d"))
        if k is not None and d is not None:
            if k <= 20 and k >= d:
                votes.append(_vote_result("BUY", 2.2, "Stochastic", f"Stochastic {k:.1f}: выход из перепроданности."))
            elif k >= 80 and k <= d:
                votes.append(_vote_result("SELL", 2.2, "Stochastic", f"Stochastic {k:.1f}: слабость в перекупленности."))
            elif k > d and k < 80:
                votes.append(_vote_result("BUY", 1.0, "Stochastic", "Stochastic направлен вверх, импульс поддерживает BUY."))
            elif k < d and k > 20:
                votes.append(_vote_result("SELL", 1.0, "Stochastic", "Stochastic направлен вниз, импульс поддерживает SELL."))

    if "CCI" in allowed:
        cci = _safe_number(snapshot.get("cci"))
        if cci is not None:
            if cci <= -100:
                votes.append(_vote_result("BUY", 2.0, "CCI", f"CCI {cci:.0f}: перепроданность и шанс на восстановление."))
            elif cci >= 100:
                votes.append(_vote_result("SELL", 2.0, "CCI", f"CCI {cci:.0f}: перегрев и риск отката."))
            elif cci > 40:
                votes.append(_vote_result("BUY", 0.9, "CCI", f"CCI {cci:.0f}: положительный импульс."))
            elif cci < -40:
                votes.append(_vote_result("SELL", 0.9, "CCI", f"CCI {cci:.0f}: отрицательный импульс."))

    if "WILLR" in allowed:
        willr = _safe_number(snapshot.get("williams_r"))
        if willr is not None:
            if willr <= -80:
                votes.append(_vote_result("BUY", 2.0, "Williams %R", f"Williams %R {willr:.0f}: рынок в перепроданности."))
            elif willr >= -20:
                votes.append(_vote_result("SELL", 2.0, "Williams %R", f"Williams %R {willr:.0f}: рынок в перекупленности."))
            elif willr > -50:
                votes.append(_vote_result("BUY", 0.8, "Williams %R", "Williams %R держится выше середины диапазона."))
            elif willr < -50:
                votes.append(_vote_result("SELL", 0.8, "Williams %R", "Williams %R держится ниже середины диапазона."))

    if "MACD" in allowed:
        macd = snapshot.get("macd") or {}
        histogram = _safe_number(macd.get("histogram"))
        previous_histogram = _safe_number(macd.get("previous_histogram"))
        if histogram is not None:
            if histogram > 0 and (previous_histogram is None or histogram >= previous_histogram):
                votes.append(_vote_result("BUY", 2.1, "MACD", "MACD histogram растет выше нуля, импульс на стороне покупателей."))
            elif histogram < 0 and (previous_histogram is None or histogram <= previous_histogram):
                votes.append(_vote_result("SELL", 2.1, "MACD", "MACD histogram снижается ниже нуля, давление на стороне продавцов."))
            elif histogram > 0:
                votes.append(_vote_result("BUY", 1.0, "MACD", "MACD остается в положительной зоне."))
            elif histogram < 0:
                votes.append(_vote_result("SELL", 1.0, "MACD", "MACD остается в отрицательной зоне."))

    if {"EMA9", "EMA50", "EMA200"} & allowed:
        ema = snapshot.get("ema") or {}
        ema9 = _safe_number(ema.get("ema9"))
        ema50 = _safe_number(ema.get("ema50"))
        ema200 = _safe_number(ema.get("ema200"))
        if price is not None and ema9 is not None and ema50 is not None:
            if ema9 > ema50 and price >= ema9:
                weight = 2.4 if ema200 is None or ema50 >= ema200 else 1.6
                votes.append(_vote_result("BUY", weight, "EMA", "EMA 9 выше EMA 50, цена удерживает восходящую структуру."))
            elif ema9 < ema50 and price <= ema9:
                weight = 2.4 if ema200 is None or ema50 <= ema200 else 1.6
                votes.append(_vote_result("SELL", weight, "EMA", "EMA 9 ниже EMA 50, цена удерживает нисходящую структуру."))
            elif price > ema50:
                votes.append(_vote_result("BUY", 0.9, "EMA", "Цена остается выше EMA 50."))
            elif price < ema50:
                votes.append(_vote_result("SELL", 0.9, "EMA", "Цена остается ниже EMA 50."))

    if "ADX" in allowed:
        adx_payload = snapshot.get("adx") or {}
        adx = _safe_number(adx_payload.get("adx"))
        plus_di = _safe_number(adx_payload.get("plus_di"))
        minus_di = _safe_number(adx_payload.get("minus_di"))
        if adx is not None and plus_di is not None and minus_di is not None:
            if adx >= 18 and plus_di > minus_di:
                votes.append(_vote_result("BUY", 2.0 if adx >= 25 else 1.3, "ADX", f"ADX {adx:.1f}: тренд поддерживает покупателей."))
            elif adx >= 18 and minus_di > plus_di:
                votes.append(_vote_result("SELL", 2.0 if adx >= 25 else 1.3, "ADX", f"ADX {adx:.1f}: тренд поддерживает продавцов."))

    if "ATR" in allowed:
        atr = _safe_number(snapshot.get("atr"))
        move_20 = _safe_number(snapshot.get("move_20")) or 0
        if atr is not None and atr > 0:
            if move_20 > atr * 1.2:
                votes.append(_vote_result("BUY", 1.5, "ATR", "ATR показывает рабочую волатильность, последний импульс направлен вверх."))
            elif move_20 < -atr * 1.2:
                votes.append(_vote_result("SELL", 1.5, "ATR", "ATR показывает рабочую волатильность, последний импульс направлен вниз."))

    if "BB" in allowed:
        bb = snapshot.get("bollinger") or {}
        upper = _safe_number(bb.get("upper"))
        lower = _safe_number(bb.get("lower"))
        middle = _safe_number(bb.get("middle"))
        if price is not None and upper is not None and lower is not None and middle is not None:
            if price <= lower:
                votes.append(_vote_result("BUY", 1.9, "Bollinger Bands", "Цена у нижней полосы Bollinger, вероятен отскок."))
            elif price >= upper:
                votes.append(_vote_result("SELL", 1.9, "Bollinger Bands", "Цена у верхней полосы Bollinger, вероятен откат."))
            elif price > middle:
                votes.append(_vote_result("BUY", 0.7, "Bollinger Bands", "Цена выше средней Bollinger, структура умеренно бычья."))
            elif price < middle:
                votes.append(_vote_result("SELL", 0.7, "Bollinger Bands", "Цена ниже средней Bollinger, структура умеренно медвежья."))

    if "PSAR" in allowed:
        psar = _safe_number(snapshot.get("psar"))
        if price is not None and psar is not None:
            if price > psar:
                votes.append(_vote_result("BUY", 1.3, "Parabolic SAR", "Цена выше Parabolic SAR, направление остается вверх."))
            elif price < psar:
                votes.append(_vote_result("SELL", 1.3, "Parabolic SAR", "Цена ниже Parabolic SAR, направление остается вниз."))

    if "MOM" in allowed:
        momentum = _safe_number(snapshot.get("momentum"))
        if momentum is not None:
            if momentum > 0:
                votes.append(_vote_result("BUY", 1.2, "Momentum", "Momentum положительный, импульс поддерживает рост."))
            elif momentum < 0:
                votes.append(_vote_result("SELL", 1.2, "Momentum", "Momentum отрицательный, импульс поддерживает снижение."))

    if "ROC" in allowed:
        roc = _safe_number(snapshot.get("roc"))
        if roc is not None:
            if roc > 0:
                votes.append(_vote_result("BUY", 1.1, "Rate Of Change", f"ROC {roc:.2f}%: цена растет относительно прошлых свечей."))
            elif roc < 0:
                votes.append(_vote_result("SELL", 1.1, "Rate Of Change", f"ROC {roc:.2f}%: цена снижается относительно прошлых свечей."))

    move_20 = _safe_number(snapshot.get("move_20")) or 0
    range_20 = _safe_number(snapshot.get("range_20")) or 0
    previous_close = _safe_number(snapshot.get("previous_close"))
    if price is not None and previous_close is not None and range_20 > 0:
        impulse_ratio = abs(move_20) / range_20
        weight = 1.6 if impulse_ratio >= 0.32 else 1.1 if impulse_ratio >= 0.18 else 0
        if weight and move_20 > 0 and price >= previous_close:
            votes.append(_vote_result("BUY", weight, "Price Action", "Последняя структура цены поддерживает восходящий импульс.", source="context"))
        elif weight and move_20 < 0 and price <= previous_close:
            votes.append(_vote_result("SELL", weight, "Price Action", "Последняя структура цены поддерживает нисходящий импульс.", source="context"))

    return votes


def _compact_indicator_snapshot(snapshot: Dict[str, Any], allowed_indicators: List[str], candles_count: int) -> Dict[str, Any]:
    allowed = set(allowed_indicators or [])
    values: Dict[str, Any] = {}
    if "RSI" in allowed:
        values["rsi"] = snapshot.get("rsi")
    if "STOCH" in allowed:
        values["stochastic"] = snapshot.get("stochastic")
    if "CCI" in allowed:
        values["cci"] = snapshot.get("cci")
    if "WILLR" in allowed:
        values["williams_r"] = snapshot.get("williams_r")
    if "MACD" in allowed:
        values["macd"] = snapshot.get("macd")
    if {"EMA9", "EMA50", "EMA200"} & allowed:
        values["ema"] = snapshot.get("ema")
    if "ADX" in allowed:
        values["adx"] = snapshot.get("adx")
    if "ATR" in allowed:
        values["atr"] = snapshot.get("atr")
    if "BB" in allowed:
        values["bollinger"] = snapshot.get("bollinger")
    if "PSAR" in allowed:
        values["psar"] = snapshot.get("psar")
    if "MOM" in allowed:
        values["momentum"] = snapshot.get("momentum")
    if "ROC" in allowed:
        values["roc"] = snapshot.get("roc")
    return {"candles": candles_count, "values": values}


def _build_local_indicator_analysis(
    *,
    payload: Dict[str, Any],
    category: str,
    symbol: str,
    selected_expiration: Optional[str],
    allowed_indicators: List[str],
) -> Dict[str, Any]:
    candles = _extract_indicator_candles(payload)
    if len(candles) < 20:
        raise HTTPException(status_code=502, detail="Not enough quote candles for local indicator analysis")

    normalized_category = normalize_quote_category(category)
    normalized_symbol = normalize_quote_symbol(_strip_otc_suffix(symbol))
    snapshot = _build_local_indicator_snapshot(candles)
    votes = _indicator_votes(snapshot, allowed_indicators)
    buy_score = sum(item["weight"] for item in votes if item["signal"] == "BUY")
    sell_score = sum(item["weight"] for item in votes if item["signal"] == "SELL")
    score_delta = buy_score - sell_score
    selected_mode = len(allowed_indicators) <= 3
    threshold = 1.35 if selected_mode else 2.2

    signal = "NO TRADE"
    confidence = 0
    comment = "Индикаторы дают смешанную картину без явного преимущества. Лучше дождаться более чистого импульса."
    decision_strength = abs(score_delta)

    indicator_votes = [item for item in votes if item.get("source") == "indicator"]
    if selected_mode and indicator_votes:
        primary_vote = max(indicator_votes, key=lambda item: item["weight"])
        primary_signal = str(primary_vote["signal"])
        same_votes = [item for item in votes if item["signal"] == primary_signal]
        opposite_votes = [item for item in votes if item["signal"] != primary_signal]
        same_weight = sum(item["weight"] for item in same_votes)
        opposite_weight = sum(item["weight"] for item in opposite_votes)
        decision_strength = max(float(primary_vote["weight"]), abs(same_weight - opposite_weight))
        if float(primary_vote["weight"]) >= 1.0 and same_weight >= opposite_weight * 0.65:
            signal = primary_signal
            confidence = int(round(50 + min(float(primary_vote["weight"]) * 7, 20) + min((same_weight - float(primary_vote["weight"])) * 4, 10) - min(opposite_weight * 3, 12)))
            if float(primary_vote["weight"]) >= 2.0:
                confidence = max(confidence, 58)
            confidence = min(max(confidence, 50), 85)
            context_note = ""
            supporting_context = [item for item in same_votes if item.get("source") == "context"]
            opposing_context = [item for item in opposite_votes if item.get("source") == "context"]
            if supporting_context:
                context_note = " Движение цены дополнительно поддерживает сценарий."
            elif opposing_context:
                context_note = " Контекст цены спорит с сигналом, поэтому уверенность снижена."
            comment = f"{primary_vote['detail']}{context_note}"
    elif abs(score_delta) >= threshold:
        signal = "BUY" if score_delta > 0 else "SELL"
        dominant_votes = [item for item in votes if item["signal"] == signal]
        opposing_votes = [item for item in votes if item["signal"] != signal]
        confidence = int(round(52 + min(abs(score_delta) * 6, 24) + min(len(dominant_votes) * 2, 8) - min(len(opposing_votes) * 2, 8)))
        confidence = min(max(confidence, 50), 85)
        best_detail = dominant_votes[0]["detail"] if dominant_votes else ""
        supporting = ", ".join(item["label"] for item in dominant_votes[:3])
        comment = best_detail
        if supporting:
            comment = f"{best_detail} Подтверждения: {supporting}."

    if signal == "NO TRADE":
        signal = "NO TRADE"
        confidence = 0
        comment = "Индикаторы дают смешанную картину без явного преимущества. Лучше дождаться более чистого импульса."

    atr = _safe_number(snapshot.get("atr")) or 0
    price = _safe_number(snapshot.get("price")) or _extract_quote_price(payload)
    range_20 = abs(_safe_number(snapshot.get("range_20")) or 0)
    if signal == "NO TRADE":
        expiration_minutes = _coerce_indicator_expiration_minutes(selected_expiration) or 5
    elif atr and price and atr / price > 0.0018:
        expiration_minutes = 1
    elif range_20 and price and range_20 / price > 0.004:
        expiration_minutes = 2
    elif decision_strength >= 4:
        expiration_minutes = 3
    else:
        expiration_minutes = 5

    result = {
        "status": "ok",
        "asset": _display_quote_symbol(normalized_symbol, normalized_category),
        "market_mode": "OTC" if normalized_category == "otc" else "MARKET",
        "signal": signal,
        "confidence": confidence,
        "expiration_minutes": expiration_minutes,
        "entry_price": price,
        "comment": comment[:260],
        "raw_source": "local_indicators",
        "indicator_snapshot": {
            **_compact_indicator_snapshot(snapshot, allowed_indicators, len(candles)),
            "buy_score": round(buy_score, 2),
            "sell_score": round(sell_score, 2),
            "primary_mode": selected_mode,
        },
    }
    return result


async def run_indicator_analysis(
    *,
    category: str,
    symbol: str,
    indicator_code: Optional[str],
    selected_expiration: Optional[str],
    interval: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_category = normalize_quote_category(category)
    normalized_symbol = normalize_quote_symbol(_strip_otc_suffix(symbol))
    normalized_indicator = str(indicator_code or "").strip().lower()
    if normalized_indicator and normalized_indicator not in INDICATOR_ANALYSIS_SUPPORTED_CODES:
        raise HTTPException(status_code=400, detail="Indicator is not supported by local analysis")

    interval_value = _normalize_indicator_interval(interval, selected_expiration)
    if interval_value not in INDICATOR_ANALYSIS_INTERVALS:
        interval_value = "5min"
    allowed_indicators = _indicator_api_codes(normalized_indicator)
    payload = await _fetch_quote_history(
        category=normalized_category,
        symbol=normalized_symbol,
        history_seconds=INDICATOR_LOCAL_HISTORY_SECONDS,
    )
    sanitized = _build_local_indicator_analysis(
        payload=payload,
        category=normalized_category,
        symbol=normalized_symbol,
        selected_expiration=selected_expiration,
        allowed_indicators=allowed_indicators,
    )
    sanitized["formatted_text"] = _build_scanner_analysis_text(sanitized)
    return {
        "result": sanitized,
        "mode": "indicators",
        "mode_label": "ИНДИКАТОРЫ",
        "indicator": normalized_indicator,
        "interval": interval_value,
        "allowed_indicators": allowed_indicators,
        "history_seconds": INDICATOR_LOCAL_HISTORY_SECONDS,
    }


def _decode_scan_image_data_url(image_data_url: str) -> tuple[str, str, bytes]:
    raw = str(image_data_url or "").strip()
    header, separator, encoded = raw.partition(",")
    if not separator or ";base64" not in header:
        raise HTTPException(status_code=400, detail="Live chart image is invalid")
    content_type = header.replace("data:", "", 1).split(";", 1)[0].strip().lower()
    if content_type not in OPENAI_SCAN_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Live chart image must be PNG, JPG, WEBP or GIF")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Live chart image is invalid") from exc
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Live chart image is empty")
    if len(image_bytes) > SCAN_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Live chart image is too large")
    return content_type, raw, image_bytes


def _display_quote_symbol(symbol: str, category: str) -> str:
    clean_symbol = re.sub(r"\s+OTC$", "", str(symbol or "").strip(), flags=re.IGNORECASE)
    return f"{clean_symbol} OTC" if category == "otc" and not re.search(r"\bOTC\b", clean_symbol, re.IGNORECASE) else clean_symbol


async def _run_scanner_analysis_for_image(
    *,
    image_data_url: str,
    known_category: Optional[str] = None,
    known_symbol: Optional[str] = None,
) -> Dict[str, Any]:
    settings = await get_scanner_settings_payload()
    api_key = await get_app_setting("scanner_openai_api_key", DEFAULT_SCANNER_OPENAI_API_KEY)
    api_key = str(api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Scanner AI key is not configured")

    _decode_scan_image_data_url(image_data_url)
    analysis_mode = settings["analysis_mode"]
    analysis_mode_label = settings["analysis_mode_label"]
    model = settings["model"]

    known_price_request: Optional[Dict[str, str]] = None
    context_lines = [f"Режим анализа: {analysis_mode_label}"]
    if known_category and known_symbol:
        try:
            normalized_category = normalize_quote_category(known_category)
            normalized_symbol = normalize_quote_symbol(
                re.sub(r"\s+OTC$", "", known_symbol, flags=re.IGNORECASE).strip()
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Live chart market or symbol is invalid") from exc
        known_price_request = {"category": normalized_category, "symbol": normalized_symbol}
        known_market_mode = "OTC" if normalized_category == "otc" else "MARKET"
        context_lines.extend(
            [
                "",
                "Контекст live-графика уже известен:",
                f"Актив: {_display_quote_symbol(normalized_symbol, normalized_category)}",
                f"Режим: {known_market_mode}",
                "Не угадывай другой актив, если на изображении нет явного противоречия.",
            ]
        )

    parsed_result = await _request_scanner_openai_json(
        api_key=api_key,
        model=model,
        system_prompt=SCANNER_ANALYSIS_PROMPT,
        user_content=[
            {"type": "text", "text": "\n".join(context_lines)},
            {"type": "image_url", "image_url": {"url": image_data_url, "detail": "high"}},
        ],
        schema_name="scanner_signal_initial",
    )
    sanitized = _sanitize_scanner_analysis_result(parsed_result)

    if known_price_request and sanitized.get("status") == "ok":
        sanitized["asset"] = _display_quote_symbol(known_price_request["symbol"], known_price_request["category"])
        sanitized["market_mode"] = "OTC" if known_price_request["category"] == "otc" else "MARKET"

    price_request = known_price_request or _resolve_scanner_price_request(
        sanitized.get("asset"),
        sanitized.get("market_mode"),
    )
    if sanitized.get("status") == "ok" and price_request:
        quote_snapshot = await _fetch_quote_snapshot(price_request["category"], price_request["symbol"])
        entry_price = _extract_quote_price(quote_snapshot)
        if entry_price is None:
            entry_price = await _fetch_quote_price(price_request["category"], price_request["symbol"])
        if entry_price is not None:
            sanitized["entry_price"] = entry_price
        if quote_snapshot:
            compact_snapshot = _compact_quote_snapshot_for_prompt(quote_snapshot)
            if compact_snapshot:
                try:
                    confirmation_result = await _request_scanner_openai_json(
                        api_key=api_key,
                        model=model,
                        system_prompt=SCANNER_CONFIRMATION_PROMPT,
                        user_content=[
                            {
                                "type": "text",
                                "text": (
                                    f"Режим анализа: {analysis_mode_label}\n\n"
                                    f"Исходный анализ:\n{_build_scanner_analysis_text(sanitized)}\n\n"
                                    f"Свежие рыночные данные:\n{json.dumps(compact_snapshot, ensure_ascii=False)}"
                                ),
                            }
                        ],
                        schema_name="scanner_signal_confirmation",
                    )
                    sanitized = _merge_scanner_confirmation_result(
                        sanitized,
                        _sanitize_scanner_analysis_result(confirmation_result),
                    )
                    if known_price_request:
                        sanitized["asset"] = _display_quote_symbol(
                            known_price_request["symbol"],
                            known_price_request["category"],
                        )
                        sanitized["market_mode"] = "OTC" if known_price_request["category"] == "otc" else "MARKET"
                    if entry_price is not None:
                        sanitized["entry_price"] = entry_price
                except HTTPException:
                    pass
        sanitized["formatted_text"] = _build_scanner_analysis_text(sanitized)

    return {
        "result": sanitized,
        "mode": analysis_mode,
        "mode_label": analysis_mode_label,
    }


async def run_scanner_analysis_for_upload(user_id: int, upload_id: Optional[int] = None) -> Dict[str, Any]:
    upload_row = await _load_scan_upload_for_analysis(user_id, upload_id)
    file_path = Path(str(upload_row["resolved_file_path"]))
    content_type = str(upload_row.get("content_type") or "").strip() or (mimetypes.guess_type(file_path.name)[0] or "image/png")
    if content_type not in OPENAI_SCAN_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Unsupported image format for scanner AI. Use PNG, JPG, WEBP or GIF.",
        )
    image_bytes = file_path.read_bytes()
    image_base64 = base64.b64encode(image_bytes).decode("ascii")
    image_data_url = f"data:{content_type};base64,{image_base64}"
    result = await _run_scanner_analysis_for_image(image_data_url=image_data_url)
    return {
        **result,
        "upload": _serialize_scan_upload(upload_row),
    }


def _normalize_selected_expiration(value: Optional[str]) -> str:
    return str(value or "").strip()[:16]


def _get_selected_expiration_seconds(value: Optional[str]) -> int:
    raw = str(value or "").strip().lower()
    match = re.match(r"^(\d+)\s*([smh])$", raw)
    if not match:
        return 0
    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        return 0
    if unit == "s":
        return amount
    if unit == "m":
        return amount * 60
    if unit == "h":
        return amount * 60 * 60
    return 0


def _datetime_to_iso(value: Any) -> Optional[str]:
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _get_settlement_outcome_label(outcome: Any) -> str:
    normalized = str(outcome or "").strip().lower()
    if normalized == "win":
        return "Победа"
    if normalized == "loss":
        return "Проигрыш"
    if normalized == "refund":
        return "Возврат"
    return "Не определено"


def _is_analysis_history_schema_error(exc: Exception) -> bool:
    error_code = getattr(exc, "args", [None])[0]
    return error_code in {1054, 1146}


def _serialize_analysis_history(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    created_at = row.get("created_at")
    archived_at = row.get("upload_archived_at")
    upload_id = int(row.get("upload_id") or 0)
    try:
        result_payload = json.loads(row.get("result_json") or "{}")
    except Exception:
        result_payload = {}
    if not isinstance(result_payload, dict):
        result_payload = {}
    settlement_payload = result_payload.get("settlement") if isinstance(result_payload.get("settlement"), dict) else None
    if not settlement_payload and row.get("settlement_status") == "settled":
        settlement_payload = {
            "status": "settled",
            "outcome": row.get("settlement_outcome") or "",
            "outcome_label": _get_settlement_outcome_label(row.get("settlement_outcome")),
            "direction": row.get("signal") or "",
            "entry_price": float(row.get("entry_price") or 0),
            "exit_price": float(row.get("exit_price") or 0),
            "selected_expiration": row.get("selected_expiration") or "",
            "settled_at": _datetime_to_iso(row.get("settled_at")),
        }
    return {
        "id": int(row.get("id") or 0),
        "source_type": row.get("source_type") or "scanner",
        "upload_id": upload_id or None,
        "preview_path": f"/api/upload/scan/{upload_id}/preview" if upload_id and not archived_at else "",
        "is_archived": bool(archived_at),
        "analysis_mode": row.get("analysis_mode") or "",
        "signal": row.get("signal") or "NO TRADE",
        "asset": row.get("asset") or "не определен",
        "market_mode": row.get("market_mode") or "MARKET",
        "entry_price": float(row.get("entry_price") or 0),
        "confidence": int(row.get("confidence") or 0),
        "expiration_minutes": int(row.get("expiration_minutes") or 0),
        "selected_expiration": row.get("selected_expiration") or "",
        "comment": row.get("comment") or "",
        "settlement_status": row.get("settlement_status") or "none",
        "settlement_due_at": _datetime_to_iso(row.get("settlement_due_at")),
        "settled_at": _datetime_to_iso(row.get("settled_at")),
        "remaining_seconds": int(row.get("remaining_seconds") if row.get("remaining_seconds") is not None else _get_analysis_due_remaining_seconds(row)),
        "settlement": settlement_payload,
        "result": result_payload,
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else (str(created_at) if created_at else None),
    }


async def _record_analysis_history(
    *,
    user_id: int,
    source_type: str,
    result_payload: Dict[str, Any],
    upload_id: Optional[int] = None,
    analysis_mode: str = "",
    selected_expiration: str = "",
) -> Optional[Dict[str, Any]]:
    result = result_payload.get("result") if isinstance(result_payload.get("result"), dict) else result_payload
    if not isinstance(result, dict):
        return None

    entry_price = result.get("entry_price")
    try:
        entry_price = float(entry_price) if entry_price is not None else None
    except (TypeError, ValueError):
        entry_price = None

    try:
        confidence = int(result.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    try:
        expiration_minutes = int(result.get("expiration_minutes") or 0)
    except (TypeError, ValueError):
        expiration_minutes = 0
    normalized_selected_expiration = _normalize_selected_expiration(selected_expiration)
    selected_expiration_seconds = _get_selected_expiration_seconds(normalized_selected_expiration)
    signal_value = str(result.get("signal") or "NO TRADE")[:16]
    signal_upper = signal_value.strip().upper()
    if signal_upper not in {"BUY", "SELL"}:
        return None
    is_settleable_signal = signal_upper in {"BUY", "SELL"} and bool(entry_price and entry_price > 0)
    settlement_due_seconds = selected_expiration_seconds if is_settleable_signal and selected_expiration_seconds > 0 else 0
    settlement_status = "pending" if settlement_due_seconds else "none"

    async def insert_history() -> Optional[Dict[str, Any]]:
        pool = await require_db_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    INSERT INTO analysis_history (
                        user_id, source_type, upload_id, analysis_mode, `signal`, asset,
                        market_mode, entry_price, confidence, expiration_minutes,
                        selected_expiration, settlement_status, settlement_due_at, comment, result_json
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        CASE WHEN %s > 0 THEN DATE_ADD(CURRENT_TIMESTAMP(), INTERVAL %s SECOND) ELSE NULL END,
                        %s, %s
                    )
                    """,
                    (
                        int(user_id),
                        (source_type or "scanner")[:16],
                        int(upload_id) if upload_id else None,
                        (analysis_mode or "")[:16],
                        signal_value,
                        str(result.get("asset") or "не определен")[:128],
                        str(result.get("market_mode") or "MARKET")[:16],
                        entry_price,
                        confidence,
                        expiration_minutes,
                        normalized_selected_expiration,
                        settlement_status,
                        settlement_due_seconds,
                        settlement_due_seconds,
                        str(result.get("comment") or "")[:2000],
                        json.dumps(result, ensure_ascii=False),
                    ),
                )
                history_id = int(cur.lastrowid or 0)
                await cur.execute(
                    """
                    SELECT ah.*, su.archived_at AS upload_archived_at
                    FROM analysis_history ah
                    LEFT JOIN scan_uploads su ON su.id = ah.upload_id
                    WHERE ah.id = %s
                    LIMIT 1
                    """,
                    (history_id,),
                )
                return await cur.fetchone()

    try:
        row = await insert_history()
    except Exception as exc:
        if not _is_analysis_history_schema_error(exc):
            raise
        pool = await require_db_pool()
        await ensure_database_schema(pool)
        row = await insert_history()
    return _serialize_analysis_history(row)


async def _count_pending_user_analyses(user_id: int) -> int:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT COUNT(*) AS total
                FROM analysis_history
                WHERE user_id = %s
                  AND settlement_status = 'pending'
                  AND settlement_due_at IS NOT NULL
                  AND UPPER(TRIM(COALESCE(`signal`, ''))) IN ('BUY', 'SELL')
                """,
                (int(user_id),),
            )
            row = await cur.fetchone()
    return int((row or {}).get("total") or 0)


async def _ensure_active_analysis_capacity(user_id: int) -> None:
    try:
        await settle_due_analysis_once()
    except Exception as exc:
        print(f"[AnalysisSettlement] capacity pre-settle failed: {exc}")
    limit = await get_active_signals_limit()
    active_count = await _count_pending_user_analyses(user_id)
    if active_count >= limit:
        raise HTTPException(
            status_code=409,
            detail=f"У вас уже {active_count} активных сигналов. Лимит: {limit}. Дождитесь завершения или откройте активный сигнал.",
        )


def _build_analysis_settlement_payload(
    *,
    signal: str,
    entry_price: float,
    exit_price: float,
    selected_expiration: str,
) -> Dict[str, Any]:
    normalized_signal = str(signal or "").strip().upper()
    delta = float(exit_price) - float(entry_price)
    tolerance = 1e-10

    if abs(delta) <= tolerance:
        outcome = "refund"
        outcome_label = "Возврат"
    elif normalized_signal == "BUY":
        outcome = "win" if delta > 0 else "loss"
        outcome_label = "Победа" if outcome == "win" else "Проигрыш"
    elif normalized_signal == "SELL":
        outcome = "win" if delta < 0 else "loss"
        outcome_label = "Победа" if outcome == "win" else "Проигрыш"
    else:
        outcome = "unknown"
        outcome_label = "Не определено"

    return {
        "status": "settled",
        "outcome": outcome,
        "outcome_label": outcome_label,
        "direction": normalized_signal,
        "entry_price": float(entry_price),
        "exit_price": float(exit_price),
        "price_delta": delta,
        "selected_expiration": _normalize_selected_expiration(selected_expiration),
        "settled_at": datetime.now(timezone.utc).isoformat(),
    }


def _get_analysis_due_remaining_seconds(row: Dict[str, Any]) -> int:
    due_at = row.get("settlement_due_at")
    if not due_at:
        return 0
    if not isinstance(due_at, datetime):
        try:
            due_at = datetime.fromisoformat(str(due_at))
        except ValueError:
            return 0
    now_value = datetime.now(due_at.tzinfo) if due_at.tzinfo else datetime.now()
    return max(0, int(round((due_at - now_value).total_seconds())))


async def _fetch_analysis_history_row(history_id: int, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            params: List[Any] = [int(history_id)]
            user_filter = ""
            if user_id is not None:
                user_filter = "AND ah.user_id = %s"
                params.append(int(user_id))
            await cur.execute(
                f"""
                SELECT ah.*, su.archived_at AS upload_archived_at
                FROM analysis_history ah
                LEFT JOIN scan_uploads su ON su.id = ah.upload_id
                WHERE ah.id = %s {user_filter}
                LIMIT 1
                """,
                tuple(params),
            )
            return await cur.fetchone()


async def _settle_analysis_history_row(row: Dict[str, Any]) -> Dict[str, Any]:
    history_id = int(row.get("id") or 0)
    user_id = int(row.get("user_id") or 0)
    signal = str(row.get("signal") or "").strip().upper()
    if not history_id or signal not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Only BUY or SELL analyses can be settled")

    try:
        entry_price = float(row.get("entry_price") or 0)
    except (TypeError, ValueError):
        entry_price = 0.0
    if entry_price <= 0:
        raise HTTPException(status_code=400, detail="Entry price is missing")

    existing_payload: Dict[str, Any]
    try:
        existing_payload = json.loads(row.get("result_json") or "{}")
    except Exception:
        existing_payload = {}
    if not isinstance(existing_payload, dict):
        existing_payload = {}
    existing_settlement = existing_payload.get("settlement")
    if row.get("settlement_status") == "settled" and isinstance(existing_settlement, dict):
        return existing_settlement
    if row.get("settlement_status") == "settled" and row.get("exit_price"):
        return _build_analysis_settlement_payload(
            signal=signal,
            entry_price=entry_price,
            exit_price=float(row.get("exit_price") or 0),
            selected_expiration=row.get("selected_expiration") or "",
        )

    price_request = _resolve_scanner_price_request(row.get("asset"), row.get("market_mode"))
    if not price_request:
        raise HTTPException(status_code=400, detail="Unable to resolve market pair for settlement")

    exit_price = await _fetch_quote_price(price_request["category"], price_request["symbol"])
    if not exit_price or exit_price <= 0:
        raise HTTPException(status_code=502, detail="Unable to fetch final quote price")

    selected_expiration = row.get("selected_expiration") or ""
    settlement = _build_analysis_settlement_payload(
        signal=signal,
        entry_price=entry_price,
        exit_price=float(exit_price),
        selected_expiration=selected_expiration,
    )
    existing_payload["settlement"] = settlement

    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                UPDATE analysis_history
                SET result_json = %s,
                    settlement_status = 'settled',
                    settlement_outcome = %s,
                    exit_price = %s,
                    settled_at = CURRENT_TIMESTAMP()
                WHERE id = %s AND user_id = %s
                """,
                (
                    json.dumps(existing_payload, ensure_ascii=False),
                    settlement.get("outcome"),
                    float(exit_price),
                    history_id,
                    user_id,
                ),
            )
    return settlement


async def settle_due_analysis_once(limit: int = 50) -> int:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT ah.*, su.archived_at AS upload_archived_at
                FROM analysis_history ah
                LEFT JOIN scan_uploads su ON su.id = ah.upload_id
                WHERE ah.settlement_status = 'pending'
                  AND ah.settlement_due_at IS NOT NULL
                  AND ah.settlement_due_at <= CURRENT_TIMESTAMP()
                  AND UPPER(TRIM(COALESCE(ah.`signal`, ''))) IN ('BUY', 'SELL')
                ORDER BY ah.settlement_due_at ASC
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = await cur.fetchall()

    settled = 0
    for row in rows:
        try:
            await _settle_analysis_history_row(row)
            settled += 1
        except Exception as exc:
            print(f"[AnalysisSettlement] failed for history #{row.get('id')}: {exc}")
    return settled


async def analysis_settlement_loop() -> None:
    while True:
        try:
            await settle_due_analysis_once()
        except Exception as exc:
            print(f"[AnalysisSettlement] loop failed: {exc}")
        await asyncio.sleep(10)


def _normalize_telegram_support_url(value: Any, fallback: str) -> str:
    url = str(value or "").strip() or fallback
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Support link must start with https://t.me/")
    if parsed.netloc.lower() not in {"t.me", "telegram.me"}:
        raise HTTPException(status_code=400, detail="Only Telegram support links are allowed")
    if parsed.scheme == "http":
        url = f"https://{parsed.netloc}{parsed.path}"
        if parsed.query:
            url = f"{url}?{parsed.query}"
    return url


def _normalize_external_url(value: Any, fallback: str = "") -> str:
    url = str(value or "").strip() or fallback
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Registration link must start with https://")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Registration link host is missing")
    if parsed.scheme == "http":
        url = f"https://{parsed.netloc}{parsed.path}"
        if parsed.query:
            url = f"{url}?{parsed.query}"
    return url


async def get_support_settings_payload() -> Dict[str, str]:
    channel_url = await get_app_setting("support_channel_url", DEFAULT_SUPPORT_CHANNEL_URL)
    support_url = await get_app_setting("support_contact_url", DEFAULT_SUPPORT_CONTACT_URL)
    return {
        "channel_url": _normalize_telegram_support_url(channel_url, DEFAULT_SUPPORT_CHANNEL_URL),
        "support_url": _normalize_telegram_support_url(support_url, DEFAULT_SUPPORT_CONTACT_URL),
    }


async def get_registration_settings_payload() -> Dict[str, str]:
    registration_url = await get_app_setting("registration_url", DEFAULT_REGISTRATION_URL)
    return {
        "registration_url": _normalize_external_url(registration_url, DEFAULT_REGISTRATION_URL),
    }


def _coerce_bool_flag(value: Any, default: int = 0) -> int:
    if value is None:
        return 1 if int(default or 0) == 1 else 0
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw in {"1", "true", "yes", "on", "enabled"}:
            return 1
        if raw in {"0", "false", "no", "off", "disabled"}:
            return 0
    try:
        return 1 if int(value) == 1 else 0
    except (TypeError, ValueError):
        return 1 if int(default or 0) == 1 else 0


def _normalize_news_lead_minutes(value: Any) -> int:
    try:
        lead = int(value)
    except (TypeError, ValueError):
        lead = 15
    if lead in NEWS_NOTIFICATION_LEAD_OPTIONS:
        return lead
    return 15


def _news_notification_payload(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    row = row or {}
    return {
        "news_enabled": _coerce_bool_flag(row.get("news_enabled"), 0),
        "signals_enabled": _coerce_bool_flag(row.get("signals_enabled"), 1),
        "economic_enabled": _coerce_bool_flag(row.get("economic_enabled"), 1),
        "market_enabled": _coerce_bool_flag(row.get("market_enabled"), 1),
        "impact_high_enabled": _coerce_bool_flag(row.get("impact_high_enabled"), 1),
        "impact_medium_enabled": _coerce_bool_flag(row.get("impact_medium_enabled"), 1),
        "impact_low_enabled": _coerce_bool_flag(row.get("impact_low_enabled"), 1),
        "lead_minutes": _normalize_news_lead_minutes(row.get("lead_minutes")),
        "lead_options": list(NEWS_NOTIFICATION_LEAD_OPTIONS),
        "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
    }


async def get_user_news_notification_settings(user_id: int) -> Dict[str, Any]:
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT
                    news_enabled,
                    signals_enabled,
                    signals_enabled_at,
                    economic_enabled,
                    market_enabled,
                    impact_high_enabled,
                    impact_medium_enabled,
                    impact_low_enabled,
                    lead_minutes,
                    updated_at
                FROM user_notification_settings
                WHERE user_id = %s
                LIMIT 1
                """,
                (int(user_id),),
            )
            row = await cur.fetchone()
    return _news_notification_payload(row)


async def update_user_news_notification_settings(user_id: int, payload: UserNewsNotificationSettingsUpdate) -> Dict[str, Any]:
    news_enabled = _coerce_bool_flag(payload.news_enabled, 0)
    signals_enabled = _coerce_bool_flag(payload.signals_enabled, 1)
    economic_enabled = _coerce_bool_flag(payload.economic_enabled, 1)
    market_enabled = _coerce_bool_flag(payload.market_enabled, 1)
    impact_high_enabled = _coerce_bool_flag(payload.impact_high_enabled, 1)
    impact_medium_enabled = _coerce_bool_flag(payload.impact_medium_enabled, 1)
    impact_low_enabled = _coerce_bool_flag(payload.impact_low_enabled, 1)
    lead_minutes = _normalize_news_lead_minutes(payload.lead_minutes)
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO user_notification_settings
                    (
                        user_id, news_enabled, signals_enabled, economic_enabled, market_enabled,
                        impact_high_enabled, impact_medium_enabled, impact_low_enabled, lead_minutes,
                        signals_enabled_at
                    )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CASE WHEN %s = 1 THEN CURRENT_TIMESTAMP() ELSE NULL END)
                ON DUPLICATE KEY UPDATE
                    news_enabled = VALUES(news_enabled),
                    signals_enabled_at = CASE
                        WHEN VALUES(signals_enabled) = 1
                         AND (COALESCE(signals_enabled, 0) = 0 OR signals_enabled_at IS NULL)
                        THEN CURRENT_TIMESTAMP()
                        ELSE signals_enabled_at
                    END,
                    signals_enabled = VALUES(signals_enabled),
                    economic_enabled = VALUES(economic_enabled),
                    market_enabled = VALUES(market_enabled),
                    impact_high_enabled = VALUES(impact_high_enabled),
                    impact_medium_enabled = VALUES(impact_medium_enabled),
                    impact_low_enabled = VALUES(impact_low_enabled),
                    lead_minutes = VALUES(lead_minutes)
                """,
                (
                    int(user_id),
                    news_enabled,
                    signals_enabled,
                    economic_enabled,
                    market_enabled,
                    impact_high_enabled,
                    impact_medium_enabled,
                    impact_low_enabled,
                    lead_minutes,
                    signals_enabled,
                ),
            )
            await cur.execute("UPDATE users SET last_active_at = NOW() WHERE user_id = %s", (int(user_id),))
    return await get_user_news_notification_settings(user_id)


async def get_market_sync_interval_min() -> int:
    raw = await get_app_setting("market_pairs_sync_interval_min", str(DEFAULT_MARKET_SYNC_INTERVAL_MIN))
    return _sanitize_market_sync_interval_min(raw)


def _market_enabled_setting_key(kind: str) -> str:
    return f"market_enabled_{_pair_kind_normalized(kind)}"


async def get_market_enabled_map() -> Dict[str, int]:
    settings = {key: 1 for key in MARKET_KIND_CONFIG}
    setting_to_kind = {_market_enabled_setting_key(key): key for key in MARKET_KIND_CONFIG}
    placeholders = ",".join(["%s"] * len(setting_to_kind))
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                f"SELECT `key`, value_text FROM app_settings WHERE `key` IN ({placeholders})",
                tuple(setting_to_kind.keys()),
            )
            rows = await cur.fetchall()
    for row in rows or []:
        kind = setting_to_kind.get(str(row.get("key") or ""))
        if kind:
            settings[kind] = 1 if str(row.get("value_text") or "1").strip() == "1" else 0
    return settings


async def set_market_enabled(kind: str, enabled: int) -> str:
    raw = str(kind or "").strip().lower()
    if raw not in MARKET_KIND_CONFIG and raw not in MARKET_KIND_ALIASES:
        raise HTTPException(status_code=400, detail="Unsupported market")
    pair_kind = _pair_kind_normalized(raw)
    await set_app_setting(_market_enabled_setting_key(pair_kind), "1" if int(enabled or 0) == 1 else "0")
    return pair_kind


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


def _merge_expiration_options(*groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        if not isinstance(group, list):
            continue
        for item in group:
            if not isinstance(item, dict):
                continue
            value = str(item.get("value") or "").strip().lower()
            label = str(item.get("label") or value).strip()
            if not value or value in seen:
                continue
            seen.add(value)
            merged.append({"value": value, "label": label or value})
    return merged or [{"value": "5m", "label": "5m"}]


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
    defaults = _merge_expiration_options(
        parse_expiration_options(CORE_EXPIRATION_OPTIONS),
        parse_expiration_options(EXPIRATION_OPTIONS),
    )
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
    return _merge_expiration_options(defaults, parsed)


async def _fetch_quote_history(category: str, symbol: str, history_seconds: int) -> Dict[str, Any]:
    if not DEVSBITE_CLIENT_TOKEN:
        raise HTTPException(status_code=503, detail="Quote history is not configured")

    normalized_category = normalize_quote_category(category)
    normalized_symbol = normalize_quote_symbol(_strip_otc_suffix(symbol))
    normalized_history_seconds = max(int(history_seconds or QUOTE_HISTORY_SECONDS), 60)
    url = f"{DEVSBITE_API_BASE_URL}/quotes/quote"
    headers = {
        "accept": "application/json",
        "X-Client-Token": DEVSBITE_CLIENT_TOKEN,
        "Cache-Control": "no-cache",
    }
    params = {
        "category": normalized_category,
        "symbol": normalized_symbol,
        "history_seconds": normalized_history_seconds,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=12.0)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text.strip() if exc.response is not None else ""
        raise HTTPException(status_code=502, detail=detail or "Quote history request failed") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Quote history request failed") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Quote history response is invalid")

    payload.setdefault("category", normalized_category)
    payload.setdefault("requested_symbol", normalized_symbol)
    payload.setdefault("resolved_symbol", normalized_symbol)
    return payload


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
    enabled_map = await get_market_enabled_map()
    for kind in MARKET_KIND_CONFIG:
        if int(enabled_map.get(kind, 1)) != 1:
            result[kind] = False
            continue
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
    enabled_map = await get_market_enabled_map()
    available_markets = [
        {"key": key, "title": value["title"]}
        for key, value in MARKET_KIND_CONFIG.items()
        if int(enabled_map.get(key, 1)) == 1
    ]
    if available_markets and int(enabled_map.get(pair_kind, 1)) != 1:
        pair_kind = available_markets[0]["key"]

    if not available_markets:
        expirations = await _fetch_expiration_options()
        return {
            "kind": pair_kind,
            "market_title": MARKET_KIND_CONFIG.get(pair_kind, MARKET_KIND_CONFIG["forex"])["title"],
            "available_markets": [],
            "pairs": [],
            "expirations": expirations,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    pairs = await _get_active_pairs_from_db(pair_kind, min_payout)
    if not pairs:
        await sync_market_pairs_kind(pair_kind, min_payout)
        pairs = await _get_active_pairs_from_db(pair_kind, min_payout)

    expirations = await _fetch_expiration_options()
    payload = {
        "kind": pair_kind,
        "market_title": MARKET_KIND_CONFIG.get(pair_kind, MARKET_KIND_CONFIG["forex"])["title"],
        "available_markets": available_markets,
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
        if row.get("code") in INDICATOR_ANALYSIS_SUPPORTED_CODES and row.get("title")
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
        if row.get("code") in INDICATOR_ANALYSIS_SUPPORTED_CODES and row.get("title")
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
    return await get_support_settings_payload()


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


@app.get("/api/statuses")
async def get_public_statuses(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    profile = await fetch_user_profile(int(user["user_id"]))
    statuses = await list_account_statuses(include_disabled=False)
    registration_settings = await get_registration_settings_payload()
    current_status = profile.get("account_status") or {}
    current_code = _normalize_status_code(profile.get("account_tier") or current_status.get("code") or "trader")
    if current_status and current_code not in {_normalize_status_code(item.get("code")) for item in statuses}:
        statuses = [current_status, *statuses]
    current_order = int(current_status.get("sort_order") or 0)
    return {
        "status": "success",
        "current_status": current_status,
        "current_status_code": profile.get("account_tier") or "trader",
        "items": statuses,
        "available_items": [
            {
                **item,
                "is_current": int(_normalize_status_code(item.get("code")) == _normalize_status_code(profile.get("account_tier"))),
                "is_unlocked": int(int(item.get("sort_order") or 0) <= current_order),
            }
            for item in statuses
        ],
        "trader_id": profile.get("trader_id") or "",
        "registration_url": registration_settings.get("registration_url") or "",
    }


@app.post("/api/user/trader-id")
async def update_user_trader_id(
    payload: UserTraderIdUpdate,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    trader_id = (payload.trader_id or "").strip() or None
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET trader_id = %s,
                    last_active_at = NOW()
                WHERE user_id = %s
                """,
                (trader_id, user_id),
            )
    return {"status": "success", "user": await fetch_user_profile(user_id)}


@app.post("/api/user/onboarding/seen")
async def mark_onboarding_seen(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET onboarding_seen = 1,
                    last_active_at = NOW()
                WHERE user_id = %s
                """,
                (user_id,),
            )
    return {"status": "success", "user": await fetch_user_profile(user_id)}


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


@app.post("/api/user/signal-mode")
async def update_user_signal_mode(
    payload: UserSignalModeUpdate,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    mode = _normalize_preferred_signal_mode(payload.mode)
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET preferred_signal_mode = %s,
                    last_active_at = NOW()
                WHERE user_id = %s
                """,
                (mode, user_id),
            )
    return {"status": "success", "mode": mode, "user": await fetch_user_profile(user_id)}


@app.get("/api/user/news-notifications")
async def get_user_news_notifications(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    return await get_user_news_notification_settings(int(user["user_id"]))


@app.post("/api/user/news-notifications")
async def update_user_news_notifications(
    payload: UserNewsNotificationSettingsUpdate,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    settings = await update_user_news_notification_settings(int(user["user_id"]), payload)
    return {"status": "success", "settings": settings}


@app.get("/api/upload/scan/latest")
async def get_latest_scan_upload(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT *
                FROM scan_uploads
                WHERE user_id = %s AND is_current = 1
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """,
                (user_id,),
            )
            row = await cur.fetchone()
    return {"file": _serialize_scan_upload(row)}


@app.delete("/api/upload/scan/latest")
async def reset_latest_scan_upload(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE scan_uploads SET is_current = 0 WHERE user_id = %s AND is_current = 1",
                (user_id,),
            )
    return {"status": "success", "file": None}


@app.post("/api/upload/scan")
async def upload_scan_file(
    source_type: str = Form(default="gallery"),
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    normalized_source = _normalize_scan_upload_source(source_type)
    if normalized_source == "link":
        raise HTTPException(status_code=400, detail="Use link upload endpoint for URL uploads")
    original_name = (file.filename or f"{normalized_source}-chart").strip()
    content_type = (file.content_type or "").strip().lower()
    try:
        saved_file = await _save_scan_upload_file(
            user_id=user_id,
            source_type=normalized_source,
            original_name=original_name,
            content_type=content_type,
            chunks=_upload_file_chunks(file),
        )
    finally:
        await file.close()
    return {"status": "success", "file": saved_file}


@app.post("/api/upload/scan/link")
async def upload_scan_from_link(
    payload: ScanLinkUploadRequest,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    source_url = (payload.url or "").strip()
    parsed = urlparse(source_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": "SonicFX-MiniApp/1.0"},
            timeout=httpx.Timeout(15.0, connect=6.0),
        ) as client:
            async with client.stream("GET", source_url) as response:
                if response.status_code != 200:
                    raise HTTPException(status_code=400, detail="Unable to download file from URL")
                content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
                if content_type in {"text/html", "application/json", "text/plain"}:
                    raise HTTPException(status_code=415, detail="URL does not point to an image file")
                content_length = response.headers.get("content-length")
                if content_length:
                    try:
                        if int(content_length) > SCAN_UPLOAD_MAX_BYTES:
                            raise HTTPException(status_code=413, detail="File is too large")
                    except ValueError:
                        pass

                final_url = str(response.url)
                original_name = Path(urlparse(final_url).path).name or "linked-chart"

                async def response_chunks():
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                        yield chunk

                saved_file = await _save_scan_upload_file(
                    user_id=user_id,
                    source_type="link",
                    original_name=original_name,
                    content_type=content_type,
                    chunks=response_chunks(),
                    source_url=final_url,
                )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to download file from URL") from exc

    return {"status": "success", "file": saved_file}


@app.post("/api/analyze/scanner")
async def analyze_scanner_chart(
    payload: ScannerAnalyzeRequest,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    await ensure_status_analysis_access(user_id, "scanner")
    await _ensure_active_analysis_capacity(user_id)
    result = await run_scanner_analysis_for_upload(user_id=user_id, upload_id=payload.upload_id)
    response = {"status": "success", **result}
    try:
        history_item = await _record_analysis_history(
            user_id=user_id,
            source_type="scanner",
            upload_id=int(result.get("upload", {}).get("id") or payload.upload_id or 0) or None,
            result_payload=result,
            analysis_mode=str(result.get("mode") or ""),
            selected_expiration=payload.selected_expiration or "",
        )
        if history_item:
            response["history_item"] = history_item
    except Exception as exc:
        print(f"[AnalysisHistory] failed to save scanner analysis: {exc}")
    return response


@app.post("/api/analyze/auto")
async def analyze_auto_chart(
    payload: AutoAnalyzeRequest,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    await ensure_status_analysis_access(user_id, "automatic")
    await _ensure_active_analysis_capacity(user_id)
    content_type, _raw_data_url, image_bytes = _decode_scan_image_data_url(payload.image_data_url)
    upload_row: Optional[Dict[str, Any]] = None
    try:
        safe_symbol = re.sub(r"[^A-Za-z0-9]+", "", payload.symbol or "")[:24] or "chart"
        upload_row = await _save_scan_upload_bytes(
            user_id=user_id,
            source_type="auto",
            original_name=f"live-{safe_symbol}.png",
            content_type=content_type,
            payload=image_bytes,
            is_current=False,
        )
    except Exception as exc:
        print(f"[AnalysisHistory] failed to save live chart snapshot: {exc}")
    result = await _run_scanner_analysis_for_image(
        image_data_url=payload.image_data_url,
        known_category=payload.category,
        known_symbol=payload.symbol,
    )
    response = {"status": "success", **result, "source": "auto"}
    if upload_row:
        response["upload"] = upload_row
    try:
        history_item = await _record_analysis_history(
            user_id=user_id,
            source_type="auto",
            upload_id=int(upload_row.get("id") or 0) if upload_row else None,
            result_payload=result,
            analysis_mode=str(result.get("mode") or ""),
            selected_expiration=payload.selected_expiration or "",
        )
        if history_item:
            response["history_item"] = history_item
    except Exception as exc:
        print(f"[AnalysisHistory] failed to save auto analysis: {exc}")
    return response


@app.post("/api/analyze/indicators")
async def analyze_indicator_signal(
    payload: IndicatorAnalyzeRequest,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    await ensure_status_analysis_access(user_id, "indicators")
    await _ensure_active_analysis_capacity(user_id)
    result = await run_indicator_analysis(
        category=payload.category,
        symbol=payload.symbol,
        indicator_code=payload.indicator_code,
        selected_expiration=payload.selected_expiration,
        interval=payload.interval,
    )
    response = {"status": "success", **result, "source": "indicators"}
    try:
        history_item = await _record_analysis_history(
            user_id=user_id,
            source_type="indicators",
            upload_id=None,
            result_payload=result,
            analysis_mode=str(result.get("mode") or "indicators"),
            selected_expiration=payload.selected_expiration or "",
        )
        if history_item:
            response["history_item"] = history_item
    except Exception as exc:
        print(f"[AnalysisHistory] failed to save indicator analysis: {exc}")
    return response


@app.get("/api/analysis/history")
async def get_analysis_history(
    limit: int = Query(default=20, ge=1, le=20),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    try:
        await settle_due_analysis_once()
    except Exception as exc:
        print(f"[AnalysisSettlement] history pre-settle failed: {exc}")
    user_id = int(user["user_id"])

    async def fetch_rows() -> List[Dict[str, Any]]:
        pool = await require_db_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT ah.*, su.archived_at AS upload_archived_at
                    FROM analysis_history ah
                    LEFT JOIN scan_uploads su ON su.id = ah.upload_id
                    WHERE ah.user_id = %s
                      AND UPPER(TRIM(COALESCE(ah.`signal`, 'NO TRADE'))) <> 'NO TRADE'
                      AND TRIM(COALESCE(ah.`signal`, '')) <> ''
                    ORDER BY ah.created_at DESC, ah.id DESC
                    LIMIT %s
                    """,
                    (user_id, int(limit)),
                )
                return await cur.fetchall()

    try:
        rows = await fetch_rows()
    except Exception as exc:
        if not _is_analysis_history_schema_error(exc):
            raise
        pool = await require_db_pool()
        await ensure_database_schema(pool)
        rows = await fetch_rows()
    return {"items": [_serialize_analysis_history(row) for row in rows if row]}


@app.get("/api/analysis/active")
async def get_active_analysis(
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    try:
        await settle_due_analysis_once()
    except Exception as exc:
        print(f"[AnalysisSettlement] active pre-settle failed: {exc}")
    user_id = int(user["user_id"])
    active_limit = await get_active_signals_limit()

    async def fetch_active() -> List[Dict[str, Any]]:
        pool = await require_db_pool()
        async with pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT ah.*, su.archived_at AS upload_archived_at,
                           GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(), ah.settlement_due_at)) AS remaining_seconds
                    FROM analysis_history ah
                    LEFT JOIN scan_uploads su ON su.id = ah.upload_id
                    WHERE ah.user_id = %s
                      AND ah.settlement_status = 'pending'
                      AND ah.settlement_due_at IS NOT NULL
                      AND UPPER(TRIM(COALESCE(ah.`signal`, ''))) IN ('BUY', 'SELL')
                    ORDER BY ah.created_at DESC, ah.id DESC
                    LIMIT %s
                    """,
                    (user_id, active_limit),
                )
                return await cur.fetchall()

    try:
        rows = await fetch_active()
    except Exception as exc:
        if not _is_analysis_history_schema_error(exc):
            raise
        pool = await require_db_pool()
        await ensure_database_schema(pool)
        rows = await fetch_active()

    items = [_serialize_analysis_history(row) for row in rows if row]
    items = [item for item in items if item]
    if not items:
        return {"item": None, "items": [], "active_limit": active_limit, "active_count": 0}

    item = items[0]
    return {
        "item": item,
        "items": items,
        "active_limit": active_limit,
        "active_count": len(items),
        "remaining_seconds": int(item.get("remaining_seconds") or 0),
    }


@app.post("/api/analysis/history/{history_id}/settle")
async def settle_analysis_history_item(
    history_id: int,
    payload: AnalysisSettlementRequest,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    user_id = int(user["user_id"])
    row = await _fetch_analysis_history_row(history_id, user_id)

    if not row:
        raise HTTPException(status_code=404, detail="Analysis history item not found")

    try:
        settlement = await _settle_analysis_history_row(row)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to settle analysis: {exc}") from exc

    updated_row = await _fetch_analysis_history_row(history_id, user_id)

    return {"status": "success", "item": _serialize_analysis_history(updated_row), "settlement": settlement}


@app.get("/api/upload/scan/{upload_id}/preview")
async def get_scan_upload_preview(
    upload_id: int,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    requester_id = int(user["user_id"])
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT id, user_id, file_path, content_type, archived_at
                FROM scan_uploads
                WHERE id = %s
                LIMIT 1
                """,
                (int(upload_id),),
            )
            row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Uploaded file not found")

    owner_id = int(row.get("user_id") or 0)
    if requester_id != owner_id and not await is_admin_user(requester_id):
        raise HTTPException(status_code=403, detail="Upload access denied")
    if row.get("archived_at"):
        raise HTTPException(status_code=410, detail="Uploaded file has been archived")

    target = Path(row.get("file_path") or "").resolve()
    scan_root = scan_upload_dir.resolve()
    try:
        target.relative_to(scan_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid upload path") from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Uploaded file not found")

    media_type = (row.get("content_type") or "").split(";", 1)[0].strip().lower() or None
    return FileResponse(target, media_type=media_type)


@app.get("/api/uploads/scan/{owner_id}/{filename}")
async def get_scan_upload_file(
    owner_id: int,
    filename: str,
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    requester_id = int(user["user_id"])
    if requester_id != int(owner_id) and not await is_admin_user(requester_id):
        raise HTTPException(status_code=403, detail="Upload access denied")
    if "/" in filename or "\\" in filename or filename in {"", ".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid file name")

    owner_dir = (scan_upload_dir / str(owner_id)).resolve()
    target = (owner_dir / filename).resolve()
    if target.parent != owner_dir or not target.is_file():
        raise HTTPException(status_code=404, detail="Uploaded file not found")
    return FileResponse(target)


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


@app.get("/api/quotes/config")
async def get_quotes_config(user: Dict[str, Any] = Depends(get_telegram_user)):
    await upsert_user_from_telegram(user)
    return {
        "enabled": quotes_hub.enabled,
        "websocket_url": get_ws_quote_backend_url(),
        "transport": {
            "upstream": DEVSBITE_QUOTES_WS_URL,
            "mode": "fanout",
        },
        "supported_categories": sorted(SUPPORTED_QUOTE_CATEGORIES),
        "history_seconds": QUOTE_HISTORY_SECONDS,
        "replace_debounce_ms": QUOTE_REPLACE_DEBOUNCE_MS,
        "ping_interval_sec": 25,
        "state": quotes_hub.snapshot_state(),
    }


@app.get("/api/quotes/history")
async def get_quotes_history(
    category: str = Query(...),
    symbol: str = Query(...),
    history_seconds: int = Query(default=QUOTE_HISTORY_SECONDS, ge=60, le=7200),
    user: Dict[str, Any] = Depends(get_telegram_user),
):
    await upsert_user_from_telegram(user)
    payload = await _fetch_quote_history(category=category, symbol=symbol, history_seconds=history_seconds)
    return {
        "event": "snapshot",
        "data": payload,
    }


@app.websocket("/api/ws/quotes")
async def quotes_stream_socket(websocket: WebSocket):
    init_data = (
        (websocket.query_params.get("tg_init_data") or "").strip()
        or (websocket.headers.get("x-tg-init-data") or "").strip()
    )
    try:
        tg_user = verify_telegram_init_data(init_data)
    except HTTPException:
        await websocket.close(code=4401, reason="Telegram auth required")
        return

    await websocket.accept()
    await upsert_user_from_telegram(tg_user)

    if not quotes_hub.enabled:
        await websocket.send_json({"event": "error", "detail": "Quote stream token is not configured"})
        await websocket.close(code=1011)
        return

    client_id = await quotes_hub.register_client(websocket)
    await websocket.send_json(
        {
            "event": "ready",
            "client_id": client_id,
            "history_seconds": QUOTE_HISTORY_SECONDS,
            "supported_categories": sorted(SUPPORTED_QUOTE_CATEGORIES),
        }
    )

    try:
        while True:
            try:
                payload = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except Exception:
                await websocket.send_json({"event": "error", "detail": "Malformed websocket payload"})
                continue

            if not isinstance(payload, dict):
                await websocket.send_json({"event": "error", "detail": "Websocket payload must be an object"})
                continue

            action = str(payload.get("action") or "").strip().lower()
            if action == "ping":
                await websocket.send_json({"event": "pong", "ts": int(time.time())})
                continue

            try:
                error_payload = await quotes_hub.handle_client_action(client_id, action, payload)
            except ValueError as exc:
                error_payload = {"event": "error", "detail": str(exc)}
            except Exception:
                error_payload = {"event": "error", "detail": "Unable to process quote subscription command"}

            if error_payload:
                await websocket.send_json(error_payload)
    finally:
        await quotes_hub.unregister_client(client_id)


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


def _format_news_notification_time(value: Any, timezone_name: Any) -> str:
    zone_name = str(timezone_name or "").strip() or "UTC"
    try:
        user_zone = ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        user_zone = timezone.utc
        zone_name = "UTC"

    if isinstance(value, datetime):
        event_time = value
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
        return f"{event_time.astimezone(user_zone).strftime('%d.%m %H:%M')} ({zone_name})"
    text = str(value or "").strip()
    return text or "-"


def _format_news_notification_message(row: Dict[str, Any]) -> str:
    feed_type = str(row.get("feed_type") or "").strip().lower()
    title = html.escape(str(row.get("title") or "Новость").strip())
    source_name = html.escape(str(row.get("source_name") or "SonicFX").strip())
    published_at = _format_news_notification_time(row.get("published_at"), row.get("timezone"))

    if feed_type == "economic":
        lead = _normalize_news_lead_minutes(row.get("lead_minutes"))
        currency = html.escape(str(row.get("currency_code") or row.get("country_code") or "").strip())
        impact = html.escape(str(row.get("impact_level") or "").strip())
        header = f"<b>SonicFX News</b>\nЗа {lead} мин до события"
        details = [f"<b>{title}</b>", f"Время: {html.escape(published_at)}"]
        if currency:
            details.append(f"Актив: {currency}")
        if impact:
            details.append(f"Важность: {impact}")
    else:
        category = html.escape(str(row.get("news_category") or "general").strip())
        header = "<b>SonicFX News</b>\nСвежая общерыночная новость"
        details = [f"<b>{title}</b>", f"Категория: {category}", f"Время: {html.escape(published_at)}"]

    if source_name:
        details.append(f"Источник: {source_name}")
    return f"{header}\n\n" + "\n".join(details)


def _build_news_notification_keyboard(row: Dict[str, Any]) -> Optional[InlineKeyboardMarkup]:
    source_url = str(row.get("source_url") or "").strip()
    if not source_url.startswith(("http://", "https://")):
        return None
    button = _build_inline_button(text="Открыть новость", url=source_url, style="danger")
    return InlineKeyboardMarkup(inline_keyboard=[[button]])


def _news_notification_media_url(row: Dict[str, Any]) -> str:
    image_url = str(row.get("image_url") or "").strip()
    if image_url.startswith(("http://", "https://")):
        return image_url
    return ""


async def send_due_news_notifications_once() -> int:
    if bot is None:
        return 0
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT
                    s.user_id,
                    s.lead_minutes,
                    u.timezone,
                    n.id AS news_item_id,
                    n.feed_type,
                    n.news_category,
                    n.title,
                    n.image_url,
                    n.source_name,
                    n.source_url,
                    n.country_code,
                    n.currency_code,
                    n.impact_level,
                    n.published_at,
                    CASE WHEN n.feed_type = 'economic' THEN s.lead_minutes ELSE 0 END AS delivery_lead_minutes
                FROM user_notification_settings s
                INNER JOIN users u ON u.user_id = s.user_id AND COALESCE(u.is_blocked, 0) = 0
                INNER JOIN news_items n ON n.is_visible = 1 AND n.published_at IS NOT NULL
                LEFT JOIN news_notification_deliveries d
                  ON d.user_id = s.user_id
                 AND d.news_item_id = n.id
                 AND d.lead_minutes = CASE WHEN n.feed_type = 'economic' THEN s.lead_minutes ELSE 0 END
                WHERE s.news_enabled = 1
                  AND d.id IS NULL
                  AND (
                    (
                      n.feed_type = 'economic'
                      AND s.economic_enabled = 1
                      AND (
                        (
                          COALESCE(NULLIF(n.impact_level, ''), 'medium') = 'high'
                          AND s.impact_high_enabled = 1
                        )
                        OR (
                          COALESCE(NULLIF(n.impact_level, ''), 'medium') = 'medium'
                          AND s.impact_medium_enabled = 1
                        )
                        OR (
                          COALESCE(NULLIF(n.impact_level, ''), 'medium') = 'low'
                          AND s.impact_low_enabled = 1
                        )
                      )
                      AND TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), n.published_at)
                          BETWEEN GREATEST(s.lead_minutes * 60 - 90, 0) AND s.lead_minutes * 60 + 90
                    )
                    OR
                    (
                      n.feed_type = 'market'
                      AND s.market_enabled = 1
                      AND n.published_at BETWEEN DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 MINUTE) AND UTC_TIMESTAMP()
                    )
                  )
                ORDER BY n.published_at ASC
                LIMIT 200
                """
            )
            rows = await cur.fetchall()

    sent = 0
    for row in rows or []:
        user_id = int(row.get("user_id") or 0)
        news_item_id = int(row.get("news_item_id") or 0)
        delivery_lead = int(row.get("delivery_lead_minutes") or 0)
        if not user_id or not news_item_id:
            continue
        message = _format_news_notification_message(row)
        keyboard = _build_news_notification_keyboard(row)
        media_url = _news_notification_media_url(row)
        try:
            if media_url:
                try:
                    await bot.send_photo(
                        chat_id=user_id,
                        photo=media_url,
                        caption=message,
                        parse_mode="HTML",
                        reply_markup=keyboard,
                    )
                except Exception as media_exc:
                    print(f"[Bot] news notification media fallback for {user_id}: {media_exc}")
                    await bot.send_message(
                        chat_id=user_id,
                        text=message,
                        parse_mode="HTML",
                        disable_web_page_preview=True,
                        reply_markup=keyboard,
                    )
            else:
                await bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode="HTML",
                    disable_web_page_preview=True,
                    reply_markup=keyboard,
                )
            sent += 1
        except Exception as exc:
            print(f"[Bot] news notification send error for {user_id}: {exc}")
            continue
        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT IGNORE INTO news_notification_deliveries
                        (user_id, news_item_id, lead_minutes)
                    VALUES (%s, %s, %s)
                    """,
                    (user_id, news_item_id, delivery_lead),
                )
    return sent


async def news_notification_loop() -> None:
    await asyncio.sleep(10)
    while True:
        try:
            await send_due_news_notifications_once()
        except Exception as exc:
            print(f"[Bot] news notification loop error: {exc}")
        await asyncio.sleep(max(30, NEWS_NOTIFICATION_CHECK_INTERVAL_SEC))


def _format_signal_notification_price(value: Any) -> str:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return "-"
    if abs(numeric) >= 100:
        return f"{numeric:.3f}".rstrip("0").rstrip(".")
    return f"{numeric:.5f}".rstrip("0").rstrip(".")


def _format_signal_notification_expiration(value: Any) -> str:
    raw = _normalize_selected_expiration(value)
    if not raw:
        return "-"
    match = re.match(r"^(\d+)([smh])$", raw)
    if not match:
        return html.escape(raw)
    amount = int(match.group(1))
    unit = match.group(2)
    if unit == "s":
        return f"{amount} сек"
    if unit == "m":
        return f"{amount} мин"
    return f"{amount} ч"


def _build_signal_notification_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                _build_inline_button(
                    text="Открыть SonicFX",
                    web_app=WebAppInfo(url=build_main_webapp_url()),
                    style="success",
                )
            ]
        ]
    )


def _fallback_signal_result_quote(outcome: str) -> str:
    normalized = str(outcome or "").strip().lower()
    if normalized == "win":
        return "Отличная работа: дисциплина и терпение снова усилили твоё решение."
    if normalized == "loss":
        return "Минус — часть дистанции. Забираем урок, сохраняем фокус и ждем лучший сетап."
    if normalized == "refund":
        return "Рынок дал паузу. Спокойствие и контроль — тоже сильная часть стратегии."
    return "Каждый результат добавляет ясности. Главное — сохранять систему и спокойный темп."


async def _generate_signal_result_quote(row: Dict[str, Any], settlement: Dict[str, Any]) -> str:
    api_key = await get_app_setting("scanner_openai_api_key", DEFAULT_SCANNER_OPENAI_API_KEY)
    api_key = str(api_key or "").strip()
    if not api_key:
        return _fallback_signal_result_quote(settlement.get("outcome"))

    model = await get_app_setting("scanner_openai_model", DEFAULT_SCANNER_OPENAI_MODEL)
    outcome_label = settlement.get("outcome_label") or _get_settlement_outcome_label(settlement.get("outcome"))
    prompt = (
        "Сгенерируй одну короткую профессиональную трейдинговую цитату на русском. "
        "Тон: спокойный, позитивный, поддерживающий. "
        "Если итог минусовой — подбодри без обещаний прибыли. "
        "Если итог плюсовой — похвали дисциплину без эйфории. "
        "Максимум 18 слов. Без эмодзи, без кавычек, без markdown."
    )
    user_text = (
        f"Итог: {outcome_label}\n"
        f"Актив: {row.get('asset') or '-'}\n"
        f"Направление: {row.get('signal') or '-'}\n"
        f"Цена входа: {settlement.get('entry_price')}\n"
        f"Цена выхода: {settlement.get('exit_price')}"
    )
    request_payload = {
        "model": str(model or DEFAULT_SCANNER_OPENAI_MODEL).strip() or DEFAULT_SCANNER_OPENAI_MODEL,
        "temperature": 0.7,
        "max_tokens": 80,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_text},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0)) as client:
            response = await client.post(f"{OPENAI_API_BASE_URL}/chat/completions", headers=headers, json=request_payload)
            response.raise_for_status()
            payload = response.json()
        quote = str(payload["choices"][0]["message"]["content"] or "").strip()
        quote = re.sub(r"^[\"'«“]+|[\"'»”]+$", "", quote).strip()
        quote = re.sub(r"\s+", " ", quote)
        return quote[:220] if quote else _fallback_signal_result_quote(settlement.get("outcome"))
    except Exception as exc:
        print(f"[Bot] signal quote generation fallback: {exc}")
        return _fallback_signal_result_quote(settlement.get("outcome"))


def _format_signal_result_notification_message(row: Dict[str, Any], settlement: Dict[str, Any], quote: str) -> str:
    outcome_label = settlement.get("outcome_label") or _get_settlement_outcome_label(settlement.get("outcome"))
    outcome = str(settlement.get("outcome") or "").strip().lower()
    outcome_icon = {"win": "✅", "loss": "⚠️", "refund": "↔️"}.get(outcome, "📌")
    asset = html.escape(str(row.get("asset") or "не определен"))
    direction = html.escape(str(settlement.get("direction") or row.get("signal") or "-"))
    direction_icon = "🟢" if direction.upper() == "BUY" else "🔴" if direction.upper() == "SELL" else "⚪"
    expiration = html.escape(_format_signal_notification_expiration(settlement.get("selected_expiration") or row.get("selected_expiration")))
    entry_price = html.escape(_format_signal_notification_price(settlement.get("entry_price") or row.get("entry_price")))
    exit_price = html.escape(_format_signal_notification_price(settlement.get("exit_price") or row.get("exit_price")))
    quote_text = html.escape(quote or _fallback_signal_result_quote(settlement.get("outcome")))

    lines = [
        "📊 <b>SonicFX Signal</b>",
        f"{outcome_icon} <b>{html.escape(str(outcome_label or 'Не определено'))}</b>",
        "",
        f"💱 Актив: <b>{asset}</b>",
        f"{direction_icon} Направление: <b>{direction}</b>",
        f"⏱ Экспирация: <b>{expiration}</b>",
        f"🎯 Цена входа: <code>{entry_price}</code>",
        f"🏁 Цена выхода: <code>{exit_price}</code>",
    ]
    lines.extend(["", f"<blockquote>💬 {quote_text}</blockquote>"])
    return "\n".join(lines)


def _get_signal_notification_media(row: Dict[str, Any]) -> Optional[types.FSInputFile]:
    if row.get("upload_archived_at"):
        return None
    file_path = str(row.get("upload_file_path") or "").strip()
    if not file_path:
        return None
    target = Path(file_path).resolve()
    try:
        target.relative_to(scan_upload_dir.resolve())
    except ValueError:
        return None
    if not target.is_file():
        return None
    return types.FSInputFile(str(target))


async def send_due_signal_result_notifications_once(limit: int = 50) -> int:
    if bot is None:
        return 0
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """
                SELECT
                    ah.*,
                    su.file_path AS upload_file_path,
                    su.content_type AS upload_content_type,
                    su.archived_at AS upload_archived_at
                FROM analysis_history ah
                INNER JOIN users u ON u.user_id = ah.user_id AND COALESCE(u.is_blocked, 0) = 0
                LEFT JOIN user_notification_settings s ON s.user_id = ah.user_id
                LEFT JOIN scan_uploads su ON su.id = ah.upload_id
                WHERE ah.settlement_status = 'settled'
                  AND ah.settled_at IS NOT NULL
                  AND ah.signal_notification_sent_at IS NULL
                  AND COALESCE(s.signals_enabled, 1) = 1
                  AND ah.settled_at >= COALESCE(
                        s.signals_enabled_at,
                        (
                            SELECT STR_TO_DATE(value_text, '%%Y-%%m-%%d %%H:%%i:%%s')
                            FROM app_settings
                            WHERE `key` = 'signal_notifications_started_at'
                            LIMIT 1
                        ),
                        CURRENT_TIMESTAMP()
                  )
                  AND UPPER(TRIM(COALESCE(ah.`signal`, ''))) IN ('BUY', 'SELL')
                ORDER BY ah.settled_at ASC, ah.id ASC
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = await cur.fetchall()

    sent = 0
    for row in rows or []:
        history_id = int(row.get("id") or 0)
        user_id = int(row.get("user_id") or 0)
        if not history_id or not user_id:
            continue
        serialized = _serialize_analysis_history(row) or {}
        settlement = serialized.get("settlement") if isinstance(serialized.get("settlement"), dict) else None
        if not settlement:
            continue
        quote = await _generate_signal_result_quote(row, settlement)
        message = _format_signal_result_notification_message(row, settlement, quote)
        keyboard = _build_signal_notification_keyboard()
        media = _get_signal_notification_media(row)
        try:
            if media:
                try:
                    await bot.send_photo(
                        chat_id=user_id,
                        photo=media,
                        caption=message,
                        parse_mode="HTML",
                        reply_markup=keyboard,
                    )
                except Exception as media_exc:
                    print(f"[Bot] signal result media fallback for {user_id}: {media_exc}")
                    await bot.send_message(
                        chat_id=user_id,
                        text=message,
                        parse_mode="HTML",
                        disable_web_page_preview=True,
                        reply_markup=keyboard,
                    )
            else:
                await bot.send_message(
                    chat_id=user_id,
                    text=message,
                    parse_mode="HTML",
                    disable_web_page_preview=True,
                    reply_markup=keyboard,
                )
        except Exception as exc:
            print(f"[Bot] signal result notification send error for {user_id}: {exc}")
            fallback_message = message.replace("<blockquote>", "<i>").replace("</blockquote>", "</i>")
            try:
                await bot.send_message(
                    chat_id=user_id,
                    text=fallback_message,
                    parse_mode="HTML",
                    disable_web_page_preview=True,
                    reply_markup=keyboard,
                )
            except Exception as fallback_exc:
                print(f"[Bot] signal result notification fallback failed for {user_id}: {fallback_exc}")
                continue

        async with pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE analysis_history
                    SET signal_notification_sent_at = CURRENT_TIMESTAMP()
                    WHERE id = %s AND user_id = %s AND signal_notification_sent_at IS NULL
                    """,
                    (history_id, user_id),
                )
        sent += 1
    return sent


async def signal_result_notification_loop() -> None:
    await asyncio.sleep(12)
    while True:
        try:
            await send_due_signal_result_notifications_once()
        except Exception as exc:
            print(f"[Bot] signal result notification loop error: {exc}")
        await asyncio.sleep(15)


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
                    activation_status, account_tier, trader_id, deposit_amount, scanner_access, is_blocked,
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
                "account_tier": _normalize_status_code(row.get("account_tier") or "trader"),
                "trader_id": row.get("trader_id") or "",
                "activation_status": _coerce_activation(row.get("activation_status") or "inactive"),
                "deposit_amount": float(row.get("deposit_amount") or 0),
                "scanner_access": int(row.get("scanner_access") or 0),
                "is_blocked": int(row.get("is_blocked") or 0),
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                "last_active_at": row.get("last_active_at").isoformat() if row.get("last_active_at") else None,
            }
        )
    return {"items": data}


@app.get("/api/admin/statuses")
async def admin_get_statuses(admin: Dict[str, Any] = Depends(get_admin_user)):
    return {"items": await list_account_statuses(include_disabled=True)}


@app.post("/api/admin/statuses")
async def admin_upsert_status(
    payload: AccountStatusUpsertRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    code = _normalize_status_code(payload.code or payload.name, fallback="")
    if not code:
        raise HTTPException(status_code=400, detail="Status code is required. Use latin letters, numbers or underscore.")
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO account_statuses (
                    `code`, name, description, is_enabled, sort_order,
                    access_required, min_deposit,
                    scanner_enabled, scanner_limit, scanner_window_hours,
                    live_enabled, live_limit, live_window_hours,
                    indicators_enabled, indicators_limit, indicators_window_hours,
                    badge_text, marketing_text
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    description = VALUES(description),
                    is_enabled = VALUES(is_enabled),
                    sort_order = VALUES(sort_order),
                    access_required = VALUES(access_required),
                    min_deposit = VALUES(min_deposit),
                    scanner_enabled = VALUES(scanner_enabled),
                    scanner_limit = VALUES(scanner_limit),
                    scanner_window_hours = VALUES(scanner_window_hours),
                    live_enabled = VALUES(live_enabled),
                    live_limit = VALUES(live_limit),
                    live_window_hours = VALUES(live_window_hours),
                    indicators_enabled = VALUES(indicators_enabled),
                    indicators_limit = VALUES(indicators_limit),
                    indicators_window_hours = VALUES(indicators_window_hours),
                    badge_text = VALUES(badge_text),
                    marketing_text = VALUES(marketing_text)
                """,
                (
                    code,
                    payload.name.strip(),
                    (payload.description or "").strip(),
                    int(payload.is_enabled),
                    int(payload.sort_order),
                    int(payload.access_required),
                    float(payload.min_deposit or 0),
                    int(payload.scanner_enabled),
                    _sanitize_status_limit(payload.scanner_limit),
                    _sanitize_status_window(payload.scanner_window_hours),
                    int(payload.live_enabled),
                    _sanitize_status_limit(payload.live_limit),
                    _sanitize_status_window(payload.live_window_hours),
                    int(payload.indicators_enabled),
                    _sanitize_status_limit(payload.indicators_limit),
                    _sanitize_status_window(payload.indicators_window_hours),
                    (payload.badge_text or payload.name).strip()[:64],
                    (payload.marketing_text or "").strip(),
                ),
            )
    await add_admin_audit(int(admin["user_id"]), "admin_upsert_status", {"code": code})
    return {"status": "success", "items": await list_account_statuses(include_disabled=True)}


@app.delete("/api/admin/statuses/{code}")
async def admin_delete_status(
    code: str,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    normalized = _normalize_status_code(code)
    if normalized == "trader":
        raise HTTPException(status_code=400, detail="Trader status cannot be deleted")
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute("UPDATE account_statuses SET is_enabled = 0, updated_at = NOW() WHERE `code` = %s", (normalized,))
    await add_admin_audit(int(admin["user_id"]), "admin_delete_status", {"code": normalized})
    return {"status": "success", "items": await list_account_statuses(include_disabled=True)}


@app.post("/api/admin/users/set-activation")
async def admin_set_activation(
    payload: AdminSetActivationRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    trader_id = (payload.trader_id or "").strip() or None
    requested_account_tier = _normalize_status_code(payload.account_tier) if payload.account_tier else None
    if requested_account_tier:
        known_statuses = await list_account_statuses(include_disabled=True)
        if requested_account_tier not in {_normalize_status_code(item.get("code")) for item in known_statuses}:
            raise HTTPException(status_code=400, detail="Unknown account status")
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT activation_status, account_tier, deposit_amount, scanner_access FROM users WHERE user_id = %s LIMIT 1",
                (int(payload.user_id),),
            )
            existing = await cur.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="User not found")

            status = _coerce_activation(payload.activation_status or existing.get("activation_status") or "inactive")
            account_tier = requested_account_tier or _normalize_status_code(existing.get("account_tier") or "trader")
            deposit_amount = float(existing.get("deposit_amount") if payload.deposit_amount is None else payload.deposit_amount or 0)
            scanner_access = scanner_access_from_deposit(deposit_amount, int(existing.get("scanner_access") or 0))
            if status == "active_scanner":
                scanner_access = 1

            await cur.execute(
                """
                UPDATE users
                SET activation_status = %s,
                    account_tier = %s,
                    trader_id = %s,
                    deposit_amount = %s,
                    scanner_access = %s,
                    updated_at = NOW()
                WHERE user_id = %s
                """,
                (status, account_tier, trader_id, deposit_amount, int(scanner_access), int(payload.user_id)),
            )
    await add_admin_audit(int(admin["user_id"]), "admin_set_activation", payload.model_dump())
    return {"status": "success"}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(
    user_id: int,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    target_user_id = int(user_id)
    if target_user_id == int(admin["user_id"]):
        raise HTTPException(status_code=400, detail="Cannot delete current admin user")

    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute("SELECT user_id FROM users WHERE user_id = %s LIMIT 1", (target_user_id,))
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="User not found")

            await cur.execute("DELETE FROM analysis_history WHERE user_id = %s", (target_user_id,))
            await cur.execute("DELETE FROM scan_uploads WHERE user_id = %s", (target_user_id,))
            await cur.execute("DELETE FROM signals WHERE user_id = %s", (target_user_id,))
            await cur.execute("DELETE FROM admin_users WHERE user_id = %s", (target_user_id,))
            await cur.execute("DELETE FROM users WHERE user_id = %s", (target_user_id,))

    await add_admin_audit(int(admin["user_id"]), "admin_delete_user", {"user_id": target_user_id})
    return {"status": "success"}


@app.get("/api/admin/feature-flags")
async def admin_get_feature_flags(admin: Dict[str, Any] = Depends(get_admin_user)):
    pool = await require_db_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            placeholders = ",".join(["%s"] * len(MODE_FEATURE_FLAG_KEYS))
            await cur.execute(
                f"SELECT `key`, is_enabled, updated_at FROM feature_flags WHERE `key` IN ({placeholders}) ORDER BY FIELD(`key`, {placeholders})",
                (*MODE_FEATURE_FLAG_KEYS, *MODE_FEATURE_FLAG_KEYS),
            )
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
    if key not in MODE_FEATURE_FLAG_KEYS:
        raise HTTPException(status_code=400, detail="Unsupported feature flag")
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


@app.get("/api/admin/scanner-settings")
async def admin_get_scanner_settings(admin: Dict[str, Any] = Depends(get_admin_user)):
    return await get_scanner_settings_payload()


@app.post("/api/admin/scanner-settings")
async def admin_update_scanner_settings(
    payload: AdminScannerSettingsUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    analysis_mode = _normalize_scanner_analysis_mode(payload.analysis_mode)
    await set_app_setting("scanner_analysis_mode", analysis_mode)

    next_key = str(payload.api_key or "").strip()
    if next_key:
        await set_app_setting("scanner_openai_api_key", next_key)
    active_limit = _sanitize_active_signals_limit(
        payload.active_signals_limit if payload.active_signals_limit is not None else await get_active_signals_limit()
    )
    await set_app_setting("active_signals_limit", str(active_limit))

    await add_admin_audit(
        int(admin["user_id"]),
        "admin_update_scanner_settings",
        {
            "analysis_mode": analysis_mode,
            "api_key_updated": bool(next_key),
            "active_signals_limit": active_limit,
        },
    )
    return await get_scanner_settings_payload()


@app.get("/api/admin/support-settings")
async def admin_get_support_settings(admin: Dict[str, Any] = Depends(get_admin_user)):
    return await get_support_settings_payload()


@app.post("/api/admin/support-settings")
async def admin_update_support_settings(
    payload: AdminSupportSettingsUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    channel_url = _normalize_telegram_support_url(payload.channel_url, DEFAULT_SUPPORT_CHANNEL_URL)
    support_url = _normalize_telegram_support_url(payload.support_url, DEFAULT_SUPPORT_CONTACT_URL)
    await set_app_setting("support_channel_url", channel_url)
    await set_app_setting("support_contact_url", support_url)
    await add_admin_audit(
        int(admin["user_id"]),
        "admin_update_support_settings",
        {"channel_url": channel_url, "support_url": support_url},
    )
    return {"channel_url": channel_url, "support_url": support_url}


@app.get("/api/admin/registration-settings")
async def admin_get_registration_settings(admin: Dict[str, Any] = Depends(get_admin_user)):
    return await get_registration_settings_payload()


@app.post("/api/admin/registration-settings")
async def admin_update_registration_settings(
    payload: AdminRegistrationSettingsUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    registration_url = _normalize_external_url(payload.registration_url, DEFAULT_REGISTRATION_URL)
    await set_app_setting("registration_url", registration_url)
    await add_admin_audit(
        int(admin["user_id"]),
        "admin_update_registration_settings",
        {"registration_url": registration_url},
    )
    return {"registration_url": registration_url}


@app.get("/api/admin/market-settings")
async def admin_get_market_settings(admin: Dict[str, Any] = Depends(get_admin_user)):
    interval_min = await get_market_sync_interval_min()
    enabled_map = await get_market_enabled_map()
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
                "is_enabled": int(enabled_map.get(key, 1)),
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


@app.post("/api/admin/market-status")
async def admin_update_market_status(
    payload: AdminMarketStatusUpdateRequest,
    admin: Dict[str, Any] = Depends(get_admin_user),
):
    market_key = (payload.key or "").strip()
    if not market_key:
        raise HTTPException(status_code=400, detail="Market key is required")
    enabled = 1 if int(payload.is_enabled or 0) == 1 else 0
    normalized_key = await set_market_enabled(market_key, enabled)
    await add_admin_audit(
        int(admin["user_id"]),
        "admin_update_market_status",
        {"key": normalized_key, "is_enabled": enabled},
    )
    return {"status": "success", "key": normalized_key, "is_enabled": enabled}


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
    await send_main_menu_message(message, welcome_text, lang, int(from_user.id))


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
            await edit_main_menu_message(callback.message, welcome_text, lang, int(callback.from_user.id))
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
    notification_task = asyncio.create_task(news_notification_loop())
    signal_notification_task = asyncio.create_task(signal_result_notification_loop())
    try:
        await dp.start_polling(bot)
    finally:
        for task in (notification_task, signal_notification_task):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


async def start_api():
    config = uvicorn.Config(app, host=API_HOST, port=API_PORT)
    server = uvicorn.Server(config)
    await server.serve()


async def bootstrap_database(*, ensure_schema: bool = True) -> None:
    global db_pool
    db_pool = await aiomysql.create_pool(**DB_CONFIG)
    if ensure_schema:
        await ensure_database_schema(db_pool)


async def shutdown_database() -> None:
    global db_pool
    if db_pool is not None:
        db_pool.close()
        await db_pool.wait_closed()
        db_pool = None


async def run_api_warmup_once() -> None:
    if db_pool is not None:
        try:
            await ensure_database_schema(db_pool)
        except Exception as exc:
            print(f"[Warmup] schema failed: {exc}")
    warmup_jobs = (
        ("market pairs", sync_market_pairs_once),
        ("news", sync_news_once),
        ("scan archive", archive_expired_scan_uploads_once),
        ("analysis settlement", settle_due_analysis_once),
    )
    for label, job in warmup_jobs:
        try:
            await job()
        except Exception as exc:
            print(f"[Warmup] {label} failed: {exc}")


async def main(mode: str = "all"):
    await bootstrap_database(ensure_schema=mode not in {"api", "all"})
    if mode in {"all", "api"}:
        try:
            await quotes_hub.start()
        except Exception as exc:
            print(f"[QuotesHub] start failed: {exc}")
    try:
        tasks = []
        if mode in {"all", "bot"}:
            tasks.append(start_bot())
        if mode in {"all", "api"}:
            tasks.append(start_api())
            tasks.append(run_api_warmup_once())
            tasks.append(market_pairs_sync_loop())
            tasks.append(news_sync_loop())
            tasks.append(scan_upload_archive_loop())
            tasks.append(analysis_settlement_loop())
        if not tasks:
            raise RuntimeError(f"Unsupported runtime mode: {mode}")
        await asyncio.gather(*tasks)
    finally:
        await quotes_hub.shutdown()
        await shutdown_database()
        if bot is not None:
            await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main(parse_runtime_mode()))
    except KeyboardInterrupt:
        pass
