CREATE TABLE users (
    telegram_id BIGINT PRIMARY KEY,
    phone_number VARCHAR(25) UNIQUE,
    username TEXT,
    first_name TEXT,
    withdrawal_wallet NUMERIC(12,2) DEFAULT 0,
    non_withdrawal_wallet NUMERIC(12,2) DEFAULT 0,
    referral_count INT DEFAULT 0,
    last_referred_date TIMESTAMPTZ,
    language TEXT CHECK (language IN ('en','am')) DEFAULT 'en',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admins (
  admin_id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  login_password_hash TEXT NOT NULL,
  action_password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','withdrawal_admin')),
  first_name TEXT,
  last_name TEXT,
  email_address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  failed_login_attempts SMALLINT DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE TABLE deposits (
    deposit_id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    bank TEXT,
    amount NUMERIC(12,2) NOT NULL,
    txn_reference TEXT UNIQUE,
    status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE regex_config (
  id BIGSERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL UNIQUE,
  regex_json JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE withdrawals_request (
    withdrawal_id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    bank TEXT,
    account_holder_name TEXT,
    account_num TEXT,
    amount NUMERIC(12,2) NOT NULL,
    status TEXT CHECK (status IN ('pending','approved','declined')) DEFAULT 'pending',
    declined_reason TEXT,
    admin_tx_number TEXT,
    admin_first_name TEXT,
    processed_by BIGINT REFERENCES admins(admin_id),
    text_status TEXT CHECK (text_status IN ('pending','processing','sent','finished')) DEFAULT 'pending',
    tg_message_id BIGINT,
    attempts INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE bank_data (
    id SMALLINT PRIMARY KEY,
    bank_name TEXT,
    account_number TEXT,
    account_holder_name TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

CREATE TABLE transfer_history (
    transfer_id BIGSERIAL PRIMARY KEY,
    sender_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
    receiver_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
    wallet TEXT,
    amount NUMERIC(12,2) NOT NULL,
    commission NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE game_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    stake_amount NUMERIC(12,2) NOT NULL DEFAULT 10,
    picking_countdown_end_time INT NOT NULL DEFAULT 30,
    minimum_player SMALLINT NOT NULL DEFAULT 2,
    prize_percent INT DEFAULT 80,
    referral_amount NUMERIC(12,2) NOT NULL DEFAULT 10,
    referral_monthly_limit INT NOT NULL DEFAULT 10,
    registration_bonus NUMERIC(12,2) NOT NULL DEFAULT 10,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE games (
    game_id BIGSERIAL PRIMARY KEY,
    phase TEXT CHECK (phase IN ('picking','started','winner_reveal','error','maintenance','finished')) DEFAULT 'picking',
    active_players SMALLINT DEFAULT 0,
    shuffled_nums JSONB,
    calling_started BOOLEAN DEFAULT FALSE,
    picking_ends_at TIMESTAMPTZ,
    winner_reveal_ends_at TIMESTAMPTZ,
    called_index INTEGER NOT NULL DEFAULT 0,
    minimum_player SMALLINT NOT NULL,
    stake_amount NUMERIC(12,2) NOT NULL,
    prize_amount NUMERIC(12,2),
    house_profit NUMERIC(12,2),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE player_picks (
    board_id SMALLINT PRIMARY KEY,
    bingo_card JSONB NOT NULL,
    telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    game_id BIGINT REFERENCES games(game_id) ON DELETE SET NULL,
    withdrawal_used NUMERIC(12,2) NOT NULL CHECK (withdrawal_used >= 0),
    non_withdrawal_used NUMERIC(12,2) NOT NULL CHECK (non_withdrawal_used >= 0),
    winner BOOLEAN DEFAULT FALSE,
    invalid BOOLEAN DEFAULT FALSE,
    winner_name TEXT,
    picked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE winners_history (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT REFERENCES games(game_id) ON DELETE SET NULL,
    telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    board_id SMALLINT,
    credited_amount NUMERIC(12,2),
    won_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE referrals_history (
    referral_id BIGSERIAL PRIMARY KEY,
    referrer_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    referred_user_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
    rewarded BOOLEAN DEFAULT FALSE,
    rewarded_amount NUMERIC(12,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coupons (
  coupon_id BIGSERIAL PRIMARY KEY,
  coupon_code TEXT NOT NULL UNIQUE,
  coupon_prize NUMERIC(12,2) NOT NULL CHECK (coupon_prize > 0),
  credit_wallet TEXT NOT NULL CHECK (credit_wallet IN ('withdrawal', 'non_withdrawal')),
  max_uses_total INT NOT NULL CHECK (max_uses_total >= 1),
  current_uses INT NOT NULL DEFAULT 0 CHECK (current_uses >= 0),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('active','expired','finished')) DEFAULT 'active',
  created_by_admin BIGINT REFERENCES admins(admin_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coupon_history (
  claimed_id BIGSERIAL PRIMARY KEY,
  coupon_id BIGINT REFERENCES coupons(coupon_id) ON DELETE SET NULL,
  user_telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
  credited_amount NUMERIC(12,2),
  credit_wallet TEXT,
  UNIQUE (coupon_id, user_telegram_id),
  claimed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE support_team_lookup (
   support_id BIGSERIAL PRIMARY KEY,
   telegram_id BIGINT UNIQUE NOT NULL,
   is_active BOOLEAN DEFAULT TRUE,
   created_at TIMESTAMPTZ DEFAULT NOW(),
   updated_at TIMESTAMPTZ
);

CREATE TABLE admin_actions (
    action_id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT REFERENCES admins(admin_id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_id BIGINT,
    target_type TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admin_credit_history (
     credit_id BIGSERIAL PRIMARY KEY,
     amount NUMERIC(12,2),
     credited_wallet TEXT,
     telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE admin_otps (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT REFERENCES admins(admin_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  sent_to TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  attempts SMALLINT DEFAULT 0,
  ip_address TEXT,
  user_agent TEXT
);
