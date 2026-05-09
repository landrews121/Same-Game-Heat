create table if not exists player_game_logs (
  id text primary key,
  player_name text not null,
  espn_id text,
  season integer not null,
  source text not null default 'ESPN',
  logs jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists slate_props (
  id text primary key,
  slate_date date not null,
  sport_key text not null,
  game_id text not null,
  game_label text not null,
  player_name text not null,
  market text not null,
  line numeric,
  odds integer,
  books jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists saved_boards (
  id text primary key,
  slate_date date not null,
  sport_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists slate_props_slate_date_idx on slate_props (slate_date);
create index if not exists slate_props_player_name_idx on slate_props (player_name);
create index if not exists player_game_logs_player_name_idx on player_game_logs (player_name);
create index if not exists saved_boards_slate_date_idx on saved_boards (slate_date);
