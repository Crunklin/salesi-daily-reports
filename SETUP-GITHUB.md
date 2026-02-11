# Set up Call Spend Summary to run on GitHub Actions

This guide gets the **Call Spend Summary** report running on a schedule and/or on demand in GitHub Actions.

---

## 1. Push the workflow to GitHub

The workflow file is already in the repo:

- **`.github/workflows/call-spend-reports.yml`**

Push your branch to GitHub (or merge to `main`) so this file is on the branch you want to use for runs.

---

## 2. Add repository secrets

The workflow needs these **secrets** so the script can log in and send email. Add them in GitHub:

1. Open your repo on GitHub.
2. Go to **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret** and add each of these:

| Secret name    | What to put |
|----------------|-------------|
| `SI_USERNAME`  | Your Sales-i login username |
| `SI_PASSWORD`  | Your Sales-i password |
| `GMAIL_USER`   | Gmail address used to send (e.g. `you@gmail.com`) |
| `GMAIL_APP_PASS` | [Gmail App Password](https://support.google.com/accounts/answer/185833) for that account (not your normal password) |
| `TO_EMAIL`     | Where reports are sent (can be same as `GMAIL_USER` or a distribution list) |
| `ALERT_EMAIL`  | Where failure alerts go (optional; if missing, alerts go to `TO_EMAIL`) |

These are the same secrets used by the existing **Call Outcome Report** workflow, so if that’s already set up, you don’t need to add them again.

---

## 3. Enable Actions (if needed)

1. In the repo, open the **Actions** tab.
2. If GitHub says “Workflows aren’t being run on this repo,” enable them (e.g. **I understand my workflows go to the Actions tab**).

---

## 4. Schedule (when it runs automatically)

The workflow is set to run:

- **On a schedule:** 1st of every month at **11:00 UTC** (e.g. 6:00 AM Eastern).
- On that run it uses the **previous month** (e.g. on Feb 1 it runs for January).

To change when it runs, edit **`.github/workflows/call-spend-reports.yml`** and adjust the `schedule` section.

### Example schedules (cron)

Cron format: minute, hour, day-of-month, month, day-of-week (UTC).

| When you want it | Cron line |
|------------------|-----------|
| 1st of month at 6 AM Eastern (11:00 UTC) | `'0 11 1 * *'` (already set) |
| 1st of month at midnight UTC | `'0 0 1 * *'` |
| Every Monday at 11:00 UTC | `'0 11 * * 1'` |
| 1st and 15th at 11:00 UTC | `'0 11 1,15 * *'` |
| Every day at 11:00 UTC | `'0 11 * * *'` |

Add or replace the `- cron: '...'` line under `on: schedule:` and push. The new schedule applies after the next push.

---

## 5. Run it manually (on demand)

1. Open the repo on GitHub → **Actions**.
2. In the left sidebar, click **“Call Spend Summary Reports”**.
3. Click **“Run workflow”** (top right).
4. Choose the branch (e.g. `main`).
5. Optionally set:
   - **Start month:** `YYYY-MM` (e.g. `2026-01`).
   - **End month:** `YYYY-MM` (e.g. `2026-02`).
   Leave both blank to use the script default (yesterday for both).
6. Click the green **“Run workflow”** button.

The run will appear in the list. Click it to see logs and status.

---

## 6. What each run does

1. Checks out the repo, installs Node and dependencies, installs Playwright (Chromium).
2. Runs `node run-daily-call-spend.cjs [START_MONTH END_MONTH]` with the secrets as env vars.
3. The script logs into Sales-i, runs the Call Spend report for each rep (date range + Export CSV), emails the full CSV and (when applicable) the zero–total-calls list.
4. If the run **fails**, the workflow uploads the `exports/` folder as an artifact for 7 days so you can inspect.

---

## 7. Quick checklist

- [ ] Workflow file `.github/workflows/call-spend-reports.yml` is in the repo and pushed.
- [ ] All 6 secrets are set under **Settings → Secrets and variables → Actions**.
- [ ] Actions are enabled for the repo.
- [ ] Schedule in the workflow matches when you want it (e.g. 1st of month).
- [ ] You’ve run it once manually (**Actions → Call Spend Summary Reports → Run workflow**) to confirm it works.

---

## 8. Troubleshooting

- **“Missing required environment variables”**  
  One or more of the secrets are missing or misnamed. Check spelling and that they’re set as **Actions** secrets.

- **Run fails on “Could not open Call Spend Summary” / login**  
  Check `SI_USERNAME` and `SI_PASSWORD`. Run the script locally with the same `.env` to confirm login works.

- **No emails received**  
  Check `GMAIL_USER`, `GMAIL_APP_PASS`, and `TO_EMAIL`. Ensure the Gmail account uses an App Password and that “Less secure app access” / 2FA is set up correctly for that app password.

- **Want a different timezone**  
  Cron is always UTC. Convert your desired local time to UTC and set the cron hour/minute accordingly (e.g. 6 AM Eastern = 11:00 UTC in winter, 10:00 UTC in summer if you want DST).

- **Change which month scheduled runs use**  
  In the workflow, the “Set timeframe for scheduled run” step sets previous month. To use a different rule (e.g. current month), edit that step’s `run:` script.
