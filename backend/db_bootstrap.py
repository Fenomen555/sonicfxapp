import os
from typing import Iterable, Optional, Tuple

import aiomysql


async def _get_current_db_name(conn) -> str:
    async with conn.cursor() as cur:
        await cur.execute("SELECT DATABASE()")
        row = await cur.fetchone()
    if not row or not row[0]:
        raise RuntimeError("Database name is not selected")
    return str(row[0])


async def _column_exists(conn, db_name: str, table_name: str, column_name: str) -> bool:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT 1
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
            LIMIT 1
            """,
            (db_name, table_name, column_name),
        )
        row = await cur.fetchone()
    return bool(row)


async def _index_exists(conn, db_name: str, table_name: str, index_name: str) -> bool:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT 1
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND INDEX_NAME = %s
            LIMIT 1
            """,
            (db_name, table_name, index_name),
        )
        row = await cur.fetchone()
    return bool(row)


async def _ensure_column(conn, db_name: str, table_name: str, column_name: str, alter_sql: str) -> None:
    if await _column_exists(conn, db_name, table_name, column_name):
        return
    async with conn.cursor() as cur:
        await cur.execute(alter_sql)


async def _ensure_index(conn, db_name: str, table_name: str, index_name: str, create_sql: str) -> None:
    if await _index_exists(conn, db_name, table_name, index_name):
        return
    async with conn.cursor() as cur:
        await cur.execute(create_sql)


def _normalize_lang(value: str) -> str:
    lang = (value or "").strip().lower()
    if lang in {"ru", "en", "uk"}:
        return lang
    return "ru"


def _normalize_account_tier(value: str) -> str:
    tier = (value or "").strip().lower()
    if tier in {"trader", "pro", "vip"}:
        return tier
    return "trader"


async def _seed_feature_flags(conn) -> None:
    defaults: Tuple[Tuple[str, int], ...] = (
        ("mode_ai_enabled", 1),
        ("mode_indicators_enabled", 1),
        ("mode_scanner_enabled", 1),
        ("news_enabled", 1),
    )
    async with conn.cursor() as cur:
        for key, val in defaults:
            await cur.execute(
                """
                INSERT INTO feature_flags (`key`, is_enabled)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE `key` = VALUES(`key`)
                """,
                (key, int(val)),
            )


async def _seed_signal_indicators(conn) -> None:
    defaults: Tuple[Tuple[str, str, str, int], ...] = (
        ("rsi", "RSI", "Relative Strength Index", 1),
        ("stochastic_oscillator", "Stochastic Oscillator", "Momentum oscillator", 2),
        ("cci", "CCI", "Commodity Channel Index", 3),
        ("williams_r", "Williams %R", "Overbought / oversold oscillator", 4),
        ("macd", "MACD", "Trend and momentum convergence", 5),
        ("ema_9_50_200", "Moving Average (EMA 9 / 50 / 200)", "EMA stack for trend alignment", 6),
        ("adx", "ADX", "Average Directional Index", 7),
        ("atr", "ATR", "Average True Range", 8),
        ("bollinger_bands", "Bollinger Bands", "Volatility envelope", 9),
        ("keltner_channel", "Keltner Channel", "ATR-based channel", 10),
        ("supertrend", "SuperTrend", "Trend-following overlay", 11),
        ("parabolic_sar", "Parabolic SAR", "Stop and reverse trend marker", 12),
        ("vortex", "Vortex", "Directional trend strength", 13),
        ("momentum", "Momentum", "Raw momentum oscillator", 14),
        ("rate_of_change", "Rate Of Change", "ROC momentum percentage", 15),
    )
    async with conn.cursor() as cur:
        for code, title, description, order in defaults:
            await cur.execute(
                """
                INSERT INTO signal_indicators (`code`, title, description, is_enabled, sort_order)
                VALUES (%s, %s, %s, 1, %s)
                ON DUPLICATE KEY UPDATE
                    title = VALUES(title),
                    description = VALUES(description),
                    sort_order = VALUES(sort_order)
                """,
                (code, title, description, int(order)),
            )


def _parse_default_admin_ids() -> list[int]:
    raw_values = [
        "7097261848",
        "732616841",
        (os.getenv("ADMIN_DEFAULT_USER_ID") or "").strip(),
        (os.getenv("ADMIN_DEFAULT_USER_IDS") or "").strip(),
    ]
    result: list[int] = []
    seen: set[int] = set()
    for raw in raw_values:
        if not raw:
            continue
        for chunk in str(raw).split(","):
            value = (chunk or "").strip()
            if not value:
                continue
            try:
                admin_id = int(value)
            except ValueError:
                continue
            if admin_id in seen:
                continue
            seen.add(admin_id)
            result.append(admin_id)
    return result


async def _seed_default_admin(conn) -> None:
    admin_ids = _parse_default_admin_ids()
    if not admin_ids:
        return
    async with conn.cursor() as cur:
        for admin_id in admin_ids:
            await cur.execute(
                """
                INSERT INTO admin_users (user_id, is_active, granted_by)
                VALUES (%s, 1, %s)
                ON DUPLICATE KEY UPDATE is_active = 1
                """,
                (admin_id, admin_id),
            )


async def _seed_app_settings(conn) -> None:
    raw_interval = (os.getenv("MARKET_SYNC_INTERVAL_SEC") or "").strip()
    try:
        default_interval_min = int(raw_interval) // 60 if raw_interval else 5
    except ValueError:
        default_interval_min = 5
    default_interval_min = min(max(default_interval_min or 5, 2), 30)
    defaults: Tuple[Tuple[str, str], ...] = (
        ("market_pairs_sync_interval_min", str(default_interval_min)),
        ("news_sync_interval_min", "60"),
        ("market_enabled_forex", "1"),
        ("market_enabled_otc", "1"),
        ("market_enabled_commodities", "1"),
        ("market_enabled_stocks", "1"),
        ("market_enabled_crypto", "1"),
        ("scanner_analysis_mode", "adaptive"),
        ("scanner_openai_api_key", os.getenv("OPENAI_API_KEY") or ""),
        ("scanner_openai_model", os.getenv("OPENAI_MODEL") or "gpt-4.1-mini"),
        ("support_channel_url", os.getenv("SUPPORT_CHANNEL_URL") or os.getenv("CHANNEL_URL") or "https://t.me/+TthmjdpAkv5hNjdi"),
        ("support_contact_url", os.getenv("SUPPORT_CONTACT_URL") or os.getenv("SUPPORT_URL") or "https://t.me/WaySonic"),
    )
    async with conn.cursor() as cur:
        for key, value in defaults:
            await cur.execute(
                """
                INSERT INTO app_settings (`key`, value_text)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE `key` = VALUES(`key`)
                """,
                (key, value),
            )


async def ensure_database_schema(db_pool: aiomysql.Pool) -> None:
    async with db_pool.acquire() as conn:
        db_name = await _get_current_db_name(conn)

        async with conn.cursor() as cur:
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    user_id BIGINT NOT NULL PRIMARY KEY,
                    tg_username VARCHAR(255) NULL,
                    first_name VARCHAR(255) NULL,
                    last_name VARCHAR(255) NULL,
                    photo_url TEXT NULL,
                    mini_username VARCHAR(64) NULL,
                    lang VARCHAR(8) NOT NULL DEFAULT 'ru',
                    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Kiev',
                    theme VARCHAR(16) NOT NULL DEFAULT 'dark',
                    account_tier VARCHAR(16) NOT NULL DEFAULT 'trader',
                    trader_id VARCHAR(128) NULL,
                    activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive',
                    deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    scanner_access TINYINT(1) NOT NULL DEFAULT 0,
                    onboarding_seen TINYINT(1) NOT NULL DEFAULT 0,
                    is_blocked TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    last_active_at TIMESTAMP NULL DEFAULT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS signals (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    mode VARCHAR(32) NOT NULL,
                    asset_category VARCHAR(32) NOT NULL,
                    asset VARCHAR(64) NOT NULL,
                    otc TINYINT(1) NOT NULL DEFAULT 0,
                    timeframe VARCHAR(16) NOT NULL,
                    expiration_sec INT NOT NULL,
                    direction VARCHAR(8) NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    result VARCHAR(32) NULL,
                    started_at TIMESTAMP NULL DEFAULT NULL,
                    closed_at TIMESTAMP NULL DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS news_items (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    external_id VARCHAR(255) NULL,
                    feed_type VARCHAR(32) NOT NULL DEFAULT 'market',
                    news_category VARCHAR(64) NULL,
                    title VARCHAR(500) NOT NULL,
                    summary TEXT NULL,
                    image_url TEXT NULL,
                    related_symbols VARCHAR(255) NULL,
                    source_name VARCHAR(255) NULL,
                    source_url TEXT NULL,
                    country_code VARCHAR(8) NULL,
                    currency_code VARCHAR(8) NULL,
                    impact_level VARCHAR(16) NULL,
                    actual_value VARCHAR(64) NULL,
                    forecast_value VARCHAR(64) NULL,
                    previous_value VARCHAR(64) NULL,
                    unit VARCHAR(32) NULL,
                    published_at TIMESTAMP NULL DEFAULT NULL,
                    is_visible TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_notification_settings (
                    user_id BIGINT NOT NULL PRIMARY KEY,
                    news_enabled TINYINT(1) NOT NULL DEFAULT 0,
                    economic_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    market_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    impact_high_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    impact_medium_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    impact_low_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    lead_minutes INT NOT NULL DEFAULT 15,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS news_notification_deliveries (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    news_item_id BIGINT NOT NULL,
                    lead_minutes INT NOT NULL,
                    delivered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_news_notification_delivery (user_id, news_item_id, lead_minutes)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_users (
                    user_id BIGINT NOT NULL PRIMARY KEY,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    granted_by BIGINT NULL,
                    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS feature_flags (
                    `key` VARCHAR(128) NOT NULL PRIMARY KEY,
                    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_audit_log (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    admin_user_id BIGINT NOT NULL,
                    action_key VARCHAR(128) NOT NULL,
                    payload_json LONGTEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    `key` VARCHAR(128) NOT NULL PRIMARY KEY,
                    value_text VARCHAR(255) NOT NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS market_pairs (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    pair_kind VARCHAR(16) NOT NULL,
                    pair VARCHAR(64) NOT NULL,
                    payout INT NULL,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    source VARCHAR(32) NOT NULL DEFAULT 'devsbite',
                    last_seen_at TIMESTAMP NULL DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_market_pairs_kind_pair (pair_kind, pair)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS signal_indicators (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    `code` VARCHAR(64) NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    description VARCHAR(255) NULL,
                    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    sort_order INT NOT NULL DEFAULT 100,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_signal_indicators_code (`code`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS scan_uploads (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    source_type VARCHAR(16) NOT NULL,
                    original_name VARCHAR(255) NULL,
                    content_type VARCHAR(128) NULL,
                    file_size BIGINT NOT NULL DEFAULT 0,
                    file_path VARCHAR(700) NOT NULL,
                    public_path VARCHAR(700) NOT NULL,
                    source_url TEXT NULL,
                    is_current TINYINT(1) NOT NULL DEFAULT 1,
                    upload_date DATE NULL,
                    sequence_number INT NOT NULL DEFAULT 0,
                    archive_path VARCHAR(700) NULL,
                    archived_at TIMESTAMP NULL DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

        await _ensure_column(conn, db_name, "users", "theme", "ALTER TABLE users ADD COLUMN theme VARCHAR(16) NOT NULL DEFAULT 'dark'")
        await _ensure_column(conn, db_name, "users", "lang", "ALTER TABLE users ADD COLUMN lang VARCHAR(8) NOT NULL DEFAULT 'ru'")
        await _ensure_column(conn, db_name, "users", "timezone", "ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Kiev'")
        await _ensure_column(conn, db_name, "users", "mini_username", "ALTER TABLE users ADD COLUMN mini_username VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "photo_url", "ALTER TABLE users ADD COLUMN photo_url TEXT NULL")
        await _ensure_column(conn, db_name, "users", "account_tier", "ALTER TABLE users ADD COLUMN account_tier VARCHAR(16) NOT NULL DEFAULT 'trader'")
        await _ensure_column(conn, db_name, "users", "trader_id", "ALTER TABLE users ADD COLUMN trader_id VARCHAR(128) NULL")
        await _ensure_column(conn, db_name, "users", "activation_status", "ALTER TABLE users ADD COLUMN activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive'")
        await _ensure_column(conn, db_name, "users", "deposit_amount", "ALTER TABLE users ADD COLUMN deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "scanner_access", "ALTER TABLE users ADD COLUMN scanner_access TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "onboarding_seen", "ALTER TABLE users ADD COLUMN onboarding_seen TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "is_blocked", "ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "last_active_at", "ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP NULL DEFAULT NULL")

        await _ensure_column(conn, db_name, "signals", "status", "ALTER TABLE signals ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'")
        await _ensure_column(conn, db_name, "signals", "result", "ALTER TABLE signals ADD COLUMN result VARCHAR(32) NULL")
        await _ensure_column(conn, db_name, "news_items", "external_id", "ALTER TABLE news_items ADD COLUMN external_id VARCHAR(255) NULL")
        await _ensure_column(conn, db_name, "news_items", "feed_type", "ALTER TABLE news_items ADD COLUMN feed_type VARCHAR(32) NOT NULL DEFAULT 'market'")
        await _ensure_column(conn, db_name, "news_items", "news_category", "ALTER TABLE news_items ADD COLUMN news_category VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "news_items", "country_code", "ALTER TABLE news_items ADD COLUMN country_code VARCHAR(8) NULL")
        await _ensure_column(conn, db_name, "news_items", "currency_code", "ALTER TABLE news_items ADD COLUMN currency_code VARCHAR(8) NULL")
        await _ensure_column(conn, db_name, "news_items", "related_symbols", "ALTER TABLE news_items ADD COLUMN related_symbols VARCHAR(255) NULL")
        await _ensure_column(conn, db_name, "news_items", "impact_level", "ALTER TABLE news_items ADD COLUMN impact_level VARCHAR(16) NULL")
        await _ensure_column(conn, db_name, "news_items", "actual_value", "ALTER TABLE news_items ADD COLUMN actual_value VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "news_items", "forecast_value", "ALTER TABLE news_items ADD COLUMN forecast_value VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "news_items", "previous_value", "ALTER TABLE news_items ADD COLUMN previous_value VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "news_items", "unit", "ALTER TABLE news_items ADD COLUMN unit VARCHAR(32) NULL")
        await _ensure_column(conn, db_name, "news_items", "updated_at", "ALTER TABLE news_items ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
        await _ensure_column(conn, db_name, "user_notification_settings", "news_enabled", "ALTER TABLE user_notification_settings ADD COLUMN news_enabled TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "user_notification_settings", "economic_enabled", "ALTER TABLE user_notification_settings ADD COLUMN economic_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "user_notification_settings", "market_enabled", "ALTER TABLE user_notification_settings ADD COLUMN market_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "user_notification_settings", "impact_high_enabled", "ALTER TABLE user_notification_settings ADD COLUMN impact_high_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "user_notification_settings", "impact_medium_enabled", "ALTER TABLE user_notification_settings ADD COLUMN impact_medium_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "user_notification_settings", "impact_low_enabled", "ALTER TABLE user_notification_settings ADD COLUMN impact_low_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "user_notification_settings", "lead_minutes", "ALTER TABLE user_notification_settings ADD COLUMN lead_minutes INT NOT NULL DEFAULT 15")
        await _ensure_column(conn, db_name, "user_notification_settings", "updated_at", "ALTER TABLE user_notification_settings ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
        await _ensure_column(conn, db_name, "market_pairs", "payout", "ALTER TABLE market_pairs ADD COLUMN payout INT NULL")
        await _ensure_column(conn, db_name, "market_pairs", "is_active", "ALTER TABLE market_pairs ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "market_pairs", "source", "ALTER TABLE market_pairs ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'devsbite'")
        await _ensure_column(conn, db_name, "market_pairs", "last_seen_at", "ALTER TABLE market_pairs ADD COLUMN last_seen_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "signal_indicators", "description", "ALTER TABLE signal_indicators ADD COLUMN description VARCHAR(255) NULL")
        await _ensure_column(conn, db_name, "signal_indicators", "is_enabled", "ALTER TABLE signal_indicators ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "signal_indicators", "sort_order", "ALTER TABLE signal_indicators ADD COLUMN sort_order INT NOT NULL DEFAULT 100")
        await _ensure_column(conn, db_name, "scan_uploads", "source_url", "ALTER TABLE scan_uploads ADD COLUMN source_url TEXT NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "is_current", "ALTER TABLE scan_uploads ADD COLUMN is_current TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "scan_uploads", "upload_date", "ALTER TABLE scan_uploads ADD COLUMN upload_date DATE NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "sequence_number", "ALTER TABLE scan_uploads ADD COLUMN sequence_number INT NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "scan_uploads", "archive_path", "ALTER TABLE scan_uploads ADD COLUMN archive_path VARCHAR(700) NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "archived_at", "ALTER TABLE scan_uploads ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "updated_at", "ALTER TABLE scan_uploads ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")

        await _ensure_index(conn, db_name, "signals", "idx_signals_user_created", "CREATE INDEX idx_signals_user_created ON signals (user_id, created_at)")
        await _ensure_index(conn, db_name, "signals", "idx_signals_status", "CREATE INDEX idx_signals_status ON signals (status)")
        await _ensure_index(conn, db_name, "news_items", "idx_news_visible_published", "CREATE INDEX idx_news_visible_published ON news_items (is_visible, published_at)")
        await _ensure_index(conn, db_name, "news_items", "uq_news_external_id", "CREATE UNIQUE INDEX uq_news_external_id ON news_items (external_id)")
        await _ensure_index(conn, db_name, "news_items", "idx_news_feed_visible_published", "CREATE INDEX idx_news_feed_visible_published ON news_items (feed_type, is_visible, published_at)")
        await _ensure_index(conn, db_name, "news_items", "idx_news_feed_category_visible", "CREATE INDEX idx_news_feed_category_visible ON news_items (feed_type, news_category, is_visible)")
        await _ensure_index(conn, db_name, "news_notification_deliveries", "idx_news_notification_user", "CREATE INDEX idx_news_notification_user ON news_notification_deliveries (user_id, delivered_at)")
        await _ensure_index(conn, db_name, "news_notification_deliveries", "idx_news_notification_item", "CREATE INDEX idx_news_notification_item ON news_notification_deliveries (news_item_id, delivered_at)")
        await _ensure_index(conn, db_name, "users", "idx_users_activation_status", "CREATE INDEX idx_users_activation_status ON users (activation_status)")
        await _ensure_index(conn, db_name, "users", "idx_users_account_tier", "CREATE INDEX idx_users_account_tier ON users (account_tier)")
        await _ensure_index(conn, db_name, "users", "idx_users_trader_id", "CREATE INDEX idx_users_trader_id ON users (trader_id)")
        await _ensure_index(conn, db_name, "market_pairs", "idx_market_pairs_kind_active", "CREATE INDEX idx_market_pairs_kind_active ON market_pairs (pair_kind, is_active)")
        await _ensure_index(conn, db_name, "market_pairs", "idx_market_pairs_last_seen", "CREATE INDEX idx_market_pairs_last_seen ON market_pairs (last_seen_at)")
        await _ensure_index(conn, db_name, "signal_indicators", "idx_signal_indicators_enabled_order", "CREATE INDEX idx_signal_indicators_enabled_order ON signal_indicators (is_enabled, sort_order)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_user_created", "CREATE INDEX idx_scan_uploads_user_created ON scan_uploads (user_id, created_at)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_user_current", "CREATE INDEX idx_scan_uploads_user_current ON scan_uploads (user_id, is_current, created_at)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_archive_due", "CREATE INDEX idx_scan_uploads_archive_due ON scan_uploads (archived_at, created_at)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_user_date_sequence", "CREATE INDEX idx_scan_uploads_user_date_sequence ON scan_uploads (user_id, upload_date, sequence_number)")

        await _seed_feature_flags(conn)
        await _seed_signal_indicators(conn)
        await _seed_app_settings(conn)
        await _seed_default_admin(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET account_tier = 'trader'
                WHERE account_tier IS NULL OR account_tier = '' OR account_tier NOT IN ('trader', 'pro', 'vip')
                """
            )


def normalize_user_lang(raw_lang: Optional[str]) -> str:
    return _normalize_lang(raw_lang or "")


def normalize_account_tier(raw_tier: Optional[str]) -> str:
    return _normalize_account_tier(raw_tier or "")


def normalize_activation_status(raw_status: str) -> str:
    status = (raw_status or "").strip().lower()
    if status in {"inactive", "active", "active_scanner"}:
        return status
    return "inactive"


def scanner_access_from_deposit(deposit_amount: float, current_scanner_access: int = 0) -> int:
    if float(deposit_amount or 0) > 50:
        return 1
    return 1 if int(current_scanner_access or 0) == 1 else 0
