import asyncio
import os
from datetime import datetime
from supabase import create_client, Client
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import certifi

# Load environment variables
load_dotenv()

# ====================== CONFIG FROM .ENV ======================
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
MONGO_URI = os.environ.get("DB_URL")
DB_NAME = os.environ.get("DB_NAME", "BroadcastBot")

if not all([SUPABASE_URL, SUPABASE_KEY, MONGO_URI]):
    print("❌ Error: Missing environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DB_URL)")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
mongo_client = AsyncIOMotorClient(MONGO_URI, tlsCAFile=certifi.where())
db = mongo_client[DB_NAME]
collection = db.users

async def import_users():
    print("🔄 Connecting to Supabase and MongoDB...")
    
    all_users = []
    page = 0
    page_size = 1000
    
    print(f"📡 Fetching all users from Supabase table 'users' in pages of {page_size}...")
    
    while True:
        try:
            start_index = page * page_size
            end_index = start_index + page_size - 1
            
            print(f"  - Fetching page {page + 1} (rows {start_index}-{end_index})...")
            
            response = supabase.table("users").select("telegram_id, created_at").range(start_index, end_index).execute()
            
            if not response.data:
                break
                
            all_users.extend(response.data)
            page += 1
            
        except Exception as e:
            print(f"❌ Supabase Error during fetch: {e}")
            return

    print(f"✅ Found {len(all_users)} total users in Supabase.")

    if not all_users:
        print("ℹ️ No users to migrate.")
        return

    count_added = 0
    count_skipped = 0
    today = datetime.now().strftime("%Y-%m-%d")

    print(f"📤 Starting migration to MongoDB collection '{collection.name}'...")

    for user in all_users:
        telegram_id = user.get("telegram_id")
        if not telegram_id:
            continue

        existing = await collection.find_one({"id": int(telegram_id)})
        if existing:
            count_skipped += 1
            continue

        doc = {
            "id": int(telegram_id),
            "join_date": (user.get("created_at") or today)[:10],
            "notif": True,
            "ban_status": {
                "is_banned": False,
                "ban_duration": 0,
                "banned_on": "9999-12-31",
                "ban_reason": ""
            }
        }

        try:
            await collection.insert_one(doc)
            count_added += 1
        except Exception as e:
            print(f"⚠️ Error inserting user {telegram_id}: {e}")

    print(f"\nMigration Summary:")
    print(f"🎉 Successfully added: {count_added}")
    print(f"⏭️ Skipped (already exist): {count_skipped}")
    
    total = await collection.count_documents({})
    print(f"📊 Total users in MongoDB now: {total}")

if __name__ == "__main__":
    asyncio.run(import_users())
