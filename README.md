# salesi-daily-reports

Automated Sales-i reports:

- **Call Outcome Report** — daily call outcome reports (existing script).
- **Call Spend Summary** — Call Spend CSV per rep + zero–total-calls summary; supports custom date ranges.

## Running Call Spend on GitHub

To run Call Spend on a schedule and/or on demand in GitHub Actions:

1. See **[SETUP-GITHUB.md](SETUP-GITHUB.md)** for secrets, schedule, and manual run.
2. Workflow: **Actions → Call Spend Summary Reports** (schedule: 1st of month 11:00 UTC; manual with optional start/end month).
