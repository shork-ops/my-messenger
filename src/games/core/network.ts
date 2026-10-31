/**
 * Playing a game with another account, over the server.
 *
 * The three engines are pure: `apply(state, action)` returns a new state and nothing else. That is
 * what makes networked play possible without rewriting any of them. The server holds the command
 * log and the revision; the client that is to move runs its own engine on the state the server
 * handed it, then posts the result back with the revision it computed from. If somebody else moved
 * in between, the post is refused as a conflict and the client simply re-reads.
 *
 * The division of labour, stated plainly because it is easy to misread:
 *
 * - The **server** decides *who may act, and when*: authorship, turn order, the revision, and that
 *   a command id is applied once. It cannot be argued with by a modified client.
 * - The **client** decides *whether an action is legal*, using the same engine that draws the board.
 *   A modified client could therefore post a state it did not reach legally. What it cannot do is
 *   make that state win an argument: every command is appended to a log, and the log replays.
 *   Closing that gap properly means running the engines in an Edge Function, which is a deployment
 *   rather than a piece of client code - see `docs/NETWORKED_GAMES.md`.
 *
 * This module is the client half: turning an engine action into a command, and a server response
 * into the next thing to show. It knows nothing about React.
 */

import type { ApplyResult, GameKind } from "./types";

/** What the server says a game is. Mirrors `game_get` in `20261053_networked_games.sql`. */
export type ServerGame = {
  id: string;
  chatId: string;
  kind: GameKind;
  status: "lobby" | "playing" | "finished" | "abandoned";
  revision: number;
  seats: number;
  rulesVersion: number;
  dictionaryVersion: number | null;
  dictionaryChecksum: string | null;
  commands: ServerCommand[];
  mySeat: number | null;
  result: unknown;
  updatedAt: string;
  players: ServerPlayer[];
  view: GameView;
};

export type ServerPlayer = {
  seat: number;
  userId: string | null;
  displayName: string;
  isBot?: boolean;
};

export type ServerCommand = {
  commandId: string;
  revision: number;
  by: string;
  at: string;
  command: unknown;
};

/**
 * What one viewer is allowed to see.
 *
 * `state` is the whole board for chess and «Балда», where nothing is hidden. For the card game
 * there is no `state`: the server sends `hands` with only the viewer's own cards in it, and a count
 * for everybody else's. The two shapes are kept apart on purpose - a card client cannot accidentally
 * read a state that was never sent, because the type does not let it.
 */
export type GameView =
  | { kind: "open"; viewerId: string; state: unknown; result: unknown }
  | {
      kind: "hands";
      viewerId: string;
      hands: VisibleHand[];
      discard: string[];
      activeColor: string | null;
      direction: number | null;
      pending: unknown;
      pendingDraw4: unknown;
      phase: string | null;
      turnIndex: number | null;
      order: string[] | null;
      scores: Record<string, number> | null;
      /** The last few things said out loud, which are public table talk. */
      events: string[];
      result: unknown;
    };

export type VisibleHand =
  | { playerId: string; cards: string[]; hidden: false }
  | { playerId: string; count: number; hidden: true };

/** The three outcomes a commit can have. Anything else is a bug, and is treated as an error. */
export type CommitOutcome =
  | { status: "applied"; revision: number; state: unknown; gameStatus: string }
  | { status: "conflict"; revision: number; state: unknown; reason?: string }
  | { status: "duplicate"; revision: number; state: unknown };

/** Why a game screen cannot show a board, in words a player can act on. */
export const NETWORK_TEXT = {
  offline: "Нет связи с сервером. Партия продолжится, когда соединение вернётся.",
  notDeployed: "Сетевая игра ещё не развёрнута на сервере.",
  refused: "Сервер отклонил действие.",
  waitingForOpponent: "Ждём соперника.",
  conflict: "Партия ушла вперёд. Показываем положение заново.",
  notYourTurn: "Сейчас ход соперника.",
  finished: "Партия закончена.",
} as const;

/**
 * What a game's status means, said to a player rather than as a database value.
 *
 * `lobby` is the one that matters: it is not an error and not "waiting for you", it is a table with
 * a free seat. A screen that printed the raw word would leave a player wondering whether something
 * had gone wrong.
 */
export const STATUS_TEXT: Record<string, string> = {
  lobby: "ждём второго игрока",
  playing: "идёт партия",
  finished: "партия закончена",
  abandoned: "партия прервана",
};

/**
 * A command id that is unique per attempt and stable across retries of *that* attempt.
 *
 * The distinction matters: a phone that times out and retries must reuse the id, or the move is
 * played twice; a phone that deliberately plays again must not, or the second move is swallowed as
 * a duplicate. So the id is generated once when the player acts, not once per network call.
 */
export function newCommandId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "cmd";
  for (let index = 0; index < 19; index += 1) {
    id += alphabet[Math.floor(random() * alphabet.length)];
  }
  return id;
}

/**
 * Which seat's turn it is, read the same way the server reads it.
 *
 * Chess narrates turn by colour; the other two by index into the seat order. This must match
 * `game_commands_prepare` in the migration exactly - if the two disagreed, one side would refuse
 * every move the other side thinks is fine.
 *
 * The chess session stores its moves, not a `turn` field: the side to move is part of the FEN and
 * `toChess` derives it from there. So the colour is read from the FEN's second field, which is what
 * the server does too. A session that does not look like one reports "no turn" rather than guessing.
 *
 * The card game's turn index lives on the *view* rather than in a state, because the card client
 * never receives a state. That asymmetry is the price of hiding the deck, and it is paid here once
 * instead of in every caller.
 */
export function seatToMove(kind: GameKind, view: GameView): number | null {
  if (view.kind === "hands") return view.turnIndex;
  const state = view.state;
  if (!state || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  if (kind === "chess") {
    const turn = chessTurnOf(record);
    if (turn === "w") return 0;
    if (turn === "b") return 1;
    return null;
  }
  const turn = record.turnIndex;
  return typeof turn === "number" ? turn : null;
}

/**
 * The side to move, from a chess session's FEN.
 *
 * `startFen` is the authoritative start position and the move list is applied to it, so the FEN's
 * second field is the side to move after those moves. Reading the stored string avoids rebuilding a
 * chess.js position just to ask who is next, which otherwise happens on every render of the screen.
 * A plain position-shaped object with a `turn` or `fen` field works too, which keeps this usable from
 * tests and from the live position view.
 */
function chessTurnOf(session: Record<string, unknown>): "w" | "b" | null {
  if (session.turn === "w" || session.turn === "b") return session.turn;
  const fen =
    typeof session.fen === "string" ? session.fen : typeof session.startFen === "string" ? session.startFen : null;
  if (!fen) return null;
  const side = fen.split(" ")[1];
  if (side === "w" || side === "b") return side;
  return null;
}

/** Whether this viewer is the one who may act. */
export function myTurn(game: ServerGame): boolean {
  if (game.status !== "playing") return false;
  if (game.mySeat === null) return false;
  return seatToMove(game.kind, game.view) === game.mySeat;
}

/**
 * Whether a local legality check is possible for this game.
 *
 * Chess and «Балда» can be checked on the client: the whole board is there and the engines are pure.
 * The card game cannot. `canPlay` inspects the top card's colour and value, and the server
 * deliberately does not ship the `cards` lookup that maps ids to them - shipping it would hand over
 * every remaining card in the deck. Rather than fake a state with placeholder cards and call the
 * result "legality", the card screen offers the hand and lets the server decide. Nothing is lost but
 * a round trip on an illegal click, and the server's answer is the only one that counts anyway.
 */
export function canCheckLocally(view: GameView): boolean {
  return view.kind === "open";
}

/** The card ids the viewer holds, for the screen that draws them. Empty for the board games. */
export function ownHand(view: GameView): string[] {
  if (view.kind !== "hands") return [];
  const mine = view.hands.find((hand) => hand.hidden === false);
  return mine && !mine.hidden ? mine.cards : [];
}

/** How many cards each player holds - all a player is allowed to know about the others. */
export function handCounts(view: GameView): { playerId: string; count: number }[] {
  if (view.kind !== "hands") return [];
  return view.hands.map((hand) => ({
    playerId: hand.playerId,
    count: hand.hidden ? hand.count : hand.cards.length,
  }));
}

/** One action the viewer may take, ready to be sent. */
export type PendingAction<A> = {
  commandId: string;
  action: A;
};

/**
 * Runs one action through the engine and reports whether it should be sent.
 *
 * `send` is false when the engine refused the action, so a refused click never reaches the network
 * and the player gets the engine's own `reason` immediately instead of after a round trip.
 *
 * The command id is generated by the caller when the *player acts*, never here: a retry of the same
 * attempt must reuse it (or the move is played twice) and a new attempt must not (or it is swallowed
 * as a duplicate). Generating it in this function would be right for the first and wrong for both.
 */
export function prepareAction<S, A>(
  engine: { apply(state: S, action: A): ApplyResult<S> },
  state: S,
  action: A,
  commandId: string
): { send: boolean; next: S; reason?: string; pending: PendingAction<A> } {
  const outcome = engine.apply(state, action);
  return {
    send: outcome.changed,
    next: outcome.state,
    reason: outcome.reason,
    pending: { commandId, action },
  };
}

/**
 * What to do with a commit's answer.
 *
 * Kept as a pure function so the three cases can be tested without a network: `applied` means carry
 * on with the returned revision, `conflict` means somebody else moved first and the board must be
 * re-read before this player can think about their move again, and `duplicate` means the retry
 * landed and the original answer stands.
 */
export type NextStep =
  | { kind: "continue"; revision: number; state: unknown; finished: boolean }
  | { kind: "reread"; revision: number; state: unknown; reason: string }
  | { kind: "idle"; revision: number; state: unknown };

export function nextStepFor(outcome: CommitOutcome): NextStep {
  if (outcome.status === "applied") {
    return {
      kind: "continue",
      revision: outcome.revision,
      state: outcome.state,
      finished: outcome.gameStatus === "finished" || outcome.gameStatus === "abandoned",
    };
  }
  if (outcome.status === "conflict") {
    return {
      kind: "reread",
      revision: outcome.revision,
      state: outcome.state,
      reason: outcome.reason ?? NETWORK_TEXT.conflict,
    };
  }
  // A duplicate is the retry of a move that already landed: the board it returns is the right one,
  // and there is nothing more to do.
  return { kind: "idle", revision: outcome.revision, state: outcome.state };
}

/**
 * The nudge the server publishes when a game changes.
 *
 * It carries the revision and nothing else, so a client knows to re-read. It is not trusted as
 * state: the board comes from `game_get`, which filters per viewer.
 */
export type GameNudge = { gameId: string; revision: number; status: string };

export function nudgeFor(gameId: string): string {
  return `game:${gameId}`;
}

/**
 * Whether a nudge means "there is something new to fetch".
 *
 * A nudge for a revision the client already has is ignored. Realtime can deliver out of order after
 * a reconnect, and re-reading on every nudge regardless would be a request storm for no benefit.
 */
export function nudgeAdvances(nudge: GameNudge, knownRevision: number, knownGameId: string): boolean {
  if (nudge.gameId !== knownGameId) return false;
  return nudge.revision > knownRevision;
}
