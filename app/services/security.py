from functools import wraps
from flask import session, redirect, url_for, request, jsonify, current_app
from cryptography.fernet import Fernet, InvalidToken
from app.services.cloudera_client import ClouderaClient

def _get_cipher() -> Fernet:
    key = current_app.config["SESSION_CIPHER_KEY"]
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)

def encrypt_secret(plain_text: str) -> str:
    return _get_cipher().encrypt(plain_text.encode("utf-8")).decode("utf-8")

def decrypt_secret(cipher_text: str) -> str | None:
    if not cipher_text:
        return None
    try:
        return _get_cipher().decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception):
        return None

def validate_cloudera_login(host: str, port: str, protocol: str, api_ver: str, user: str, password: str) -> tuple[bool, str]:
    """Verifica credenciales reales haciendo un ping autenticado a Cloudera Manager."""
    try:
        client = ClouderaClient(host, port, protocol, api_ver, user, password)
        # /clusters o /tools/echo son ligeros y exigen credenciales válidas
        client.get("/clusters")
        return True, ""
    except Exception as e:
        err_msg = str(e)
        if "401" in err_msg:
            return False, "Usuario o contraseña de Cloudera incorrectos (HTTP 401)."
        if "ConnectionError" in err_msg or "Timeout" in err_msg or "Max retries" in err_msg:
            return False, f"No se pudo conectar con {protocol}://{host}:{port}. Verifica IP, puerto o VPN."
        return False, f"Error de autenticación: {err_msg}"

def get_authenticated_client() -> ClouderaClient | None:
    """Construye el ClouderaClient descifrando la contraseña de la sesión."""
    enc_pwd = session.get("enc_password")
    password = decrypt_secret(enc_pwd)
    if not password or not session.get("user"):
        return None
    return ClouderaClient(
        session.get("host"),
        session.get("port"),
        session.get("protocol"),
        session.get("api_ver"),
        session.get("user"),
        password
    )

def cm_login_required(f):
    """Decorador que protege tanto vistas HTML como rutas JSON /api/*."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get("enc_password") or not decrypt_secret(session.get("enc_password")):
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"ok": False, "error": "Sesión expirada. Recarga e inicia sesión nuevamente."}), 401
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return decorated_function

