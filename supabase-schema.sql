-- Same Game Heat — MLB Intelligence Platform Schema
-- Phase 1: Clean MLB-only data layer

-- ── Core MLB tables ──────────────────────────────────────────

-- Sportsbook prop lines cache (date + sport + game + player + market)
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

-- Saved user boards (board snapshot + result tracking)
create table if not exists saved_boards (
  id text primary key,
  slate_date date not null,
  sport_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- MLB park factors (30 ballparks, overrideable per season)
create table if not exists mlb_park_factors (
  team_abbr text primary key,       -- e.g. "NYY", "BOS", "LAD"
  team_name text not null,
  hr_factor numeric not null default 1.0,   -- >1 hitter-friendly, <1 pitcher-friendly
  run_factor numeric not null default 1.0,
  notes text,
  season integer not null default 2025,
  updated_at timestamptz not null default now()
);

-- MLB pitcher cache (ERA, FIP, WHIP, K/9, BB/9, HR/9, hand, team)
create table if not exists mlb_pitchers (
  id text primary key,              -- e.g. "mlb-{player_id}-{season}"
  player_id integer,
  player_name text not null,
  team_abbr text not null,
  hand text,                        -- "L" or "R"
  season integer not null,
  era numeric,
  fip numeric,
  whip numeric,
  k_per_9 numeric,
  bb_per_9 numeric,
  hr_per_9 numeric,
  innings_pitched numeric,
  games_started integer,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────

create index if not exists slate_props_slate_date_idx on slate_props (slate_date);
create index if not exists slate_props_player_name_idx on slate_props (player_name);
create index if not exists saved_boards_slate_date_idx on saved_boards (slate_date);
create index if not exists mlb_pitchers_player_name_idx on mlb_pitchers (player_name);
create index if not exists mlb_pitchers_team_idx on mlb_pitchers (team_abbr, season);

-- ── Row-Level Security ────────────────────────────────────────

alter table slate_props enable row level security;
alter table saved_boards enable row level security;
alter table mlb_park_factors enable row level security;
alter table mlb_pitchers enable row level security;

create policy "service_role_all_slate_props" on slate_props
  for all to service_role using (true) with check (true);

create policy "service_role_all_saved_boards" on saved_boards
  for all to service_role using (true) with check (true);

create policy "service_role_all_mlb_park_factors" on mlb_park_factors
  for all to service_role using (true) with check (true);

create policy "service_role_all_mlb_pitchers" on mlb_pitchers
  for all to service_role using (true) with check (true);

-- ── Seed: 2025 MLB park factors (30 teams) ───────────────────
-- Source: FanGraphs Park Factors 2024 (HR), normalized to 1.0 baseline

insert into mlb_park_factors (team_abbr, team_name, hr_factor, run_factor, season) values
  ('ARI', 'Arizona Diamondbacks',  1.04, 1.02, 2025),
  ('ATL', 'Atlanta Braves',        1.00, 1.00, 2025),
  ('BAL', 'Baltimore Orioles',     1.06, 1.04, 2025),
  ('BOS', 'Boston Red Sox',        1.01, 1.05, 2025),
  ('CHC', 'Chicago Cubs',          1.02, 1.03, 2025),
  ('CWS', 'Chicago White Sox',     1.07, 1.05, 2025),
  ('CIN', 'Cincinnati Reds',       1.11, 1.08, 2025),
  ('CLE', 'Cleveland Guardians',   0.93, 0.97, 2025),
  ('COL', 'Colorado Rockies',      1.32, 1.28, 2025),
  ('DET', 'Detroit Tigers',        0.92, 0.94, 2025),
  ('HOU', 'Houston Astros',        0.95, 0.98, 2025),
  ('KC',  'Kansas City Royals',    0.94, 0.96, 2025),
  ('LAA', 'Los Angeles Angels',    1.01, 1.00, 2025),
  ('LAD', 'Los Angeles Dodgers',   0.96, 0.97, 2025),
  ('MIA', 'Miami Marlins',         0.88, 0.92, 2025),
  ('MIL', 'Milwaukee Brewers',     0.97, 0.99, 2025),
  ('MIN', 'Minnesota Twins',       1.04, 1.02, 2025),
  ('NYM', 'New York Mets',         0.99, 1.01, 2025),
  ('NYY', 'New York Yankees',      1.09, 1.06, 2025),
  ('OAK', 'Oakland Athletics',     0.91, 0.93, 2025),
  ('PHI', 'Philadelphia Phillies', 1.03, 1.03, 2025),
  ('PIT', 'Pittsburgh Pirates',    0.90, 0.93, 2025),
  ('SD',  'San Diego Padres',      0.89, 0.93, 2025),
  ('SEA', 'Seattle Mariners',      0.90, 0.93, 2025),
  ('SF',  'San Francisco Giants',  0.87, 0.91, 2025),
  ('STL', 'St. Louis Cardinals',   0.95, 0.97, 2025),
  ('TB',  'Tampa Bay Rays',        0.98, 0.99, 2025),
  ('TEX', 'Texas Rangers',         1.06, 1.04, 2025),
  ('TOR', 'Toronto Blue Jays',     1.02, 1.02, 2025),
  ('WSH', 'Washington Nationals',  1.05, 1.03, 2025)
on conflict (team_abbr) do update set
  hr_factor = excluded.hr_factor,
  run_factor = excluded.run_factor,
  notes = excluded.notes,
  updated_at = now();
