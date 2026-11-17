import logging
from flask import Flask
from app.config import Config
from app.routes.dashboard import dashboard_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.register_blueprint(dashboard_bp)
    logging.info("Cloudera API Monitor inicializado correctamente")
    return app
