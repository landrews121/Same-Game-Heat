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

-- ── Social Studio: auditable pick snapshots and content drafts ──────────────

create table if not exists social_pick_snapshots (
  id text primary key,
  slate_date date not null,
  sport text not null,
  snapshot_hash text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists social_content (
  id text primary key,
  content_type text not null,
  slate_date date not null,
  sport text not null,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_content_status_check check (
    status in ('draft', 'ready_for_review', 'approved', 'scheduled', 'published', 'failed', 'archived')
  ),
  constraint social_content_type_check check (
    content_type in ('DAILY_3', 'BEST_BET', 'PICK_BREAKDOWN', 'DAILY_RESULTS', 'WEEKLY_RESULTS')
  )
);

create table if not exists social_content_snapshots (
  content_id text not null references social_content(id) on delete cascade,
  snapshot_id text not null references social_pick_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (content_id, snapshot_id)
);

create table if not exists social_graphics (
  id text primary key,
  social_content_id text not null references social_content(id) on delete cascade,
  content_type text not null,
  slate_date date not null,
  format text not null,
  width integer not null,
  height integer not null,
  template_version text not null,
  render_version text not null,
  status text not null default 'rendered',
  asset_path text,
  asset_url text,
  mime_type text not null default 'image/svg+xml',
  file_size integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint social_graphics_status_check check (
    status in ('rendered', 'approved', 'failed', 'archived')
  ),
  constraint social_graphics_format_check check (
    format in ('feed', 'story', 'square')
  )
);

create table if not exists social_pick_results (
  id text primary key,
  snapshot_id text not null references social_pick_snapshots(id) on delete restrict,
  snapshot_hash text not null,
  slate_date date not null,
  sport text not null,
  game_id text not null,
  status text not null,
  result text not null,
  frozen_odds integer,
  home_score integer,
  away_score integer,
  winning_team text,
  source text not null,
  source_game_status text,
  game_completed_at text,
  settled_at timestamptz,
  grading_version text not null,
  result_hash text not null,
  unit_stake numeric,
  units_won_lost numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_pick_results_status_check check (
    status in ('settled', 'pending', 'manual_review')
  ),
  constraint social_pick_results_result_check check (
    result in ('PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID', 'MANUAL_REVIEW')
  )
);

create table if not exists social_publications (
  id text primary key,
  social_content_id text not null references social_content(id) on delete restrict,
  social_graphic_id text not null references social_graphics(id) on delete restrict,
  platform text not null,
  account_id text,
  publication_type text not null,
  status text not null,
  container_id text,
  platform_media_id text,
  permalink text,
  asset_url text,
  asset_hash text not null,
  caption text not null,
  api_version text,
  payload jsonb not null default '{}'::jsonb,
  requested_at timestamptz,
  published_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_publications_platform_check check (
    platform in ('instagram')
  ),
  constraint social_publications_type_check check (
    publication_type in ('FEED_IMAGE', 'STORY_IMAGE')
  )
);

create index if not exists social_pick_snapshots_slate_idx on social_pick_snapshots (slate_date, sport);
create index if not exists social_content_slate_idx on social_content (slate_date, sport, status);
create index if not exists social_content_status_idx on social_content (status, updated_at);
create index if not exists social_graphics_content_idx on social_graphics (social_content_id, status);
create index if not exists social_graphics_slate_idx on social_graphics (slate_date, content_type, format);
create index if not exists social_pick_results_slate_idx on social_pick_results (slate_date, sport, status);
create index if not exists social_pick_results_snapshot_idx on social_pick_results (snapshot_id, result);
create index if not exists social_pick_results_settled_idx on social_pick_results (settled_at);
create index if not exists social_publications_graphic_idx on social_publications (social_graphic_id, platform, account_id, status);
create index if not exists social_publications_content_idx on social_publications (social_content_id, status);
create index if not exists social_publications_published_idx on social_publications (published_at);

-- ── Row-Level Security ────────────────────────────────────────

alter table slate_props enable row level security;
alter table saved_boards enable row level security;
alter table mlb_park_factors enable row level security;
alter table mlb_pitchers enable row level security;
alter table social_pick_snapshots enable row level security;
alter table social_content enable row level security;
alter table social_content_snapshots enable row level security;
alter table social_graphics enable row level security;
alter table social_pick_results enable row level security;
alter table social_publications enable row level security;

create policy "service_role_all_slate_props" on slate_props
  for all to service_role using (true) with check (true);

create policy "service_role_all_saved_boards" on saved_boards
  for all to service_role using (true) with check (true);

create policy "service_role_all_mlb_park_factors" on mlb_park_factors
  for all to service_role using (true) with check (true);

create policy "service_role_all_mlb_pitchers" on mlb_pitchers
  for all to service_role using (true) with check (true);

create policy "service_role_all_social_pick_snapshots" on social_pick_snapshots
  for all to service_role using (true) with check (true);

create policy "service_role_all_social_content" on social_content
  for all to service_role using (true) with check (true);

create policy "service_role_all_social_content_snapshots" on social_content_snapshots
  for all to service_role using (true) with check (true);

create policy "service_role_all_social_graphics" on social_graphics
  for all to service_role using (true) with check (true);

create policy "service_role_all_social_pick_results" on social_pick_results
  for all to service_role using (true) with check (true);

create policy "service_role_all_social_publications" on social_publications
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
