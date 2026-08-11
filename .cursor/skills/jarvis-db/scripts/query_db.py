#!/usr/bin/env python3
"""Read-only queries against production CreaJarvis2 Postgres."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlparse, urlunparse

CONFIG_PATH = Path.home() / ".config" / "jarvis-db" / "config.env"
VENV_PYTHON = Path.home() / ".cache" / "cursor-skills" / "jarvis-db" / ".venv" / "bin" / "python"

# Leading keywords allowed for a single statement (case-insensitive).
_READ_OK = re.compile(
    r"^\s*(WITH|SELECT|TABLE|VALUES|EXPLAIN|SHOW|DESCRIBE|DESC|\\d)\b",
    re.IGNORECASE | re.DOTALL,
)
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|ALTER|DROP|CREATE|TRUNCATE|"
    r"GRANT|REVOKE|COPY|CALL|DO|VACUUM|REINDEX|CLUSTER|REFRESH|"
    r"SECURITY\s+LABEL|SET\s+ROLE|SET\s+SESSION\s+AUTHORIZATION)\b",
    re.IGNORECASE,
)


class JarvisDbError(Exception):
    pass


def ensure_psycopg_runtime() -> None:
    """Re-exec under the skill venv if psycopg is missing."""
    try:
        import psycopg  # noqa: F401

        return
    except ImportError:
        pass
    venv_root = VENV_PYTHON.parent.parent
    already_in_venv = Path(sys.prefix).resolve() == venv_root.resolve()
    if VENV_PYTHON.is_file() and not already_in_venv:
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), *sys.argv])
    raise JarvisDbError(
        "psycopg missing. Create the skill venv once:\n"
        f"  python3 -m venv {venv_root}\n"
        f"  {venv_root}/bin/pip install 'psycopg[binary]'\n"
        "Then re-run this script."
    )


def load_config() -> dict[str, str]:
    cfg: dict[str, str] = {}
    if CONFIG_PATH.is_file():
        for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key:
                cfg[key] = value
    return cfg


def _cfg(env: dict[str, str], file_cfg: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = (env.get(key) or file_cfg.get(key) or "").strip()
        if value:
            return value
    return ""


def resolve_dsn() -> str:
    file_cfg = load_config()
    env = dict(os.environ)

    url = _cfg(env, file_cfg, "JARVIS_DB_URL", "JARVIS_DATABASE_URL")
    if url:
        return url

    host = _cfg(env, file_cfg, "JARVIS_DB_HOST")
    port = _cfg(env, file_cfg, "JARVIS_DB_PORT")
    name = _cfg(env, file_cfg, "JARVIS_DB_NAME", "JARVIS_DB_DATABASE")
    user = _cfg(env, file_cfg, "JARVIS_DB_USER")
    password = _cfg(env, file_cfg, "JARVIS_DB_PASSWORD")
    missing = [
        key
        for key, value in (
            ("JARVIS_DB_HOST", host),
            ("JARVIS_DB_PORT", port),
            ("JARVIS_DB_NAME", name),
            ("JARVIS_DB_USER", user),
            ("JARVIS_DB_PASSWORD", password),
        )
        if not value
    ]
    if missing:
        raise JarvisDbError(
            "Missing "
            + ", ".join(missing)
            + ". Set JARVIS_DB_URL or all discrete fields in "
            "~/.config/jarvis-db/config.env (mode 600). "
            "Do not paste secrets into chat."
        )
    return (
        f"postgresql://{quote_plus(user)}:{quote_plus(password)}"
        f"@{host}:{port}/{name}"
    )


def redacted_dsn(dsn: str) -> str:
    parsed = urlparse(dsn)
    if parsed.password is None:
        return dsn
    netloc = parsed.netloc.replace(f":{parsed.password}@", ":***@")
    return urlunparse(parsed._replace(netloc=netloc))


def assert_readonly_sql(sql: str) -> None:
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise JarvisDbError("Empty SQL")
    if ";" in text:
        raise JarvisDbError("Only a single SQL statement is allowed (no ';')")
    if not _READ_OK.match(text):
        raise JarvisDbError(
            "Only read statements allowed (SELECT / WITH / EXPLAIN / SHOW / …)"
        )
    if _FORBIDDEN.search(text):
        raise JarvisDbError("SQL contains a forbidden write/DDL keyword")


def connect():
    import psycopg
    from psycopg.rows import dict_row

    dsn = resolve_dsn()
    conn = psycopg.connect(
        dsn,
        autocommit=False,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on",
    )
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    return conn


def cmd_health(_: argparse.Namespace) -> int:
    with connect() as conn:
        row = conn.execute("SELECT current_database() AS db, now() AS now").fetchone()
    print(f"ok db={row['db']} now={row['now']} dsn={redacted_dsn(resolve_dsn())}")
    return 0


def cmd_tables(_: argparse.Namespace) -> int:
    sql = """
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
    """
    with connect() as conn:
        rows = conn.execute(sql).fetchall()
    for r in rows:
        print(f"{r['table_schema']}.{r['table_name']}")
    print(f"# {len(rows)} tables")
    return 0


def cmd_describe(args: argparse.Namespace) -> int:
    sql = """
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = %s
    ORDER BY ordinal_position
    """
    with connect() as conn:
        rows = conn.execute(sql, (args.table,)).fetchall()
    if not rows:
        print(f"No columns for public.{args.table}", file=sys.stderr)
        return 1
    for r in rows:
        print(f"{r['column_name']}\t{r['data_type']}\tnullable={r['is_nullable']}")
    return 0


def _format_value(v: Any) -> str:
    if v is None:
        return "NULL"
    return str(v).replace("\t", "\\t").replace("\n", "\\n")


def cmd_query(args: argparse.Namespace) -> int:
    assert_readonly_sql(args.sql)
    limit = args.limit
    with connect() as conn:
        with conn.transaction():
            cur = conn.execute(args.sql)
            if cur.description is None:
                print("# no result set")
                return 0
            cols = [d.name for d in cur.description]
            rows = cur.fetchmany(limit + 1)
    truncated = len(rows) > limit
    rows = rows[:limit]
    print("\t".join(cols))
    for row in rows:
        print("\t".join(_format_value(row[c]) for c in cols))
    print(f"# rows={len(rows)}" + (" truncated=true" if truncated else ""))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    h = sub.add_parser("health", help="Ping DB (read-only)")
    h.set_defaults(func=cmd_health)

    t = sub.add_parser("tables", help="List public tables")
    t.set_defaults(func=cmd_tables)

    d = sub.add_parser("describe", help="Describe a public table")
    d.add_argument("table")
    d.set_defaults(func=cmd_describe)

    q = sub.add_parser("query", help="Run a read-only SQL SELECT")
    q.add_argument("--sql", "-q", required=True)
    q.add_argument("--limit", type=int, default=100, help="Max rows printed (default 100)")
    q.set_defaults(func=cmd_query)

    return p


def main() -> int:
    ensure_psycopg_runtime()
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except JarvisDbError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
