# Training the Call Spend Summary script

The new script is **`run-daily-call-spend.cjs`**. It’s already set up with the same login, email, and flow as the Call Outcome script; we only need to **teach it the right selectors** from the real Call Spend Summary page.

## How we train it (browser snapshot)

The assistant can “see” the **Playwright browser** that Cursor uses. To train the script:

1. **Use that same browser**  
   The assistant opened the Sales-i **login** page there. If you don’t see it, say so and we can open it again.

2. **Log in and go to Call Spend Summary**  
   - Log in (username → Next → password → Sign in).  
   - On the welcome page, open the **Call Spend Summary** report (click its tile / VIEW REPORT).  
   - When you’re on the **Call Spend Summary** page, open the **Filter** panel so the date and user controls are visible.

3. **Tell the assistant**  
   Reply with **“ready”** (or “I’m on the Call Spend page”). The assistant will take a **snapshot** of the page, read the structure (IDs, labels, button text), and update **`run-daily-call-spend.cjs`** with the correct selectors.

After that, you can run:

```bash
node run-daily-call-spend.cjs
```

(with `SI_USERNAME`, `SI_PASSWORD`, `GMAIL_*`, `TO_EMAIL` in `.env` or the environment).

## If the browser you see isn’t the one the assistant controls

- If you have Call Spend open in **another** window (e.g. Chrome or Cursor’s Simple Browser), the assistant can’t see it.  
- In that case: in **this** project, use the **Cursor/Playwright** browser (the one where the assistant opened the login page), log in there, go to welcome → Call Spend Summary → open Filter, then say **“ready.”**

## What gets updated from the snapshot

- **Welcome tile**: Exact text for “Call Spend Summary” (or whatever the tile is called).  
- **Filter bar**: How to open the filter (same as Call Outcome or different).  
- **Start / End date**: Input IDs or labels.  
- **User dropdown**: ID or name.  
- **Apply button**: ID or text.  
- **Extra steps**: e.g. a “Click for detail” link (if the spend report has one).

Once the snapshot is captured, those values are written into the `SPEND` config at the top of `run-daily-call-spend.cjs`.
