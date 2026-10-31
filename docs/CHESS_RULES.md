# Chess rules: what was checked against FIDE, and what was fixed

The previous result reported two things about the chess engine. The instruction for this stage was to
re-verify them independently against the actual code and the actual Laws, and to fix the code rather
than adjust the tests to match a wrong rule. Both claims were checked; one was wrong about the code,
and the code itself was wrong about the Laws.

Source of truth: **FIDE Laws of Chess, in force from 1 January 2023**
(https://handbook.fide.com/chapter/E012023).

## Finding 1: the fifty- and seventy-five-move thresholds were half of what the Laws allow

**The Laws say** (Article 9.3.2, claimable):

> the last **50 moves by each player** have been completed without the movement of any pawn and
> without any capture

**The Laws say** (Article 9.6.2, automatic):

> any series of at least **75 moves** have been made by each player without the movement of any pawn
> and without any capture. If the last move resulted in checkmate, that shall take precedence.

**The code had** `halfmoveClaim: 50` and `halfmoveAutomatic: 75`, compared against a **halfmove
clock**, which advances once per ply (once per player's move). So:

- A player could claim a fifty-move draw after **25 moves each**, not 50.
- The game declared an automatic draw after **37.5 moves each**, not 75.

Both thresholds fired at half the distance the Laws allow. In a game with no captures and no pawn
moves — two kings shuffling — this is the difference between a draw that arrives when it should and
one that arrives while both players are still playing.

**Fixed:** the constants are now `halfmoveClaim: 100` and `halfmoveAutomatic: 150`, with the
derivation written next to them. All the player-facing text says "50 ходов каждого" and "75 ходов
каждого" (moves by each player) rather than the internal ply count, so the words match the Laws.

**Why the old tests agreed with the bug:** they asserted `expect(after.halfmoveClock).toBe(DRAW_RULES.halfmoveClaim)`
— the code compared against itself. A test that reads the constant it is checking cannot detect a
wrong constant. The new tests write the expected number **out literally** (100 / 150) and state where
it comes from, and one of them explicitly asserts that 50 plies is *not* enough, which is the exact
bug.

Also added: a test for the checkmate precedence clause in 9.6.2, since that ordering is easy to lose.

**Rules version bumped from 2 to 3.** A saved game carries the rules version it was played under, and
`canResume` refuses to resume a save from a different version rather than reinterpreting a position
someone already committed to. So games saved under the old (wrong) threshold are not silently resumed
under the new one.

## Finding 2: the castling claim was wrong — refusing to castle into check is FIDE-correct

The previous result described "no kingside castling where the king would land on an attacked square"
as a **deviation from FIDE**, documented in the rules text as a known narrowing.

That is not a deviation. **Article 3.8.2.2** (castling is prevented temporarily):

> 3) If the square on which the king stands, **or the square which it must cross, or the square which
> it is to occupy, is attacked** by one or more of the opponent's pieces

So castling where the king's destination square is attacked is **forbidden by the Laws**. The engine
was right; the comment and the rules text were wrong. Article 3.9.2 forbids ending any move with the
king in check regardless, which makes the same conclusion reachable twice.

**Fixed:** the false "second boundary" line is removed from `CHESS_RULES`. The castling line now
states all three squares explicitly ("не стоит под шахом, не проходит через атакованное поле и не
встаёт на атакованное поле"), matching 3.8.2.2.

The original claim is asserted **not** to come back: a test checks the rules text no longer contains
the apologetic sentence, and a new nine-case test pins the whole rule — including the asymmetry that
actually catches implementations out: an attacked **b1/b8** must *not* prevent queenside castling,
because the rook passes over it but the king never stands there.

## What the nine-case castling test covers

| Case | Expected |
| --- | --- |
| White kingside, g1 (destination) attacked | refused |
| White kingside, f1 (crossed) attacked | refused |
| White kingside, e1 (king in check) attacked | refused |
| White kingside, nothing attacked | allowed |
| White queenside, c1 (destination) attacked | refused |
| White queenside, d1 (crossed) attacked | refused |
| White queenside, **b1 attacked** | **allowed** — the king never stands on b1 |
| Black kingside, g8 attacked | refused |
| Black queenside, **b8 attacked** | **allowed** |

The black cases matter because a rule written only against White's squares passes every white test.

## The remaining, genuine limitation

Still narrower than the Laws, and still stated to the player in `CHESS_RULES`:

- **Dead positions other than "no mating material".** FIDE 5.2.2 draws a position where neither side
  *can* checkmate by any legal series of moves — which includes blocked pawn structures and, for
  example, two knights against a lone king. The engine only recognises insufficient material in the
  narrow "no mating material" sense (bare kings, king+bishop, king+knight, and the same-coloured
  bishop cases). Other dead positions run on until the seventy-five-move rule or a player's request
  ends them. This is honest and documented; recognising all dead positions is a search for
  "is there any mate in any continuation", which is a much larger piece of work.
- **Draw claims are offered to either player** rather than only to the player to move. FIDE 9.2/9.3
  require the claimant to have the move (or to have just moved, for 9.2.2). Since this is a
  bot-or-two-people-at-one-screen game rather than a supervised tournament, the looser rule avoids a
  claim that arrives a half-move too late and cannot be made at all. It is stated in the rules text.

Neither of these is a thing the previous report got wrong; they are recorded here so that "checked
against FIDE" does not read as "identical to FIDE".

## How this was verified

- `npm test` — 1290 tests pass, including 73 in `src/games/chess/session.test.ts`.
- `npm run build` must still succeed; the typecheck is part of the same verification run.
- The Laws text above was read from the FIDE Handbook directly rather than from a summary, because
  the whole point of this exercise was that a summary had already been trusted once.
