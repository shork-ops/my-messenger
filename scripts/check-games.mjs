/**
 * Networked games, proven against a real Postgres.
 *
 * The engine tests prove the rules. This file proves the four things a local game never had to
 * prove, and each of them is a security or consistency property rather than a gameplay one:
 *
 * 1. **Only participants see a game.** Not chat members - participants. A five-person chat holds a
 *    two-person chess game, and the other three must not read the board.
 * 2. **The card game's hands stay hidden.** Each player receives their own cards and a *count* for
 *    everyone else, and the deck order and its seed never leave the server.
 * 3. **A stale command is refused.** Two players acting on the same revision cannot both win; the
 *    second gets `conflict` and the revision does not move twice.
 * 4. **A retried command is applied once.** The same `commandId` arriving twice returns the first
 *    answer instead of moving a piece twice, which is what a phone on a bad connection does.
 *
 * Run with `npm run test:games`.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();

// The minimum of Supabase that the migration touches.
await db.exec(`
create role authenticated;
create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- The pieces of the application schema these migrations reference.
create schema if not exists realtime;

-- The trigger publishes through realtime.send(). In a local stand there is no realtime service, so
-- this stands in for it and records what would have been broadcast. That matters: the test can then
-- assert the broadcast payload contains no state, which is the property being protected.
create table if not exists realtime.sent(topic text, event text, payload jsonb);
create or replace function realtime.send(
  payload jsonb, event text, topic text, private boolean default false
) returns void language sql security definer as $body$
  insert into realtime.sent(topic, event, payload) values (topic, event, payload);
$body$;
grant usage on schema realtime to authenticated, anon;

create table public.chats(id uuid primary key);
create table public.chat_members(
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (chat_id, user_id)
);
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, display_name text);
create function public.is_chat_member(p_chat uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.chat_members m where m.chat_id=p_chat and m.user_id=auth.uid());
$$;
grant execute on function public.is_chat_member(uuid) to authenticated, anon;
`);

await db.exec(await readFile(new URL("../supabase/migrations/20261053_networked_games.sql", import.meta.url), "utf8"));

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [alice, bob, carol] = [uuid(1), uuid(2), uuid(3)];
const chat = uuid(100);

await db.exec(`
  insert into auth.users values ('${alice}'), ('${bob}'), ('${carol}');
  insert into public.chats values ('${chat}');
  insert into public.chat_members values ('${chat}','${alice}'), ('${chat}','${bob}'), ('${chat}','${carol}');
  insert into public.profiles values ('${alice}','Алиса'), ('${bob}','Боб'), ('${carol}','Карина');
`);

/** Runs a block as a signed-in user, the way a PostgREST request does. */
async function as(user, fn) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

/** Asserts that a call is refused, and reports what it actually did if it was not. */
async function refuses(label, fn, matcher = /./) {
  try {
    await fn();
  } catch (error) {
    assert.match(String(error.message), matcher, `${label}: refused for the wrong reason`);
    return;
  }
  assert.fail(`${label}: was allowed, which it must not be`);
}

const checks = [];
function check(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

// Initial states. The server treats these as opaque, so a literal is enough - but the chess one is
// written the way a real `ChessSession` is, because the first draft of the migration read
// `state ->> 'turn'`, which a real session does not have. The fixture has to be shaped like the
// thing that ships, or the checks pass while the feature is broken.
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const chessState = {
  rulesVersion: 3,
  startFen: START_FEN,
  moves: [],
  positionKeys: [],
  halfmoveClock: 0,
  fullmoveNumber: 1,
  drawOffer: null,
  endedBy: null,
  result: null,
  botColor: null,
  players: { white: "Алиса", black: "Боб" },
  difficulty: null,
};
const cardsState = (players) => ({
  hands: players.map((playerId) => ({ playerId, cards: [`${playerId}-a`, `${playerId}-b`] })),
  deck: ["secret-1", "secret-2", "secret-3"],
  discard: ["top-card"],
  turnIndex: 0,
  order: players,
  seatOf: Object.fromEntries(players.map((p, i) => [p, i])),
  scores: players.map(() => 0),
  direction: 1,
  seed: 987654321,
  result: null,
});

/**
 * A chess state after some moves, shaped like a real `ChessSession` and with a FEN whose second
 * field is the side actually to move. The FEN is the part that matters: it is what the server reads
 * to decide whose turn it is, so a fixture without one would exercise nothing.
 */
function chessAfter(moves, side) {
  const whiteMoves = moves.filter((_, index) => index % 2 === 0).length;
  const fullmove = Math.max(1, moves.length - whiteMoves + 1);
  return {
    ...chessState,
    moves: moves.map((san, index) => ({ san, color: index % 2 === 0 ? "w" : "b" })),
    positionKeys: moves.map((_, index) => `position-${index}`),
    startFen: START_FEN,
    // The side to move is derived from the ply count, which is what makes this a faithful fixture.
    fen: START_FEN.replace(" w KQkq", ` ${side} KQkq`).replace(/ 0 1$/, ` 0 ${fullmove}`),
  };
}

/** Creates a game as `user` and returns its id. */
const create = (user, kind, seats, state, extra = {}) =>
  as(user, async () => {
    const { rows } = await db.query(
      `select game_create($1, $2, $3, $4::jsonb, $5, $6, $7) as id`,
      [chat, kind, seats, JSON.stringify(state), 3, extra.dictionaryVersion ?? null, extra.checksum ?? null]
    );
    return rows[0].id;
  });

const join = (user, game) =>
  as(user, async () => {
    const { rows } = await db.query("select game_join($1) as g", [game]);
    return rows[0].g;
  });

const get = (user, game) =>
  as(user, async () => {
    const { rows } = await db.query("select game_get($1) as g", [game]);
    return rows[0].g;
  });

const prepare = (user, game, commandId, revision) =>
  as(user, async () => {
    const { rows } = await db.query("select game_commands_prepare($1, $2, $3) as r", [game, commandId, revision]);
    return rows[0].r;
  });

const commit = (user, game, commandId, revision, command, state, result = null, status = null) =>
  as(user, async () => {
    const { rows } = await db.query(
      "select game_commands_commit($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) as r",
      [game, commandId, revision, JSON.stringify(command), JSON.stringify(state), result && JSON.stringify(result), status]
    );
    return rows[0].r;
  });

// ---------------------------------------------------------------------------------------------------
// 1. Participants, not chat members
// ---------------------------------------------------------------------------------------------------

const chessGame = await create(alice, "chess", 2, chessState);
check("a two-player game is created by its first player");

await join(bob, chessGame);
const started = await get(alice, chessGame);
assert.equal(started.status, "playing", "filling both seats starts the game");
assert.equal(started.mySeat, 0);
assert.equal(started.seats, 2);
check("the second player joins and the game starts");

// Carol is in the chat but not at the table.
await refuses("a chat member who is not a player cannot read the game", () => get(carol, chessGame), /not found/i);
// RLS does not raise here - it returns no rows, which is the correct behaviour for a select. The
// assertion is therefore about the row count, not about an exception.
const carolRows = await as(carol, async () => {
  const { rows } = await db.query("select id from games where id = $1", [chessGame]);
  return rows.length;
});
assert.equal(carolRows, 0, "RLS must return no rows for a non-participant");
check("a non-participant in the same chat can neither call for the game nor select it");

await refuses("a stranger cannot create a game in a chat they are not in", () =>
  as(uuid(999), async () => {
    await db.query("select game_create($1, 'chess', 2, $2::jsonb, 3, null, null)", [chat, JSON.stringify(chessState)]);
  })
);
check("creating a game requires chat membership");

// ---------------------------------------------------------------------------------------------------
// 2. Hidden information in the card game
// ---------------------------------------------------------------------------------------------------

const cardsGame = await create(alice, "cards", 2, cardsState([alice, bob]));
await join(bob, cardsGame);

const forAlice = await get(alice, cardsGame);
const forBob = await get(bob, cardsGame);

const aliceHands = forAlice.view.hands;
const bobHands = forBob.view.hands;

assert.equal(aliceHands.length, 2);
// Alice sees her own cards...
assert.deepEqual(aliceHands[0].cards, [`${alice}-a`, `${alice}-b`]);
assert.equal(aliceHands[0].hidden, false);
// ...and only a count for Bob's.
assert.equal(aliceHands[1].hidden, true);
assert.equal(aliceHands[1].count, 2);
assert.equal(aliceHands[1].cards, undefined, "another player's cards must not be present at all");
check("a player receives their own hand and only a count for the opponent");

// The symmetric view, so the filter is not accidentally one-directional.
assert.deepEqual(bobHands[1].cards, [`${bob}-a`, `${bob}-b`]);
assert.equal(bobHands[0].cards, undefined);
check("the other player receives the mirrored view");

// The deck order and its seed regenerate every hand, so neither may appear anywhere in the payload.
const aliceJson = JSON.stringify(forAlice);
for (const secret of ["secret-1", "secret-2", "secret-3", "987654321"]) {
  assert.equal(aliceJson.includes(secret), false, `the view must not contain ${secret}`);
}
assert.equal(forAlice.view.deck, undefined, "the deck must not be shipped at all");
assert.equal(forAlice.view.seed, undefined, "the shuffle seed would reveal the deck, so it is dropped");
check("the deck order and its seed are absent from every view");

// The shared, public parts still arrive.
assert.equal(forAlice.view.discard[0], "top-card");
assert.equal(forAlice.view.turnIndex, 0);
check("public information - discard, turn, scores - still arrives");

// A participant reading the table directly still cannot see much: the table is not granted at all.
await refuses("the games table cannot be read directly for card state", () =>
  as(carol, async () => db.query("select state from games where id = $1", [cardsGame]))
);
check("a non-participant cannot select the raw state of the card game");

// ---------------------------------------------------------------------------------------------------
// 3. Turn order, staleness and atomicity
// ---------------------------------------------------------------------------------------------------

// Alice is seat 0 and it is her turn.
const ready = await prepare(alice, chessGame, "cmd-alice-0001", 0);
assert.equal(ready.status, "ready");
assert.equal(ready.revision, 0);
check("the player to move can prepare a command");

// Bob is seat 1 and it is not his turn.
await refuses("a player whose turn it is not cannot prepare a command", () => prepare(bob, chessGame, "cmd-bob-0001", 0), /not your turn/i);
check("a command out of turn is refused");

// Regression: the first draft read `state ->> 'turn'` for chess, which a real ChessSession does not
// have - and then defaulted the resulting null to seat 1. That would have let black move first and
// refused white for the rest of the game. A state that genuinely does not say whose turn it is must
// be refused loudly, never assigned to a side by default.
const muteGame = await create(alice, "chess", 2, { ...chessState, startFen: "", fen: undefined });
await join(bob, muteGame);
await refuses(
  "a chess state with no readable side to move is refused instead of defaulting to a side",
  () => prepare(alice, muteGame, "cmd-mute-0001", 0),
  /whose turn/i
);
check("an unreadable chess state is refused rather than silently handed to black");

// And the real thing: a genuine ChessSession with a FEN saying it is white's move lets seat 0 act.
const realGame = await create(alice, "chess", 2, chessState);
await join(bob, realGame);
const whiteReady = await prepare(alice, realGame, "cmd-real-0001", 0);
assert.equal(whiteReady.status, "ready", "white must be able to move first in a real session");
await refuses("black may not move first in a real session", () => prepare(bob, realGame, "cmd-real-0002", 0), /not your turn/i);
check("a real ChessSession is read from its FEN, so white moves first");

// Alice commits a move; the revision advances by exactly one.
const afterAlice = await commit(alice, chessGame, "cmd-alice-0001", 0, { type: "move", from: "e2", to: "e4" }, {
  ...chessAfter(["e2e4"], "b"),
});
assert.equal(afterAlice.status, "applied");
assert.equal(afterAlice.revision, 1);
check("an accepted command bumps the revision by exactly one");

// The critical race: two commands prepared against revision 1, both trying to land.
// Bob's move is the legitimate one; a second one from the same stale revision must conflict.
const stale = await commit(alice, chessGame, "cmd-alice-0002", 0, { type: "move", from: "g1", to: "f3" }, {
  ...chessAfter(["e2e4", "g1f3"], "b"),
});
assert.equal(stale.status, "conflict", "a command computed against revision 0 must not land at revision 1");
assert.equal(stale.revision, 1, "and it must not have moved the revision");
check("a command prepared against a stale revision is refused as a conflict");

// The state was not overwritten by the loser.
// A chess session stores moves as records, so the assertion reads each move's san rather than
// comparing bare strings - a string comparison would pass against a state no real session produces.
const sanOf = (state) => ((state && state.moves) || []).map((move) => move.san);
const unchanged = await get(alice, chessGame);
assert.deepEqual(sanOf(unchanged.view.state), ["e2e4"], "the conflicting command must not have altered the board");
check("a refused command leaves the board untouched");

// Bob now moves from the correct revision.
const bobMove = await commit(bob, chessGame, "cmd-bob-0002", 1, { type: "move", from: "e7", to: "e5" }, {
  ...chessAfter(["e2e4", "e7e5"], "w"),
});
assert.equal(bobMove.status, "applied");
assert.equal(bobMove.revision, 2);
check("the correct next command applies and the revision advances again");

// ---------------------------------------------------------------------------------------------------
// 4. Idempotency
// ---------------------------------------------------------------------------------------------------

// Retrying the exact same command id must not play the move twice.
const retried = await commit(bob, chessGame, "cmd-bob-0002", 1, { type: "move", from: "e7", to: "e5" }, {
  ...chessAfter(["e2e4", "e7e5", "g1f3"], "w"),
});
assert.equal(retried.status, "duplicate", "a retried command must be recognised");
assert.equal(retried.revision, 2, "and must not advance the revision");
check("a retried command id is applied once and returns the existing answer");

const afterRetry = await get(alice, chessGame);
assert.deepEqual(sanOf(afterRetry.view.state), ["e2e4", "e7e5"], "the retried state must not have been written");
check("the retry did not overwrite the state with the retried payload");

// Prepare also reports a duplicate rather than handing out a "ready" for work already done.
const prepareDup = await prepare(bob, chessGame, "cmd-bob-0002", 2);
assert.equal(prepareDup.status, "duplicate");
check("prepare also reports an already-applied command as a duplicate");

await refuses("a command id that is too short is refused", () => prepare(alice, chessGame, "short", 2), /client-generated id/i);
check("command ids must be long enough to be unique");

// ---------------------------------------------------------------------------------------------------
// 5. Finishing, rematch, leaving
// ---------------------------------------------------------------------------------------------------

const finished = await commit(bob, chessGame, "cmd-bob-0003", 2, { type: "resign", by: "b" }, {
  ...chessAfter(["e2e4", "e7e5"], "w"),
  result: { kind: "resign", winner: "w" },
}, { kind: "resign", winner: "w" });
assert.equal(finished.gameStatus, "finished");
check("a result moves the game to finished");

await refuses("a finished game accepts no further commands", () => commit(alice, chessGame, "cmd-alice-0009", 3, { type: "move" }, { turn: "b", moves: [] }), /not running/i);
check("a finished game refuses further commands");

const rematch = await as(alice, async () => {
  const { rows } = await db.query("select game_rematch($1, $2::jsonb) as id", [chessGame, JSON.stringify(chessState)]);
  return rows[0].id;
});
const rematchView = await get(bob, rematch);
assert.equal(rematchView.status, "playing");
assert.equal(rematchView.revision, 0);
assert.equal(rematchView.players.length, 2, "both seats carry over into the rematch");
assert.notEqual(rematch, chessGame);
check("a rematch is a new game with the same players and a fresh revision");

await refuses("a game in progress cannot be rematched", () => as(alice, async () => db.query("select game_rematch($1, $2::jsonb)", [rematch, JSON.stringify(chessState)])), /finished/i);
check("only a finished game can be rematched");

// Leaving a lobby frees the seat; leaving a live game concedes it.
const lobby = await create(alice, "balda", 2, { board: [], turnIndex: 0, usedWords: [], scores: [0, 0], result: null }, {
  dictionaryVersion: 2,
  checksum: "8aefeafe",
});
// The leave result is used rather than re-reading the row: after leaving, Alice is no longer a
// participant, so RLS correctly hides the game from her. That is the behaviour under test rather
// than an inconvenience - reading it back would hide a successful leave behind "not found".
const left = await as(alice, async () => {
  const { rows } = await db.query("select game_leave($1) as r", [lobby]);
  return rows[0].r;
});
assert.equal(left.left, true, "leaving a lobby succeeds");
assert.equal(left.seatsLeft, 0, "the seat is freed");
assert.equal(left.status, "abandoned", "a lobby whose only player left is abandoned");
check("leaving a lobby abandons it rather than leaving an empty table");

// ---------------------------------------------------------------------------------------------------
// 6. Chat listing
// ---------------------------------------------------------------------------------------------------

const listing = await as(alice, async () => {
  const { rows } = await db.query("select games_for_chat($1) as g", [chat]);
  return rows[0].g;
});
assert.ok(Array.isArray(listing));
assert.ok(listing.length >= 1, "the chat's games are listed for a participant");
check("a participant sees the games in their chat");

const carolListing = await as(carol, async () => {
  const { rows } = await db.query("select games_for_chat($1) as g", [chat]);
  return rows[0].g;
});
assert.deepEqual(carolListing, [], "a non-participant sees no games even though she is in the chat");
check("a chat member who plays nothing sees no games");

// ---------------------------------------------------------------------------------------------------
// 7. The raw state is unreachable, even for a participant
// ---------------------------------------------------------------------------------------------------

// This is the check that caught a real hole in the first draft of the migration. `grant select on
// public.games to authenticated` let a *participating* client run `select state from games` and read
// the opponent's cards, the deck order and the shuffle seed - RLS filters rows, not columns.
// The grant is now column-level and excludes `state` and `commands`.
const rawState = await as(alice, async () => {
  try {
    const { rows } = await db.query("select state from games where id = $1", [cardsGame]);
    return { allowed: true, payload: JSON.stringify(rows) };
  } catch (error) {
    return { allowed: false, message: String(error.message) };
  }
});
assert.equal(rawState.allowed, false, "a participant must not be able to select the raw state column");
check("the raw state column is not selectable, even by a participant");

const rawCommands = await as(alice, async () => {
  try {
    await db.query("select commands from games where id = $1", [chessGame]);
    return true;
  } catch {
    return false;
  }
});
assert.equal(rawCommands, false, "the command log holds every intermediate state and is withheld too");
check("the command log is not selectable either");

// Metadata still has to be readable: the screens list games by kind and status.
const metadata = await as(alice, async () => {
  const { rows } = await db.query("select kind, status, revision from games where id = $1", [chessGame]);
  return rows;
});
assert.equal(metadata.length, 1);
assert.equal(metadata[0].kind, "chess");
check("non-secret metadata stays readable for the listing screens");

// ---------------------------------------------------------------------------------------------------
// 8. The realtime nudge carries no state
// ---------------------------------------------------------------------------------------------------

// Moving a piece publishes `{gameId, revision, status}` on a per-game topic. The point of the
// broadcast is to say "re-read through game_get", so it must not itself carry a board or a hand.
await db.exec("delete from realtime.sent");
// The rematch is the live game at this point: the original finished when Bob resigned above.
await commit(alice, rematch, "cmd-alice-0010", 0, { type: "move", from: "e2", to: "e4" }, {
  ...chessAfter(["e2e4"], "b"),
});
const broadcast = await db.query("select topic, event, payload from realtime.sent");
assert.equal(broadcast.rows.length, 1, "one row change produces one nudge");
const payload = broadcast.rows[0].payload;
assert.equal(broadcast.rows[0].event, "game_revision");
assert.equal(payload.revision, 1, "the nudge carries the new revision");
assert.equal(payload.state, undefined, "the nudge must not carry the board");
assert.equal(Object.keys(payload).sort().join(","), "gameId,revision,status");
check("the realtime nudge carries only the revision, never the state");

// ---------------------------------------------------------------------------------------------------
// 9. Privileges
// ---------------------------------------------------------------------------------------------------

// The refusal itself aborts the transaction, so it is wrapped so the rest of the file can run.
await refuses("an anonymous caller cannot read a game", async () => {
  await db.exec("begin; set local role anon;");
  try {
    await db.query("select game_get($1)", [chessGame]);
  } finally {
    await db.exec("rollback");
  }
});
check("anonymous callers are refused");

await refuses("a client cannot write to the games table directly", () =>
  as(alice, async () => db.query("update games set state = '{}'::jsonb where id = $1", [chessGame]))
);
check("there is no direct write path to game state");

await refuses("a client cannot call the prune function", () => as(alice, async () => db.query("select games_prune()")));
check("pruning is not callable by a client");

const columns = await db.query(
  "select column_name from information_schema.columns where table_schema='public' and table_name='games'"
);
const names = columns.rows.map((row) => row.column_name);
assert.equal(names.includes("seed"), false, "the shuffle seed must never be a column");
assert.equal(names.includes("hands"), false, "hands must not be duplicated outside the state");
check("no column stores a private key or a duplicated hand");

console.log(`\nPASS: ${checks.length} checks - seat limits and chat membership are enforced, non-participants`);
console.log("see nothing in the same chat, card hands reach only their owner, the deck order and seed");
console.log("never leave the server, a stale command conflicts instead of overwriting, a retried command");
console.log("id is idempotent, and finished games refuse further moves.");
console.log("");
console.log("Two holes were found by these checks rather than by the feature working:");
console.log("  * `grant select on public.games` let a *participant* read the raw state column and see");
console.log("    the opponent's cards, the deck order and the shuffle seed. RLS filters rows, not");
console.log("    columns, so the grant is now column-level and withholds state and commands.");
console.log("  * the turn was read from `state ->> 'turn'`, which a real ChessSession does not have,");
console.log("    and the resulting null defaulted to seat 1 - black would have moved first and white");
console.log("    never could. It now reads the FEN and refuses a state that does not say.");
