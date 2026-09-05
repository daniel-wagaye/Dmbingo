-- Coupons: sent flag + auto-finish + one webhook when a coupon becomes finished.
-- Run this in the Supabase SQL editor (production).
--
-- After this runs:
-- 1. Delete any existing Dashboard Database Webhook on public.coupons (it double-fires
--    if it also matches current_uses updates).
-- 2. Add COUPON_GROUP_CHAT_ID to admin-server .env (negative Telegram group id).
-- 3. Replace REPLACE_WITH_WEBHOOK_PASS_KEY below with the same value as WEBHOOK_PASS_KEY.
-- 4. Add the admin Telegram bot to the coupon group so it can send documents.

CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS sent boolean NOT NULL DEFAULT FALSE;

-- Optional: do not rebroadcast coupons that were already finished before this column existed.
-- UPDATE public.coupons SET sent = TRUE WHERE status = 'finished';

CREATE INDEX IF NOT EXISTS idx_coupons_finished_unsent
  ON public.coupons (coupon_id)
  WHERE status = 'finished' AND sent = FALSE;

-- Last redeem (current_uses reaches max_uses_total) marks the coupon finished in the
-- same UPDATE, so the AFTER trigger can notify without changing game-server.
CREATE OR REPLACE FUNCTION public.coupons_auto_finish_when_exhausted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_uses >= NEW.max_uses_total
     AND NEW.status IS DISTINCT FROM 'finished' THEN
    NEW.status := 'finished';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coupons_auto_finish_when_exhausted ON public.coupons;
CREATE TRIGGER coupons_auto_finish_when_exhausted
BEFORE INSERT OR UPDATE ON public.coupons
FOR EACH ROW
EXECUTE PROCEDURE public.coupons_auto_finish_when_exhausted();

-- Fire HTTP only when status *becomes* finished and the winners list is still unsent.
-- Do not fire on current_uses changes, and do not fire when Finish was used with
-- "notify the user" turned off (that UPDATE sets sent = TRUE in the same statement).
CREATE OR REPLACE FUNCTION public.coupons_notify_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
BEGIN
  IF NEW.status = 'finished'
     AND OLD.status IS DISTINCT FROM 'finished'
     AND COALESCE(NEW.sent, FALSE) = FALSE THEN
    PERFORM net.http_post(
      url := 'https://admin-api.dmzone.top/webhooks/coupon-finished',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Webhook-Secret', 'REPLACE_WITH_WEBHOOK_PASS_KEY'
      ),
      body := jsonb_build_object(
        'event', 'COUPON_FINISHED',
        'coupon_id', NEW.coupon_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coupons_notify_finished ON public.coupons;
CREATE TRIGGER coupons_notify_finished
AFTER UPDATE ON public.coupons
FOR EACH ROW
EXECUTE PROCEDURE public.coupons_notify_finished();
