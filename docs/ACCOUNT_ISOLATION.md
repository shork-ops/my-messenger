# Account isolation

What this document is: the record of what was actually shared between accounts on one browser, what
was changed, what the change is proven by, and what it deliberately does **not** claim.

Everything below is client-side. Nothing here is a security boundary against the server: a person
who is signed in as A can always call the API as A. This is about the *device* — one browser, one
machine, several people — where the local caches are the thing that leaks.

## The rule

Three statements, in order of how easy they are to get wrong:

1. **The owner is the real auth user id.** Not the profile name, not the saved-account slot, not a
   device id. `useProfile` reads `user.id` from the session; that UUID is what decides whose
   namespace a key lands in. A name is user-editable and can be changed to match someone else's;
   a slot is a browser label that says nothing about who is signed in.
2. **Guest is its own owner, not "no owner".** A signed-out visitor writes to the `guest` namespace,
   which no account can read and which can never overwrite an account's data. "No owner" would mean
   "the shared key", which is the bug being fixed.
3. **Switching accounts is a namespace change, not a copy.** Nothing is moved, merged or migrated
   between A and B. A's data stays under A's keys and is simply not reachable from B.

## The storage layout

A key belongs to an owner when it is prefixed:

```
nexus-scoped:u:<lowercased-auth-uuid>:<logical-key>     an account
nexus-scoped:guest:<logical-key>                        a signed-out visitor
```

`src/lib/accountScope.ts` owns the rules and has no React in it, so the ownership question can be
tested without a browser. `src/lib/scopedStorage.ts` is the only writer: it has no unscoped write
path at all, so a caller cannot accidentally write to the shared key even if it tries.

## What was shared, and is not any more

| Cache | Logical key | Before | Now |
| --- | --- | --- | --- |
| Chat list and its messages | `nexus-chats-v1` | one key for the browser | per account |
| Per-chat drafts | `nexus-drafts-v1` | one key | per account |
| Reply drafts | `nexus-reply-drafts-v1` | one key | per account |
| Chat folders | `nexus-chat-folders` | one key | per account |
| Notification preferences | `nexus-notification-prefs` | one key | per account |
| Privacy switches | `nexus-privacy-prefs` | one key | per account |
| Wallpaper | `nexus-wallpaper` | one key | per account |
| Auto-download policy | `nexus-media-policy` | one key | per account |
| Passcode and its unlocked flag | `nexus-passcode` | one key | per account |
| Single-view "already opened" list | `nexus-view-once-spent` | one key, capped at 500 entries | per account |
| Link preview cache | `nexus-link-card:*` | one key per URL, shared | per account |
| Push prompt "already asked" | `nexus:push-prompt` | one key | per account |
| Game saves | `nexus.games.sessions` | already per account | unchanged, adoption fixed |

Already per account before this work, and left alone: the send outbox (`nexus-outbox:<id>`) and the
game session store (`nexus.games.sessions:<id>`).

### Deliberately *not* per account

Some things are device facts rather than account facts, and scoping them would be its own bug:

- The saved-account list and the active slot (`nexus-saved-accounts`, `nexus-active-slot`) — they are
  how the browser remembers who *can* sign in.
- The device id (`nexus-device-id`) — one browser is one device, whoever is using it right now.
- The Supabase auth token per slot (`sb-nexus-auth-<slot>`) — the credential itself.
- Interface language (`nexus-language`) and theme/text size — deliberately left device-wide for now.
  This is a judgement call, not an oversight: they describe how the machine is set up, not what a
  person talks about, and someone who set the laptop to a large text size does not want it to shrink
  when a colleague signs in. Recorded here so it is a decision rather than a gap.

## The account switch has to be a re-derivation, not an effect

The first attempt at this was wrong in a way worth recording, because the bug is invisible until
someone actually switches accounts.

Each hook was written the obvious way: an effect that writes on change, plus an effect that re-reads
when the account changes. Effects run in declaration order, so on the render where the account
changed the write effect ran **first**, writing the *old* account's value under the *new* account's
key — and the re-read effect then read that value straight back. The result is an account switch that
appears to do nothing, plus the previous account's data now persisted in the next account's
namespace: both the leak and the overwrite, in one ordering mistake.

The fix lives in `src/lib/useOwnerStorage.ts`. State is stored *with* the owner it was loaded for;
when the current owner differs, the value is re-derived during render, so no frame ever shows one
account's data in another's session. A write is directed at the namespace the value came from, so a
pending write from an account that has since been switched away from lands in its own namespace
rather than overwriting the new one.

## Legacy caches: nobody inherits by being first

Before this work, every one of the listed keys held one browser's data with **no owner recorded**.
There is no way to prove from such a value who wrote it. The only honest options were to guess or not
to adopt, and the instructions are explicit that a guess is not acceptable — "do not give it to the
first person who signs in without proven ownership".

So `mayAdoptLegacy` in `src/lib/accountScope.ts` adopts **only** with proof:

- the stored value is an array or object **all** of whose entries name the same account in a
  `senderId`/`userId`/`accountId`/`ownerId` field, and that account is the one asking; or
- nothing at all — an unreadable, empty, or mixed-owner value is never adopted.

A guest never adopts anything, in either direction. Unadopted legacy data is **left in place**, not
deleted: the person it belongs to may still come back, and the safe failure is "the caches look empty
once" rather than "the wrong person got the data and the right person lost it".

The same rule was applied to game saves. `takeLegacySessions` used to hand the old shared list to the
first account that opened the games screen, which is exactly the forbidden behaviour; it now requires
every save to name that account, and only lets a guest take saves that record no account at all
(bot and same-device games, which cannot belong to anyone).

## What proves it

- `src/lib/accountScope.test.ts` — 18 tests on the ownership rules and the adoption refusals,
  including "a shared cache is never given to the first signer", "a mixed cache is refused", "a guest
  is refused in both directions", and "the UUID decides, not the display name".
- `src/hooks/accountIsolation.test.tsx` — 16 tests driving the real hooks: A→B switch shows none of
  A; A→guest→A returns A's data; a guest cannot delete an account's cache; restart reloads each
  account's own values; a late response for A never lands under B's keys; and every write lands
  inside a scoped key, with no bare key written at all.
- `src/games/core/storage.test.ts` — the legacy adoption cases, including that the first account to
  ask is now *refused*.

`npm test` covers all of these; the count at the time of writing is 1275 passing.

## Limits, stated plainly

- **Old data is not attributed.** Anyone who used the app before this change has unscoped caches on
  their device. That data is refused rather than guessed at, so it is effectively unreachable. This
  is the intended trade, not a bug to report later.
- **The browser is not the enemy here.** Everything above protects one person from the *next* person
  who uses the same browser profile. It does nothing against someone with devtools open on their own
  signed-in session, and the server is where that is enforced.
- **Nothing was verified against the cloud in this area.** These are local storage rules; there is no
  server component to deploy.
