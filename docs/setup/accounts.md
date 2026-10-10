# Accounts, secrets and console actions for Idan

Everything here is something only Idan can do: it costs money, signs a legal agreement, or acts in
a store console. The team never does these. Prices are what the platforms publish as of
October 2026; check the console before paying.

The game is **Rushwarden** (ADR-008). Domain `rushwarden.com`; app ID `com.rushwarden.game`
(permanent once a store record exists). Get a trademark attorney's clearance, including EU and
UK, before paying for listings; our screen is in [name-search.md](name-search.md).

## Order and when each is needed

| #   | Account                                                   | Cost                               | Needed by                                 | Blocks                      |
| --- | --------------------------------------------------------- | ---------------------------------- | ----------------------------------------- | --------------------------- |
| 1   | GitHub repo + secrets                                     | Free                               | **Today**                                 | Everything                  |
| 2   | Domain (`rushwarden.com` is available, i.e. unregistered) | ~US$10–15/yr for .com (₪35–55)     | Phase 1 (share URL, itch page link)       | Website, store privacy URLs |
| 3   | itch.io                                                   | Free                               | Phase 1 gate                              | 3-minute toy build          |
| 4   | Steamworks                                                | US$100 per app (recoupable)        | Phase 1 if ADR-006 kept, else Phase 2     | Wishlists, Next Fest        |
| 5   | Poki for Developers, CrazyGames Developer Portal          | Free                               | Phase 1 gate                              | Player-fit test             |
| 6   | Cloudflare                                                | Free tier                          | Phase 1 (toy session metrics), else 3     | Daily, leaderboard, license |
| 7   | Stripe                                                    | Per-transaction fees               | Phase 3                                   | Web unlock                  |
| 8   | Apple Developer Program                                   | US$99/yr                           | Phase 3 (sandbox IAP)                     | iOS build, IAP              |
| 9   | Google Play Console                                       | US$25 once                         | Phase 3; start early (14-day tester rule) | Android, IAP                |
| 10  | RevenueCat                                                | Free up to US$2.5k monthly revenue | Phase 3                                   | Mobile IAP                  |

## 1. GitHub (today)

1. Create an **empty private repository**, e.g. `IdanErel/rushwarden` (no README, no
   licence; the scaffold is ready to push). Keep the slug even if the game is renamed.
2. Make sure the Claude GitHub app can reach it: https://github.com/apps/claude/installations/select_target
3. Settings → Branches → add a rule for `main`: require a pull request, require status checks
   `Lint, typecheck, unit, golden (Node)`, `Golden hashes (Chromium, WebKit, Firefox)`,
   `Web build, size budget, e2e`, `Conventional commit title`; require linear history; do not
   require GitHub approvals (ADR-005 explains why; Reviewer verdicts are PR comments).
4. Settings → General → Pull Requests: allow **squash merging only**; enable "automatically
   delete head branches".
5. Repository secrets are added later, as each account below is created (Settings → Secrets and
   variables → Actions). Never paste secrets into chat or code.

## 2. Domain

1. Register `rushwarden.com`; it is available (unregistered), but registration costs about
   US$10–15 a year (~₪35–55; GoDaddy's ~₪50 is in that range, though renewals there often cost more).
   Cloudflare Registrar sells at cost with no markup on renewals and you need a Cloudflare account
   anyway (step 6), so it is the cheapest option. Use a registrar with free WHOIS
   privacy. Cloudflare Registrar sells at cost once you have the Cloudflare account (step 6).
2. Point nameservers at Cloudflare.
3. Reserve matching social handles (X, Bluesky, Reddit, TikTok, YouTube) at the same time.

## 3. itch.io

1. Create an account; under "Dashboard → Create new project" make a **draft** project, kind HTML,
   embed 390×844, "Mobile friendly", fullscreen button on. Leave it unpublished.
2. Settings → API keys → generate a key. GitHub secret: `BUTLER_API_KEY`. Variable:
   `ITCH_TARGET` = `youruser/rushwarden:html5`.
3. You publish; CI only uploads builds to the draft channel.
4. Until the butler deploy exists (P1-LEAD-02), every CI run on `main` attaches the zip as the
   artifact `rushwarden-itch-<commit>` (GitHub → Actions → the run → Artifacts). To try it by hand,
   upload that zip to the draft project and tick "This file will be played in the browser".

## 4. Steamworks

1. Sign up at https://partner.steamgames.com as an individual. Complete the tax interview and
   bank details (identity verification takes a few days).
2. Pay the app credit (US$100) for one app. Note the **App ID**.
3. Create a **build account** (a separate Steam account with Steam Guard via email) for CI uploads.
4. GitHub secrets: `STEAM_APP_ID`, `STEAM_USERNAME`, `STEAM_CONFIG_VDF` (generated after first
   login with steamcmd on your machine; we provide the command in the runbook).
5. Create the store page draft; the team supplies copy and capsule art. Submitting the page for
   Valve's review is your action.

## 5. Web portals

1. **Poki:** apply at https://developers.poki.com with the itch link once the toy exists. They run
   the player-fit test; no payment.
2. **CrazyGames:** create a developer account at https://developer.crazygames.com; Basic Launch
   upload is yours. Payouts and IAP need your tax details there later.

## 6. Cloudflare

1. Create an account (free plan). Add `rushwarden.com`.
2. Workers & Pages: nothing to create by hand; Wrangler in CI creates them.
3. My Profile → API Tokens → create a token with "Edit Cloudflare Workers", D1 Edit, Workers KV
   Edit, Cloudflare Pages Edit, scoped to your account. GitHub secrets: `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`.
4. Later (Phase 3) we will ask you to add Worker secrets via `wrangler secret put`: the Ed25519
   license signing key and the dashboard secret. The team generates the key pair locally on your
   machine with a script; the private key never enters the repo.

## 7. Stripe

1. Create an account as an individual/sole proprietor; complete identity and bank verification.
2. Enable **Stripe Tax** (Settings → Tax) and register where required.
3. Create product "Full City", one-time price US$7.99.
4. Developers → API keys: GitHub secrets `STRIPE_SECRET_KEY` (test mode first), and after we
   deploy the Worker, a webhook endpoint `https://api.rushwarden.com/license` for
   `checkout.session.completed` → secret `STRIPE_WEBHOOK_SECRET`.

## 8. Apple Developer Program

1. Enroll as an individual at https://developer.apple.com/programs/enroll (US$99/yr; the seller
   name shown on the App Store will be your legal name).
2. Sign the **Paid Applications Agreement** and complete tax and banking (required for IAP, even
   sandbox).
3. Certificates, IDs & Profiles → register App ID `com.rushwarden.game`.
4. App Store Connect → create the app record (name ≤ 30 chars), then In-App Purchases → create
   non-consumable `full_city`, US$7.99 tier.
5. Users and Access → Integrations → App Store Connect API → generate a key (App Manager role).
   GitHub secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`.
6. Create a sandbox tester account for purchase tests.

## 9. Google Play Console

1. Register a **personal** developer account (US$25 once) and verify identity. Personal accounts
   created after Nov 2023 must run a **closed test with at least 12 testers for 14 consecutive
   days** before production; start recruiting early (section 12).
2. Set up a payments profile (merchant) for IAP.
3. Create the app with package name `com.rushwarden.game`, enroll in Play App Signing.
4. Monetize → Products → In-app products: `full_city`, non-consumable, US$7.99.
5. Create a Google Cloud service account with Play Console API access (Release manager).
   GitHub secret: `PLAY_SERVICE_ACCOUNT_JSON`. Upload keystore: we generate it; you store the
   backup. Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`.

## 10. RevenueCat

1. Create a project; add the iOS app (needs the App Store Connect in-app purchase key) and the
   Android app (needs the Play service account JSON).
2. Create entitlement `full_city` and attach both store products; create an offering "default".
3. GitHub secrets: `REVENUECAT_IOS_PUBLIC_KEY`, `REVENUECAT_ANDROID_PUBLIC_KEY` (public SDK keys),
   and a webhook to `https://api.rushwarden.com/revenuecat` with auth header secret
   `REVENUECAT_WEBHOOK_AUTH` for refunds/revocations.

## Secrets summary

| Secret                                                                                  | From       | Phase |
| --------------------------------------------------------------------------------------- | ---------- | ----- |
| `BUTLER_API_KEY` (+ variable `ITCH_TARGET`)                                             | itch.io    | 1     |
| `STEAM_APP_ID`, `STEAM_USERNAME`, `STEAM_CONFIG_VDF`                                    | Steamworks | 1–2   |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                                         | Cloudflare | 2–3   |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                            | Stripe     | 3     |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`                                        | Apple      | 3     |
| `PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_KEYSTORE_*`                                       | Google     | 3     |
| `REVENUECAT_IOS_PUBLIC_KEY`, `REVENUECAT_ANDROID_PUBLIC_KEY`, `REVENUECAT_WEBHOOK_AUTH` | RevenueCat | 3     |
