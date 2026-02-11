# How the Daily Sales-i Script Works

## Current flow (Call Outcome Report)

1. **Login**
   - Goes to `https://login.sales-i.com/Account/Login`
   - Fills UserName → Next → Password → Sign in
   - Waits for URL to contain `us2t.sales-i.com`

2. **Welcome page**
   - Navigates to `https://us2t.sales-i.com/Net/RecordCard_v3/welcome.aspx`
   - Finds the **Call Outcome Report** tile (section/div/li with that text)
   - Clicks **VIEW REPORT** on that tile

3. **Filter panel**
   - Clicks the Filter bar (tries: `#ctl00_divFilter1`, `.accordion__title` with "Filter", button "Filter", etc.)
   - Waits until **start date**, **end date**, or **Apply** button is visible
   - Selectors used: `#start-date`, `#end-date`, `#ctl00_btnApply`

4. **Per rep**
   - Sets **start** and **end** date to yesterday (MM/DD/YYYY) in `#start-date` and `#end-date`
   - Dismisses any datepicker (Escape, click away)
   - Sets **user** via dropdown `#ddUser` (select by rep id)
   - Clicks **Apply Filters** (`#ctl00_btnApply` or button with text "Apply Filters")
   - Waits 3s, then clicks **"Click for detail"** to open the detailed call notes view
   - First rep only: opens **Columns**, unchecks Contact / Call Outcome / Next Action, OK
   - Takes full-page screenshot → emails with subject "Sales-i Call Outcome Report — {name} — {date}"
   - For next rep: goes back (link "Call Outcome Report" or goBack), re-opens filter panel

5. **Failure handling**
   - Saves screenshot and HTML on fatal error, emails alert to ALERT_EMAIL

---

## What’s needed for Call Spend Summary

- **Different page**: From welcome, open the **Call Spend Summary** (or equivalent) tile instead of Call Outcome Report.
- **Different filter selectors**: The spend page may use different IDs/classes for:
  - Filter bar / accordion
  - Start date and end date inputs
  - User dropdown
  - Apply button
- **Different post-apply steps**: There may be no "Click for detail" or different column toggles; we’ll need to match the actual spend page behavior.

---

## Recommended approach

**Option A – Single script, report-type config (recommended)**  
- One script (e.g. `run-daily-salesi.cjs`) that reads `REPORT_TYPE=call-outcome` or `REPORT_TYPE=call-spend` (env or CLI).
- A **report config** object per type defines:
  - Tile text to find on welcome (e.g. "Call Outcome Report" vs "Call Spend Summary")
  - Selectors for: filter bar, start date, end date, user dropdown, apply button
  - Optional: "detail" link text/selector, column checkboxes to change
- Shared code: login, navigation, safeGoto, email, logging, retries, date formatting.
- **Pros**: One codebase; fixes (e.g. login, email) apply to both reports; adding a third report is just another config.

**Option B – Shared module + two scripts**  
- Extract shared logic into `lib/salesi-shared.cjs` (login, email, logging, safe*, date, generic “set dates / set user / apply” that take selector config).
- `run-daily-call-outcome.cjs` and `run-daily-call-spend.cjs` each call the shared module and pass their own selectors and steps.
- **Pros**: Same reuse as A; two entry points can be clearer for scheduling (e.g. different cron for each). **Cons**: Two files to keep in sync for flow changes.

**Option C – Copy and edit**  
- Duplicate the current script and change only the page-specific parts.
- **Cons**: Duplicate login, email, and retry logic; any fix must be applied in both places.

Recommendation: **Option A** (one script + report config), or **Option B** if you prefer separate entry points (e.g. different GitHub Action schedules for call-outcome vs call-spend).

---

## Next step

To implement Call Spend Summary we need the **exact selectors and flow** on the spend page:

1. **Welcome**: Exact text of the tile/link for the spend report (e.g. "Call Spend Summary", "Spend Summary", etc.).
2. **Filter**: How to open the filter (same accordion "Filter" or different? Any IDs like `#ctl00_divFilter2`?).
3. **Dates**: IDs or labels for start/end date inputs (e.g. still `#start-date` / `#end-date` or something else).
4. **User**: ID or name of the user dropdown (e.g. still `#ddUser` or different).
5. **Apply**: ID or text of the Apply button.
6. **After Apply**: Is there a "Click for detail" or similar, or do we screenshot the same page that appears right after Apply?

If you can open the Call Spend Summary page in the browser and share:
- The exact tile/link text on the welcome page, and  
- Inspect element (or “Copy selector”) for the filter bar, date inputs, user dropdown, and Apply button  

we can plug those into the report config and wire up the script (or second script) without re-teaching the whole flow from scratch.
