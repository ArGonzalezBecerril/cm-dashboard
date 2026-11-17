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

        data = {"hosts": hosts, "clusters": clusters, "custom_parsed": custom_parsed}
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
