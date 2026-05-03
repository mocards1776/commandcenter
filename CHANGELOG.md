# CommandCenter Changelog

---

## Lexington 1 — May 3, 2026

**Fixed by AI (Perplexity / Claude session).**

### What broke
Tasks stopped completing on Saturday evening. The frontend at `command-center-flax-gamma.vercel.app` was sending `PATCH` requests to the DigitalOcean backend at `orca-app-v7oew.ondigitalocean.app`, but the live server was rejecting them with a CORS preflight error:

> "Method PATCH is not allowed by Access-Control-Allow-Methods in preflight response"

### Root cause
A previous AI session (Claude) had modified `main.py` but the DigitalOcean deployment was **stale** — the running container never picked up the CORS fix that included `PATCH` in `allow_methods`. A force rebuild on DigitalOcean resolved the immediate CORS issue.

### Additional fixes applied in this session
1. **Dashboard stats were all blank (`---`)** — The `/dashboard/` endpoint was not returning `completed_tasks_today`, `total_tasks_today`, `time_tracked_seconds`, or the `gamification` block. The frontend `GameScoreboard` component reads all of these directly. Fixed by computing and returning the full gamification object (batting average, hitting streak, hits, strikeouts, focus minutes).

2. **Habits showing as `—`** — Habit entries in `today_habits` only had a `title` field, but `DashHabitRow` looks for `entry?.name` first. Since `name` was missing, it rendered as `—`. Fixed by returning both `title` and `name` on every habit entry.

### For future AI sessions
- The backend is a **FastAPI** app on DigitalOcean App Platform. It auto-deploys from GitHub pushes, but sometimes needs a **Force Rebuild & Deploy** from the DigitalOcean dashboard to pick up changes.
- The frontend is a **Next.js / React** app on Vercel at `command-center-flax-gamma.vercel.app`.
- CORS middleware is in `main.py` — if you ever add a new HTTP method anywhere, make sure it's listed in `allow_methods`.
- The `GameScoreboard` and `DashHabitRow` components are sensitive to exact field names returned by `/dashboard/`. If stats go blank, check that endpoint first.
