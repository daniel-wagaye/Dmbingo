import logging

from pyrogram import Client
from pyrogram import StopPropagation, filters
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup

import config
from handlers.broadcast import broadcast
from handlers.check_user import handle_user_status
from handlers.database import Database

LOG_CHANNEL = config.LOG_CHANNEL
AUTH_USERS = config.AUTH_USERS
DB_URL = config.DB_URL
DB_NAME = config.DB_NAME

db = Database(DB_URL, DB_NAME)


Bot = Client(
    "BroadcastBot",
    bot_token=config.BOT_TOKEN,
    api_id=config.API_ID,
    api_hash=config.API_HASH,
)

@Bot.on_message(filters.private)
async def _(bot, cmd):
    await handle_user_status(bot, cmd)

@Bot.on_message(filters.command("start") & filters.private)
async def startprivate(client, message):
    join_button = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("📢 Join Community", url="https://t.me/DM_Bingo")],
            [InlineKeyboardButton("🎮 Play Now", url="https://t.me/dmbingobot/startapp")],
        ]
    )
    user_name = message.from_user.first_name or "ጓደኛዬ"
    welcome_text = f"ሰላም! {user_name}\n🔥 ወደ DMbingo  እንኳን በደህና መጡ! 🎮✨\n\n🚀 ተጫወቱ፣ አሸንፉ እና ትልቅ ሽልማት ያግኙ! 💎\n\n🎯 የእርስዎ እድል ዛሬ ይጀምራል! 🌟\n💰 የሚጠብቅዎት:\n⚡️ ፈጣን ጨዋታዎች\n🎊 ትልቅ ሽልማቶች\n🎁 ቀን በቀን ትልቅ የቦነስ ስጦታወች በዚ  ግሩፕ ላይ ይለቀቃሉ\n💬Join our community to get daily reward's 💰\n🔥 አሁኑኑ ይጀምሩ እና ያሸንፉ! 🚀"
    try:
        if config.START_COMMAND_PHOTO_URL:
            await message.reply_photo(
                config.START_COMMAND_PHOTO_URL,
                caption=welcome_text,
                reply_markup=join_button,
            )
        else:
            await message.reply_text(welcome_text, reply_markup=join_button)
    except Exception as exc:
        logging.error("start photo send failed, fallback to text: %s", exc)
        await message.reply_text(welcome_text, reply_markup=join_button)
    raise StopPropagation

@Bot.on_message(filters.private & filters.command("broadcast"))
async def broadcast_handler_open(_, m):
    if m.from_user.id not in AUTH_USERS:
        print("Not Authorized")
        await m.delete()
        return
    if m.reply_to_message is None:
        await m.reply_text(
            "Reply to a message to broadcast it to all subscribers", quote=True
        )
        await m.delete()
    else:
        await broadcast(m, db)


@Bot.on_message(filters.private & filters.command("stat"))
async def sts(c, m):
    if m.from_user.id not in AUTH_USERS:
        await m.delete()
        return
    await m.reply_text(
        text=f"**Total Users in Database 📂:** `{await db.total_users_count()}`\n\n**Total Users with Notification Enabled 🔔 :** `{await db.total_notif_users_count()}`",
        quote=True
    )

print("Bot Started...")
Bot.run()
