import os
from datetime import timedelta
from dotenv import load_dotenv
from cryptography.fernet import Fernet

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "cambia-esto-en-produccion-por-un-hash-largo")
    # Clave para cifrar la contraseña de Cloudera dentro de la sesión
    SESSION_CIPHER_KEY = os.getenv("SESSION_CIPHER_KEY", Fernet.generate_key().decode())
    
    # Endurecimiento de cookies 
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.getenv("HTTPS_ENABLED", "false").lower() == "true"
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    # Valores por defecto para el formulario de Login
    CM_DEFAULT_HOST = os.getenv("CM_DEFAULT_HOST", "10.180.220.177")
    CM_DEFAULT_PORT = os.getenv("CM_DEFAULT_PORT", "7180")
    CM_DEFAULT_PROTOCOL = os.getenv("CM_DEFAULT_PROTOCOL", "http")
    CM_DEFAULT_API_VER = os.getenv("CM_DEFAULT_API_VER", "v19")
    CM_DEFAULT_USER = os.getenv("CM_DEFAULT_USER", "admin")

