# ADR-025: Privacy defaults for analytics, retention and data requests

Status: Accepted · 2026-10-10 · Lead

Idan delegated these privacy defaults to the Lead on 2026-10-10 ('why do I need to give privacy
details? You can do that yourself'); only the developer name and contact email remain his.

ADR-009 left consent in the EU/UK, retention and opt-out to the published policy, and the
privacy draft (`docs/legal/privacy.md`) listed them as open questions. This ADR picks the
defaults. Only the developer's legal name and contact email remain for Idan.

## The law in short (read 2026-10-10)

- **EU (ePrivacy Art. 5(3)).** The EDPB's
  [Guidelines 2/2023 on the technical scope of Art. 5(3), version 2.0](https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)
  (landing page:
  [edpb.europa.eu](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en))
  say: "The ePD does not place any upper or lower limit on the length of time that information
  must persist on a storage medium to be counted as stored" (para 37); "the notion of storage
  does not depend on the type of medium on which the information is stored" (para 38); and
  access also covers software the entity "distributes ... on the terminal equipment of the
  user" that "will then proactively call an Application Programming Interface ('API') endpoint
  over the network" (para 33), which is what our analytics client does. There is
  no EU-wide first-party analytics exemption, so a random install ID in `localStorage`, and
  even an ID kept only in memory, needs consent unless it is strictly necessary. Analytics is
  not strictly necessary to play.
- **UK (PECR as amended by the Data (Use and Access) Act 2025, commenced in 2026).** The
  ICO's [exceptions guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/)
  adds a "statistical purposes" exception for information society services, including apps:
  allowed without consent if the sole purpose is statistics "about how the service is used",
  the output is "aggregate statistical information", any third party is a processor, and the
  user gets "a simple means of objecting, free of charge". The same page says storage "used as
  part of a cookie consent mechanism, which remember the user's cookie preferences" is strictly
  necessary.
- **US children (COPPA).** A persistent identifier is personal information, but collecting it
  only for "support for the internal operations" (16 CFR 312.2, which includes "maintain or
  analyze the functioning" of the service) needs no parental consent if nothing else is
  collected and it is not used to contact or profile anyone (16 CFR 312.5(c)(7)).

## Decision

1. **Opt-in everywhere, one rule for all players.** The game stores no install ID and sends no
   event until the player says yes. It asks once, in a small non-blocking panel on the title
   screen before the first run: "Help balance Rushwarden? Send anonymous gameplay stats to the
   developer. [Yes] [No]", with both buttons equal in size and style and a "Privacy" link. No
   answer means no. The answer (yes or no) is kept in `localStorage` (strictly necessary, it is
   the consent record) and asked again only when the policy's collected data changes.
   - Why not the alternatives: an EU/UK-only prompt needs a geolocation step that fails on VPNs
     and still has to treat "unknown" as EU; ID-less analytics still falls under Art. 5(3) per
     the EDPB and cannot measure a session; the UK statistical exception does not cover the EU.
     One opt-in rule is the safest and the simplest to build and test.
   - Cost, a caveat on Phase 1 criterion 1: session length comes only from players who opted
     in, so it skews toward engaged players. QA reports the yes rate beside the median, and the
     gate one-pager (P1-QA-04) shows both to Idan (ADR-010 is otherwise unchanged).
2. **Legal basis: consent** (GDPR Art. 6(1)(a)), the same consent as point 1. Withdrawing is as
   easy as giving it (Art. 7(3)): the Privacy panel has an on/off switch.
3. **Portal builds collect nothing** (ADR-024 point 4). Analytics exists only on itch and our
   own website.
4. **Retention.**
   - Raw events (with install ID): **90 days** from receipt, then deleted by a daily job.
   - Aggregates: daily totals with **no install ID**, and any figure covering fewer than 10
     installs is merged or dropped, so they are anonymous. Kept while the game is maintained,
     reviewed once a year.
   - Cloudflare: Workers request logs and Logpush stay off for the analytics Worker, and the
     Worker never logs request bodies, IP addresses or install IDs.
5. **Where the policy lives.** Source of truth: `docs/legal/privacy.md` in this repo. Published
   at **`https://rushwarden.com/privacy`** as a static page, linked from the in-game Privacy
   panel, the itch page, every portal submission (Poki needs a hosted URL, not a Google Doc) and
   later every store listing (GDD §10). Nothing is collected until that URL is live (ADR-007
   point 5, unchanged).
6. **Data-subject requests without accounts.** The Privacy panel shows the install ID, the
   analytics switch, and a **"Delete my data"** button that calls `DELETE /ingest/:install` (GDD
   §10) and then deletes the local ID. Turning analytics off also deletes the local ID. For
   access or anything else, players email the install ID to the contact address; holding the ID
   is the proof (only that device has it). We answer within one month (GDPR Art. 12(3)). If a
   player no longer has the ID, we explain that we cannot find their data (Art. 11(2)).
7. **Other gaps in the draft.**
   - No postal address is published; GDPR Art. 13 needs the controller's identity and contact
     details, and the email is the contact.
   - Processor and transfers: Cloudflare acts as processor under its self-serve Data Processing
     Addendum, which includes the EU Standard Contractual Clauses; the policy says so.
   - Children: the policy states the COPPA position above (identifier only, internal
     operations, no contact, no profiling) and that portal builds collect nothing.
   - The install ID is a random UUID, never derived from the device, never sent anywhere but
     `/ingest`, and never shared.

## Consequences (work for other roles, flagged to the Lead)

- **Backend (`packages/app/src/analytics`, `packages/backend`):** the client creates the ID only
  after a yes and deletes it on a no or on delete; a daily cron deletes raw events older than 90
  days; the nightly roll-up drops install IDs and suppresses figures under 10 installs.
- **UI:** the consent panel and the Privacy panel (link, switch, install ID, delete button).
  The toy needs both before `VITE_INGEST_URL` is set.
- **Platform:** portal builds never set `VITE_INGEST_URL`; the itch build sets it only after the
  policy URL is live.
- **Residual risk, not blocking:** the UK's opt-out exception and the EU's consent rule may let a
  later ADR switch the UK to opt-out; GDPR Art. 8 (a child's own consent below 13–16) and the
  Art. 27 EU/UK representative question are worth a lawyer's look before Phase 3 sales, when
  personal data grows (Stripe, optional recovery email).
