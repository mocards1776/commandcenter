# Release Log

## Lexington 1.3
**Date:** 2026-05-05
**Type:** Config-only fix (no code changes)

### Changes
- **Google Calendar OAuth fix** — resolved `Error 400: redirect_uri_mismatch` blocking Google sign-in
- Root cause: `https://command-center-flax-gamma.vercel.app` was never registered in Google Cloud Console OAuth credentials
- Fix: Add the following to the OAuth 2.0 Client in Google Cloud Console:
  - **Authorized JavaScript Origins:** `https://command-center-flax-gamma.vercel.app`
  - **Authorized Redirect URIs:** `https://command-center-flax-gamma.vercel.app/calendar` and `https://command-center-flax-gamma.vercel.app/`
- No code changes made; the `connectGoogleCalendar()` function in `CalendarPage.tsx` already constructs the redirect URI correctly from `window.location.origin + window.location.pathname`

---

## Lexington 2
**Commit:** 6792cb35d5527c20f7abdc0ccdf21aaa8b2a6332
**Date:** 2026-05-04

### Changes
- Fixed BaseballPanel divider to use `stripe-thin` + `stripe-3` pattern matching all other dashboard sections
- Fixed BaseballPanel grid from `auto 1fr` to `1fr 1fr` for true 50/50 left/right split
- Cardinals "Next Game" now always fetches and displays regardless of today's game status (was previously only shown after a Final)
