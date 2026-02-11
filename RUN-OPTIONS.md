# How to run Call Spend Summary: automated and on-demand

## Option 1: On-demand from your machine (terminal)

**Default (yesterday for start and end):**
```bash
npm run call-spend
# or
node run-daily-call-spend.cjs
```

**Specific timeframe (start month → end month):**
```bash
node run-daily-call-spend.cjs 2026-01 2026-02
```
Uses first day of start month and last day of end month.

**Using env for timeframe:**
```bash
START_MONTH=2026-01 END_MONTH=2026-03 node run-daily-call-spend.cjs
START_DATE=01/15/2026 END_DATE=02/28/2026 node run-daily-call-spend.cjs
```

Requires `.env` (or env vars) with: `SI_USERNAME`, `SI_PASSWORD`, `GMAIL_USER`, `GMAIL_APP_PASS`, `TO_EMAIL`, and optionally `ALERT_EMAIL`.

---

## Option 2: GitHub Actions (schedule + manual with timeframe)

- **Workflow file:** `.github/workflows/call-spend-reports.yml`
- **Scheduled run:** First day of each month at 6:00 AM UTC (cron: `0 11 1 * *`). Edit the `schedule` in that file to change interval (e.g. weekly, or a different time).
- **Manual run:** In GitHub: repo → **Actions** → **Call Spend Summary Reports** → **Run workflow**. You can optionally set:
  - **Start month** (e.g. `2026-01`)
  - **End month** (e.g. `2026-02`)
  Leave both empty to use default (yesterday).

**Secrets:** Same as your existing Sales-i workflow: `SI_USERNAME`, `SI_PASSWORD`, `GMAIL_USER`, `GMAIL_APP_PASS`, `TO_EMAIL`, `ALERT_EMAIL`. No new secrets needed.

---

## Option 3: Windows Task Scheduler (run on your PC on a schedule)

1. Open **Task Scheduler** (search “Task Scheduler” in Windows).
2. **Create Basic Task** (or Create Task).
3. **Trigger:** e.g. Daily at 6:00 AM, or Monthly on the 1st.
4. **Action:** Start a program.
   - **Program:** `node` (or full path to `node.exe`).
   - **Arguments:** full path to script, e.g.  
     `"C:\Users\CHRIS_CONKLIN\salesi daily\salesi-daily-reports\run-daily-call-spend.cjs"`  
     For a specific range add: `2026-01 2026-02`.
   - **Start in:** your project folder, e.g.  
     `C:\Users\CHRIS_CONKLIN\salesi daily\salesi-daily-reports`
5. So that env vars (e.g. from `.env`) are available, either:
   - Run a **batch file** that sets env (or calls `dotenv`) then runs `node run-daily-call-spend.cjs`, and point Task Scheduler at that batch file, or
   - In Task Scheduler → Task → **Environment** (or “Start in” and a wrapper script), ensure the process can load `.env` (e.g. run from project directory and use `node run-daily-call-spend.cjs` which loads `dotenv`).

**On-demand:** Run the same task manually from Task Scheduler (right‑click → Run), or run `npm run call-spend` / `node run-daily-call-spend.cjs` in a terminal.

---

## Option 4: Batch file for easy on-demand (Windows)

Create e.g. `run-call-spend.bat` in the project folder:

```bat
@echo off
cd /d "%~dp0"
if "%~1"=="" (
  node run-daily-call-spend.cjs
) else (
  node run-daily-call-spend.cjs %*
)
pause
```

- Double‑click: runs with default (yesterday).
- Or run from cmd with a range: `run-call-spend.bat 2026-01 2026-02`.

You can duplicate the batch file and hardcode a timeframe in the `node` line if you want one-click for “last month” or “Jan–Feb 2026”.

---

## Summary

| Goal | Use |
|------|-----|
| Run now, default (yesterday) | `npm run call-spend` or `node run-daily-call-spend.cjs` |
| Run now, specific months | `node run-daily-call-spend.cjs 2026-01 2026-02` |
| Automated in the cloud + manual with inputs | GitHub Actions (Option 2) |
| Automated on your PC | Windows Task Scheduler (Option 3) |
| One-click / simple on-demand on PC | Batch file (Option 4) |
