-- WC26 Predictor — core schema
-- Entities per SPEC.md: tournament data, challenges, predictions, caches, points.

create extension if not exists citext;

-- enums -------------------------------------------------------------------

create type match_stage as enum ('group', 'r32', 'r16', 'qf', 'sf', 'third_place', 'final');
create type match_status as enum ('scheduled', 'timed', 'in_play', 'paused', 'finished', 'suspended', 'postponed', 'cancelled', 'awarded');
create type challenge_kind as enum ('full', 'groups', 'playoff', 'fun');
create type prediction_outcome as enum ('home', 'draw', 'away');
create type user_role as enum ('user', 'admin');
create type fun_question_type as enum ('numeric', 'pick', 'yesno');

-- profiles ----------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name citext not null unique,
  role user_role not null default 'user',
  locale text not null default 'en' check (locale in ('en', 'uk')),
  banned_at timestamptz,
  created_at timestamptz not null default now()
);

-- tournament data (written by service role / sync only) ---------------------

create table teams (
  id integer generated always as identity primary key,
  api_id integer not null unique,
  fifa_code text not null unique,
  name text not null,
  flag_emoji text not null default '🏳️',
  group_code char(1) check (group_code between 'A' and 'L')
);

create table matches (
  id integer generated always as identity primary key,
  api_id integer not null unique,
  stage match_stage not null,
  group_code char(1) check (group_code between 'A' and 'L'),
  matchday integer,
  -- FIFA match number; doubles as the knockout slot id (bracket graph key)
  fifa_match_number integer unique,
  kickoff_utc timestamptz not null,
  status match_status not null default 'scheduled',
  home_team_id integer references teams (id),
  away_team_id integer references teams (id),
  home_score integer,
  away_score integer,
  home_score_et integer,
  away_score_et integer,
  home_pens integer,
  away_pens integer,
  winner_team_id integer references teams (id),
  manually_corrected boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint group_match_has_group check (stage <> 'group' or group_code is not null)
);

create index matches_kickoff_idx on matches (kickoff_utc);
create index matches_stage_idx on matches (stage);

-- challenges ----------------------------------------------------------------

create table challenges (
  id integer generated always as identity primary key,
  kind challenge_kind not null unique,
  opens_at timestamptz,
  locks_at timestamptz,
  -- admin override: forces state regardless of timestamps
  manual_override text check (manual_override in ('open', 'locked')),
  created_at timestamptz not null default now()
);

create table challenge_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  challenge_id integer not null references challenges (id),
  hardcore boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, challenge_id)
);

create index challenge_entries_challenge_idx on challenge_entries (challenge_id);

-- redistribution log (Full challenge): one row per used stage, gen 1..5 ------

create table redistributions (
  id integer generated always as identity primary key,
  entry_id uuid not null references challenge_entries (id) on delete cascade,
  generation integer not null check (generation between 1 and 5),
  stage match_stage not null check (stage in ('r32', 'r16', 'qf', 'sf', 'final')),
  multiplier numeric(2, 1) not null check (multiplier in (0.7, 0.6, 0.5, 0.4, 0.3)),
  created_at timestamptz not null default now(),
  unique (entry_id, stage),
  unique (entry_id, generation)
);

-- predictions ----------------------------------------------------------------

-- group-stage match predictions (Full + Groups challenges)
create table match_predictions (
  id integer generated always as identity primary key,
  entry_id uuid not null references challenge_entries (id) on delete cascade,
  match_id integer not null references matches (id),
  -- always populated; for hardcore entries derived from scores by trigger
  outcome prediction_outcome not null,
  home_score integer check (home_score between 0 and 99),
  away_score integer check (away_score between 0 and 99),
  updated_at timestamptz not null default now(),
  unique (entry_id, match_id)
);

create index match_predictions_entry_idx on match_predictions (entry_id);

-- knockout bracket picks (Full + Playoff); generation 0 = original bracket,
-- 1..5 = redistribution generations
create table bracket_predictions (
  id integer generated always as identity primary key,
  entry_id uuid not null references challenge_entries (id) on delete cascade,
  generation integer not null default 0 check (generation between 0 and 5),
  -- knockout slot = FIFA match number (73..104)
  slot integer not null,
  home_team_id integer references teams (id),
  away_team_id integer references teams (id),
  winner_team_id integer not null references teams (id),
  home_score integer check (home_score between 0 and 99),
  away_score integer check (away_score between 0 and 99),
  -- casual users' optional "decided after extra time / penalties" flag
  aet_pens boolean,
  updated_at timestamptz not null default now(),
  unique (entry_id, generation, slot)
);

create index bracket_predictions_entry_idx on bracket_predictions (entry_id, generation);

-- fun challenge ---------------------------------------------------------------

create table fun_questions (
  id integer generated always as identity primary key,
  key text not null unique,
  qtype fun_question_type not null,
  max_pts integer not null,
  tolerance numeric,
  correct_numeric numeric,
  correct_text text,
  correct_bool boolean,
  sort_order integer not null default 0
);

create table fun_answers (
  id integer generated always as identity primary key,
  entry_id uuid not null references challenge_entries (id) on delete cascade,
  question_id integer not null references fun_questions (id),
  numeric_answer numeric,
  text_answer text,
  bool_answer boolean,
  updated_at timestamptz not null default now(),
  unique (entry_id, question_id)
);

create index fun_answers_entry_idx on fun_answers (entry_id);

-- live data caches (service-role writes) ---------------------------------------

create table standings_cache (
  group_code char(1) not null,
  team_id integer not null references teams (id),
  position integer not null,
  played integer not null default 0,
  won integer not null default 0,
  drawn integer not null default 0,
  lost integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  goal_difference integer not null default 0,
  points integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (group_code, team_id)
);

create table scorers_cache (
  id integer generated always as identity primary key,
  player_name text not null,
  team_id integer references teams (id),
  goals integer not null default 0,
  assists integer,
  penalties integer,
  updated_at timestamptz not null default now(),
  unique (player_name, team_id)
);

-- computed points (idempotent recompute: delete + insert per entry) ------------

create table points (
  id bigint generated always as identity primary key,
  entry_id uuid not null references challenge_entries (id) on delete cascade,
  category text not null,
  ref jsonb,
  points numeric not null,
  hardcore boolean not null default false,
  computed_at timestamptz not null default now()
);

create index points_entry_idx on points (entry_id);

create table leaderboard_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  challenge_id integer references challenges (id),
  board text not null check (board in ('global', 'hardcore')),
  user_id uuid not null references profiles (id) on delete cascade,
  rank integer not null,
  points numeric not null
);

create index leaderboard_snapshots_lookup_idx
  on leaderboard_snapshots (board, challenge_id, taken_at desc);

-- sync job log ------------------------------------------------------------------

create table sync_log (
  id bigint generated always as identity primary key,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  detail jsonb
);

-- the four challenges exist from day one; timestamps filled by seed (Stage 3)
insert into challenges (kind) values ('full'), ('groups'), ('playoff'), ('fun');
