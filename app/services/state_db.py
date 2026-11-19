import sqlite3
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cluster_state.db")

def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS service_baseline (
                cluster_name TEXT, service_name TEXT, display_name TEXT,
                last_state TEXT, last_health TEXT, last_seen TEXT,
                is_expected INTEGER DEFAULT 1,
                PRIMARY KEY (cluster_name, service_name)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS service_actions_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_name TEXT, service_name TEXT, display_name TEXT,
                action TEXT, command_id INTEGER, executed_by TEXT,
                executed_at TEXT, status TEXT DEFAULT 'RUNNING', result_message TEXT
            )
        """)
def dismiss_missing_service(cluster_name, service_name):
    init_db()
    with _get_conn() as conn:
        conn.execute("UPDATE service_baseline SET is_expected = 0 WHERE cluster_name = ? AND service_name = ?", (cluster_name, service_name))

def log_service_action(cluster_name, service_name, display_name, action, command_id, executed_by):
    init_db()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    with _get_conn() as conn:
        conn.execute("INSERT INTO service_actions_log (cluster_name, service_name, display_name, action, command_id, executed_by, executed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING')", (cluster_name, service_name, display_name, action, command_id, executed_by, now_iso))

def update_service_action_status(command_id, status, result_message=""):
    init_db()
    with _get_conn() as conn:
        conn.execute("UPDATE service_actions_log SET status = ?, result_message = ? WHERE command_id = ?", (status, result_message, command_id))

def get_service_action_history(cluster_name, service_name, limit=5):
    init_db()
    with _get_conn() as conn:
        rows = conn.execute("SELECT action, command_id, executed_by, executed_at, status, result_message FROM service_actions_log WHERE cluster_name = ? AND service_name = ? ORDER BY id DESC LIMIT ?", (cluster_name, service_name, limit)).fetchall()
        return [dict(r) for r in rows]

def sync_and_detect_anomalies(clusters_data, client):
    init_db()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    alerts = []
    with _get_conn() as conn:
        rows = conn.execute("SELECT * FROM service_baseline WHERE is_expected = 1").fetchall()
        expected_map = {(r["cluster_name"], r["service_name"]): dict(r) for r in rows}
        seen_keys = set()
        for c in clusters_data:
            c_name = c["name"]
            for s in c["services"]:
                s_name, d_name = s["name"], s.get("displayName") or s["name"]
                state, health = s.get("serviceState", "UNKNOWN"), s.get("healthSummary", "UNKNOWN")
                seen_keys.add((c_name, s_name))
                if state not in ["STARTED", "NA"] or health in ["BAD", "CONCERNING"]:
                    alerts.append({"type": "DEGRADED", "service_name": s_name, "display_name": d_name, "cluster": c_name, "title": f"El servicio {d_name} se encuentra con error", "detail": f"Estado: {state} | Salud: {health}"})
                conn.execute("INSERT INTO service_baseline VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(cluster_name, service_name) DO UPDATE SET display_name=excluded.display_name, last_state=excluded.last_state, last_health=excluded.last_health, last_seen=excluded.last_seen, is_expected=1", (c_name, s_name, d_name, state, health, now_iso))
        for key, prev in expected_map.items():
            if key not in seen_keys:
                alerts.append({"type": "MISSING", "service_name": prev["service_name"], "display_name": prev["display_name"], "cluster": prev["cluster_name"], "title": f"El servicio {prev['display_name']} ya no existe en el clúster", "detail": f"Última vez visto: {prev['last_seen']}"})
    return alerts


def _ensure_role_log_table():
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS role_actions_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_name TEXT,
                service_name TEXT,
                role_name TEXT,
                role_type TEXT,
                hostname TEXT,
                action TEXT,
                command_id INTEGER,
                executed_by TEXT,
                executed_at TEXT,
                status TEXT DEFAULT 'RUNNING',
                result_message TEXT
            )
        """)


def log_role_action(cluster_name, service_name, role_name, role_type, hostname, action, command_id, executed_by):
    _ensure_role_log_table()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO role_actions_log (cluster_name, service_name, role_name, role_type, hostname, action, command_id, executed_by, executed_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING')",
            (cluster_name, service_name, role_name, role_type, hostname, action, command_id, executed_by, now_iso),
        )


def get_running_role_commands(cluster_name, service_name):
    _ensure_role_log_table()
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT id, role_name, action, command_id, status FROM role_actions_log WHERE cluster_name = ? AND service_name = ? AND status = 'RUNNING' ORDER BY id DESC",
            (cluster_name, service_name),
        ).fetchall()
        return [dict(r) for r in rows]


def update_role_action_status(command_id, status, result_message=""):
    _ensure_role_log_table()
    with _get_conn() as conn:
        conn.execute(
            "UPDATE role_actions_log SET status = ?, result_message = ? WHERE command_id = ?",
            (status, result_message, command_id),
        )
