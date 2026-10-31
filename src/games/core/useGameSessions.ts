/**
 * The state of the games screen.
 *
 * One place owns the sessions: which game is open, what its state is, how a move is applied, and
 * when it is written to storage. The three game screens are then drawings of this state rather
 * than three separate piles of `useState` that each grow their own rules - which is how the
 * placeholders became unplayable in the first place.
 *
 * Chess is held to a higher standard than the other two here, because the plan asks for it: the
 * position, the scoresheet and the repetition history are all saved, so a reload lands on the same
 * game rather than on a plausible-looking new one; the bot's move is asked for through a search
 * that can be abandoned; and nothing is written under a key that is not the signed-in account.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameKind, GameResult, PlayMode } from "./types";
import { shortId } from "./types";
import {
  browserStorage,
  canResume,
  prune,
  removeSession,
  STORAGE_VERSION,
  takeLegacySessions,
  unfinishedByKind,
  upsertSession,
  type GameStorage,
  type SavedSession,
} from "./storage";
import {
  baldaEngine,
  createBalda,
  type BaldaAction,
  type BaldaState,
} from "../balda/engine";
import { chooseBaldaMove, type BaldaDifficulty } from "../balda/bot";
import { DICTIONARY_VERSION } from "../balda/dictionary";
import {
  applyChessCommand,
  botColorFrom,
  CHESS_RULES_VERSION,
  createChessSession,
  summaryOf as chessSummary,
  type ChessCommand,
  type ChessSession,
  type Color as ChessColor,
} from "../chess/session";
import type { Difficulty as ChessDifficulty } from "../chess/bot";
import { newCardState, applyCardAction, type CardAction, type CardState } from "../cards/deck";
import { playBotTurn, type CardDifficulty } from "../cards/bot";

export type OpenGame =
  | { kind: "chess"; state: ChessSession; gameId: string; mode: PlayMode; difficulty: ChessDifficulty }
  | { kind: "cards"; state: CardState; gameId: string; mode: PlayMode; difficulty: CardDifficulty }
  | { kind: "balda"; state: BaldaState; gameId: string; mode: PlayMode; difficulty: BaldaDifficulty };

export type GameSummary = Partial<Record<GameKind, SavedSession>>;

type AnyState = ChessSession | CardState | BaldaState;

function rulesVersionOf(kind: GameKind): number {
  if (kind === "chess") return CHESS_RULES_VERSION;
  if (kind === "cards") return 1;
  return baldaEngine.rulesVersion;
}

/** A line for the catalogue card, written from the state rather than stored separately. */
export function summarize(kind: GameKind, state: AnyState): string {
  if (kind === "chess") return chessSummary(state as ChessSession);
  if (kind === "cards") {
    const cards = state as CardState;
    if (cards.result) return "раунд закончен";
    const left = cards.hands.reduce((total, hand) => total + hand.cards.length, 0);
    return `${left} карт на руках`;
  }
  const balda = state as BaldaState;
  if (balda.result) return "партия закончена";
  return `счёт ${balda.scores[0]}:${balda.scores[1]}`;
}

function resultOf(kind: GameKind, state: AnyState): GameResult | null {
  if (kind === "chess") return (state as ChessSession).result;
  if (kind === "cards") return (state as CardState).result;
  return (state as BaldaState).result;
}

/** How the chess screen should name its two seats, given who is sitting at it. */
function chessPlayers(viewerName: string): { white: string; black: string } {
  return { white: viewerName, black: "Бот" };
}

export type StartOptions = {
  mode?: PlayMode;
  difficulty?: "easy" | "normal";
  /** For chess: which colour the person at the screen plays. The bot takes the other one. */
  playerColor?: ChessColor;
  /** The display name put on the white seat, so a saved game is still recognisably yours. */
  playerName?: string;
};

/**
 * The games screen's state for one account.
 *
 * The account is passed in rather than read from a module, so the storage key and the state are
 * chosen together: a screen that has already loaded one account's games can never write them back
 * under another account's key.
 */
export function useGameSessions(
  accountId: string | null = null,
  storage: GameStorage = browserStorage(accountId)
) {
  const [sessions, setSessions] = useState<SavedSession[]>(() => {
    const own = storage.read();
    if (own.length > 0) return own;
    // A player who had a game in progress before games were per-account keeps it: the old shared
    // key is adopted once, here, and only by a signed-in account.
    const adopted = takeLegacySessions(accountId);
    if (adopted.length === 0) return own;
    const pruned = prune(adopted);
    storage.write(pruned);
    return pruned;
  });
  const [open, setOpen] = useState<OpenGame | null>(null);
  const [notice, setNotice] = useState("");
  const storageRef = useRef(storage);
  storageRef.current = storage;

  // Written on every change rather than on close: a tab closed by a phone that ran out of
  // battery never fires an unload handler, and that is exactly when a saved game matters.
  const persist = useCallback((next: SavedSession[]) => {
    const pruned = prune(next);
    storageRef.current.write(pruned);
    setSessions(pruned);
  }, []);

  const save = useCallback(
    (kind: GameKind, state: AnyState, gameId: string, mode: PlayMode) => {
      const now = new Date().toISOString();
      const result = resultOf(kind, state);
      setSessions((current) => {
        const previous = current.find((item) => item.gameId === gameId);
        const session: SavedSession = {
          gameId,
          kind,
          rulesVersion: rulesVersionOf(kind),
          dictionaryVersion: DICTIONARY_VERSION,
          mode,
          status: result ? "finished" : "playing",
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
          summary: summarize(kind, state),
          state,
        };
        const next = prune(upsertSession(current, session));
        storageRef.current.write(next);
        return next;
      });
    },
    []
  );

  const unfinished: GameSummary = useMemo(() => unfinishedByKind(sessions), [sessions]);

  const start = useCallback(
    (kind: GameKind, options: StartOptions = {}) => {
      const mode = options.mode ?? "bot";
      const difficulty = options.difficulty ?? "normal";
      const gameId = shortId("game");
      setNotice("");
      if (kind === "chess") {
        const playerColor = options.playerColor ?? "w";
        const state = createChessSession({
          mode,
          // The bot takes whichever colour the person at the screen does not.
          botColor: playerColor === "w" ? "b" : "w",
          difficulty,
          players: chessPlayers(options.playerName ?? "Вы"),
        });
        const opened: OpenGame = { kind, state, gameId, mode, difficulty: difficulty as ChessDifficulty };
        setOpen(opened);
        save(kind, state, gameId, mode);
        return opened;
      }
      if (kind === "cards") {
        const state = newCardState(["Вы", "Соперник"], Math.floor(Math.random() * 2 ** 31));
        const opened: OpenGame = { kind, state, gameId, mode, difficulty: difficulty as CardDifficulty };
        setOpen(opened);
        save(kind, state, gameId, mode);
        return opened;
      }
      const state = createBalda({ players: [], seed: Math.floor(Math.random() * 2 ** 31) });
      const opened: OpenGame = { kind, state, gameId, mode, difficulty: difficulty as BaldaDifficulty };
      setOpen(opened);
      save(kind, state, gameId, mode);
      return opened;
    },
    [save]
  );

  /** Reopens the saved game of a kind, if it is still resumable under this build. */
  const resume = useCallback(
    (kind: GameKind): boolean => {
      const session = unfinished[kind];
      if (!session) return false;
      if (!canResume(session, rulesVersionOf(kind), DICTIONARY_VERSION)) {
        setNotice("Сохранённая партия сделана по старым правилам и не может быть продолжена.");
        return false;
      }
      setNotice("");
      const state = session.state as AnyState;
      if (kind === "chess") {
        const chess = state as ChessSession;
        setOpen({ kind, state: chess, gameId: session.gameId, mode: session.mode, difficulty: chess.difficulty });
      } else if (kind === "cards") {
        setOpen({ kind, state: state as CardState, gameId: session.gameId, mode: session.mode, difficulty: "normal" });
      } else {
        setOpen({ kind, state: state as BaldaState, gameId: session.gameId, mode: session.mode, difficulty: "normal" });
      }
      return true;
    },
    [unfinished]
  );

  const close = useCallback(() => {
    setOpen(null);
    setNotice("");
  }, []);

  const forget = useCallback(
    (gameId: string) => {
      setSessions((current) => {
        const next = removeSession(current, gameId);
        storageRef.current.write(next);
        return next;
      });
    },
    []
  );

  /**
   * Applies a chess command.
   *
   * A refused command keeps the same session object, so the screen can tell "nothing happened"
   * from "the position changed" without comparing FENs.
   */
  const applyChess = useCallback(
    (command: ChessCommand) => {
      if (!open || open.kind !== "chess") return;
      const outcome = applyChessCommand(open.state, command);
      if (!outcome.changed) {
        setNotice(outcome.reason ?? "Так ходить нельзя");
        return;
      }
      setNotice("");
      setOpen({ ...open, state: outcome.state });
      save("chess", outcome.state, open.gameId, open.mode);
    },
    [open, save]
  );

  const applyCards = useCallback(
    (action: CardAction) => {
      if (!open || open.kind !== "cards") return;
      const outcome = applyCardAction(open.state, action);
      if (!outcome.changed) {
        setNotice(outcome.reason ?? "Так нельзя");
        return;
      }
      setNotice("");
      setOpen({ ...open, state: outcome.state });
      save("cards", outcome.state, open.gameId, open.mode);
    },
    [open, save]
  );

  const applyBalda = useCallback(
    (action: BaldaAction) => {
      if (!open || open.kind !== "balda") return;
      const outcome = baldaEngine.apply(open.state, action);
      if (!outcome.changed) {
        setNotice(outcome.reason ?? "Так нельзя");
        return;
      }
      setNotice("");
      setOpen({ ...open, state: outcome.state });
      save("balda", outcome.state, open.gameId, open.mode);
    },
    [open, save]
  );

  /** Plays one move for the bot in Uno or Балда. Chess goes through the cancellable search. */
  const playBot = useCallback(() => {
    if (!open) return;
    if (open.mode !== "bot") return;

    if (open.kind === "cards") {
      const next = playBotTurn(open.state, open.difficulty as CardDifficulty);
      if (next === open.state) return;
      setOpen({ ...open, state: next });
      save("cards", next, open.gameId, open.mode);
      return;
    }
    if (open.kind !== "balda") return;

    const move = chooseBaldaMove(open.state, open.difficulty as BaldaDifficulty);
    if (!move) return;
    const outcome = baldaEngine.apply(open.state, {
      type: "place",
      square: move.square,
      letter: move.letter,
      word: move.word,
    });
    if (!outcome.changed) return;
    setOpen({ ...open, state: outcome.state });
    save("balda", outcome.state, open.gameId, open.mode);
  }, [open, save]);

  // A finished game is saved as finished exactly once, so the catalogue stops offering it.
  useEffect(() => {
    if (!open) return;
    const result = resultOf(open.kind, open.state);
    if (!result) return;
    const session = sessions.find((item) => item.gameId === open.gameId);
    if (session?.status === "finished") return;
    save(open.kind, open.state, open.gameId, open.mode);
  }, [open, save, sessions]);

  return {
    sessions,
    unfinished,
    open,
    notice,
    setNotice,
    start,
    resume,
    close,
    forget,
    applyChess,
    applyCards,
    applyBalda,
    playBot,
    /** Starts a new game of the same kind and mode, for the «Новая партия» button. */
    restart: useCallback(
      (kind: GameKind, mode: PlayMode, difficulty: "easy" | "normal", playerColor: ChessColor = "w") =>
        start(kind, { mode, difficulty, playerColor }),
      [start]
    ),
    /** The seat the person at the screen holds in the open chess game. */
    viewerColor: useMemo<ChessColor | "both">(() => {
      if (!open || open.kind !== "chess") return "both";
      if (open.state.botColor === null) return "both";
      return open.state.botColor === "w" ? "b" : "w";
    }, [open]),
    botColorOf: botColorFrom,
  };
}

export { STORAGE_VERSION };
