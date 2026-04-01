import os
from dotenv import load_dotenv

load_dotenv()


def to_bool(value: str, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
API_ID_RAW = os.environ.get("API_ID", "").strip()
API_HASH = os.environ.get("API_HASH", "").strip()
DB_URL = os.environ.get("DB_URL", "").strip()

# Convert API_ID to int safely
try:
    API_ID = int(API_ID_RAW) if API_ID_RAW else 0
except ValueError:
    API_ID = 0

if not BOT_TOKEN or not API_ID or not API_HASH or not DB_URL:
    print("❌ FATAL: Missing or invalid required environment variables!")
    if not BOT_TOKEN: print("   - BOT_TOKEN is missing")
    if not API_ID: print(f"   - API_ID is missing or invalid (received: '{API_ID_RAW}')")
    if not API_HASH: print("   - API_HASH is missing")
    if not DB_URL: print("   - DB_URL is missing")
    
    # Help debug by showing available keys (but not values!)
    print(f"\nAvailable environment keys: {list(os.environ.keys())}")
    exit(1)

LOG_CHANNEL_RAW = os.environ.get("LOG_CHANNEL", "").strip()
LOG_CHANNEL = int(LOG_CHANNEL_RAW) if LOG_CHANNEL_RAW else 0
AUTH_USERS = set(int(x) for x in os.environ.get("AUTH_USERS", "").split())
DB_NAME = os.environ.get("DB_NAME", "BroadcastBot")
START_COMMAND_PHOTO_URL = os.environ.get("START_COMMAND_PHOTO_URL", "").strip()

BROADCAST_AS_COPY = to_bool(os.environ.get("BROADCAST_AS_COPY"), True)
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "10"))
UPDATE_INTERVAL = int(os.environ.get("UPDATE_INTERVAL", "2"))
