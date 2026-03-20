-- Row-Level Security (RLS) — ensure clients see only active game
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_picks ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER function to avoid infinite recursion in RLS policies
CREATE OR REPLACE FUNCTION public.get_latest_game_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max(game_id) FROM games;
$$;

CREATE POLICY "read_latest_game_only"
  ON games FOR SELECT
  USING (game_id = get_latest_game_id());

CREATE POLICY "read_current_game_picks_only"
  ON player_picks FOR SELECT
  USING (game_id = get_latest_game_id());