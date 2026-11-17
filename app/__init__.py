import logging
from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from app.config import Config
from app.routes.dashboard import dashboard_bp
from app.routes.auth import auth_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri="memory://")

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    limiter.init_app(app)
    # Protege específicamente /login contra ataques de fuerza bruta
    limiter.limit("10 per minute")(auth_bp)

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)

    logging.info("Cloudera API Monitor inicializado correctamente")
    return app

