import logging
from flask import Blueprint, render_template, request, session, current_app, jsonify
from app.services.cloudera_client import ClouderaClient
from app.services.json_parser import parse_to_html

dashboard_bp = Blueprint("dashboard", __name__)
logger = logging.getLogger(__name__)

def _build_client_from_session():
    if not session.get("password"):
        logger.warning("Intento de consulta AJAX sin password en sesión")
        return None
    return ClouderaClient(
        session.get("host"), session.get("port"), session.get("protocol"),
        session.get("api_ver"), session.get("user"), session.get("password")
    )

@dashboard_bp.route("/", methods=["GET", "POST"])
def index():
    cfg = current_app.config
    form = {
        "host": session.get("host", cfg["CM_DEFAULT_HOST"]),
        "port": session.get("port", cfg["CM_DEFAULT_PORT"]),
        "protocol": session.get("protocol", cfg["CM_DEFAULT_PROTOCOL"]),
        "api_ver": session.get("api_ver", cfg["CM_DEFAULT_API_VER"]),
        "user": session.get("user", cfg["CM_DEFAULT_USER"]),
        "password": session.get("password", ""),
        "custom_endpoint": ""
    }
    data = None
    error = None

    if request.method == "POST":
        form.update(request.form)
        for k in ["host", "port", "protocol", "api_ver", "user", "password"]:
            session[k] = form[k]

        logger.info(f"Consultando clúster en {form['protocol']}://{form['host']}:{form['port']} ({form['api_ver']})")
        client = _build_client_from_session()
        try:
            hosts = client.get_hosts()
            clusters = client.get_clusters_with_services()
            custom_parsed = None

            if form["custom_endpoint"].strip():
                raw_json = client.get(form["custom_endpoint"].strip())
                custom_parsed = parse_to_html(raw_json)

            data = {"hosts": hosts, "clusters": clusters, "custom_parsed": custom_parsed}
        except Exception as e:
            logger.error(f"Fallo en consulta principal: {e}")
            error = str(e)

    return render_template("index.html", form=form, data=data, error=error)

@dashboard_bp.route("/api/live-status", methods=["GET"])
def live_status():
    client = _build_client_from_session()
    if not client:
        return jsonify({"ok": False, "error": "Sesión no iniciada"}), 401
    try:
        hosts = client.get_hosts()
        clusters = client.get_clusters_with_services()
        return jsonify({"ok": True, "hosts": hosts, "clusters": clusters})
    except Exception as e:
        logger.error(f"Error en /api/live-status: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

@dashboard_bp.route("/api/service-roles", methods=["GET"])
def service_roles():
    cluster = request.args.get("cluster", "")
    service = request.args.get("service", "")
    logger.info(f"Click recibido -> cluster='{cluster}', service='{service}'")

    client = _build_client_from_session()
    if not client:
        return jsonify({"ok": False, "error": "Sesión no iniciada (vuelve a darle Consultar Estatus)"}), 401

    if not cluster or not service:
        return jsonify({"ok": False, "error": "Faltan parámetros"}), 400

    try:
        hosts_list = client.get("/hosts").get("items", [])
        hosts_map = {h.get("hostId"): h.get("hostname", "") for h in hosts_list}

        raw = client.get(f"/clusters/{cluster}/services/{service}/roles")
        items = raw.get("items", [])
        logger.info(f"Roles encontrados para {service}: {len(items)}")
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
def host_detail():
    host_id = request.args.get("host_id", "")
    logger.info(f"Inspeccionando nodo -> host_id='{host_id}'")

    client = _build_client_from_session()
    if not client:
        return jsonify({"ok": False, "error": "Sesión no iniciada (vuelve a darle Consultar Estatus)"}), 401

    if not host_id:
        return jsonify({"ok": False, "error": "Falta host_id"}), 400

    try:
        h = client.get(f"/hosts/{host_id}?view=full")
        dist = h.get("distribution", {})
        os_name = f"{dist.get('name', 'Linux')} {dist.get('version', '')}".strip() if isinstance(dist, dict) else str(dist or "Linux")

        # Mapear estado en vivo de los roles instalados en este nodo
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

        checks = []
        for chk in h.get("healthChecks", []):
            checks.append({
                "name": chk.get("name", ""),
                "summary": chk.get("summary", "UNKNOWN"),
                "explanation": chk.get("explanation", "")
            })

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
