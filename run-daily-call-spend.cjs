// run-daily-call-spend.cjs — Call Spend Summary reports (CSV export per rep)
//
// Timeframe (start/end month; Sales-i uses first day of start month, last day of end month):
//   node run-daily-call-spend.cjs 2026-01 2026-02     # Jan 2026 through Feb 2026
//   START_MONTH=2026-01 END_MONTH=2026-03 node run-daily-call-spend.cjs
//   START_DATE=01/15/2026 END_DATE=02/28/2026 node run-daily-call-spend.cjs
// Default (no args): yesterday for both start and end.
//
require('dotenv/config');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { parse: parseCsv } = require('csv-parse/sync');
const { chromium } = require('playwright');

// ============= CONFIG — TSM/sales reps (Analysis Value list); name must match dropdown exactly =============
const REPS = [
  { name: 'Brandon Hatfield',   id: '200229612' },
  { name: 'Barry Jezewski',     id: '200215321' },
  { name: 'Mike Stephens',      id: '200221589' },
  { name: 'Trevor Stevens',     id: '200227744' },
  { name: 'Kevin Ford',        id: '200223210' },
  { name: 'Aaron Wisniewski',   id: '215523' },
  { name: 'David Raison',       id: '200226280' },
  { name: 'Jeremy Rama',       id: '200224688' },
  { name: 'Chris Chavayda',    id: '200226708' },
  { name: 'Kevin Sellers',     id: '200229000' },
  { name: 'John Derrig',       id: '200230324' },
  { name: 'Jason Murphy',      id: '200226279' },
  { name: 'Matthew Kartz',     id: '200228999' },
  { name: 'Matthew Blondeau',   id: '' },  // not in User dropdown; use User=All + Analysis Value by name (at end so others run first)
];

// CALL SPEND PAGE SELECTORS — from snapshot of CallSpendSummary.aspx
const SPEND = {
  tileName: /Call Spend Summary/i,
  runButtonName: 'Run',
  exportButtonName: 'Export',   // click after report loads
  startDateLabel: 'Start Date:',
  endDateLabel: 'End Date:',
  userComboboxName: 'User:',
  reportViewLabel: 'Report View:',
  reportViewValue: 'Parent Account View',  // always use this view
  analysisFieldLabel: 'Analysis Field:',
  analysisFieldValue: 'Sales Rep',         // always use this; shows Analysis Value field
  analysisValueLabel: 'Analysis Value:',   // TSM/sales rep names (e.g. Aaron Wisniewski); we select by REPS one by one, matching by first name
  detailLinkText: null,
};

const OUT_DIR = path.resolve('./screenshots');
const EXPORT_DIR = path.resolve('./exports'); // CSV downloads from Export button
const LOG_DIR = path.resolve('./logs');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `call-spend_${RUN_ID}.log`);

const TENANT_WELCOME = 'https://us2t.sales-i.com/Net/RecordCard_v3/welcome.aspx';
const CALL_SPEND_URL = 'https://us2t.sales-i.com/Net/RecordCard_v3/CallSpendSummary.aspx';

// ============= ENV =============
const {
  SI_USERNAME,
  SI_PASSWORD,
  GMAIL_USER,
  GMAIL_APP_PASS,
  TO_EMAIL,
  ALERT_EMAIL
} = process.env;

if (!SI_USERNAME || !SI_PASSWORD || !GMAIL_USER || !GMAIL_APP_PASS || !TO_EMAIL) {
  console.error('Missing required environment variables. Need SI_USERNAME, SI_PASSWORD, GMAIL_USER, GMAIL_APP_PASS, TO_EMAIL');
  process.exit(1);
}

const ALERT_TO = ALERT_EMAIL || TO_EMAIL;

// ============= LOGGING =============
function stamp() { return new Date().toISOString(); }
function log(line) {
  const msg = `[${stamp()}] ${line}\n`;
  fs.appendFileSync(LOG_FILE, msg);
  process.stdout.write(msg);
}

// ============= EMAIL =============
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS }
});

async function sendEmail({ subject, text, attachments }) {
  const info = await transporter.sendMail({
    from: `"Sales-i Call Spend Bot" <${GMAIL_USER}>`,
    to: TO_EMAIL,
    subject,
    text,
    attachments
  });
  log(`Email sent: ${info.messageId}`);
}

/** Parse CSV and return rows where Total Calls is 0 (account-level rows only: have Account Number). */
function getZeroCallAccounts(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw, { columns: true, skip_empty_lines: true });
  if (rows.length === 0) return [];
  const totalCallsKey = Object.keys(rows[0]).find(k => /Total Calls/i.test(k));
  const accountNumKey = Object.keys(rows[0]).find(k => /Account Number/i.test(k));
  const customerNameKey = Object.keys(rows[0]).find(k => /Customer Name/i.test(k));
  if (!totalCallsKey) return [];
  return rows.filter(row => {
    const totalCalls = String((row[totalCallsKey] || '').trim());
    const accountNum = (row[accountNumKey] || '').trim();
    if (totalCalls !== '0' || accountNum === '') return false;
    if (accountNum.toUpperCase().startsWith('P')) return false; // exclude column A starting with P
    return true;
  }).map(row => ({
    accountNumber: (row[accountNumKey] || '').trim(),
    customerName: (row[customerNameKey] || '').trim()
  }));
}

async function sendAlert({ subject, text, attachments }) {
  try {
    await transporter.sendMail({
      from: `"Sales-i Call Spend (ALERT)" <${GMAIL_USER}>`,
      to: ALERT_TO,
      subject,
      text,
      attachments
    });
    log(`ALERT email sent`);
  } catch (e) {
    log(`ALERT email failed: ${e?.message || e}`);
  }
}

// ============= HELPERS =============
/** Format Date as MM/DD/YYYY */
function toMMDDYYYY(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** Last day of month for a given year/month (1-based month) */
function lastDayOfMonth(year, month) {
  const d = new Date(year, month, 0); // day 0 = last day of previous month
  return d.getDate();
}

/**
 * Get start and end date strings for the report.
 * Sales-i uses start/end month; we send first day of start month and last day of end month.
 *
 * Sources (first wins):
 * 1. CLI: node run-daily-call-spend.cjs 2026-01 2026-02  (start month, end month as YYYY-MM)
 * 2. Env: START_MONTH=2026-01 END_MONTH=2026-02  or  START_DATE=01/15/2026 END_DATE=02/15/2026
 * 3. Default: yesterday for both (single-day report)
 */
function getDateRange() {
  const args = process.argv.slice(2);
  const startMonthArg = args[0]; // YYYY-MM
  const endMonthArg = args[1];   // YYYY-MM

  if (startMonthArg && endMonthArg && /^\d{4}-\d{2}$/.test(startMonthArg) && /^\d{4}-\d{2}$/.test(endMonthArg)) {
    const [sY, sM] = startMonthArg.split('-').map(Number);
    const [eY, eM] = endMonthArg.split('-').map(Number);
    const startStr = toMMDDYYYY(new Date(sY, sM - 1, 1));
    const lastDay = lastDayOfMonth(eY, eM);
    const endStr = toMMDDYYYY(new Date(eY, eM - 1, lastDay));
    return { startStr, endStr, label: `${startMonthArg} to ${endMonthArg}` };
  }

  const startMonthEnv = process.env.START_MONTH; // YYYY-MM
  const endMonthEnv = process.env.END_MONTH;
  if (startMonthEnv && endMonthEnv && /^\d{4}-\d{2}$/.test(startMonthEnv) && /^\d{4}-\d{2}$/.test(endMonthEnv)) {
    const [sY, sM] = startMonthEnv.split('-').map(Number);
    const [eY, eM] = endMonthEnv.split('-').map(Number);
    const startStr = toMMDDYYYY(new Date(sY, sM - 1, 1));
    const lastDay = lastDayOfMonth(eY, eM);
    const endStr = toMMDDYYYY(new Date(eY, eM - 1, lastDay));
    return { startStr, endStr, label: `${startMonthEnv} to ${endMonthEnv}` };
  }

  const startDateEnv = process.env.START_DATE; // MM/DD/YYYY
  const endDateEnv = process.env.END_DATE;
  if (startDateEnv && endDateEnv) {
    return { startStr: startDateEnv, endStr: endDateEnv, label: `${startDateEnv} to ${endDateEnv}` };
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const single = toMMDDYYYY(yesterday);
  return { startStr: single, endStr: single, label: single };
}

async function safe(actionName, fn, retries = 2, delayMs = 700) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      log(`${actionName} failed (attempt ${i + 1}/${retries + 1}): ${err?.message || err}`);
      if (i < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function safeGoto(page, url, options = {}) {
  const attempts = options.attempts ?? 6;
  const waitUntil = options.waitUntil ?? 'domcontentloaded';
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url, { waitUntil, timeout: 45000 });
      return;
    } catch (e) {
      lastErr = e;
      log(`safeGoto attempt ${i+1}/${attempts} failed: ${e?.message || e}`);
      await page.waitForTimeout(700);
      try {
        await page.evaluate(u => { window.location.assign(u); }, url);
        await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
        return;
      } catch {}
    }
  }
  throw lastErr;
}

// ============= CALL SPEND: OPEN FROM WELCOME =============
async function openCallSpendFromWelcome(page) {
  const tileName = SPEND.tileName;
  const card = page.locator('section,div,li,article').filter({ hasText: tileName }).first();
  const btn = card.getByRole('link', { name: /^VIEW REPORT$/i }).or(card.getByRole('button', { name: /^VIEW REPORT$/i }));
  if (await btn.isVisible().catch(() => false)) { await btn.click(); return true; }
  const nth = page.getByRole('link', { name: /^VIEW REPORT$/i }).nth(3);
  if (await nth.isVisible().catch(() => false)) { await nth.click(); return true; }
  const direct = page.getByRole('link', { name: tileName });
  if (await direct.isVisible().catch(() => false)) { await direct.click(); return true; }
  return false;
}

// ============= CALL SPEND: FILTER PANEL =============
async function clickFilterBar(page) {
  log('  Clicking Filter...');
  const candidates = [
    page.getByText('Filter', { exact: true }),
    page.locator('p').filter({ hasText: /^Filter$/ }),
    page.locator('#ctl00_divFilter1').getByText('Filter'),
    page.locator('.accordion__title').filter({ hasText: /Filter/i }),
    page.getByRole('button', { name: /^Filter$/i }),
  ];
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ force: true });
        log('  Filter clicked');
        return true;
      }
    } catch (e) {
      log(`  Filter candidate failed: ${e.message}`);
    }
  }
  return false;
}

async function ensureFilterPanel(page) {
  const runBtn = page.getByRole('button', { name: SPEND.runButtonName });
  const startDate = page.getByLabel(SPEND.startDateLabel);
  if (await runBtn.isVisible().catch(() => false) || await startDate.isVisible().catch(() => false)) {
    log('  Filter panel already open');
    return true;
  }
  for (let attempts = 0; attempts < 10; attempts++) {
    const clicked = await clickFilterBar(page);
    if (clicked) {
      await page.waitForTimeout(1000);
      if (await runBtn.isVisible().catch(() => false) || await startDate.isVisible().catch(() => false)) {
        log('  Filter panel opened');
        return true;
      }
    }
    await page.waitForTimeout(500);
  }
  log('  Failed to open filter panel');
  return false;
}

async function setReportView(page) {
  log('  Setting Report View to Parent Account View…');
  const reportView = page.getByRole('combobox', { name: SPEND.reportViewLabel });
  if (await reportView.isVisible({ timeout: 2000 }).catch(() => false)) {
    await reportView.selectOption(SPEND.reportViewValue);
    log('  ✓ Report View set to Parent Account View');
  }
}

async function setAnalysisField(page) {
  log('  Setting Analysis Field to Sales Rep…');
  const analysisField = page.getByRole('combobox', { name: SPEND.analysisFieldLabel });
  if (await analysisField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await analysisField.selectOption(SPEND.analysisFieldValue);
    await page.waitForTimeout(500); // allow Analysis Value field to appear
    log('  ✓ Analysis Field set to Sales Rep');
  }
}

async function setAnalysisValue(page, rep) {
  log(`  Setting Analysis Value to: ${rep.name} (TSM/sales rep)`);
  const analysisValue = page.getByRole('combobox', { name: SPEND.analysisValueLabel });
  if (!(await analysisValue.isVisible({ timeout: 3000 }).catch(() => false))) {
    log('  Analysis Value field not visible (may appear after Analysis Field = Sales Rep)');
    return;
  }
  // Analysis Value dropdown uses full names; select by label (id often doesn't match, so try name first)
  try {
    await analysisValue.selectOption({ label: rep.name });
    log('  ✓ Analysis Value set by name');
    return;
  } catch (e) {
    log(`  Exact name failed: ${e.message}`);
  }
  try {
    await analysisValue.selectOption({ label: new RegExp(rep.name, 'i') });
    log('  ✓ Analysis Value set by name (regex)');
  } catch (e2) {
    if (rep.id) {
      try {
        await analysisValue.selectOption(rep.id);
        log('  ✓ Analysis Value set by id');
      } catch (e3) {
        log(`  Analysis Value select failed: ${e3.message}`);
      }
    }
  }
}

async function clickOutsideDatepicker(page) {
  // Datepicker must be dismissed by clicking outside the frame for the date to register
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const heading = page.getByRole('heading', { name: 'Call Spend Summary' });
  if (await heading.isVisible({ timeout: 500 }).catch(() => false)) {
    await heading.click({ force: true });
  } else {
    await page.locator('body').click({ position: { x: 10, y: 10 }, force: true }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

async function setDateInputs(page, startStr, endStr) {
  if (endStr === undefined) endStr = startStr;
  log(`  Setting dates: ${startStr} to ${endStr}`);
  await page.waitForTimeout(800);
  const startEl = page.getByLabel(SPEND.startDateLabel);
  const endEl = page.getByLabel(SPEND.endDateLabel);
  if (await startEl.isVisible({ timeout: 2000 }).catch(() => false)) {
    await startEl.clear();
    await startEl.fill(startStr);
    log('  ✓ Start date set');
    await clickOutsideDatepicker(page);
  } else throw new Error('Start date field not found');
  if (await endEl.isVisible({ timeout: 2000 }).catch(() => false)) {
    await endEl.clear();
    await endEl.fill(endStr);
    log('  ✓ End date set');
    await clickOutsideDatepicker(page);
  } else throw new Error('End date field not found');
}

async function setUser(page, rep) {
  log(`  Setting user: ${rep.name} (${rep.id})`);
  const userCombo = page.getByRole('combobox', { name: SPEND.userComboboxName });
  if (!(await userCombo.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }
  try {
    await userCombo.selectOption(rep.id);
    log('  ✓ User set by id');
    return true;
  } catch (e) {
    log(`  Select by id failed, trying by label: ${e.message}`);
  }
  try {
    await userCombo.selectOption({ label: new RegExp(rep.name, 'i') });
    log('  ✓ User set by name');
    return true;
  } catch (e) {
    log(`  Select by name failed: ${e.message}`);
  }
  const found = await page.evaluate(({ id, name }) => {
    const selects = Array.from(document.querySelectorAll('select'));
    for (const select of selects) {
      const option = Array.from(select.options).find(opt => opt.value === id || (name && opt.text.trim().includes(name)));
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { id: rep.id, name: rep.name });
  return !!found;
}

/** Set User dropdown to "All" when rep isn't in User list; report is still scoped by Analysis Value. */
async function setUserToAll(page) {
  const userCombo = page.getByRole('combobox', { name: SPEND.userComboboxName });
  if (!(await userCombo.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  try {
    await userCombo.selectOption({ label: /^All$/i });
    log('  ✓ User set to All (fallback)');
    return true;
  } catch (e) {
    const ok = await page.evaluate(() => {
      const select = document.querySelector('select[name*="ddUser"], #ddUser');
      if (!select) return false;
      const allOpt = Array.from(select.options).find(o => /^All$/i.test(o.text.trim()));
      if (allOpt) {
        select.value = allOpt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    });
    if (ok) log('  ✓ User set to All (fallback)');
    return ok;
  }
}

async function clickApply(page) {
  log('  Clicking Run...');
  const runBtn = page.getByRole('button', { name: SPEND.runButtonName });
  if (await runBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await runBtn.click();
    log('  ✓ Run clicked');
    return true;
  }
  log('  ✗ Run button not found');
  return false;
}

async function clickExportAndSaveDownload(page, csvPath) {
  log('  Waiting for results screen (table + Export) to load...');
  await page.waitForTimeout(3000);
  const exportBtn = page.getByRole('button', { name: new RegExp(SPEND.exportButtonName, 'i') })
    .or(page.getByRole('link', { name: new RegExp(SPEND.exportButtonName, 'i') }));
  await exportBtn.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (!(await exportBtn.first().isVisible().catch(() => false))) {
    log('  ✗ Export button not found');
    return null;
  }
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await exportBtn.first().click();
  log('  ✓ Export clicked, waiting for CSV download...');
  const download = await downloadPromise;
  await download.saveAs(csvPath);
  log(`  ✓ CSV saved: ${csvPath}`);
  return csvPath;
}

// ============= MAIN =============
async function run() {
  const dateRange = getDateRange();
  const { startStr, endStr, label: dateLabel } = dateRange;
  const dateFile = `${startStr.replace(/\//g, '-')}_to_${endStr.replace(/\//g, '-')}`;
  log(`Call Spend run started. Timeframe=${dateLabel}, Log=${LOG_FILE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  let fatalShot = null;

  try {
    log('Logging in…');
    await page.goto('https://login.sales-i.com/Account/Login');
    await page.getByRole('textbox', { name: 'UserName' }).fill(SI_USERNAME);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(SI_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/us2t\.sales-i\.com/i, { timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    log('Opening Call Spend Summary…');
    await safeGoto(page, CALL_SPEND_URL, { attempts: 6 });
    await page.waitForLoadState('networkidle').catch(() => {});

    log('Opening Filter panel…');
    const panelOK = await ensureFilterPanel(page);
    if (!panelOK) throw new Error('Could not open Filter panel');

    await setReportView(page);
    await setAnalysisField(page);
    await setDateInputs(page, startStr, endStr); // once; stays populated for all reps

    await page.screenshot({ path: path.join(OUT_DIR, 'call-spend-debug-filter.png'), fullPage: true });

    for (let i = 0; i < REPS.length; i++) {
      const rep = REPS[i];
      log(`--- ${rep.name} (${rep.id}) ---`);
      const fileSafe = rep.name.toLowerCase().replace(/\s+/g, '-');
      const csvPath = path.join(EXPORT_DIR, `call-spend_${fileSafe}_${dateFile}.csv`);

      // Only change rep: User + Analysis Value (other fields stay populated)
      let userOK = await setUser(page, rep);
      if (!userOK) {
        log(`  User dropdown does not have ${rep.name}, trying User=All (report still scoped by Analysis Value)`);
        userOK = await setUserToAll(page);
      }
      if (!userOK) throw new Error(`Could not set user for ${rep.name}`);

      await setAnalysisValue(page, rep);

      const applied = await clickApply(page);
      if (!applied) throw new Error('Could not click Run');

      const savedCsv = await clickExportAndSaveDownload(page, csvPath);
      if (!savedCsv || !fs.existsSync(savedCsv)) throw new Error('Export did not produce CSV');

      await safe('Email report', async () => {
        await sendEmail({
          subject: `Sales-i Call Spend Summary — ${rep.name} — ${dateLabel}`,
          text: `Attached is the Call Spend Summary (CSV export) for ${rep.name} for ${dateLabel}.`,
          attachments: [{ filename: path.basename(csvPath), path: csvPath }]
        });
      });

      const zeroCallAccounts = getZeroCallAccounts(csvPath);
      if (zeroCallAccounts.length > 0) {
        log(`  Found ${zeroCallAccounts.length} account(s) with 0 total calls — sending summary email`);
        const listText = zeroCallAccounts
          .map(a => `${a.accountNumber}\t${a.customerName}`)
          .join('\n');
        const emailBody = `The following accounts have 0 total calls for ${rep.name} (${dateLabel}):\n\nAccount Number\tCustomer Name\n${listText}`;
        await safe('Email zero-calls summary', async () => {
          await sendEmail({
            subject: `Call Spend — Zero Total Calls — ${rep.name} — ${dateLabel}`,
            text: emailBody
          });
        });
      } else {
        log('  No accounts with 0 total calls');
      }

      if (i < REPS.length - 1) {
        // Re-open Filter bar; all fields stay populated, next iteration only sets User + Analysis Value
        log('  Re-opening Filter bar for next rep...');
        const panelAgain = await ensureFilterPanel(page);
        if (!panelAgain) {
          log('  Filter bar not open on results page, navigating back to report...');
          await page.goto(CALL_SPEND_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForLoadState('networkidle').catch(() => {});
          const afterNav = await ensureFilterPanel(page);
          if (!afterNav) throw new Error('Could not re-open Filter panel');
          await setReportView(page);
          await setAnalysisField(page);
          await setDateInputs(page, startStr, endStr);
        }
      }
    }

    log('All reps processed.');
  } catch (fatal) {
    log(`FATAL: ${fatal?.message || fatal}`);
    try {
      fatalShot = path.join(OUT_DIR, `FATAL_callspend_${RUN_ID}.png`);
      await page.screenshot({ path: fatalShot, fullPage: true });
    } catch {}
    const atts = [];
    if (fs.existsSync(LOG_FILE)) atts.push({ filename: path.basename(LOG_FILE), path: LOG_FILE });
    if (fatalShot && fs.existsSync(fatalShot)) atts.push({ filename: path.basename(fatalShot), path: fatalShot });
    await sendAlert({
      subject: `ALERT: Sales-i Call Spend run FAILED (${RUN_ID})`,
      text: `${fatal?.stack || fatal}`,
      attachments: atts.length ? atts : undefined
    });
    throw fatal;
  } finally {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    log('Run finished.');
  }
}

process.on('unhandledRejection', async (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`);
  await sendAlert({ subject: `ALERT: Call Spend script rejection (${RUN_ID})`, text: `${reason}` });
  process.exit(1);
});

run().catch(async (err) => {
  log(`Top-level catch: ${err}`);
  await sendAlert({
    subject: `ALERT: Call Spend script crashed (${RUN_ID})`,
    text: `${err?.stack || err}`,
    attachments: fs.existsSync(LOG_FILE) ? [{ filename: path.basename(LOG_FILE), path: LOG_FILE }] : undefined
  });
  process.exit(1);
});
