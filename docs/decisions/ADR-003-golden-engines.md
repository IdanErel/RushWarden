# ADR-003: Golden-hash engines per PR and nightly

Status: Accepted · 2026-10-10 · Lead

Section 3 says golden hashes run "on every CI run" on Node, Chromium, WebKit and the Android/iOS
WebViews; section 11 says every PR for web and nightly for mobile. Following section 11: every PR
runs Node + Chromium + WebKit + Firefox (Playwright); Android and iOS WebViews run nightly once
the Capacitor shells exist (Phase 2), and on release tags. A mobile mismatch blocks the next
release tag and is a P0.
