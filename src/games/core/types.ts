/**
 * What every game in the arcade has in common.
 *
 * The reason this file exists at all is that three games written separately drift apart in
 * ways that are invisible until a player hits them: one accepts a move after the game is over,
 * another resets the turn counter on reload, a third lets the interface decide legality. The
 * shape below is deliberately narrow - a game supplies rules, and React only renders and
 * forwards commands.
 *
 * The one rule this file enforces for everyone: a rejected command returns the *same* state
 * object. Not an equal one - the same one. A rejected move that produces an equal-but-new
 * state still looks the same to a player, but it resets whatever the screen keyed off identity,
 * and it makes "did anything change" impossible to answer.
 */

/** Which game a session belongs to. */
export type GameKind = "chess" | "cards" | "balda";

/** How a session is played. The third is only offered once a server room exists. */
export type PlayMode = "bot" | "local" | "friend";

export type GameStatus =
  | "setup"
  | "waiting"
  | "playing"
  | "finished"
  | "abandoned";

/** The result of a finished game, from the point of view of no one in particular. */
export type GameResult =
  | { kind: "win"; winnerId: string; reason: string }
  | { kind: "draw"; reason: string };

/** One player at the table, whether human or not. */
export type Player = {
  id: string;
  name: string;
  /** A bot is a player like any other, except that it takes its own turn. */
  bot: boolean;
  /** Colour, side or seat. Games interpret this; the core only keeps it stable. */
  seat: string;
};

/**
 * The fields every session carries.
 *
 * `revision` is what makes a network game reconcilable later: every accepted command raises it
 * by one, so a client can say "I have revision 7" and be sent only what came after.
 *
 * `rulesVersion` is separate from the storage version on purpose. The storage version answers
 * "can this build read this file". The rules version answers "was this played under the rules
 * the player agreed to" - a saved game of a different rules version may still be readable and
 * must not silently continue under new rules.
 */
export type SessionBase<K extends GameKind, S> = {
  gameId: string;
  kind: K;
  rulesVersion: number;
  /** Bumped whenever the saved shape changes in a way older builds cannot read. */
  storageVersion: number;
  mode: PlayMode;
  status: GameStatus;
  players: Player[];
  /** Whose turn it is, or null when nobody's is. */
  turn: string | null;
  revision: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: GameResult | null;
  state: S;
};

/**
 * A command from the interface.
 *
 * `commandId` matters only for the network game, where it makes a repeat harmless. It is
 * created here anyway so that no game has to grow the field later.
 */
export type Command<A> = {
  commandId: string;
  expectedRevision: number;
  action: A;
};

export type ApplyResult<S> = {
  /** The same object reference when the command was refused. */
  state: S;
  changed: boolean;
  /** Why the command was refused, in words a player can act on. */
  reason?: string;
};

/** What a game engine has to provide. Everything else is shared. */
export type GameEngine<S, A> = {
  kind: GameKind;
  rulesVersion: number;
  /** The rules a player is shown before starting. Not optional: it is the agreement. */
  rules: string[];
  /** A fresh session with no moves played. */
  create(options: CreateOptions): S;
  /** Legal actions for the player whose turn it is. Empty when the game is over. */
  actions(state: S): A[];
  /** Applies one action. Returns the identical state when the action is not legal. */
  apply(state: S, action: A): ApplyResult<S>;
  /** The result, once the game is over. Null while it is not. */
  result(state: S): GameResult | null;
  /** Whether the player whose turn it is has something to do. */
  describe(state: S): string;
};

export type CreateOptions = {
  players: Player[];
  /** Fixed for the whole game, so a rerolled game cannot secretly use other odds. */
  seed: number;
};

/** A short, readable id. Not a UUID: these never leave the device in local play. */
export function shortId(prefix: string, random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return `${prefix}_${out}`;
}

/**
 * Deterministic pseudo-randomness, so a game can be replayed.
 *
 * `Math.random` is right for production play but useless for a test: a failing card game has
 * to be reproducible. Every engine that shuffles takes a seed and a small generator, and the
 * seed is part of the saved session.
 */
export function makeRandom(seed: number): () => number {
  // xorshift32: small, no dependencies, and good enough for shuffling a deck of 108.
  let state = seed | 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, in place on a copy. Never mutates the input. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The player whose turn it is, if that player is a bot. */
export function activePlayer(session: { players: Player[]; turn: string | null }): Player | null {
  if (!session.turn) return null;
  return session.players.find((player) => player.id === session.turn) ?? null;
}

/** Whether the game has ended. Every command after that is refused except a rematch. */
export function isOver(session: { status: GameStatus }): boolean {
  return session.status === "finished" || session.status === "abandoned";
}

/** The player sitting opposite `playerId`, or null in a game with more than two. */
export function opponentOf(players: Player[], playerId: string): Player | null {
  return players.find((player) => player.id !== playerId) ?? null;
}
