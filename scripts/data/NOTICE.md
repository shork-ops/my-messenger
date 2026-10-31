# Third-party notice: «Балда» dictionary source

The word list used by the «Балда» game is derived from a third-party source. This file records what
that source is, what it is licensed under, and what was changed.

## Source

- **Project:** Russian-Nouns — "List of Russian nouns"
- **Author:** Sergienko Anton
- **URL:** https://github.com/Harrix/Russian-Nouns
- **File used:** `dist/russian_nouns.txt`, branch `main` (51,301 lines at the time of the build)
- **Retrieved:** 2026-10-31

## Licence

MIT. Full text as published by the project (`LICENSE.md` in that repository):

```
# The MIT License

Copyright © 2018-present Sergienko Anton

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The MIT terms are met: the copyright notice and permission notice are reproduced above, and they are
also carried in the generated source file's header comment.

## What was changed

The list was filtered, not re-ordered by hand. `scripts/build-dictionary.mjs` applies, in order:

| Rule | Rejected |
| --- | --- |
| Only letters that exist on the board alphabet | 391 |
| At least 2 letters | 0 |
| No leading `ь`, `ъ`, `ы` | 0 |
| At least one vowel | 0 |
| `ё` folded to `е`; duplicates after folding removed | 59 |

Result: **50,851 words** from the licensed source. Generated into `src/games/balda/words.data.ts`,
with its metadata in `src/games/balda/words.meta.ts`.

No word from the source was edited. The transformation is mechanical and reproducible by running
`npm run build:dictionary` against the same input.

## Words added on top, and why that is a separate list

The source's own input is an explanatory dictionary compiled before roughly the mid-1990s, and the
gap is measurable rather than theoretical. These are **absent** from all 51,301 source lines:

`интернет`, `сайт`, `браузер`, `ноутбук`, `смартфон`, `флешка`, `сервер`, `блогер`, `мем`

To a player, tapping «сайт» on the board and being told "«сайт» нет в словаре игры" reads as a broken
game rather than as a strict dictionary. So `scripts/data/supplement.txt` adds **48 words** covering
post-1995 everyday and computing vocabulary.

They are kept in a **separate file from the licensed data** deliberately: the difference between
"third-party data used under its licence" and "words this project added itself" stays visible in
the diff, in the generated output, and here. The build refuses to run if a supplement word is already
present in the licensed list, because that would mean a comment claiming to fill a gap was false.

`supplement.txt` states its own inclusion rules. Two are worth repeating:

- **Brands and trademarks are excluded** (`фейсбук`, `инстаграм`, `тикток`, `айфон`, `сигвей`).
  Deciding which brand names have become ordinary nouns is an editorial judgement, not a dictionary
  lookup, so it is not made silently here.
- **Adjectives and adverbs are excluded** (`квантовый`, `онлайн`). This is a dictionary of nouns.

Total: **50,899 words** (50,851 licensed + 48 added), checksum `8aefeafe`.

The supplement words are the author's own and are offered under the same MIT terms as the rest of
this project.

## The question this notice does not settle

Being honest about provenance means being honest about its limits:

- **The MIT licence covers the Russian-Nouns project** — its code and its own aggregation of the
  list. It is the licence the project publishes, and redistributing the list under those terms is
  what the project grants.
- **The upstream data is itself derived.** The project's generator reads `src/efremova.txt` (an
  explanatory dictionary of Russian attributed to T. F. Efremova) and `src/odict.csv` (a
  morphological forms table). The licence status of *those* upstream works is not stated by the
  Russian-Nouns project, and this notice cannot assert it. That is a question for whoever ships this
  commercially, not something a build script can resolve.
- **Therefore:** this attribution is accurate about what was used and under what terms it was
  obtained. It is not a legal opinion that the underlying dictionary text is free of third-party
  rights. If the word list ships in a commercial product, that question should be checked with
  someone qualified to answer it.

This is written down rather than glossed over because the previous dictionary had *no* recorded
source at all, which made even this partial answer unavailable.

## Why the list is in the repository rather than fetched at runtime

A game must not depend on a network fetch to decide whether a word counts, and two players must agree.
The generated list ships with the build; `WORDS_CHECKSUM` identifies it, so a networked game can prove
both sides are using the same words.

## Why the list is two files

The word text is ~965 KB. It sits in `words.data.ts`, which is imported with `import()` and becomes
its own ~197 KB-gzip chunk, while `words.meta.ts` (1 KB: version, counts, checksum, alphabet) stays
cheap enough to import anywhere. Without the split, opening the games list would download the whole
dictionary into the `GameModal` chunk, which broke the per-chunk bundle budget that the plan's
"the dictionary and bots must not block the chat" requirement depends on.
