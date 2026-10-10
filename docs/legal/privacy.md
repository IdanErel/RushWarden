# Rushwarden privacy policy

**Status: DRAFT, not published.** Phase 1 task P1-BE-02 (GDD §10, ADR-007, ADR-009). Idan has
approved collecting in the toy once this policy is published; publishing it is his call (GDD §13:
legal and policy questions go to Idan). Until this page is live on the website, `/ingest` stays
switched off in every public build (ADR-007 point 5).

Scope: the Phase 1 validation toy (web, itch.io). It lists only the four events ADR-007 allows,
and the event time as ADR-009 defines it (server receipt time, no client timestamp). Consent,
retention, the request path and where this page lives follow ADR-025; portal builds follow
ADR-024 (no analytics on Poki or CrazyGames).
When any event, field or surface is added (GDD §10 requires an ADR for a new event), this page
is updated in the same PR, before the change ships.

Placeholders in `[square brackets]` are for Idan to fill before publishing: only his developer
name, contact email and the publication date remain. The notes at the end of this file are
removed from the published version, which goes live at `https://rushwarden.com/privacy`.

---

_Last updated: [publication date]_

Rushwarden is a small traffic puzzle game made by [developer name, GDD §1: Idan's name]. This
page explains, in plain language, what the game sends to us and what it does not.

## The short version

- You do not need an account. Your progress stays on your device.
- Only if you say yes, the game sends a few gameplay events to our own server, tagged with a
  random install ID (not your name or any account), so we can see how long sessions last and
  whether rounds are too hard. That is all we use them for. If you say no, or do not answer,
  nothing is sent and no ID is made.
- We never collect your name, email, contacts, location, photos, or advertising IDs. The game
  has no ads and no third-party tracking or analytics tools.
- We do not sell or share this data with anyone.

## What we collect

The first time you open the game, it asks whether you want to send anonymous gameplay stats.
Nothing below is created or sent unless you choose **Yes**. You can change your answer at any
time in the game's **Privacy** panel. When you have said yes, the game sends these four events,
and nothing else.

| Event       | When it is sent  | What it contains                                                                                                                                                                              |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_open`  | The game starts  | Nothing beyond the details every event carries (below)                                                                                                                                        |
| `run_start` | You start a run  | Which mayor and which district you chose, and whether it is the daily run                                                                                                                     |
| `round_end` | A round finishes | The round number, whether you passed, your throughput (the round's score: points for each vehicle that gets through, by vehicle type), the round's target (quota), and which cards you played |
| `run_end`   | A run finishes   | How many rounds you played, the result (win or loss), and the card types (tags) in your deck                                                                                                  |

Every event also carries:

- **A random install ID.** The game makes up a random value when you say yes and keeps it in
  your browser. It is not made from your name, account, hardware serial or advertising ID. It
  lets us tell that two events came from the same install, for example to measure how long a
  session lasted. Because it stays the same across your sessions, data protection law (such as
  the GDPR) treats the install ID and the events linked to it as **pseudonymous personal data**,
  and we handle them that way.
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
- No advertising ID, no hardware identifiers (such as a serial number or IMEI), and no
  fingerprinting. The random install ID above is the only identifier.
- No contacts, photos, microphone, or camera.
- No data from other apps or websites.
- No cookies. The game keeps up to three things in your browser's local storage: your saved
  progress and your yes/no answer about stats, which the game needs, and, only if you said yes,
  the random install ID, which is used only for the analytics described above.

## Why we collect it

Only to make the game better: to see how long people play, which rounds are too hard or too
easy, and which cards are picked. We do not use it for advertising, profiling, or any decision
about you.

**Legal basis:** your consent (in the EU and UK, Article 6(1)(a) GDPR, and the consent rules
for storing information on your device). You can withdraw it at any time as easily as you gave
it.

## Where it goes and who sees it

Events go to a small server we run on Cloudflare Workers, which stores them in a Cloudflare
database. Cloudflare, Inc. hosts the server and the database as our **processor**: it handles the
data only on our instructions, to run the service, under Cloudflare's Data Processing Addendum.
Cloudflare may process data in the United States and other countries; for data from the EU and
UK, that addendum includes the European Commission's Standard Contractual Clauses. Only the Rushwarden developer can read the
events. We do not sell, rent or share the data.

Like any web host, Cloudflare sees your IP address to deliver the request and may keep it in its
own short-lived logs. We never store your IP address, and request logging is switched off for
our analytics server. See
[Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

The site you play on has its own privacy policy for its own pages. On itch.io, see
[itch.io's privacy policy](https://itch.io/docs/legal/privacy-policy). When you play Rushwarden
on Poki or CrazyGames, the game sends nothing to us at all; those sites' own privacy policies
([Poki](https://poki.com/en/privacy), [CrazyGames](https://www.crazygames.com/privacy-policy))
cover what they collect.

## How long we keep it

Raw events, with the install ID, are kept for **90 days** from when our server received them,
and then deleted automatically. We keep daily combined totals that contain no install ID (for
example "median session length on itch in October") for as long as we maintain the game, and
we drop or merge any total that covers fewer than 10 installs, so the totals cannot point to
anyone.

## Your choices

- **Yes or no.** Stats are off unless you say yes. The **Privacy** link on the title screen
  opens a panel with an on/off switch. Turning it off stops all sending and deletes the install
  ID from your browser.
- **Delete my data.** The same panel shows your install ID and has a **Delete my data** button.
  It deletes every event stored with that ID on our server, then deletes the ID from your
  browser.
- **Reset:** the install ID is a random value stored only in your browser. Clearing this site's
  data in your browser deletes it (and your saved progress, and your yes/no answer). The game then
  asks you again and makes a new random ID only if you say yes.
- **By email:** we can only find events by install ID, never by name or email. To see a copy of
  your events, or for any other request, send the install ID shown in the Privacy panel to
  [contact email]. Having the ID is how we know the events are yours. We reply within one month.
  After you reset or delete the ID, the events stored under the old one can no longer be linked
  to you, and they are deleted when the 90 days above end.
- You can contact us about this data at any time at [contact email].

If you are in the EU, UK or a similar jurisdiction, you have the right to access, correct and delete
personal data about you, to receive a copy of it in a portable format, and to complain to your
data protection authority. You can also withdraw your consent at any time, which does not affect
what was sent before.

## Children

Rushwarden is made for everyone. It has no chat, no accounts and no way for players to share
personal information. If a child says yes to stats, their play sends the same events as
everyone else's, tagged with the same kind of random install ID, which is pseudonymous personal
data as described above. We use it only to keep the game working and improve it, never to
contact anyone, build a profile or show ads. We never ask for or collect a name, contact details
or location from anyone, and we do not knowingly collect any other personal information from
children. On Poki and CrazyGames the game sends us nothing.

## Changes to this policy

If we change what the game collects, we update this page and the date at the top before the
change goes live, and the game asks you again before sending anything new.

## Contact

[developer name] · [contact email]

---

## Notes for Idan (remove before publishing)

Settled in ADR-025 (2026-10-10): opt-in consent everywhere, consent as the legal basis, 90-day
raw retention and anonymous totals, the Privacy panel with the install ID and "Delete my data",
email requests by install ID, the URL `rushwarden.com/privacy`, no postal address, no analytics
on Poki or CrazyGames (ADR-024).

Still needed from Idan before publishing:

1. **Developer name** (the controller's identity, GDPR Art. 13) and a **contact email** that he
   reads. The name can be his own name (GDD §1 open decisions).
2. **The domain** `rushwarden.com` registered (accounts.md step 2), so this page can be hosted.

Before `VITE_INGEST_URL` is set in any public build, the team must also land: the consent panel
and Privacy panel (UI), the client that waits for consent and the 90-day deletion job (Backend).
This page describes that behaviour, so it must not be published before it ships.

Settled by the Lead earlier (2026-10-10): Idan approved collecting once this is published; the
event time is the server's receipt time with unbatched events (ADR-009); IP addresses are never
stored (P1-BE-01 acceptance criteria).
