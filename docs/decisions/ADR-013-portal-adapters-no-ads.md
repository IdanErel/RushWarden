# ADR-013: Web portal adapters never call portal ad APIs

Status: Proposed (Idan, for the Poki part) · 2026-10-10 · Platform Engineer

GDD §1 constraint 2 says "No ads, ever". §9 asks for `commercialBreak` "before run start and
after run end (it will resolve instantly since we serve no ads, but the hook must exist)". In the
real SDKs, `PokiSDK.commercialBreak()` is the call that shows a video ad when Poki decides to, and
CrazyGames shows ads through `SDK.ad.requestAd`. Calling either cannot be made ad-free from our
side.

**Decision.** The Poki, CrazyGames and itch adapters in `packages/platform-web/src/portal/` keep
the `commercialBreak()` hook so the game flow has it, but it resolves at once and never calls
`PokiSDK.commercialBreak`, `PokiSDK.rewardedBreak` or `CrazyGames.SDK.ad.*`. Unit tests assert
this. Related details the brief leaves open:

1. **Build flag.** The adapter is chosen by `VITE_PORTAL` (`none` default, `itch`, `poki`,
   `crazygames`). An unknown value fails the build. Vite inlines the flag, so a portal build
   contains only its own adapter and only its own SDK URL. SDKs load at runtime from their
   official URLs and are never bundled.
2. **Loading events.** Poki `gameLoadingFinished` and CrazyGames `loadingStart`/`loadingStop` have
   no hook on the shared `PortalAdapter`. They live on a web-only `WebPortalAdapter` extension,
   which `main.ts` calls, so the shared interface does not change.
3. **Failure.** If the SDK is blocked, slow (8 s timeout) or malformed, the game boots without
   it, and every hook becomes a no-op. Poki is the exception: when `PokiSDK.init` rejects (ad
   blocker), events are still sent, as Poki asks. A CrazyGames SDK that reports `environment:
'disabled'` (not on a CrazyGames domain) is treated as no portal.
4. **Iframe safety.** The adapters never read `window.top`, `parent` or `opener` and never
   navigate. Share URLs come from the portal SDK (`shareableURL`, `inviteLink`), or from our own
   configured URL. Only `https://` URLs from the SDK are accepted.

**Escalation (Idan).** Poki's docs ask for `commercialBreak()` before every `gameplayStart()`,
which their QA may check. Before any Poki submission, Idan confirms with Poki that a no-ads game
is accepted with the hook in place and the SDK ad call left out. If Poki insists on the call,
that is a conflict with the no-ads pillar for Idan to decide; the team does not add the call.
CrazyGames Basic Launch should also be confirmed as fine for a game that never requests ads.
