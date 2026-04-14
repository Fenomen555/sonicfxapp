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


def _parse_default_admin_ids() -> list[int]:
    raw_values = [
        "7097261848",
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
                    activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive',
                    deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
                    scanner_access TINYINT(1) NOT NULL DEFAULT 0,
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
                    title VARCHAR(500) NOT NULL,
                    summary TEXT NULL,
                    image_url TEXT NULL,
                    source_name VARCHAR(255) NULL,
                    source_url TEXT NULL,
                    published_at TIMESTAMP NULL DEFAULT NULL,
                    is_visible TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

        await _ensure_column(conn, db_name, "users", "theme", "ALTER TABLE users ADD COLUMN theme VARCHAR(16) NOT NULL DEFAULT 'dark'")
        await _ensure_column(conn, db_name, "users", "lang", "ALTER TABLE users ADD COLUMN lang VARCHAR(8) NOT NULL DEFAULT 'ru'")
        await _ensure_column(conn, db_name, "users", "timezone", "ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Kiev'")
        await _ensure_column(conn, db_name, "users", "mini_username", "ALTER TABLE users ADD COLUMN mini_username VARCHAR(64) NULL")
        await _ensure_column(conn, db_name, "users", "activation_status", "ALTER TABLE users ADD COLUMN activation_status VARCHAR(32) NOT NULL DEFAULT 'inactive'")
        await _ensure_column(conn, db_name, "users", "deposit_amount", "ALTER TABLE users ADD COLUMN deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "scanner_access", "ALTER TABLE users ADD COLUMN scanner_access TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "is_blocked", "ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) NOT NULL DEFAULT 0")
        await _ensure_column(conn, db_name, "users", "last_active_at", "ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP NULL DEFAULT NULL")

        await _ensure_column(conn, db_name, "signals", "status", "ALTER TABLE signals ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'")
        await _ensure_column(conn, db_name, "signals", "result", "ALTER TABLE signals ADD COLUMN result VARCHAR(32) NULL")
        await _ensure_column(conn, db_name, "market_pairs", "payout", "ALTER TABLE market_pairs ADD COLUMN payout INT NULL")
        await _ensure_column(conn, db_name, "market_pairs", "is_active", "ALTER TABLE market_pairs ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1")
        await _ensure_column(conn, db_name, "market_pairs", "source", "ALTER TABLE market_pairs ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'devsbite'")
        await _ensure_column(conn, db_name, "market_pairs", "last_seen_at", "ALTER TABLE market_pairs ADD COLUMN last_seen_at TIMESTAMP NULL DEFAULT NULL")

        await _ensure_index(conn, db_name, "signals", "idx_signals_user_created", "CREATE INDEX idx_signals_user_created ON signals (user_id, created_at)")
        await _ensure_index(conn, db_name, "signals", "idx_signals_status", "CREATE INDEX idx_signals_status ON signals (status)")
        await _ensure_index(conn, db_name, "news_items", "idx_news_visible_published", "CREATE INDEX idx_news_visible_published ON news_items (is_visible, published_at)")
        await _ensure_index(conn, db_name, "users", "idx_users_activation_status", "CREATE INDEX idx_users_activation_status ON users (activation_status)")
        await _ensure_index(conn, db_name, "market_pairs", "idx_market_pairs_kind_active", "CREATE INDEX idx_market_pairs_kind_active ON market_pairs (pair_kind, is_active)")
        await _ensure_index(conn, db_name, "market_pairs", "idx_market_pairs_last_seen", "CREATE INDEX idx_market_pairs_last_seen ON market_pairs (last_seen_at)")

        await _seed_feature_flags(conn)
        await _seed_app_settings(conn)
        await _seed_default_admin(conn)


def normalize_user_lang(raw_lang: Optional[str]) -> str:
    return _normalize_lang(raw_lang or "")


def normalize_activation_status(raw_status: str) -> str:
    status = (raw_status or "").strip().lower()
    if status in {"inactive", "active", "active_scanner"}:
        return status
    return "inactive"


def scanner_access_from_deposit(deposit_amount: float, current_scanner_access: int = 0) -> int:
    if float(deposit_amount or 0) > 50:
        return 1
    return 1 if int(current_scanner_access or 0) == 1 else 0
