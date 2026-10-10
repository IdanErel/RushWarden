# Rushwarden privacy policy

**Status: DRAFT, not published.** Phase 1 task P1-BE-02 (GDD §10, ADR-007, ADR-009). Idan has
approved collecting in the toy once this policy is published; publishing it is his call (GDD §13:
legal and policy questions go to Idan). Until this page is live on the website, `/ingest` stays
switched off in every public build (ADR-007 point 5).

Scope: the Phase 1 validation toy (web, itch.io). It lists only the four events ADR-007 allows,
and the event time as ADR-009 defines it (server receipt time, no client timestamp).
When any event, field or surface is added (GDD §10 requires an ADR for a new event), this page
is updated in the same PR, before the change ships.

Placeholders in `[square brackets]` are for Idan to fill before publishing. The open questions
for Idan are at the end of this file and are removed from the published version.

---

_Last updated: [publication date]_

Rushwarden is a small traffic puzzle game made by [developer name, GDD §1: Idan's name]. This
page explains, in plain language, what the game sends to us and what it does not.

## The short version

- You do not need an account. Your progress stays on your device.
- The game sends a few anonymous gameplay events to our own server so we can see how long
  sessions last and whether rounds are too hard. That is all we use them for.
- We never collect your name, email, contacts, location, photos, or advertising IDs. The game
  has no ads and no third-party tracking or analytics tools.
- We do not sell or share this data with anyone.

## What we collect

When analytics is switched on, the game sends these four events, and nothing else.

| Event       | When it is sent  | What it contains                                                                                                                         |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `app_open`  | The game starts  | Nothing beyond the details every event carries (below)                                                                                   |
| `run_start` | You start a run  | Which mayor and which district you chose, and whether it is the daily run                                                                |
| `round_end` | A round finishes | The round number, whether you passed, how many vehicles got through (throughput), the round's target (quota), and which cards you played |
| `run_end`   | A run finishes   | How many rounds you played, the result (win or loss), and the card types (tags) in your deck                                             |

Every event also carries:

- **A random install ID.** The game makes up a random number the first time it runs and keeps it
  on your device. It is not tied to your name, account, device serial, or advertising ID, and we
  cannot work out who you are from it. It only lets us tell that two events came from the same
  install, for example to measure how long a session lasted.
- **Platform**, for example "itch" or "web".
- **Game version**, for example "0.1.0".
- **Language setting** of the game or browser, for example "en-US".
- **Device class**: "low", "mid" or "high", worked out from a short performance test inside the
  game. It is not your device model.
- **The time our server receives the event.** The game does not send its own clock time. Events
  are sent one at a time as they happen, so the receipt time is what lets us measure session
  length.

We do not collect free text, and we do not collect anything you type.

## What we do not collect

- No name, email, phone number, or account of any kind.
- No precise or approximate location.
- No advertising ID, device ID, or fingerprinting.
- No contacts, photos, microphone, or camera.
- No data from other apps or websites.
- No cookies for tracking. The install ID and your saved progress are kept in your browser's
  local storage for the game itself.

## Why we collect it

Only to make the game better: to see how long people play, which rounds are too hard or too
easy, and which cards are picked. We do not use it for advertising, profiling, or any decision
about you.

## Where it goes and who sees it

Events go to a small server we run on Cloudflare Workers, which stores them in a Cloudflare
database. Only the Rushwarden developer can read them. We do not sell, rent or share the data.

Like any web host, Cloudflare processes your IP address to deliver the request and may keep it
in its own short-lived logs. We do not store your IP address with the events. See
[Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

The site you play on has its own privacy policy for its own pages. On itch.io, see
[itch.io's privacy policy](https://itch.io/docs/legal/privacy-policy). [If the game is later
offered on Poki or CrazyGames, add a sentence here naming that portal and linking its policy.]

## How long we keep it

Raw events are kept for [retention period] and then deleted. We may keep combined totals that
contain no install ID (for example "median session length on itch in October") for longer.

## Your choices

- **No opt-out yet.** This early test version of the game has no settings screen, so it has no
  switch to turn analytics off. A later version will add one, together with a "delete my data"
  button.
- **Reset:** the install ID is a random value stored only in your browser. Clearing this site's
  data in your browser deletes it (and your saved progress), and the game makes a new random one
  next time. Because the ID is not linked to you, we cannot look up your events by name or email.
- You can contact us about this data at any time at [contact email].

If you are in the EU, UK or a similar jurisdiction, you have the right to access, correct, delete
or object to the processing of personal data about you, and to complain to your data protection
authority. [Legal basis: to be confirmed by Idan, see the open questions.]

## Children

Rushwarden is made for everyone. It has no chat, no accounts and no way for players to share
personal information, and the data above contains nothing that identifies a person. We do not
knowingly collect personal information from children.

## Changes to this policy

If we change what the game collects, we update this page and the date at the top before the
change goes live.

## Contact

[developer name] · [contact email] · [postal address if required]

---

## Open questions for Idan (remove before publishing)

These are legal or policy calls (GDD §13), so the draft does not decide them.

1. **EU/UK consent.** A random ID stored in the browser for analytics may need opt-in consent in
   the EU and UK (ePrivacy rules), since it is not strictly needed to play. Options: (a) ask once
   with a plain yes/no before sending anything, (b) send nothing for EU/UK players, or (c) rely on
   legitimate interest for pseudonymous analytics after legal advice. This draft does not choose.
   The answer also fills the "Legal basis" placeholder.
2. **Retention period.** Proposal: raw events 90 days, then only totals without install IDs.
3. **Identity, contact and URL.** Developer name, contact email, whether a postal address is
   required where you live, and the public URL (planned: `rushwarden.com/privacy`, GDD §10 and
   §12), linked from the itch page.

Settled by the Lead (2026-10-10): Idan approved collecting once this is published; the event time
is the server's receipt time with unbatched events (ADR-009); the toy has no opt-out yet, as stated
above.
