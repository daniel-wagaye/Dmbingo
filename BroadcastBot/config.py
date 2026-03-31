import os
from dotenv import load_dotenv

load_dotenv()


def to_bool(value: str, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
API_ID = int(os.environ.get("API_ID", "0"))
API_HASH = os.environ.get("API_HASH", "")
LOG_CHANNEL_RAW = os.environ.get("LOG_CHANNEL", "").strip()
LOG_CHANNEL = int(LOG_CHANNEL_RAW) if LOG_CHANNEL_RAW else 0
AUTH_USERS = set(int(x) for x in os.environ.get("AUTH_USERS", "").split())
DB_URL = os.environ.get("DB_URL", "")
DB_NAME = os.environ.get("DB_NAME", "BroadcastBot")
START_COMMAND_PHOTO_URL = os.environ.get("START_COMMAND_PHOTO_URL", "").strip()

BROADCAST_AS_COPY = to_bool(os.environ.get("BROADCAST_AS_COPY"), True)
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "10"))
UPDATE_INTERVAL = int(os.environ.get("UPDATE_INTERVAL", "2"))
