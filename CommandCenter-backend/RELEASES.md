# CommandCenter Release Notes

---

## Lexington 2.1 — May 4, 2026

### Bug Fixes
- **Fixed 500 error on timer stop** — Removed invalid assignment to `duration_seconds`, which is a computed `@property` on `TimeEntry` and has no setter. The `ended_at` timestamp is now set directly and `duration_seconds` is calculated automatically from `started_at`/`ended_at`. This fix applies to both `stop_time_entry` and the auto-stop logic inside `start_time_entry`.

---

## Lexington 2.0

- Initial stable release with Tasks, Projects, Habits, Time Entries, Notes, CRM, Braindump, Time Blocks, Sports (MLB), Gamification, and Telegram bot integration.
