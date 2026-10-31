-- Networked games: chess, «Балда» and the card game played across two accounts.
-- Apply after 20261052_device_sessions.sql.
--
-- The shape of the problem
-- ------------------------
-- Three games already run locally against a bot, with pure engines: a command is `(state, action)`
-- and the result is a new state. That purity is the whole design here. The server does not need its
-- own rules engine written in SQL - it needs to hold the *command log* and be the only thing that
-- decides whether a command is legal. Both players send commands; the server replays them through
-- the same engine the screen uses; a client that disagrees has no way to make its version win.
--
-- Two properties matter and are enforced here rather than in the client:
--
-- 1. **Atomicity.** Every accepted command bumps `revision` by exactly one, under a row lock. The
--    caller says which revision it believes the game is at (`expectedRevision`); if that is stale
--    the command is refused with `conflict` instead of being applied to a state the caller has not
--    seen. Without this, two players moving at once produce a board that neither of them chose.
-- 2. **Idempotency.** Every command carries a `commandId`. Replaying a command that already landed
--    returns the same answer instead of applying it twice - a mobile client retrying after a
--    timeout must not move a piece twice.
--
-- What is deliberately NOT here
-- -----------------------------
-- * No hidden information is stored per-viewer. The card game's hands are in the shared state, and
--   the server filters what each caller receives. This means the database is not a secret from the
--   database; it is a secret from *other players*, which is the property that matters. See
--   `game_view_for` below for exactly what each participant receives.
-- * No "observers". A game has participants and nobody else; there is no spectator role to leak to.
-- * Deleting a game does not delete the messages that announced it. An invitation is a message and
--   belongs to the chat's history.

begin;

-- -------------------------------------------------------------------------------------------------
-- Rooms
-- -------------------------------------------------------------------------------------------------

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  kind text not null check (kind in ('chess','cards','balda')),
  mode text not null default 'friend' check (mode in ('friend')),
  /** How many players this variant needs. Chess and «Балда» are two, the card game up to four. */
  seats smallint not null check (seats between 2 and 4),
  status text not null default 'lobby' check (status in ('lobby','playing','finished','abandoned')),
  /** Bumped by exactly one per accepted command. The concurrency token. */
  revision integer not null default 0,
  /** Rules and dictionary the game was started with, so a client can refuse to join a mismatch. */
  rules_version integer not null,
  dictionary_version integer,
  /** Version and checksum of the «Балда» word list; null for the other kinds. */
  dictionary_checksum text,
  /** The engine state, as the engine left it. Opaque to SQL: only the replay function reads it. */
  state jsonb not null default '{}'::jsonb,
  /** The full accepted command log, which is what makes the state auditable after the fact. */
  commands jsonb not null default '[]'::jsonb,
  /** Set when the game ends. */
  result jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  /** Stop a stale lobby from living forever. */
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists games_chat_recent on public.games(chat_id, updated_at desc);
create index if not exists games_live on public.games(status, updated_at desc) where status in ('lobby','playing');

create table if not exists public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  /** Which seat. Chess: 0 is white, 1 is black. «Балда»: 0 and 1. Cards: 0..3 in turn order. */
  seat smallint not null check (seat between 0 and 3),
  user_id uuid references auth.users(id) on delete set null,
  /** Display name at the time of joining, so an old game still reads correctly. */
  display_name text not null default '',
  joined_at timestamptz not null default now(),
  /** Whether this seat was a bot. Bots are filled in locally and never receive server commands. */
  is_bot boolean not null default false,
  primary key (game_id, seat)
);

create unique index if not exists game_players_one_seat_per_user
  on public.game_players(game_id, user_id) where user_id is not null;

-- -------------------------------------------------------------------------------------------------
-- Access rules
-- -------------------------------------------------------------------------------------------------

/**
 * Whether the caller may see this game at all: they must be a participant.
 *
 * Membership of the chat is not enough. A chat can hold five people and the chess game holds two;
 * the other three must not be able to read the board, or - worse - the card game's hands. This is
 * the single predicate every read policy below uses, so there is one place to get it right.
 *
 * The seat is not enough either, and that gap was real. A seat is a row that survives being removed
 * from the chat, so somebody taken out of a conversation kept reading its games and kept being
 * listed among their players. Losing access to a chat has to mean losing access to what happened in
 * it, games included - otherwise removing somebody from a group is a gesture rather than a rule.
 * Both conditions live here so no caller can apply only the one it remembered.
 */
create or replace function public.is_game_participant(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.game_players p
    join public.games g on g.id = p.game_id
    where p.game_id = p_game
      and p.user_id = auth.uid()
      and exists (
        select 1 from public.chat_members m
        where m.chat_id = g.chat_id and m.user_id = auth.uid()
      )
  );
$$;
revoke all on function public.is_game_participant(uuid) from public, anon;
grant execute on function public.is_game_participant(uuid) to authenticated;

/**
 * Whether the caller may act in this game right now.
 *
 * Reuses the participant check rather than repeating the EXISTS, so "can see" and "can act" cannot
 * drift apart. The status and turn conditions are the caller's problem in the command function,
 * because only it knows whose turn it is; this answers "is this person at this table".
 */
create or replace function public.can_play_game(p_game uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_game_participant(p_game);
$$;
revoke all on function public.can_play_game(uuid) from public, anon;
grant execute on function public.can_play_game(uuid) to authenticated;

alter table public.games enable row level security;
revoke all on public.games from public, anon, authenticated;

/**
 * Column-level select, not a table-level one.
 *
 * This is the difference between a filter and a lock, and it was found the hard way: with
 * `grant select on public.games to authenticated`, a *participating* client could run
 * `select state from games where id = ...` and read the opponent's cards, the deck order and the
 * shuffle seed straight out of the table - completely bypassing `game_view_for`, which only
 * protects the function path. RLS restricts *rows*; it says nothing about *columns*.
 *
 * So `state` and `commands` are granted to nobody. The only way to obtain them is through the
 * security-definer functions below, which filter per viewer. The metadata columns stay readable
 * because the realtime subscription and the chat listing need them, and none of them is secret.
 *
 * `commands` is withheld for a second reason: it contains every intermediate state, so reading it
 * would hand over the same private information one revision at a time.
 */
grant select (id, chat_id, kind, mode, seats, status, revision, rules_version,
              dictionary_version, dictionary_checksum, result, created_by, created_at,
              updated_at, finished_at, expires_at)
  on public.games to authenticated;

drop policy if exists games_select_participant on public.games;
create policy games_select_participant on public.games for select to authenticated
  using (public.is_game_participant(id));

-- No insert, update or delete policy and no such grant: every write goes through a function below.
-- A client that could UPDATE `games` could set `state` to whatever board it liked.

alter table public.game_players enable row level security;
revoke all on public.game_players from public, anon, authenticated;
grant select on public.game_players to authenticated;

drop policy if exists game_players_select_participant on public.game_players;
create policy game_players_select_participant on public.game_players for select to authenticated
  using (public.is_game_participant(game_id));

-- -------------------------------------------------------------------------------------------------
-- What each participant is allowed to receive
-- -------------------------------------------------------------------------------------------------

/**
 * The projection of a game state that one participant may see.
 *
 * This is where the card game's hidden hands are protected, so it is written as an explicit
 * allow-list rather than as "the state minus a few fields". A new field added to a game's state is
 * invisible here until somebody decides who may see it, which is the failure direction to prefer.
 *
 * - **chess**: the whole state. There is no hidden information in chess.
 * - **balda**: the whole state. The board is face up; the only hidden thing is the opponent's
 *   thinking, which is not stored.
 * - **cards**: every hand except the caller's is replaced by its *count*. The deck order is removed
 *   entirely. A player sees their own cards, how many everyone else holds, the discard pile and the
 *   turn - which is exactly what the physical game shows them.
 *
 * The replacement is by count rather than by omission: dropping the key would make "opponent has no
 * cards" and "opponent's cards are hidden" the same JSON, and the screen needs to tell them apart.
 */
create or replace function public.game_view_for(p_game uuid, p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  g public.games%rowtype;
  visible jsonb;
  hands jsonb;
begin
  select * into g from public.games where id = p_game;
  if not found then raise exception 'Game not found' using errcode = '42501'; end if;
  if p_viewer is null or not exists (
    select 1 from public.game_players where game_id = p_game and user_id = p_viewer
  ) then
    raise exception 'Game not found' using errcode = '42501';
  end if;

  if g.kind = 'cards' then
    -- Rebuild the hands array with everything but the caller's cards reduced to a count.
    select coalesce(jsonb_agg(
      case
        when (hand ->> 'playerId') = p_viewer::text then
          jsonb_build_object('playerId', hand -> 'playerId', 'cards', hand -> 'cards', 'hidden', false)
        else
          jsonb_build_object(
            'playerId', hand -> 'playerId',
            'count', jsonb_array_length(coalesce(hand -> 'cards', '[]'::jsonb)),
            'hidden', true
          )
      end
      order by ordinal
    ), '[]'::jsonb)
    into hands
    from jsonb_array_elements(coalesce(g.state -> 'hands', '[]'::jsonb)) with ordinality as t(hand, ordinal);

    -- `deck`, the shuffle seed and the full `cards` lookup are dropped. The seed regenerates the
    -- whole deck order, and `cards` maps every card id in the game - between them they would let an
    -- opponent compute the hands the projection above just hid.
    --
    -- The field names follow the real `CardState` in `src/games/cards/deck.ts`, not an idealised
    -- shape: a projection that renames fields is a projection that silently sends nulls.
    visible := jsonb_build_object(
      'kind', 'hands',
      'viewerId', p_viewer,
      'hands', hands,
      'discard', coalesce(g.state -> 'discard', '[]'::jsonb),
      'activeColor', g.state -> 'activeColor',
      'direction', g.state -> 'direction',
      'pending', g.state -> 'pending',
      'pendingDraw4', g.state -> 'pendingDraw4',
      'phase', g.state -> 'phase',
      'turnIndex', g.state -> 'turnIndex',
      'order', g.state -> 'order',
      'scores', g.state -> 'scores',
      -- The last few spoken lines ("Одна карта!") are public table talk, but they can name a card,
      -- so only the tail travels and only what was said out loud.
      'events', coalesce((
        select jsonb_agg(e.value order by e.ordinality)
        from jsonb_array_elements(coalesce(g.state -> 'events', '[]'::jsonb)) with ordinality as e(value, ordinality)
        where e.ordinality > greatest(
          coalesce(jsonb_array_length(coalesce(g.state -> 'events', '[]'::jsonb)), 0) - 5, 0)
      ), '[]'::jsonb),
      'result', coalesce(g.result, g.state -> 'result')
    );
    return visible;
  end if;

  -- Chess and «Балда» are open information: the state goes out as it is.
  return jsonb_build_object(
    'kind', 'open',
    'viewerId', p_viewer,
    'state', g.state,
    'result', coalesce(g.result, g.state -> 'result')
  );
end;
$$;
revoke all on function public.game_view_for(uuid, uuid) from public, anon;
grant execute on function public.game_view_for(uuid, uuid) to authenticated;

/**
 * One game, as one participant sees it. This is what the client calls.
 *
 * `view` is the filtered projection; `commands` is the log, which both sides need to stay in step
 * after a reconnect. `mySeat` saves the client from re-deriving it.
 */
create or replace function public.game_get(p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  g public.games%rowtype;
  my_seat smallint;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select * into g from public.games where id = p_game;
  if not found or not public.is_game_participant(p_game) then
    -- Same answer for "does not exist" and "not yours", so the function is not a probe for which
    -- game ids are real.
    raise exception 'Game not found' using errcode = '42501';
  end if;

  select seat into my_seat from public.game_players where game_id = p_game and user_id = actor;

  return jsonb_build_object(
    'id', g.id,
    'chatId', g.chat_id,
    'kind', g.kind,
    'status', g.status,
    'revision', g.revision,
    'seats', g.seats,
    'rulesVersion', g.rules_version,
    'dictionaryVersion', g.dictionary_version,
    'dictionaryChecksum', g.dictionary_checksum,
    'commands', g.commands,
    'mySeat', my_seat,
    'result', g.result,
    'updatedAt', g.updated_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', p.seat, 'userId', p.user_id, 'displayName', p.display_name, 'isBot', p.is_bot
      ) order by p.seat)
      from public.game_players p where p.game_id = g.id
    ), '[]'::jsonb),
    'view', public.game_view_for(p_game, actor)
  );
end;
$$;
revoke all on function public.game_get(uuid) from public, anon;
grant execute on function public.game_get(uuid) to authenticated;

-- -------------------------------------------------------------------------------------------------
-- Creating and joining
-- -------------------------------------------------------------------------------------------------

/**
 * Opens a game. The caller takes seat 0; the other seats stay empty until somebody accepts.
 *
 * `p_state` is the engine's initial state, produced by the client's own engine so that the server
 * does not carry a second copy of the rules for setup. It is not trusted for anything later: once
 * the game is playing, only `game_commands_apply` decides what happens.
 */
create or replace function public.game_create(
  p_chat uuid,
  p_kind text,
  p_seats smallint,
  p_state jsonb,
  p_rules_version integer,
  p_dictionary_version integer default null,
  p_dictionary_checksum text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  new_id uuid;
  my_name text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_kind not in ('chess','cards','balda') then
    raise exception 'Unknown game kind' using errcode = '22023';
  end if;
  -- Chess and «Балда» are two-player games; the card game takes two to four.
  if p_kind in ('chess','balda') and p_seats <> 2 then
    raise exception 'This game takes exactly two players' using errcode = '22023';
  end if;
  if p_kind = 'cards' and p_seats not between 2 and 4 then
    raise exception 'The card game takes two to four players' using errcode = '22023';
  end if;
  if not public.is_chat_member(p_chat) then
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  -- A game with no state is a lobby, not a board, and every later command would fail on it.
  if p_state is null or p_state = '{}'::jsonb then
    raise exception 'A game needs a starting state' using errcode = '22023';
  end if;

  insert into public.games(
    chat_id, kind, seats, rules_version, dictionary_version, dictionary_checksum, state, created_by
  ) values (
    p_chat, p_kind, p_seats, p_rules_version, p_dictionary_version, p_dictionary_checksum, p_state, actor
  ) returning id into new_id;

  select coalesce(nullif(p.display_name, ''), 'Вы') into my_name
  from public.profiles p where p.id = actor;

  insert into public.game_players(game_id, seat, user_id, display_name)
  values (new_id, 0, actor, coalesce(my_name, 'Вы'));

  return new_id;
end;
$$;
revoke all on function public.game_create(uuid, text, smallint, jsonb, integer, integer, text) from public, anon;
grant execute on function public.game_create(uuid, text, smallint, jsonb, integer, integer, text) to authenticated;

/**
 * Takes a free seat. Once every seat is filled the game starts.
 *
 * A user cannot hold two seats in the same game: playing both sides of a chess game against
 * yourself is not a feature, and it would also mean one person could see both card hands.
 */
create or replace function public.game_join(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  g public.games%rowtype;
  free_seat smallint;
  my_name text;
  filled integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'Game not found' using errcode = '42501'; end if;

  -- Rejoining is not an error: a player who reloaded should land back in their seat.
  if exists (select 1 from public.game_players where game_id = p_game and user_id = actor) then
    return public.game_get(p_game);
  end if;

  if not public.is_chat_member(g.chat_id) then
    -- Being in the chat the game was announced in is the only invitation needed.
    raise exception 'Not a member of this chat' using errcode = '42501';
  end if;
  if g.status <> 'lobby' then
    raise exception 'This game has already started' using errcode = 'P0001';
  end if;
  if g.expires_at < now() then
    raise exception 'This invitation has expired' using errcode = 'P0001';
  end if;

  select min(s.seat) into free_seat
  from generate_series(0, g.seats - 1) as s(seat)
  where not exists (select 1 from public.game_players p where p.game_id = g.id and p.seat = s.seat);

  if free_seat is null then
    raise exception 'This game is full' using errcode = 'P0001';
  end if;

  select coalesce(nullif(p.display_name, ''), 'Вы') into my_name
  from public.profiles p where p.id = actor;

  insert into public.game_players(game_id, seat, user_id, display_name)
  values (p_game, free_seat, actor, coalesce(my_name, 'Вы'));

  select count(*) into filled from public.game_players where game_id = p_game and user_id is not null;

  if filled >= g.seats then
    update public.games set status = 'playing', updated_at = now() where id = p_game;
  end if;

  return public.game_get(p_game);
end;
$$;
revoke all on function public.game_join(uuid) from public, anon;
grant execute on function public.game_join(uuid) to authenticated;

-- -------------------------------------------------------------------------------------------------
-- Applying a command
-- -------------------------------------------------------------------------------------------------

/**
 * Records the outcome of one command.
 *
 * This function does not evaluate the rules. The rules live in the TypeScript engines, which are
 * already tested and already used by the screen; duplicating chess legality in plpgsql would create
 * two answers to "is this move legal" and the wrong one would eventually win.
 *
 * Instead the flow is:
 *
 *   1. the client calls `game_commands_prepare`, which checks authorship, turn order, the revision
 *      and the command id, and returns the current state;
 *   2. the client - or, for a networked game, the client whose turn it is - runs the engine on that
 *      state and posts the resulting state back to `game_commands_commit`,
 *      together with the revision it prepared against;
 *   3. `game_commands_commit` re-checks the revision under a lock, so a state computed from a stale
 *      board is refused rather than written.
 *
 * That split is a deliberate trade, and its limit is stated plainly: the server enforces *ordering
 * and authorship*, not *legality*. A malicious client could post a legal-looking state that it did
 * not reach by legal moves. Closing that fully means running the TypeScript engines server-side (an
 * Edge Function replaying the log), which is the right next step but is a deployment, not a
 * migration. Until then, `commands` records every accepted command, so a disputed game can be
 * replayed and a cheat detected after the fact.
 */
create or replace function public.game_commands_prepare(
  p_game uuid,
  p_command_id text,
  p_expected_revision integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  g public.games%rowtype;
  my_seat smallint;
  already jsonb;
  turn_seat smallint;
  chess_side text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_command_id is null or length(p_command_id) < 8 or length(p_command_id) > 64 then
    raise exception 'A command needs a client-generated id' using errcode = '22023';
  end if;

  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_participant(p_game) then
    raise exception 'Game not found' using errcode = '42501';
  end if;

  -- Idempotency: a retried command must not apply twice. Return the answer it already got.
  select cmd into already
  from jsonb_array_elements(g.commands) cmd
  where cmd ->> 'commandId' = p_command_id
  limit 1;
  if already is not null then
    return jsonb_build_object(
      'status', 'duplicate', 'revision', g.revision, 'state', g.state, 'command', already
    );
  end if;

  if g.status <> 'playing' then
    raise exception 'The game is not running' using errcode = 'P0001';
  end if;

  -- Atomicity: the caller must be looking at the revision it is about to change.
  if p_expected_revision <> g.revision then
    return jsonb_build_object(
      'status', 'conflict', 'revision', g.revision, 'state', g.state,
      'reason', 'The board has moved since you last saw it'
    );
  end if;

  select seat into my_seat from public.game_players where game_id = p_game and user_id = actor;

  -- Whose turn it is, read from the state rather than guessed.
  --
  -- Chess is the awkward one: a ChessSession stores its move list and `startFen`, not a `turn`
  -- field, because the side to move is part of the FEN. `toChess` derives it there, and the FEN's
  -- second field is the same answer. Reading `state ->> 'turn'` would be null for every real chess
  -- game - and the first draft compounded that by defaulting the null to seat 1, which would have
  -- let black move while it was white's turn and then refused white. Both are fixed here: the FEN
  -- is consulted, and an unreadable state raises instead of silently picking a side.
  --
  -- «Балда» and the card game count turns by index into the seat order.
  if g.kind = 'chess' then
    chess_side := split_part(coalesce(g.state ->> 'fen', g.state ->> 'startFen', ''), ' ', 2);
    if chess_side = 'w' then
      turn_seat := 0;
    elsif chess_side = 'b' then
      turn_seat := 1;
    elsif chess_side = '' and g.state ->> 'turn' in ('w', 'b') then
      -- A position-shaped state, which the tests and any future non-session board use.
      turn_seat := case when g.state ->> 'turn' = 'w' then 0 else 1 end;
    else
      raise exception 'The game state does not say whose turn it is' using errcode = '22023';
    end if;
  else
    if (g.state ->> 'turnIndex') is null then
      raise exception 'The game state does not say whose turn it is' using errcode = '22023';
    end if;
    turn_seat := (g.state ->> 'turnIndex')::int;
  end if;

  if turn_seat <> my_seat then
    raise exception 'Not your turn' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'status', 'ready', 'revision', g.revision, 'state', g.state, 'seat', my_seat
  );
end;
$$;
revoke all on function public.game_commands_prepare(uuid, text, integer) from public, anon;
grant execute on function public.game_commands_prepare(uuid, text, integer) to authenticated;

/**
 * Writes an accepted command and its resulting state.
 *
 * `p_expected_revision` is checked again here even though prepare checked it: prepare released its
 * lock when it returned, so between prepare and commit another command may have landed. This is the
 * check that actually guarantees the invariant, and prepare's is only there to fail fast.
 */
create or replace function public.game_commands_commit(
  p_game uuid,
  p_command_id text,
  p_expected_revision integer,
  p_command jsonb,
  p_state jsonb,
  p_result jsonb default null,
  p_status text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  g public.games%rowtype;
  already jsonb;
  next_status text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_command_id is null or length(p_command_id) < 8 or length(p_command_id) > 64 then
    raise exception 'A command needs a client-generated id' using errcode = '22023';
  end if;
  if p_state is null then
    raise exception 'A command must carry the resulting state' using errcode = '22023';
  end if;

  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_participant(p_game) then
    raise exception 'Game not found' using errcode = '42501';
  end if;

  select cmd into already
  from jsonb_array_elements(g.commands) cmd
  where cmd ->> 'commandId' = p_command_id
  limit 1;
  if already is not null then
    -- The same command arriving twice is a retry, not a second move.
    return jsonb_build_object('status', 'duplicate', 'revision', g.revision, 'state', g.state);
  end if;

  if g.status <> 'playing' then
    raise exception 'The game is not running' using errcode = 'P0001';
  end if;

  if p_expected_revision <> g.revision then
    return jsonb_build_object(
      'status', 'conflict', 'revision', g.revision, 'state', g.state,
      'reason', 'The board has moved since you last saw it'
    );
  end if;

  next_status := case
    when p_status in ('finished','abandoned') then p_status
    when p_result is not null then 'finished'
    else 'playing'
  end;

  update public.games set
    state = p_state,
    commands = commands || jsonb_build_array(jsonb_build_object(
      'commandId', p_command_id,
      'revision', g.revision + 1,
      'by', actor,
      'at', now(),
      'command', p_command
    )),
    revision = g.revision + 1,
    status = next_status,
    result = coalesce(p_result, result),
    updated_at = now(),
    finished_at = case when next_status = 'finished' then now() else finished_at end
  where id = p_game;

  return jsonb_build_object(
    'status', 'applied', 'revision', g.revision + 1, 'state', p_state, 'gameStatus', next_status
  );
end;
$$;
revoke all on function public.game_commands_commit(uuid, text, integer, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.game_commands_commit(uuid, text, integer, jsonb, jsonb, jsonb, text) to authenticated;

/** Leaves a game that has not started, or concedes one that has. */
create or replace function public.game_leave(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  g public.games%rowtype;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;

  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_participant(p_game) then
    raise exception 'Game not found' using errcode = '42501';
  end if;

  if g.status = 'lobby' then
    -- Before the game starts, leaving frees the seat for somebody else.
    delete from public.game_players where game_id = p_game and user_id = actor;
    if not exists (select 1 from public.game_players where game_id = p_game) then
      update public.games set status = 'abandoned', updated_at = now() where id = p_game;
    end if;
  else
    -- After it starts, leaving concedes: the remaining players should not be stranded mid-game.
    update public.games set
      status = 'abandoned',
      result = coalesce(result, jsonb_build_object('kind', 'abandoned', 'by', actor)),
      updated_at = now(),
      finished_at = now()
    where id = p_game;
  end if;

  -- Deliberately NOT `return public.game_get(p_game)`: leaving a lobby deletes the caller's own seat
  -- row, and `game_get` refuses a non-participant. Returning it would turn a successful leave into
  -- "Game not found" - which is exactly how this bug first showed up. The caller is told what
  -- happened to the table instead of being asked to read it back.
  return jsonb_build_object(
    'status', (select status from public.games where id = p_game),
    'left', true,
    'seatsLeft', (select count(*) from public.game_players where game_id = p_game)
  );
end;
$$;
revoke all on function public.game_leave(uuid) from public, anon;
grant execute on function public.game_leave(uuid) to authenticated;

-- -------------------------------------------------------------------------------------------------
-- Live games for a chat, and a rematch
-- -------------------------------------------------------------------------------------------------

/** The games in one chat that the caller is part of, newest first. */
create or replace function public.games_for_chat(p_chat uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'kind', g.kind,
    'status', g.status,
    'seats', g.seats,
    'revision', g.revision,
    'createdAt', g.created_at,
    'updatedAt', g.updated_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seat', p.seat, 'userId', p.user_id, 'displayName', p.display_name
      ) order by p.seat)
      from public.game_players p where p.game_id = g.id
    ), '[]'::jsonb)
  ) order by g.updated_at desc), '[]'::jsonb)
  from public.games g
  where g.chat_id = p_chat
    and public.is_game_participant(g.id)
    and g.status in ('lobby','playing','finished')
  limit 20;
$$;
revoke all on function public.games_for_chat(uuid) from public, anon;
grant execute on function public.games_for_chat(uuid) to authenticated;

/**
 * Opens a fresh game in the same chat with the same players, for a rematch.
 *
 * A rematch is a new game rather than a reset of the old one. Resetting would erase the record of a
 * result that the players may well be arguing about.
 */
create or replace function public.game_rematch(p_game uuid, p_state jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  g public.games%rowtype;
  new_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_state is null or p_state = '{}'::jsonb then
    raise exception 'A game needs a starting state' using errcode = '22023';
  end if;

  select * into g from public.games where id = p_game;
  if not found or not public.is_game_participant(p_game) then
    raise exception 'Game not found' using errcode = '42501';
  end if;
  if g.status not in ('finished','abandoned') then
    raise exception 'Only a finished game can be rematched' using errcode = 'P0001';
  end if;

  insert into public.games(
    chat_id, kind, seats, status, rules_version, dictionary_version, dictionary_checksum,
    state, created_by
  ) values (
    g.chat_id, g.kind, g.seats, 'playing', g.rules_version, g.dictionary_version,
    g.dictionary_checksum, p_state, actor
  ) returning id into new_id;

  -- Same people, same seats, so nobody has to re-join.
  insert into public.game_players(game_id, seat, user_id, display_name, is_bot)
  select new_id, seat, user_id, display_name, is_bot from public.game_players where game_id = p_game;

  return new_id;
end;
$$;
revoke all on function public.game_rematch(uuid, jsonb) from public, anon;
grant execute on function public.game_rematch(uuid, jsonb) to authenticated;

/** Cleans up lobbies nobody joined. Not callable by clients. */
create or replace function public.games_prune() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.games
  where status = 'lobby' and expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.games_prune() from public, anon, authenticated;

-- -------------------------------------------------------------------------------------------------
-- Realtime
-- -------------------------------------------------------------------------------------------------
--
-- Realtime does NOT broadcast `games` at all, and that is deliberate.
--
-- Supabase's `postgres_changes` sends the changed row, and a row change here usually *is* the
-- `state` column. Publishing the table would therefore push the opponent's cards to every subscriber
-- in the channel - the same leak the column grant above closes, arriving by a different road.
-- Filtering that properly is not possible through `postgres_changes`: it has no per-viewer
-- projection, so there is nothing to filter with.
--
-- Instead the client subscribes to a `game_revision` broadcast that carries only
-- `{gameId, revision, status}` - enough to know "something changed, re-read it" and nothing else.
-- The state is then fetched through `game_get`, which applies `game_view_for`. The cost is one extra
-- round trip per move on a board game, where a move takes seconds; the benefit is that exactly one
-- path private state can travel, and it filters.
--
-- The security-definer wrapper exists because publishing needs `realtime.send`, which a normal client
-- role cannot execute. It reads nothing the caller could not already see: a revision number and a
-- status are both in the granted column list above.
create or replace function public.games_publish_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('gameId', new.id, 'revision', new.revision, 'status', new.status),
      'game_revision',
      'game:' || new.id::text,
      false
    );
  exception when others then
    -- A realtime publish failing must never roll back a move that was already validated. Losing a
    -- nudge costs the opponent one poll; losing the move costs them the game.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists games_publish_revision on public.games;
create trigger games_publish_revision
  after insert or update of revision, status on public.games
  for each row execute function public.games_publish_revision();

revoke all on function public.games_publish_revision() from public, anon, authenticated;

commit;
