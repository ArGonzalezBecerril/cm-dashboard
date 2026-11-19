from app.services.state_db import sync_and_detect_anomalies, dismiss_missing_service, log_service_action, update_service_action_status, get_service_action_history
import logging
from flask import Blueprint, render_template, request, jsonify
from app.services.security import get_authenticated_client, cm_login_required
from app.services.json_parser import parse_to_html

dashboard_bp = Blueprint("dashboard", __name__)
logger = logging.getLogger(__name__)

@dashboard_bp.route("/", methods=["GET", "POST"])
@cm_login_required
def index():
    client = get_authenticated_client()
    custom_endpoint = ""
    custom_parsed = None
    data = None
    error = None

    if request.method == "POST":
        custom_endpoint = request.form.get("custom_endpoint", "").strip()

    try:
        hosts = client.get_hosts()
        clusters = client.get_clusters_with_services()

        if custom_endpoint:
            raw_json = client.get(custom_endpoint)
            custom_parsed = parse_to_html(raw_json)

        alerts = sync_and_detect_anomalies(clusters, client)
        data = {"hosts": hosts, "clusters": clusters, "custom_parsed": custom_parsed, "alerts": alerts}
    except Exception as e:
        logger.error(f"Fallo en consulta principal: {e}")
        error = str(e)

    return render_template("index.html", data=data, error=error, custom_endpoint=custom_endpoint)

@dashboard_bp.route("/api/live-status", methods=["GET"])
@cm_login_required
def live_status():
    client = get_authenticated_client()
    try:
        hosts = client.get_hosts()
        clusters = client.get_clusters_with_services()
        return jsonify({"ok": True, "hosts": hosts, "clusters": clusters})
    except Exception as e:
        logger.error(f"Error en /api/live-status: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@dashboard_bp.route("/api/service-roles", methods=["GET"])
@cm_login_required
def service_roles():
    cluster = request.args.get("cluster", "")
    service = request.args.get("service", "")
    client = get_authenticated_client()

    if not cluster or not service:
        return jsonify({"ok": False, "error": "Faltan parámetros"}), 400

    try:
        hosts_list = client.get("/hosts").get("items", [])
        hosts_map = {h.get("hostId"): h.get("hostname", "") for h in hosts_list}

        raw = client.get(f"/clusters/{cluster}/services/{service}/roles")
        items = raw.get("items", [])
        roles = []
        for r in items:
            h_ref = r.get("hostRef", {})
            h_id = h_ref.get("hostId", "")
            full_host = h_ref.get("hostname") or hosts_map.get(h_id) or h_id or "Sin host"
            short_host = full_host.split(".")[0]
            roles.append({
                "name": r.get("name"),
                "type": r.get("type"),
                "hostname": short_host,
                "hostId": h_id,
                "roleState": r.get("roleState", "UNKNOWN"),
                "healthSummary": r.get("healthSummary", "UNKNOWN")
            })
        return jsonify({"ok": True, "service": service, "cluster": cluster, "roles": roles})
    except Exception as e:
        logger.error(f"Error consultando roles de {service}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@dashboard_bp.route("/api/host-detail", methods=["GET"])
@cm_login_required
def host_detail():
    host_id = request.args.get("host_id", "")
    client = get_authenticated_client()

    if not host_id:
        return jsonify({"ok": False, "error": "Falta host_id"}), 400

    try:
        h = client.get(f"/hosts/{host_id}?view=full")
        dist = h.get("distribution", {})
        os_name = f"{dist.get('name', 'Linux')} {dist.get('version', '')}".strip() if isinstance(dist, dict) else str(dist or "Linux")

        role_refs = h.get("roleRefs", [])
        roles_detail = []
        services_cache = {}

        for ref in role_refs:
            c_name = ref.get("clusterName", "")
            s_name = ref.get("serviceName", "")
            r_name = ref.get("roleName", "")
            cache_key = f"{c_name}:{s_name}"

            if cache_key not in services_cache and c_name and s_name:
                try:
                    srv_roles = client.get(f"/clusters/{c_name}/services/{s_name}/roles").get("items", [])
                    services_cache[cache_key] = {sr.get("name"): sr for sr in srv_roles}
                except Exception:
                    services_cache[cache_key] = {}

            role_obj = services_cache.get(cache_key, {}).get(r_name, {})
            roles_detail.append({
                "service": s_name,
                "roleName": r_name,
                "type": role_obj.get("type", r_name),
                "roleState": role_obj.get("roleState", "UNKNOWN"),
                "healthSummary": role_obj.get("healthSummary", "UNKNOWN")
            })

        checks = [
            {
                "name": chk.get("name", ""),
                "summary": chk.get("summary", "UNKNOWN"),
                "explanation": chk.get("explanation", "")
            }
            for chk in h.get("healthChecks", [])
        ]

        payload = {
            "hostname": h.get("hostname", host_id),
            "short_host": h.get("hostname", host_id).split(".")[0],
            "ipAddress": h.get("ipAddress", "N/A"),
            "rackId": h.get("rackId", "/default"),
            "maintenanceMode": h.get("maintenanceMode", False),
            "lastHeartbeat": h.get("lastHeartbeat", "N/A"),
            "entityStatus": h.get("entityStatus", "NONE"),
            "numCores": h.get("numCores", 0),
            "numPhysicalCores": h.get("numPhysicalCores", 0),
            "ramGb": round(h.get("totalPhysMemBytes", 0) / (1024 ** 3), 1),
            "os": os_name,
            "roles": roles_detail,
            "healthChecks": checks
        }
        return jsonify({"ok": True, "host": payload})
    except Exception as e:
        logger.error(f"Error consultando detalle del nodo {host_id}: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@dashboard_bp.route("/api/tls-check", methods=["GET"])
@cm_login_required
def tls_check():
    import ssl
    import socket
    from datetime import datetime, timezone
    from flask import session

    client = get_authenticated_client()
    cm_host = session.get("host", "")
    cm_port = int(session.get("port", 7180))

    targets = []
    # Si CM corre en 7180 (HTTP), igual revisamos 7183 (TLS por defecto de CM) y el puerto configurado
    ports_to_check = list({cm_port, 7183}) if cm_port != 7183 else [7183]
    for p in ports_to_check:
        targets.append({"label": f"Cloudera Manager ({cm_host}:{p})", "host": cm_host, "port": p})

    try:
        hosts_list = client.get("/hosts").get("items", [])
        for h in hosts_list:
            hn = h.get("hostname", "")
            if hn:
                # Puerto tipico de Cloudera Agent TLS (9000)
                targets.append({"label": f"CM Agent • {hn.split('.')[0]}", "host": hn, "port": 9000})
    except Exception as e:
        logger.warning(f"No se pudieron listar hosts para TLS check: {e}")

    results = []
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    now = datetime.now(timezone.utc)
    for t in targets:
        try:
            with socket.create_connection((t["host"], t["port"]), timeout=2.5) as sock:
                with ctx.wrap_socket(sock, server_hostname=t["host"]) as ssock:
                    der = ssock.getpeercert(binary_form=True)
                    from cryptography import x509
                    cert = x509.load_der_x509_certificate(der)
                    exp = cert.not_valid_after_utc if hasattr(cert, "not_valid_after_utc") else cert.not_valid_after.replace(tzinfo=timezone.utc)
                    days_left = (exp - now).days
                    subject = cert.subject.rfc4514_string()
                    issuer = cert.issuer.rfc4514_string()
                    status = "VALID" if days_left > 30 else ("WARNING" if days_left >= 0 else "EXPIRED")
                    results.append({
                        "label": t["label"],
                        "host": t["host"],
                        "port": t["port"],
                        "status": status,
                        "daysLeft": days_left,
                        "expiresAt": exp.strftime("%Y-%m-%d %H:%M UTC"),
                        "subject": subject,
                        "issuer": issuer
                    })
        except Exception as e:
            results.append({
                "label": t["label"],
                "host": t["host"],
                "port": t["port"],
                "status": "NO_TLS",
                "daysLeft": None,
                "expiresAt": "Sin respuesta TLS / Puerto cerrado",
                "subject": str(e)[:60],
                "issuer": "-"
            })

    return jsonify({"ok": True, "certs": results})

@dashboard_bp.route("/api/service-command", methods=["POST"])
@cm_login_required
def service_command():
    from flask import session
    from app.services.state_db import log_service_action
    p = request.get_json(silent=True) or {}
    c, s, d, a = p.get("cluster", ""), p.get("service", ""), p.get("display_name", ""), p.get("action", "").lower()
    if a not in ["start", "stop", "restart"] or not c or not s:
        return jsonify({"ok": False, "error": "Parámetros inválidos"}), 400
    try:
        resp = get_authenticated_client().post(f"/clusters/{c}/services/{s}/commands/{a}")
        cmd_id = resp.get("id")
        log_service_action(c, s, d or s, a, cmd_id, session.get("user", "admin"))
        return jsonify({"ok": True, "commandId": cmd_id, "name": resp.get("name", a.upper())})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@dashboard_bp.route("/api/command-status/<int:cmd_id>", methods=["GET"])
@cm_login_required
def command_status(cmd_id):
    from app.services.state_db import update_service_action_status
    try:
        cmd = get_authenticated_client().get(f"/commands/{cmd_id}")
        active = bool(cmd.get("active", False)); success = bool(cmd.get("success", False)) if not active else None; msg = cmd.get("resultMessage") or ("Operación completada correctamente." if success else "")
        children = [{"name": ch.get("name", ""), "active": ch.get("active", False), "success": ch.get("success", None), "resultMessage": ch.get("resultMessage", "")} for ch in cmd.get("children", {}).get("items", [])]
        if not active:
            update_service_action_status(cmd_id, "SUCCESS" if success else "FAILED", msg)
        return jsonify({"ok": True, "id": cmd_id, "name": cmd.get("name", ""), "active": active, "success": success, "resultMessage": msg, "children": children})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@dashboard_bp.route("/api/service-history", methods=["GET"])
@cm_login_required
def service_history():
    from app.services.state_db import get_service_action_history, update_service_action_status
    c = request.args.get("cluster", "")
    s = request.args.get("service", "")
    items = get_service_action_history(c, s, 25)
    client = get_authenticated_client()
    for it in items:
        if it.get("status") == "RUNNING" and it.get("command_id"):
            try:
                cmd = client.get(f"/commands/{it['command_id']}")
                if not cmd.get("active", False):
                    st = "SUCCESS" if cmd.get("success", False) else "FAILED"
                    update_service_action_status(it["command_id"], st, cmd.get("resultMessage", ""))
                    it["status"] = st
            except Exception:
                pass
    return jsonify({"ok": True, "history": items})

@dashboard_bp.route("/api/service-metrics", methods=["GET"])
@cm_login_required
def service_metrics():
    from datetime import datetime, timedelta, timezone

    service = request.args.get("service", "")
    if not service:
        return jsonify({"ok": False, "error": "Falta service"}), 400

    client = get_authenticated_client()
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=30)
    from_str = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    queries = {
        "cpu_user": f"SELECT cpu_user_rate WHERE serviceName = '{service}'",
        "cpu_sys":  f"SELECT cpu_system_rate WHERE serviceName = '{service}'",
        "heap":     f"SELECT jvm_heap_used_mb WHERE serviceName = '{service}'",
        "gc_time":  f"SELECT jvm_gc_time_ms WHERE serviceName = '{service}'"
    }

    series_out = {}
    for key, tsq in queries.items():
        try:
            endpoint = f"/timeseries?query={tsq}&from={from_str}&to={to_str}"
            raw = client.get(endpoint)
            items = raw.get("items") or list()
            points = list()
            if len(items) > 0:
                first_item = next(iter(items))
                ts_list = first_item.get("timeSeries") or list()
                if len(ts_list) > 0:
                    best_ts = max(ts_list, key=lambda x: len(x.get("data") or list()))
                    data_pts = best_ts.get("data") or list()
                    for pt in data_pts[-25:]:
                        ts_raw = pt.get("timestamp", "")
                        label = ts_raw[11:19] if len(ts_raw) >= 19 else ts_raw
                        points.append({"t": label, "v": round(float(pt.get("value", 0)), 2)})
            series_out[key] = points
        except Exception as e:
            logger.warning(f"Error consultando {key} en {service}: {e}")
            series_out[key] = list()

    return jsonify({"ok": True, "service": service, "metrics": series_out})

@dashboard_bp.route("/api/hdfs-metrics", methods=["GET"])
@cm_login_required
def hdfs_metrics():
    from datetime import datetime, timedelta, timezone

    cluster = request.args.get("cluster", "")
    service = request.args.get("service", "hdfs")
    client = get_authenticated_client()

    # 0. Mapa hostId -> nombre corto real (cbgdtqroo01, cbgdtqroo02, etc.)
    host_map = {}
    try:
        hosts_data = client.get("/hosts")
        for h in (hosts_data.get("items") or list()):
            h_id = h.get("hostId", "")
            h_name = h.get("hostname", "")
            if h_id and h_name:
                host_map[h_id] = h_name.split(".")[0]
    except Exception as e:
        logger.warning(f"No se pudo mapear hostId a hostname: {e}")

    # 1. Detectar dinámicamente qué roles/nodos de HDFS están vivos (STARTED)
    alive_roles = {}
    try:
        if not cluster:
            cl_data = client.get("/clusters")
            cl_items = cl_data.get("items") or list()
            if len(cl_items) > 0:
                cluster = next(iter(cl_items)).get("name", "")
        if cluster:
            roles_data = client.get(f"/clusters/{cluster}/services/{service}/roles")
            for r in (roles_data.get("items") or list()):
                if r.get("roleState") == "STARTED":
                    r_name = r.get("name", "")
                    href = r.get("hostRef") or {}
                    raw_host = href.get("hostname") or host_map.get(href.get("hostId", ""), "nodo")
                    host_short = str(raw_host).split(".")[0]
                    r_type = r.get("type", "ROLE")
                    alive_roles[r_name] = f"{host_short} • {r_type}"
    except Exception as e:
        logger.warning(f"No se pudo filtrar roles vivos de HDFS: {e}")

    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=30)
    from_str = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    queries = {
        "cpu_user": f"SELECT cpu_user_rate WHERE serviceName = '{service}'",
        "heap":     f"SELECT jvm_heap_used_mb WHERE serviceName = '{service}'",
        "gc_time":  f"SELECT jvm_gc_time_ms WHERE serviceName = '{service}'",
        "fd_open":  f"SELECT fd_open WHERE serviceName = '{service}'"
    }

    series_out = {}
    for key, tsq in queries.items():
        try:
            raw = client.get(f"/timeseries?query={tsq}&from={from_str}&to={to_str}")
            items = raw.get("items") or list()
            multi_series = list()
            if len(items) > 0:
                ts_list = next(iter(items)).get("timeSeries") or list()
                for ts in ts_list:
                    meta = ts.get("metadata") or {}
                    attrs = meta.get("attributes") or {}
                    r_name = attrs.get("roleName") or meta.get("entityName") or ""

                    if alive_roles and r_name not in alive_roles:
                        continue

                    raw_h = attrs.get("hostname") or host_map.get(attrs.get("hostId", ""), "nodo")
                    host_short = str(raw_h).split(".")[0]
                    r_type = attrs.get("roleType") or "HDFS"
                    label = alive_roles.get(r_name, f"{host_short} • {r_type}")

                    pts = list()
                    for pt in (ts.get("data") or list())[-25:]:
                        ts_raw = pt.get("timestamp", "")
                        t_lbl = ts_raw[11:19] if len(ts_raw) >= 19 else ts_raw
                        pts.append({"t": t_lbl, "v": round(float(pt.get("value", 0)), 2)})

                    if len(pts) > 0:
                        multi_series.append({"label": label, "points": pts})

            multi_series.sort(key=lambda x: x.get("label", ""))
            series_out[key] = multi_series
        except Exception as e:
            logger.warning(f"Error en métrica HDFS {key}: {e}")
            series_out[key] = list()

    return jsonify({"ok": True, "service": service, "alive_count": len(alive_roles), "metrics": series_out})

@dashboard_bp.route("/api/metrics-stream", methods=["GET"])
@cm_login_required
def metrics_stream():
    from app.services.metrics_store import ensure_collector_running, read_series_from_db

    service = request.args.get("service", "")
    if not service:
        return jsonify({"ok": False, "error": "Falta service"}), 400

    client = get_authenticated_client()
    ensure_collector_running(service, client)
    metrics_data, alive_count = read_series_from_db(service, limit_per_node=25)
    return jsonify({"ok": True, "service": service, "alive_count": alive_count, "metrics": metrics_data})


@dashboard_bp.route("/api/metrics-stop", methods=["POST"])
@cm_login_required
def metrics_stop():
    from app.services.metrics_store import stop_all_collectors
    stop_all_collectors()
    return jsonify({"ok": True})

@dashboard_bp.route("/api/general-report", methods=["GET"])
@cm_login_required
def general_usage_report():
    from datetime import datetime, timedelta, timezone

    days = max(1, min(int(request.args.get("days", 7)), 60))
    client = get_authenticated_client()

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    from_str = start.strftime("%Y-%m-%dT%H:%M:%SZ")
    to_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    cluster_name = "Quintana Roo"
    try:
        cl_items = (client.get("/clusters").get("items") or list())
        if len(cl_items):
            c0 = next(iter(cl_items))
            cluster_name = c0.get("displayName") or c0.get("name") or cluster_name
    except Exception:
        pass

    def run_ts_first(queries_list, rollup="DAILY"):
        for tsq in queries_list:
            try:
                raw = client.get(f"/timeseries?query={tsq}&from={from_str}&to={to_str}&desiredRollup={rollup}")
                items = raw.get("items") or list()
                if len(items):
                    ts_arr = next(iter(items)).get("timeSeries") or list()
                    if len(ts_arr):
                        return ts_arr
            except Exception as e:
                logger.warning(f"[GeneralReport] Intento tsquery ({tsq}): {e}")
        return list()

    def extract_user_name(meta):
        attrs = meta.get("attributes") or {}
        u = attrs.get("userName") or attrs.get("user") or meta.get("entityName") or ""
        if "/" in u:
            u = u.rstrip("/").split("/")[-1]
        if ":" in u:
            u = u.split(":")[-1]
        return u.strip() or "hdfs"

    hdfs_bytes_ts = run_ts_first(("SELECT bytes_used WHERE category = HDFS_USER_ROOT_DIR", "SELECT total_bytes_used_across_hdfs_user_dirs WHERE serviceType = HDFS", "SELECT dfs_capacity_used WHERE serviceType = HDFS"))
    hdfs_raw_ts = run_ts_first(("SELECT bytes_used_raw WHERE category = HDFS_USER_ROOT_DIR", "SELECT total_bytes_used_raw_across_hdfs_user_dirs WHERE serviceType = HDFS"))
    hdfs_files_ts = run_ts_first(("SELECT num_files WHERE category = HDFS_USER_ROOT_DIR", "SELECT total_files_across_hdfs_user_dirs WHERE serviceType = HDFS"))

    raw_by_user = {extract_user_name(ts.get("metadata") or {}): float((ts.get("data") or list())[-1].get("value", 0)) for ts in hdfs_raw_ts if len(ts.get("data") or list())}
    files_by_user = {extract_user_name(ts.get("metadata") or {}): int(float((ts.get("data") or list())[-1].get("value", 0))) for ts in hdfs_files_ts if len(ts.get("data") or list())}

    hdfs_users = list()
    trend_dates_set = set()
    trend_by_user = {}

    for ts in hdfs_bytes_ts:
        u = extract_user_name(ts.get("metadata") or {})
        pts = ts.get("data") or list()
        if not len(pts):
            continue
        last_bytes = float(pts[-1].get("value", 0))
        r_bytes = raw_by_user.get(u, last_bytes * 3.0)
        hdfs_users.append({"user": u, "bytes_logical": int(last_bytes), "gb_logical": round(last_bytes / (1024 ** 3), 4), "mb_logical": round(last_bytes / (1024 ** 2), 2), "bytes_raw": int(r_bytes), "gb_raw": round(r_bytes / (1024 ** 3), 4), "files": files_by_user.get(u, 0)})
        for pt in pts:
            d_str = str(pt.get("timestamp", ""))[:10]
            if d_str:
                trend_dates_set.add(d_str)
                trend_by_user.setdefault(u, {})[d_str] = round(float(pt.get("value", 0)) * 3.0 / (1024 ** 3), 3)

    hdfs_users.sort(key=lambda x: x["bytes_logical"], reverse=True)
    total_logical_b = sum(x["bytes_logical"] for x in hdfs_users) or 1
    total_raw_b = sum(x["bytes_raw"] for x in hdfs_users)
    for x in hdfs_users:
        x["pct"] = round((x["bytes_logical"] / total_logical_b) * 100.0, 2)

    trend_dates = sorted(list(trend_dates_set))
    top_users_trend = [{"user": u["user"], "values": [trend_by_user.get(u["user"], {}).get(d, 0) for d in trend_dates]} for u in hdfs_users[:6]]

    impala_q_ts = run_ts_first(("SELECT queries_ingested_rate WHERE serviceType = IMPALA", "SELECT impala_queries_rate WHERE serviceType = IMPALA"))
    impala_daily = {}
    for ts in impala_q_ts:
        for pt in (ts.get("data") or list()):
            d_str = str(pt.get("timestamp", ""))[:10]
            impala_daily.setdefault(d_str, {"date": d_str, "queries": 0, "duration": 0})["queries"] += int(round(float(pt.get("value", 0)) * 86400))
    impala_rows = [impala_daily[d] for d in sorted(impala_daily.keys())]
    total_impala_queries = sum(r["queries"] for r in impala_rows)

    yarn_apps_ts = run_ts_first(("SELECT apps_ingested_rate WHERE serviceType = YARN", "SELECT apps_submitted_rate WHERE serviceType = YARN", "SELECT apps_completed_rate WHERE serviceType = YARN"))
    yarn_dur_ts = run_ts_first(("SELECT yarn_application_application_duration_rate WHERE serviceType = YARN", "SELECT allocated_memory_mb WHERE serviceType = YARN"))
    yarn_daily = {}
    for ts in yarn_apps_ts:
        for pt in (ts.get("data") or list()):
            d_str = str(pt.get("timestamp", ""))[:10]
            val_day = float(pt.get("value", 0))
            if val_day != 0 and not (val_day >= 1):
                val_day = val_day * 86400
            yarn_daily.setdefault(d_str, {"date": d_str, "apps": 0, "duration": 0})["apps"] += int(round(val_day))
    for ts in yarn_dur_ts:
        for pt in (ts.get("data") or list()):
            d_str = str(pt.get("timestamp", ""))[:10]
            yarn_daily.setdefault(d_str, {"date": d_str, "apps": 0, "duration": 0})["duration"] += int(round(float(pt.get("value", 0))))
    yarn_rows = [yarn_daily[d] for d in sorted(yarn_daily.keys())]
    total_yarn_apps = sum(r["apps"] for r in yarn_rows)

    hbase_tbl_ts = run_ts_first(("SELECT raw_size WHERE category = HBASE_TABLE", "SELECT storefile_size WHERE category = HBASE_TABLE"))
    hbase_get_ts = run_ts_first(("SELECT total_get_rate WHERE category = HBASE_TABLE", "SELECT get_request_rate WHERE category = HBASE_TABLE"))
    gets_by_tbl = {}
    for ts in hbase_get_ts:
        attrs = (ts.get("metadata") or {}).get("attributes") or {}
        tname = attrs.get("tableName") or (ts.get("metadata") or {}).get("entityName") or ""
        pts = ts.get("data") or list()
        if tname and len(pts):
            gets_by_tbl[tname] = int(round(float(pts[-1].get("value", 0)) * 86400))

    hbase_tables = list()
    ns_totals = {}
    for ts in hbase_tbl_ts:
        attrs = (ts.get("metadata") or {}).get("attributes") or {}
        tname = attrs.get("tableName") or (ts.get("metadata") or {}).get("entityName") or "tabla"
        if ":" in tname:
            parts_t = tname.split(":", 1)
            ns = parts_t.pop(0)
            tname = parts_t.pop(0)
        else:
            ns = attrs.get("namespace") or ("hbase" if tname.startswith("SYSTEM.") else "default")
        pts = ts.get("data") or list()
        if not len(pts):
            continue
        b_val = float(pts[-1].get("value", 0))
        ns_totals[ns] = ns_totals.get(ns, 0.0) + b_val
        hbase_tables.append({"table": tname, "namespace": ns, "bytes": int(b_val), "mb": round(b_val / (1024 ** 2), 3), "gets_day": gets_by_tbl.get(tname, 0)})
    hbase_tables.sort(key=lambda x: x["bytes"], reverse=True)

    top1 = next(iter(hdfs_users), {"user": "N/A", "gb_logical": 0, "gb_raw": 0, "pct": 0})
    top2 = next(iter(hdfs_users[1:2]), {"user": "N/A", "gb_logical": 0, "pct": 0})
    top_tbl = next(iter(hbase_tables), {}).get("table", "N/A")
    findings = (
        f"{top1['user']} es el principal consumidor de disco ({top1['gb_logical']} GB lógicos / {top1['gb_raw']} GB raw), representando {top1['pct']}% del total.",
        f"{top2['user']} ocupa el segundo lugar ({top2['gb_logical']} GB lógicos, {top2['pct']}% del total).",
        f"En los últimos {days} días se registraron {total_yarn_apps} aplicaciones YARN y {total_impala_queries} consultas Impala.",
        f"HBase tiene {len(hbase_tables)} tablas monitoreadas; la mayor es {top_tbl}."
    )
    return jsonify({
        "ok": True, "cluster": cluster_name, "days": days, "period": f"{start.strftime('%Y-%m-%d')} – {now.strftime('%Y-%m-%d')}",
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "kpis": {
            "total_logical_gb": round(sum(x["bytes_logical"] for x in hdfs_users) / (1024 ** 3), 2),
            "total_raw_gb": round(total_raw_b / (1024 ** 3), 2),
            "top1_user": top1["user"], "top1_gb": round(top1["gb_logical"], 2), "top1_pct": top1["pct"],
            "top2_user": top2["user"], "top2_gb": round(top2["gb_logical"], 2), "top2_pct": top2["pct"],
            "yarn_apps": total_yarn_apps, "impala_queries": total_impala_queries
        },
        "findings": findings, "hdfs_users": hdfs_users, "hdfs_trend": {"dates": trend_dates, "series": top_users_trend},
        "impala": impala_rows, "yarn": yarn_rows, "hbase_tables": hbase_tables,
        "hbase_namespaces": [{"ns": f"hbase:{k}", "bytes": int(v), "mb": round(v / (1024 ** 2), 3)} for k, v in ns_totals.items()]
    })

@dashboard_bp.route("/api/general-report/docx", methods=["GET", "POST"])
@cm_login_required
def general_report_docx():
    from flask import send_file
    from app.services.report_docx import build_usage_report_docx

    payload = request.get_json(silent=True) or {}
    if not payload:
        # Si viene por GET, generar el reporte al vuelo con el mismo endpoint
        resp = general_usage_report()
        payload = resp.get_json() if hasattr(resp, "get_json") else {}

    buf = build_usage_report_docx(payload)
    days = payload.get("days", 7)
    return send_file(
        buf,
        as_attachment=True,
        download_name=f"Reporte_Uso_Cluster_{days}d.docx",
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

@dashboard_bp.route("/api/user-session", methods=["GET"])
@cm_login_required
def user_session_info():
    from flask import session
    from app.services.metrics_store import get_cached_user, set_cached_user

    cached = get_cached_user()
    if cached:
        return jsonify(cached)

    client = get_authenticated_client()
    cluster_name = "Quintana Roo"
    try:
        cl_items = (client.get("/clusters").get("items") or list())
        if len(cl_items):
            c0 = next(iter(cl_items))
            cluster_name = c0.get("displayName") or c0.get("name") or cluster_name
    except Exception:
        pass

    uname = session.get("cm_user") or session.get("username") or getattr(client, "username", "admin")
    cm_url = getattr(client, "base_url", "https://10.180.220.177:7183")
    saved = set_cached_user(uname, cm_url, cluster_name)
    return jsonify(saved)


@dashboard_bp.route("/api/app-storage", methods=["GET"])
@cm_login_required
def app_storage_scan():
    from app.services.housekeeper import scan_storage
    return jsonify(scan_storage())


@dashboard_bp.route("/api/app-storage/clean", methods=["POST"])
@cm_login_required
def app_storage_clean():
    from app.services.housekeeper import clean_target
    payload = request.get_json(silent=True) or {}
    target_id = payload.get("target", "all")
    return jsonify(clean_target(target_id))


@dashboard_bp.route("/api/app-storage/rules", methods=["GET", "POST", "DELETE"])
@cm_login_required
def app_storage_rules():
    from app.services.housekeeper import get_rules_and_protected, add_cleanup_rule, delete_cleanup_rule
    if request.method == "GET":
        return jsonify(get_rules_and_protected())
    if request.method == "POST":
        p = request.get_json(silent=True) or {}
        return jsonify(add_cleanup_rule(p.get("pattern", ""), p.get("rule_type", "extension"), p.get("scope", "app/*"), p.get("description", "")))
    if request.method == "DELETE":
        rid = request.args.get("id", 0)
        return jsonify(delete_cleanup_rule(rid))
