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
        try:
            await cur.execute(alter_sql)
        except Exception as exc:
            if getattr(exc, "args", [None])[0] == 1060:
                return
            raise


async def _ensure_index(conn, db_name: str, table_name: str, index_name: str, create_sql: str) -> None:
    if await _index_exists(conn, db_name, table_name, index_name):
        return
    async with conn.cursor() as cur:
        try:
            await cur.execute(create_sql)
        except Exception as exc:
            if getattr(exc, "args", [None])[0] == 1061:
                return
            raise


def _normalize_lang(value: str) -> str:
    lang = (value or "").strip().lower()
    if lang in {"ru", "en", "uk"}:
        return lang
    return "ru"


def _normalize_account_tier(value: str) -> str:
    tier = (value or "").strip().lower()
    if tier == "pro":
        return "premium"
    if tier in {"trader", "premium", "vip", "unlimited"}:
        return tier
    return "trader"


DEFAULT_ACCOUNT_STATUSES: Tuple[Tuple[str, str, str, int, int, int, float, int, int, int, int, int, int, int, int, int, str, str], ...] = (
    (
        "trader",
        "Trader",
        "Базовый статус для каждого пользователя SonicFX.",
        1,
        10,
        0,
        0.0,
        1,
        1,
        0,
        1,
        1,
        3,
        1,
        1,
        3,
        "TRADER",
        "🎯 1 Live или Indicator анализ\n🎁 1 пробный Scanner\nОткрой Premium для полного доступа",
    ),
    (
        "premium",
        "Premium",
        "Полный старт для активной торговли с Live и индикаторами.",
        1,
        20,
        1,
        10.0,
        0,
        0,
        3,
        1,
        3,
        3,
        1,
        3,
        3,
        "PREMIUM",
        "⚡ Live сигналы\n📊 Индикаторы\nЛимит: 3 сигнала / 3 часа",
    ),
    (
        "vip",
        "VIP",
        "Расширенный доступ для частых сигналов и Scanner анализа.",
        1,
        30,
        1,
        50.0,
        1,
        10,
        3,
        1,
        10,
        3,
        1,
        10,
        3,
        "VIP",
        "🔥 Scanner\n⚡ Live + Индикаторы\nЛимит: 10 сигналов / 3 часа",
    ),
    (
        "unlimited",
        "Unlimited",
        "Максимальный статус без лимитов по сигналам.",
        1,
        40,
        1,
        250.0,
        1,
        -1,
        1,
        1,
        -1,
        1,
        1,
        -1,
        1,
        "UNLIMITED",
        "🚀 Полный доступ\n♾ Без лимитов\n⚡ Максимальная скорость сигналов",
    ),
)


async def _seed_account_statuses(conn) -> None:
    async with conn.cursor() as cur:
        for item in DEFAULT_ACCOUNT_STATUSES:
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
                    `code` = VALUES(`code`)
                """,
                item,
            )


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
        ("parabolic_sar", "Parabolic SAR", "Stop and reverse trend marker", 10),
        ("momentum", "Momentum", "Raw momentum oscillator", 11),
        ("rate_of_change", "Rate Of Change", "ROC momentum percentage", 12),
    )
    async with conn.cursor() as cur:
        await cur.execute(
            """
            DELETE FROM signal_indicators
            WHERE `code` IN ('keltner_channel', 'supertrend', 'vortex')
            """
        )
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
        ("active_signals_limit", "3"),
        ("support_channel_url", os.getenv("SUPPORT_CHANNEL_URL") or os.getenv("CHANNEL_URL") or "https://t.me/+TthmjdpAkv5hNjdi"),
        ("support_contact_url", os.getenv("SUPPORT_CONTACT_URL") or os.getenv("SUPPORT_URL") or "https://t.me/WaySonic"),
        ("registration_url", os.getenv("REGISTRATION_URL") or ""),
        ("pocket_partner_id", os.getenv("POCKET_PARTNER_ID") or ""),
        ("pocket_api_token_encrypted", ""),
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
        await cur.execute(
            """
            INSERT IGNORE INTO app_settings (`key`, value_text)
            VALUES ('signal_notifications_started_at', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'))
            """
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
                    preferred_signal_mode VARCHAR(16) NOT NULL DEFAULT 'scanner',
                    account_tier VARCHAR(16) NOT NULL DEFAULT 'trader',
                    trader_id VARCHAR(128) NULL,
                    activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive',
                    deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    pocket_referral_status VARCHAR(32) NULL,
                    pocket_balance DECIMAL(14,4) NULL,
                    pocket_sum_ftd DECIMAL(14,4) NULL,
                    pocket_date_ftd VARCHAR(64) NULL,
                    pocket_count_deposits INT NULL,
                    pocket_sum_deposits DECIMAL(14,4) NULL,
                    pocket_reg_date VARCHAR(64) NULL,
                    pocket_activity_date VARCHAR(64) NULL,
                    pocket_country VARCHAR(64) NULL,
                    pocket_is_verified VARCHAR(64) NULL,
                    pocket_company VARCHAR(128) NULL,
                    pocket_registration_link TEXT NULL,
                    pocket_raw_json LONGTEXT NULL,
                    pocket_checked_at TIMESTAMP NULL DEFAULT NULL,
                    pocket_error VARCHAR(64) NULL,
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
                    signals_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    signals_enabled_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
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
                CREATE TABLE IF NOT EXISTS account_statuses (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    `code` VARCHAR(32) NOT NULL,
                    name VARCHAR(64) NOT NULL,
                    description TEXT NULL,
                    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    sort_order INT NOT NULL DEFAULT 100,
                    access_required TINYINT(1) NOT NULL DEFAULT 0,
                    min_deposit DECIMAL(12,2) NOT NULL DEFAULT 0,
                    scanner_enabled TINYINT(1) NOT NULL DEFAULT 0,
                    scanner_limit INT NOT NULL DEFAULT 0,
                    scanner_window_hours INT NOT NULL DEFAULT 3,
                    live_enabled TINYINT(1) NOT NULL DEFAULT 0,
                    live_limit INT NOT NULL DEFAULT 0,
                    live_window_hours INT NOT NULL DEFAULT 3,
                    indicators_enabled TINYINT(1) NOT NULL DEFAULT 0,
                    indicators_limit INT NOT NULL DEFAULT 0,
                    indicators_window_hours INT NOT NULL DEFAULT 3,
                    badge_text VARCHAR(64) NULL,
                    marketing_text TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_account_statuses_code (`code`)
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
                    value_text TEXT NOT NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            try:
                await cur.execute("ALTER TABLE app_settings MODIFY COLUMN value_text TEXT NOT NULL")
            except Exception:
                pass

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

            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_history (
                    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    source_type VARCHAR(16) NOT NULL DEFAULT 'scanner',
                    upload_id BIGINT NULL,
                    analysis_mode VARCHAR(16) NULL,
                    `signal` VARCHAR(16) NULL,
                    asset VARCHAR(128) NULL,
                    market_mode VARCHAR(16) NULL,
                    entry_price DECIMAL(20,8) NULL,
                    confidence INT NULL,
                    expiration_minutes INT NULL,
                    selected_expiration VARCHAR(16) NULL,
                    settlement_status VARCHAR(16) NOT NULL DEFAULT 'none',
                    settlement_due_at TIMESTAMP NULL DEFAULT NULL,
                    settled_at TIMESTAMP NULL DEFAULT NULL,
                    settlement_outcome VARCHAR(16) NULL,
                    exit_price DECIMAL(20,8) NULL,
                    signal_notification_sent_at TIMESTAMP NULL DEFAULT NULL,
                    comment TEXT NULL,
                    result_json MEDIUMTEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )

        await _ensure_column(conn, db_name, "users", "theme", "ALTER TABLE users ADD COLUMN theme VARCHAR(16) NOT NULL DEFAULT 'dark'")
        await _ensure_column(conn, db_name, "users", "preferred_signal_mode", "ALTER TABLE users ADD COLUMN preferred_signal_mode VARCHAR(16) NOT NULL DEFAULT 'scanner'")
        await _ensure_column(conn, db_name, "users", "lang", "ALTER TABLE users ADD COLUMN lang VARCHAR(8) NOT NULL DEFAULT 'ru'")
        await _ensure_column(conn, db_name, "users", "timezone", "ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Kiev'")
        await _ensure_column(conn, db_name, "users", "mini_username", "ALTER TABLE users ADD COLUMN mini_username VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "photo_url", "ALTER TABLE users ADD COLUMN photo_url TEXT NULL")
        await _ensure_column(conn, db_name, "users", "account_tier", "ALTER TABLE users ADD COLUMN account_tier VARCHAR(32) NOT NULL DEFAULT 'trader'")
        await _ensure_column(conn, db_name, "users", "trader_id", "ALTER TABLE users ADD COLUMN trader_id VARCHAR(128) NULL")
        await _ensure_column(conn, db_name, "users", "activation_status", "ALTER TABLE users ADD COLUMN activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive'")
        await _ensure_column(conn, db_name, "users", "deposit_amount", "ALTER TABLE users ADD COLUMN deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "pocket_referral_status", "ALTER TABLE users ADD COLUMN pocket_referral_status VARCHAR(32) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_balance", "ALTER TABLE users ADD COLUMN pocket_balance DECIMAL(14,4) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_sum_ftd", "ALTER TABLE users ADD COLUMN pocket_sum_ftd DECIMAL(14,4) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_date_ftd", "ALTER TABLE users ADD COLUMN pocket_date_ftd VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_count_deposits", "ALTER TABLE users ADD COLUMN pocket_count_deposits INT NULL")
        await _ensure_column(conn, db_name, "users", "pocket_sum_deposits", "ALTER TABLE users ADD COLUMN pocket_sum_deposits DECIMAL(14,4) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_reg_date", "ALTER TABLE users ADD COLUMN pocket_reg_date VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_activity_date", "ALTER TABLE users ADD COLUMN pocket_activity_date VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_country", "ALTER TABLE users ADD COLUMN pocket_country VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_is_verified", "ALTER TABLE users ADD COLUMN pocket_is_verified VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_company", "ALTER TABLE users ADD COLUMN pocket_company VARCHAR(128) NULL")
        await _ensure_column(conn, db_name, "users", "pocket_registration_link", "ALTER TABLE users ADD COLUMN pocket_registration_link TEXT NULL")
        await _ensure_column(conn, db_name, "users", "pocket_raw_json", "ALTER TABLE users ADD COLUMN pocket_raw_json LONGTEXT NULL")
        await _ensure_column(conn, db_name, "users", "pocket_checked_at", "ALTER TABLE users ADD COLUMN pocket_checked_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "users", "pocket_error", "ALTER TABLE users ADD COLUMN pocket_error VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "scanner_access", "ALTER TABLE users ADD COLUMN scanner_access TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "onboarding_seen", "ALTER TABLE users ADD COLUMN onboarding_seen TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "is_blocked", "ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "last_active_at", "ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP NULL DEFAULT NULL")
        async with conn.cursor() as cur:
            try:
                await cur.execute("ALTER TABLE users MODIFY COLUMN account_tier VARCHAR(32) NOT NULL DEFAULT 'trader'")
            except Exception:
                pass

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
        await _ensure_column(conn, db_name, "user_notification_settings", "signals_enabled", "ALTER TABLE user_notification_settings ADD COLUMN signals_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "user_notification_settings", "signals_enabled_at", "ALTER TABLE user_notification_settings ADD COLUMN signals_enabled_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP")
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
        await _ensure_column(conn, db_name, "account_statuses", "description", "ALTER TABLE account_statuses ADD COLUMN description TEXT NULL")
        await _ensure_column(conn, db_name, "account_statuses", "is_enabled", "ALTER TABLE account_statuses ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "account_statuses", "sort_order", "ALTER TABLE account_statuses ADD COLUMN sort_order INT NOT NULL DEFAULT 100")
        await _ensure_column(conn, db_name, "account_statuses", "access_required", "ALTER TABLE account_statuses ADD COLUMN access_required TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "min_deposit", "ALTER TABLE account_statuses ADD COLUMN min_deposit DECIMAL(12,2) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "scanner_enabled", "ALTER TABLE account_statuses ADD COLUMN scanner_enabled TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "scanner_limit", "ALTER TABLE account_statuses ADD COLUMN scanner_limit INT NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "scanner_window_hours", "ALTER TABLE account_statuses ADD COLUMN scanner_window_hours INT NOT NULL DEFAULT 3")
        await _ensure_column(conn, db_name, "account_statuses", "live_enabled", "ALTER TABLE account_statuses ADD COLUMN live_enabled TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "live_limit", "ALTER TABLE account_statuses ADD COLUMN live_limit INT NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "live_window_hours", "ALTER TABLE account_statuses ADD COLUMN live_window_hours INT NOT NULL DEFAULT 3")
        await _ensure_column(conn, db_name, "account_statuses", "indicators_enabled", "ALTER TABLE account_statuses ADD COLUMN indicators_enabled TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "indicators_limit", "ALTER TABLE account_statuses ADD COLUMN indicators_limit INT NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "account_statuses", "indicators_window_hours", "ALTER TABLE account_statuses ADD COLUMN indicators_window_hours INT NOT NULL DEFAULT 3")
        await _ensure_column(conn, db_name, "account_statuses", "badge_text", "ALTER TABLE account_statuses ADD COLUMN badge_text VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "account_statuses", "marketing_text", "ALTER TABLE account_statuses ADD COLUMN marketing_text TEXT NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "source_url", "ALTER TABLE scan_uploads ADD COLUMN source_url TEXT NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "is_current", "ALTER TABLE scan_uploads ADD COLUMN is_current TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "scan_uploads", "upload_date", "ALTER TABLE scan_uploads ADD COLUMN upload_date DATE NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "sequence_number", "ALTER TABLE scan_uploads ADD COLUMN sequence_number INT NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "scan_uploads", "archive_path", "ALTER TABLE scan_uploads ADD COLUMN archive_path VARCHAR(700) NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "archived_at", "ALTER TABLE scan_uploads ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "scan_uploads", "updated_at", "ALTER TABLE scan_uploads ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP")
        await _ensure_column(conn, db_name, "analysis_history", "source_type", "ALTER TABLE analysis_history ADD COLUMN source_type VARCHAR(16) NOT NULL DEFAULT 'scanner'")
        await _ensure_column(conn, db_name, "analysis_history", "upload_id", "ALTER TABLE analysis_history ADD COLUMN upload_id BIGINT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "analysis_mode", "ALTER TABLE analysis_history ADD COLUMN analysis_mode VARCHAR(16) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "signal", "ALTER TABLE analysis_history ADD COLUMN `signal` VARCHAR(16) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "asset", "ALTER TABLE analysis_history ADD COLUMN asset VARCHAR(128) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "market_mode", "ALTER TABLE analysis_history ADD COLUMN market_mode VARCHAR(16) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "entry_price", "ALTER TABLE analysis_history ADD COLUMN entry_price DECIMAL(20,8) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "confidence", "ALTER TABLE analysis_history ADD COLUMN confidence INT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "expiration_minutes", "ALTER TABLE analysis_history ADD COLUMN expiration_minutes INT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "selected_expiration", "ALTER TABLE analysis_history ADD COLUMN selected_expiration VARCHAR(16) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "settlement_status", "ALTER TABLE analysis_history ADD COLUMN settlement_status VARCHAR(16) NOT NULL DEFAULT 'none'")
        await _ensure_column(conn, db_name, "analysis_history", "settlement_due_at", "ALTER TABLE analysis_history ADD COLUMN settlement_due_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "settled_at", "ALTER TABLE analysis_history ADD COLUMN settled_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "settlement_outcome", "ALTER TABLE analysis_history ADD COLUMN settlement_outcome VARCHAR(16) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "exit_price", "ALTER TABLE analysis_history ADD COLUMN exit_price DECIMAL(20,8) NULL")
        await _ensure_column(conn, db_name, "analysis_history", "signal_notification_sent_at", "ALTER TABLE analysis_history ADD COLUMN signal_notification_sent_at TIMESTAMP NULL DEFAULT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "comment", "ALTER TABLE analysis_history ADD COLUMN comment TEXT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "result_json", "ALTER TABLE analysis_history ADD COLUMN result_json MEDIUMTEXT NULL")
        await _ensure_column(conn, db_name, "analysis_history", "created_at", "ALTER TABLE analysis_history ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP")

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
        await _ensure_index(conn, db_name, "account_statuses", "idx_account_statuses_enabled_order", "CREATE INDEX idx_account_statuses_enabled_order ON account_statuses (is_enabled, sort_order)")
        await _ensure_index(conn, db_name, "market_pairs", "idx_market_pairs_kind_active", "CREATE INDEX idx_market_pairs_kind_active ON market_pairs (pair_kind, is_active)")
        await _ensure_index(conn, db_name, "market_pairs", "idx_market_pairs_last_seen", "CREATE INDEX idx_market_pairs_last_seen ON market_pairs (last_seen_at)")
        await _ensure_index(conn, db_name, "signal_indicators", "idx_signal_indicators_enabled_order", "CREATE INDEX idx_signal_indicators_enabled_order ON signal_indicators (is_enabled, sort_order)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_user_created", "CREATE INDEX idx_scan_uploads_user_created ON scan_uploads (user_id, created_at)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_user_current", "CREATE INDEX idx_scan_uploads_user_current ON scan_uploads (user_id, is_current, created_at)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_archive_due", "CREATE INDEX idx_scan_uploads_archive_due ON scan_uploads (archived_at, created_at)")
        await _ensure_index(conn, db_name, "scan_uploads", "idx_scan_uploads_user_date_sequence", "CREATE INDEX idx_scan_uploads_user_date_sequence ON scan_uploads (user_id, upload_date, sequence_number)")
        await _ensure_index(conn, db_name, "analysis_history", "idx_analysis_history_user_created", "CREATE INDEX idx_analysis_history_user_created ON analysis_history (user_id, created_at)")
        await _ensure_index(conn, db_name, "analysis_history", "idx_analysis_history_upload", "CREATE INDEX idx_analysis_history_upload ON analysis_history (upload_id)")
        await _ensure_index(conn, db_name, "analysis_history", "idx_analysis_history_settlement_due", "CREATE INDEX idx_analysis_history_settlement_due ON analysis_history (settlement_status, settlement_due_at)")
        await _ensure_index(conn, db_name, "analysis_history", "idx_analysis_history_signal_notify", "CREATE INDEX idx_analysis_history_signal_notify ON analysis_history (settlement_status, signal_notification_sent_at, settled_at)")

        await _seed_feature_flags(conn)
        await _seed_signal_indicators(conn)
        await _seed_account_statuses(conn)
        await _seed_app_settings(conn)
        await _seed_default_admin(conn)
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE users
                SET account_tier = 'premium'
                WHERE account_tier = 'pro'
                """
            )
            await cur.execute(
                """
                UPDATE users
                SET account_tier = 'trader'
                WHERE account_tier IS NULL OR account_tier = ''
                """
            )
            await cur.execute(
                """
                UPDATE users
                SET preferred_signal_mode = 'scanner'
                WHERE preferred_signal_mode IS NULL OR preferred_signal_mode = '' OR preferred_signal_mode NOT IN ('scanner', 'automatic', 'indicators')
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
