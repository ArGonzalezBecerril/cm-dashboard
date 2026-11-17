import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    CM_DEFAULT_HOST = os.getenv("CM_DEFAULT_HOST", "10.180.220.177")
    CM_DEFAULT_PORT = os.getenv("CM_DEFAULT_PORT", "7180")
    CM_DEFAULT_PROTOCOL = os.getenv("CM_DEFAULT_PROTOCOL", "http")
    CM_DEFAULT_API_VER = os.getenv("CM_DEFAULT_API_VER", "v19")
    CM_DEFAULT_USER = os.getenv("CM_DEFAULT_USER", "admin")
