import logging
from flask import Blueprint, render_template, request, session, redirect, url_for, current_app
from app.services.security import validate_cloudera_login, encrypt_secret, decrypt_secret

auth_bp = Blueprint("auth", __name__)
logger = logging.getLogger(__name__)

@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    # Si ya tiene sesión activa válida, mandar directo al dashboard
    if session.get("enc_password") and decrypt_secret(session.get("enc_password")):
        return redirect(url_for("dashboard.index"))

    cfg = current_app.config
    form = {
        "host": session.get("last_host", cfg["CM_DEFAULT_HOST"]),
        "port": session.get("last_port", cfg["CM_DEFAULT_PORT"]),
        "protocol": session.get("last_protocol", cfg["CM_DEFAULT_PROTOCOL"]),
        "api_ver": session.get("last_api_ver", cfg["CM_DEFAULT_API_VER"]),
        "user": session.get("last_user", cfg["CM_DEFAULT_USER"]),
    }
    error = None

    if request.method == "POST":
        host = request.form.get("host", "").strip()
        port = request.form.get("port", "").strip()
        protocol = request.form.get("protocol", "http").strip()
        api_ver = request.form.get("api_ver", "v19").strip()
        user = request.form.get("user", "").strip()
        password = request.form.get("password", "")

        form.update({"host": host, "port": port, "protocol": protocol, "api_ver": api_ver, "user": user})

        if not all([host, port, api_ver, user, password]):
            error = "Todos los campos son obligatorios para conectar al clúster."
        else:
            ok, err_msg = validate_cloudera_login(host, port, protocol, api_ver, user, password)
            if ok:
                # Prevención de Session Fixation: limpiar antes de asignar
                session.clear()
                session.permanent = True
                session["host"] = host
                session["port"] = port
                session["protocol"] = protocol
                session["api_ver"] = api_ver
                session["user"] = user
                session["enc_password"] = encrypt_secret(password)

                logger.info(f"Login exitoso -> {user}@{protocol}://{host}:{port} ({api_ver})")
                return redirect(url_for("dashboard.index"))
            else:
                logger.warning(f"Login fallido para {user}@{host}:{port} -> {err_msg}")
                error = err_msg

    return render_template("login.html", form=form, error=error)

@auth_bp.route("/logout", methods=["POST", "GET"])
def logout():
    user = session.get("user", "desconocido")
    last_conn = {
        "last_host": session.get("host"),
        "last_port": session.get("port"),
        "last_protocol": session.get("protocol"),
        "last_api_ver": session.get("api_ver"),
        "last_user": session.get("user"),
    }
    session.clear()
    # Recordar host/usuario para comodidad al volver a entrar (sin password)
    for k, v in last_conn.items():
        if v:
            session[k] = v
    logger.info(f"Sesión cerrada para {user}")
    return redirect(url_for("auth.login"))

