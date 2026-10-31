/**
 * The state of the games screen.
 *
 * One place owns the sessions: which game is open, what its state is, how a move is applied, and
 * when it is written to storage. The three game screens are then drawings of this state rather
 * than three separate piles of `useState` that each grow their own rules - which is how the
 * placeholders became unplayable in the first place.
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
import { chessEngine, createChess, type ChessAction, type ChessState } from "../chess/engine";
import { chooseMove as chooseChessMove, botColour, type Difficulty as ChessDifficulty } from "../chess/bot";
import { newCardState, applyCardAction, type CardAction, type CardState } from "../cards/deck";
import { playBotTurn, type CardDifficulty } from "../cards/bot";

export type OpenGame =
  | { kind: "chess"; state: ChessState; gameId: string; mode: PlayMode; difficulty: ChessDifficulty }
  | { kind: "cards"; state: CardState; gameId: string; mode: PlayMode; difficulty: CardDifficulty }
  | { kind: "balda"; state: BaldaState; gameId: string; mode: PlayMode; difficulty: BaldaDifficulty };

export type GameSummary = Partial<Record<GameKind, SavedSession>>;

type AnyState = ChessState | CardState | BaldaState;

function rulesVersionOf(kind: GameKind): number {
  if (kind === "chess") return chessEngine.rulesVersion;
  if (kind === "cards") return 1;
  return baldaEngine.rulesVersion;
}

/** A line for the catalogue card, written from the state rather than stored separately. */
export function summarize(kind: GameKind, state: AnyState): string {
  if (kind === "chess") {
    const chess = state as ChessState;
    if (chess.result) return "партия закончена";
    const side = chess.turn === "w" ? "белые" : "чёрные";
    return `${side}, ${Math.max(1, chess.fullmove)}-й ход`;
  }
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
  if (kind === "chess") return (state as ChessState).result;
  if (kind === "cards") return (state as CardState).result;
  return (state as BaldaState).result;
}

export function useGameSessions(storage: GameStorage = browserStorage()) {
  const [sessions, setSessions] = useState<SavedSession[]>(() => storage.read());
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
    (kind: GameKind, mode: PlayMode = "bot", difficulty: "easy" | "normal" = "normal") => {
      const gameId = shortId("game");
      setNotice("");
      if (kind === "chess") {
        const state = createChess({ players: [], seed: Math.floor(Math.random() * 2 ** 31) });
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
      if (kind === "chess") setOpen({ kind, state: state as ChessState, gameId: session.gameId, mode: session.mode, difficulty: "normal" });
      else if (kind === "cards") setOpen({ kind, state: state as CardState, gameId: session.gameId, mode: session.mode, difficulty: "normal" });
      else setOpen({ kind, state: state as BaldaState, gameId: session.gameId, mode: session.mode, difficulty: "normal" });
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

  const applyChess = useCallback(
    (action: ChessAction) => {
      if (!open || open.kind !== "chess") return;
      const outcome = chessEngine.apply(open.state, action);
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

  /** Plays the bot's move for the game in progress, when it is the bot's turn. */
  const playBot = useCallback(() => {
    if (!open) return;
    if (open.mode !== "bot") return;

    if (open.kind === "chess") {
      // The bot plays whichever colour the second seat holds; the player always has the first.
      const colour = botColour(
        [
          { id: "player-1", seat: "player-1", bot: false },
          { id: "player-2", seat: "player-2", bot: true },
        ],
        "player-1"
      );
      if (!colour) return;
      if (open.state.turn !== colour || open.state.result) return;
      const move = chooseChessMove(open.state, open.difficulty as ChessDifficulty);
      if (!move) return;
      const outcome = chessEngine.apply(open.state, {
        type: "move",
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      });
      if (!outcome.changed) return;
      setOpen({ ...open, state: outcome.state });
      save("chess", outcome.state, open.gameId, open.mode);
      return;
    }

    if (open.kind === "cards") {
      const next = playBotTurn(open.state, open.difficulty as CardDifficulty);
      if (next === open.state) return;
      setOpen({ ...open, state: next });
      save("cards", next, open.gameId, open.mode);
      return;
    }

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
  };
}

export { STORAGE_VERSION };
