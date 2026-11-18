import re
import os
import sqlite3
import threading
import time
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "metrics_live.db")
_db_lock = threading.Lock()
_collectors = {}



def _short_host(val):
    if isinstance(val, (list, tuple)):
        val = val.pop(0) if val else "nodo"
    s = str(val).strip()
    if "." in s:
        s = s.split(".", 1).pop(0)
    return s or "nodo"

def _get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_db():
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metrics_buffer (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service_name TEXT NOT NULL,
                    metric_key TEXT NOT NULL,
                    node_label TEXT NOT NULL,
                    val REAL NOT NULL,
                    ts_label TEXT NOT NULL,
                    ts_epoch REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_srv_ts ON metrics_buffer(service_name, ts_epoch);")
            conn.commit()
        finally:
            conn.close()


def clear_all_metrics():
    init_db()
    stop_all_collectors()
    with _db_lock:
        conn = _get_conn()
        try:
            conn.execute("DELETE FROM metrics_buffer;")
            conn.commit()
        finally:
            conn.close()
    logger.info("[SQLite] Tabla metrics_buffer limpiada por inicio de sesión.")


def stop_all_collectors():
    for srv, ctrl in list(_collectors.items()):
        ctrl["stop"].set()
    _collectors.clear()


def ensure_collector_running(service_name, client):
    """Arranca un hilo daemon por servicio si no está corriendo ya."""
    init_db()
    # Detener colectores de otros servicios para no gastar recursos
    for srv, ctrl in list(_collectors.items()):
        if srv != service_name:
            ctrl["stop"].set()
            del _collectors[srv]

    if service_name in _collectors and _collectors[service_name]["thread"].is_alive():
        _collectors[service_name]["last_ping"] = time.time()
        return

    stop_ev = threading.Event()
    ctrl = {"stop": stop_ev, "last_ping": time.time()}
    t = threading.Thread(
        target=_collector_worker,
        args=(service_name, client, stop_ev, ctrl),
        daemon=True,
    )
    ctrl["thread"] = t
    _collectors[service_name] = ctrl
    t.start()


def _collector_worker(service_name, client, stop_ev, ctrl):

    logger.info(f"[Hilo-1] Recolector SQLite iniciado para {service_name}")

    # Mapa hostId -> nombre corto real (cbgdtqroo01..08)
    host_map = {}
    try:
        hosts_data = client.get("/hosts")
        for h in (hosts_data.get("items") or list()):
            h_id = h.get("hostId", "")
            h_name = str(h.get("hostname", "")).strip()
            if h_id and h_name:
                host_map[h_id] = h_name.split(".", 1).pop(0)
    except Exception:
        pass

    while not stop_ev.is_set():
        if time.time() - ctrl["last_ping"] > 20:
            logger.info(f"[Hilo-1] Auto-deteniendo recolector de {service_name} por inactividad.")
            break

        try:
            _poll_and_store_once(client, service_name, host_map)
        except Exception as e:
            logger.warning(f"[Hilo-1] Error en ciclo {service_name}: {e}")

        stop_ev.wait(5.0)


def _poll_and_store_once(client, service_name, host_map):
    # Detectar roles vivos con su hostname real cruzando hostId
    alive_roles = {}
    try:
        cl_data = client.get("/clusters")
        cl_items = cl_data.get("items") or list()
        if len(cl_items) > 0:
            cluster = next(iter(cl_items)).get("name", "")
            if cluster:
                roles_data = client.get(f"/clusters/{cluster}/services/{service_name}/roles")
                for r in (roles_data.get("items") or list()):
                    if r.get("roleState") == "STARTED":
                        r_name = r.get("name", "")
                        href = r.get("hostRef") or {}
                        h_id = href.get("hostId", "")
                        raw_host = href.get("hostname") or host_map.get(h_id) or h_id or "nodo"
                        host_short = str(raw_host).strip().split(".", 1).pop(0)
                        r_type = r.get("type", "ROLE")
                        alive_roles[r_name] = f"{host_short} • {r_type}"
    except Exception:
        pass

    now_utc = datetime.now(timezone.utc)
    start_utc = now_utc - timedelta(minutes=10)
    from_str = start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_str = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    is_hdfs = "hdfs" in service_name.lower()
    queries = {
        "cpu_user": f"SELECT cpu_user_rate WHERE serviceName = '{service_name}'",
        "heap":     f"SELECT jvm_heap_used_mb WHERE serviceName = '{service_name}'",
        "gc_time":  f"SELECT jvm_gc_time_ms WHERE serviceName = '{service_name}'",
        "fd_open" if is_hdfs else "cpu_sys": (
            f"SELECT fd_open WHERE serviceName = '{service_name}'"
            if is_hdfs else f"SELECT cpu_system_rate WHERE serviceName = '{service_name}'"
        ),
    }

    now_local = datetime.now()
    ts_label = now_local.strftime("%H:%M:%S")
    ts_epoch = time.time()
    rows_to_insert = list()

    for key, tsq in queries.items():
        try:
            raw = client.get(f"/timeseries?query={tsq}&from={from_str}&to={to_str}")
            items = raw.get("items") or list()
            if len(items) > 0:
                ts_list = next(iter(items)).get("timeSeries") or list()
                for ts in ts_list:
                    meta = ts.get("metadata") or {}
                    attrs = meta.get("attributes") or {}
                    r_name = attrs.get("roleName") or meta.get("entityName") or ""

                    if alive_roles and r_name not in alive_roles:
                        continue

                    raw_h = attrs.get("hostname") or host_map.get(attrs.get("hostId", ""), "nodo")
                    host_short = _short_host(raw_host)
                    r_type = attrs.get("roleType") or service_name.upper()
                    label = alive_roles.get(r_name) or (host_map.get(attrs.get("hostId", ""), "nodo") + " • " + str(r_type))

                    data_pts = ts.get("data") or list()
                    if len(data_pts) > 0:
                        last_pt = data_pts[-1]
                        val = round(float(last_pt.get("value", 0)), 2)
                        rows_to_insert.append((service_name, key, label, val, ts_label, ts_epoch))
        except Exception as e:
            logger.warning(f"[Hilo-1] Error tsquery {key}: {e}")

    if rows_to_insert:
        with _db_lock:
            conn = _get_conn()
            try:
                conn.executemany(
                    "INSERT INTO metrics_buffer (service_name, metric_key, node_label, val, ts_label, ts_epoch) VALUES (?, ?, ?, ?, ?, ?)",
                    rows_to_insert,
                )
                # Mantener solo los últimos 15 minutos en SQLite para que vuele
                cutoff = ts_epoch - 900
                conn.execute("DELETE FROM metrics_buffer WHERE ts_epoch < ?", (cutoff,))
                conn.commit()
            finally:
                conn.close()


def read_series_from_db(service_name, limit_per_node=25):
    init_db()
    with _db_lock:
        conn = _get_conn()
        try:
            cur = conn.execute(
                """
                SELECT metric_key, node_label, val, ts_label, ts_epoch
                FROM metrics_buffer
                WHERE service_name = ?
                ORDER BY ts_epoch ASC, id ASC
                """,
                (service_name,),
            )
            rows = cur.fetchall()
        finally:
            conn.close()

    grouped = {}
    alive_nodes = set()
    for m_key, n_lbl, val, t_lbl, _ in rows:
        alive_nodes.add(n_lbl)
        grouped.setdefault(m_key, {}).setdefault(n_lbl, list()).append({"t": t_lbl, "v": val})

    metrics_out = {}
    for m_key, nodes_dict in grouped.items():
        series_list = list()
        for n_lbl in sorted(nodes_dict.keys()):
            series_list.append({"label": n_lbl, "points": nodes_dict[n_lbl][-limit_per_node:]})
        metrics_out[m_key] = series_list

    return metrics_out, len(alive_nodes)
