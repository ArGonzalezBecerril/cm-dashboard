import logging
import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime, timezone
from urllib.parse import quote
import urllib3
from app.services.icons import get_service_icon

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

class ClouderaClient:
    def __init__(self, host, port, protocol, api_ver, user, password):
        self.base_url = f"{protocol}://{host}:{port}/api/{api_ver}"
        self.auth = HTTPBasicAuth(user, password)

    def get(self, endpoint):
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        # Codificar espacios en rutas como /clusters/Quintana Roo/...
        safe_endpoint = quote(endpoint, safe="/?=&")
        url = f"{self.base_url}{safe_endpoint}"
        logger.info(f"GET -> {url}")
        resp = requests.get(url, auth=self.auth, verify=False, timeout=8)
        logger.info(f"RESP <- {resp.status_code} ({len(resp.content)} bytes)")
        resp.raise_for_status()
        return resp.json()


    def post(self, endpoint, payload=None):
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        safe_endpoint = quote(endpoint, safe="/?=&")
        url = f"{self.base_url}{safe_endpoint}"
        logger.info(f"POST -> {url}")
        resp = requests.post(url, json=payload, auth=self.auth, verify=False, timeout=10)
        logger.info(f"RESP <- {resp.status_code} ({len(resp.content)} bytes)")
        resp.raise_for_status()
        return resp.json()

    def get_hosts(self):
        hosts = self.get("/hosts?view=full").get("items", [])
        now = datetime.now(timezone.utc)
        for h in hosts:
            hb_str = h.get("lastHeartbeat")
            is_alive = False
            seconds_ago = None
            if hb_str:
                try:
                    hb_dt = datetime.fromisoformat(hb_str.replace("Z", "+00:00"))
                    seconds_ago = max(0, int((now - hb_dt).total_seconds()))
                    is_alive = (seconds_ago <= 120) and not h.get("maintenanceMode", False)
                except Exception:
                    is_alive = h.get("entityStatus") in ["GOOD_HEALTH", "CONCERNING_HEALTH", "NONE"]
            else:
                is_alive = not h.get("maintenanceMode", False)

            h["is_alive"] = is_alive
            h["hb_seconds"] = seconds_ago
        return hosts

    def get_clusters_with_services(self):
        clusters_raw = self.get("/clusters").get("items", [])
        clusters = []
        for c in clusters_raw:
            c_name = c["name"]
            try:
                services = self.get(f"/clusters/{c_name}/services").get("items", [])
                for s in services:
                    s["icon_svg"] = get_service_icon(s.get("type", ""))
            except Exception as e:
                logger.error(f"Error cargando servicios de {c_name}: {e}")
                services = []
            clusters.append({"name": c_name, "services": services})
        return clusters
