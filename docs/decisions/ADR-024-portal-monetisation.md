# ADR-024: What Poki and CrazyGames allow for a no-ads, one-unlock game

Status: Accepted · 2026-10-10 · Lead, except decision 2, which is Proposed (Idan): decision card
posted 2026-10-10, recommended free District 1 demo, non-exclusive only.

GDD §1 constraint 2 says "No ads, ever" and one unlock purchase. §9 plans the unlock on
CrazyGames through its IAP, and on Poki an unlock button that deep-links to the stores and the
website. ADR-013 asked whether the portals accept a game that never calls their ad APIs. This
ADR records what the portals' own public docs say (read 2026-10-10), what we do on each portal,
and the few points only the portal's team can confirm.

## What the portals publish

### Poki

Sources: [Requirements and quality](https://developers.poki.com/guide/requirements-quality),
[Monetization overview](https://developers.poki.com/guide/how-monetization-works),
[Deal types](https://developers.poki.com/guide/revenue-deal-types),
[SDK overview](https://developers.poki.com/guide/sdk-overview),
[External resources](https://sdk.poki.com/external-resources),
[SDK requirements](https://sdk.poki.com/new-requirements),
[older requirements page](https://sdk.poki.com/requirements).

- **Ads.** "Ad break integration: implement `commercialBreak()` and/or `rewardedBreak()`
  functions as appropriate for your game." No line says an ad call is mandatory, but
  "Poki's ad system is the only form of monetization", and the SDK overview says of
  `commercialBreak()`: "our system decides when a player is ready, so signal as many
  opportunities as possible." The only call the SDK overview marks as required is
  `gameLoadingFinished()` ("Required to track loading and show your conversion to play").
- **Purchases.** "In-app purchases are not available." "Games on Poki earn through in-game ads,
  served entirely by the Poki SDK. There are no in-app purchases and no third-party ad systems
  to integrate." "No internal purchases: remove any in-game UI elements for purchasing currency
  or disabling advertisements."
- **Links.** "Remove splash screens and outgoing links; your studio logo is welcome on the
  loading screen." Buttons that open external links "are required to fire the following SDK
  rather than directly leading to the URL" (`PokiSDK.openExternalLink`).
- **Network and data.** "Poki blocks all external requests by default." "Analytics services
  like GameAnalytics, ByteBrew, or your own in-house solution may be approved on a case-by-case
  basis." "Games should not collect any personal information from players." If a game links
  out "(even for analytics exemptions), include an in-game, accessible Privacy Policy UI" and
  "provide us a hosted policy URL (no Google Doc links)."
- **Deals.** Web exclusive is "Our preferred way of working: on the open web, your game is
  published only on Poki." "By default, exclusive deals run for 5 years." "Exclusivity only
  applies to the web, so you stay free to publish on non-web platforms like Steam and the app
  stores." For non-exclusive games "we can offer a one-time flat license fee instead, with no
  revenue share."
- **QA.** "Before your game can go live, our QA team checks it against the requirements below."
  The player-fit (Web Fit) test only needs the SDK events: "Implement SDK events correctly
  (required for Web Fit testing and all releases)."

### CrazyGames

Sources: [Requirements](https://docs.crazygames.com/requirements/intro/),
[Ads](https://docs.crazygames.com/requirements/ads/),
[Gameplay](https://docs.crazygames.com/requirements/gameplay/),
[Technical](https://docs.crazygames.com/requirements/technical/),
[Account integration](https://docs.crazygames.com/requirements/account-integration/),
[In-game purchases](https://docs.crazygames.com/sdk/in-game-purchases/),
[FAQ](https://docs.crazygames.com/faq/).

- **Ads.** "The primary monetization mechanism we offer is through advertisement revenue
  share." "Only ads served through our SDK are allowed." Basic Launch: "The CrazyGames SDK is
  optional and monetization is not available", and "Ads are not allowed in Basic Launch, and
  will be disabled even if you would integrate them." The ads page sets only a maximum ("max 1
  every 3 minutes") and no minimum. No page says a Full Launch game must show ads.
- **Purchases.** "Selected games are eligible for In-game Purchases." "A Full Implementation is
  required, using Xsolla as payments provider." "Contact our team if you want to apply for
  this." "In-game purchases are an invite only feature." "In-game purchases should be available
  only for the users that are signed in." "Guest users should not be able to purchase items."
  "Make sure to use the CrazyGames account ID to register purchases." Local-only saves are "not
  allowed for games with in-game purchases as it relies on local data." "If your game uses
  Xsolla or another external payment flow, disable it in the CrazyGames App" when
  `applicationType` is `google_play_store` or `apple_store`.
- **Links.** "The game should not include cross-promotions for external or internal
  games/platforms." Community links (including the dev website) are allowed on the menu only
  "as long they don't lead directly to a playable web version". "App Store links are never
  allowed in-game". Privacy Policy and Terms links are an allowed exception.
- **Data.** "In case your game collects additional personal data beyond the events in our
  SDK", "the game should add a Terms & Conditions and/or Privacy Policy notice to new players."
- **Exclusivity.** None stated; publishing on Steam or mobile "doesn't affect your eligibility
  for revenue share."

## Verdicts

1. **Poki: OK for the Phase 1 player-fit test; conflicts with our model for a commercial
   release.** The toy has no ads and no unlock, and the test needs only SDK events, so it fits.
   A release cannot sell the unlock (no purchases, no purchase UI), and the deep-link to the
   stores and website in §9 breaks "remove outgoing links" and "no internal purchases". Poki
   earns only from ads, so a no-ads game earns Poki and us nothing on Poki, and its default deal
   is 5-year web exclusivity, which conflicts with itch, our website and CrazyGames.
2. **CrazyGames: OK with conditions.** Basic Launch fits as is: no ads exist there anyway, the
   SDK is optional, and there is no exclusivity. Selling the unlock needs an invitation to IAP,
   Full Launch, Xsolla through the CrazyGames SDK, a signed-in CrazyGames player, and the
   entitlement stored against the CrazyGames account, not only locally. The unlock may not link
   to our website (it hosts a playable version) or to the app stores.

## Decision

1. **Ad calls.** ADR-013 stands: no portal build calls `commercialBreak`, `rewardedBreak` or
   `SDK.ad.*`. The team never adds them; if a portal requires them, the portal is dropped for
   that phase, not the pillar.
2. **Proposed (Idan): decision card posted 2026-10-10, recommended free District 1 demo,
   non-exclusive only.** Poki is a test channel and a free demo channel only. The Phase 1 player-fit test goes
   ahead. A later Poki release, if any, is District 1 only, with no unlock button, no price, no
   purchase UI and no outgoing links (the share uses `shareableURL`). `canSellInPortal()` stays
   `false`. The §9 row "on Poki, the unlock CTA deep-links to the stores and the website" is
   replaced by this. Any Poki deal must be **non-exclusive** (flat fee or none); a web-exclusive
   deal needs Idan's decision, since it would remove itch, our website and CrazyGames. Until
   Idan answers, nothing depends on this beyond the Phase 1 player-fit test, which fits either
   way.
3. **CrazyGames starts in Basic Launch with no unlock.** This is not a choice we make: in-game
   purchases are invite-only under CrazyGames' own policy ("In-game purchases are an invite only
   feature"), so at launch the §9 "unlock via CrazyGames IAP" cannot exist. It reverts to §9 when
   CrazyGames invites us. Same District 1 build as Poki, with `canSellInPortal()` returning
   `false` until that invitation (a reversible change). If invited,
   the unlock uses only CrazyGames' Xsolla flow, requires the player to sign in to CrazyGames
   (a CrazyGames account, not a Rushwarden one, so constraint 6 holds), stores the entitlement
   with the CrazyGames account ID, and is hidden in the CrazyGames mobile apps. That work is a
   Phase 3 task for the Platform Engineer with its own ADR.
4. **No own analytics on portal builds.** Portal builds (`VITE_PORTAL=poki|crazygames`) never
   set `VITE_INGEST_URL`. Poki blocks the request and asks for no personal data; both portals
   already give us plays, playtime and retention in their dashboards, which is all Phase 1
   criterion 4 needs (ADR-010). Portal builds still link the privacy policy (ADR-025).
5. **Links on portals.** Only the portal's own share URL and the privacy policy link. No itch,
   website, Steam or app-store links in portal builds.

## What only the portals can confirm (Idan asks, in writing, before submitting)

The docs do not settle these. Idan, or the Lead on his behalf by email, asks each portal's
developer support and keeps the reply.

- **Poki:** (a) A game that never calls `commercialBreak()` or `rewardedBreak()` passes QA for
  the Web Fit test and for release. (b) For a no-ads game, what deal is possible: a
  non-exclusive listing, flat fee or none. (c) Whether a `PokiSDK.openExternalLink` to our Steam
  page would ever be approved (we assume no and plan without it).
- **CrazyGames:** (a) A game that never requests ads is eligible for Basic Launch and for Full
  Launch. (b) Whether a no-ads game with a one-time unlock can be invited to in-game purchases,
  and the revenue split on Xsolla purchases (not published).

## Consequences

- No code change is needed now: the adapters already never call ad APIs (ADR-013), and Poki's
  `canSellInPortal()` is already `false`. CrazyGames' `canSellInPortal()` currently returns
  `true`; the Platform Engineer changes it to `false` until the IAP invitation exists (a change
  in `packages/platform-web`, flagged to the Lead).
- `docs/store/portals.md` already has no links, prices or unlock talk, which matches.
- Revenue from portals is expected to be near zero. Portals are for reach, testing and funnel to
  Steam and mobile through the portal's own listing fields (CrazyGames metadata), not in-game.
