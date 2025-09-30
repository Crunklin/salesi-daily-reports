// run-daily-salesi-FIXED.cjs
require('dotenv/config');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// ============= CONFIG =============
const REPS = [
  { name: 'Aaron',          id: '215523' },
  { name: 'Barry',          id: '200215321' },
  { name: 'Brandon',        id: '200229612' },
  { name: 'Chris',          id: '200226708' },
  { name: 'Dave',           id: '200226280' },
  { name: 'Murph',          id: '200226279' },
  { name: 'Jeremy',         id: '200224688' },
  { name: 'Jesse',          id: '200223301' },
  { name: 'John',           id: '200230324' },
  { name: 'Kevin',          id: '200223210' },
  { name: 'Kevin Sellers',  id: '200229000' },
  { name: 'Matt Kartz',     id: '200228999' },
  { name: 'Mike',           id: '200221589' },
  { name: 'Trevor',         id: '200227744' },
];

const OUT_DIR = path.resolve('./screenshots');
const LOG_DIR = path.resolve('./logs');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `salesi_${RUN_ID}.log`);

const TENANT_WELCOME = 'https://us2t.sales-i.com/Net/RecordCard_v3/welcome.aspx';

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
    from: `"Sales-i Bot" <${GMAIL_USER}>`,
    to: TO_EMAIL,
    subject,
    text,
    attachments
  });
  log(`Email sent: ${info.messageId}`);
}

async function sendAlert({ subject, text, attachments }) {
  try {
    const info = await transporter.sendMail({
      from: `"Sales-i Bot (ALERT)" <${GMAIL_USER}>`,
      to: ALERT_TO,
      subject,
      text,
      attachments
    });
    log(`ALERT email sent: ${info.messageId}`);
  } catch (e) {
    log(`ALERT email failed: ${e?.message || e}`);
  }
}

// ============= HELPERS =============
function yesterdayMMDDYYYY() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
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
      log(`safeGoto attempt ${i+1}/${attempts} to ${url} failed: ${e?.message || e}`);
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

async function openCORFromWelcome(page) {
  // Prefer tile section with 'Call Outcome Report' then click 'VIEW REPORT'
  const card = page.locator('section,div,li,article').filter({ hasText: /Call Outcome Report/i }).first();
  const btn = card.getByRole('link', { name: /^VIEW REPORT$/i }).or(card.getByRole('button', { name: /^VIEW REPORT$/i }));
  if (await btn.isVisible().catch(() => false)) { await btn.click(); return true; }
  // Fallback: nth(3) 'VIEW REPORT'
  const nth = page.getByRole('link', { name: /^VIEW REPORT$/i }).nth(3);
  if (await nth.isVisible().catch(() => false)) { await nth.click(); return true; }
  // Last resort: any direct link
  const direct = page.getByRole('link', { name: /Call Outcome Report/i });
  if (await direct.isVisible().catch(() => false)) { await direct.click(); return true; }
  return false;
}

// === IMPROVED FILTER PANEL CONTROLS ===
async function clickFilterBar(page) {
  log('  Attempting to click Filter bar...');
  
  // Look for the accordion title that contains "Filter"
  const candidates = [
    page.locator('#ctl00_divFilter1').getByText('Filter'),
    page.locator('.accordion__title').filter({ hasText: /Filter/i }),
    page.getByRole('button', { name: /^Filter$/i }),
    page.getByText(/^Filter$/i),
    page.locator('button:has-text("Filter")'),
    page.locator('a:has-text("Filter")'),
    page.locator('div.crm-filter, .crm-filter').filter({ hasText: /Filter/i }),
    page.locator('[aria-label*="Filter" i]'),
    page.locator('[title*="Filter" i]')
  ];
  
  for (const loc of candidates) {
    try {
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ force: true });
        log('  Successfully clicked filter bar');
        return true;
      }
    } catch (e) {
      log(`  Filter click candidate failed: ${e.message}`);
    }
  }
  return false;
}

async function ensureFilterPanel(page) {
  log('  Checking if filter panel is already open...');
  
  // First check if it's already visible
  const isAlreadyOpen = await Promise.race([
    page.locator('#start-date').isVisible().catch(() => false),
    page.locator('#end-date').isVisible().catch(() => false),
    page.locator('#ctl00_btnApply').isVisible().catch(() => false),
  ]);
  
  if (isAlreadyOpen) {
    log('  Filter panel is already open');
    return true;
  }
  
  // Try to open it
  for (let attempts = 0; attempts < 10; attempts++) {
    log(`  Attempt ${attempts + 1} to open filter panel...`);
    
    const clicked = await clickFilterBar(page);
    if (clicked) {
      await page.waitForTimeout(1000);
      
      // Check if it's now visible
      const isOpen = await Promise.race([
        page.locator('#start-date').isVisible().catch(() => false),
        page.locator('#end-date').isVisible().catch(() => false),
        page.locator('#ctl00_btnApply').isVisible().catch(() => false),
      ]);
      
      if (isOpen) {
        log('  Filter panel opened successfully');
        return true;
      }
    }
    
    await page.waitForTimeout(500);
  }
  
  log('  Failed to open filter panel');
  return false;
}

// === IMPROVED DATE INPUT HANDLING ===
async function setDateInputs(page, dateStr) {
  log(`  Setting dates to: ${dateStr}`);
  
  // Wait a bit for the panel to be ready
  await page.waitForTimeout(1000);
  
  // Try multiple approaches for start date
  await safe('Set start date', async () => {
    let success = false;
    
    // Method 1: Direct ID selector
    try {
      const startEl = page.locator('#start-date');
      if (await startEl.isVisible({ timeout: 2000 })) {
        await startEl.clear();
        await startEl.fill(dateStr);
        log('  ✓ Start date set via #start-date');
        success = true;
      }
    } catch (e) {
      log(`  Start date #start-date failed: ${e.message}`);
    }
    
    // Method 2: Input by name attribute
    if (!success) {
      try {
        const startEl = page.locator('input[name="start-date"]');
        if (await startEl.isVisible({ timeout: 2000 })) {
          await startEl.clear();
          await startEl.fill(dateStr);
          log('  ✓ Start date set via name attribute');
          success = true;
        }
      } catch (e) {
        log(`  Start date name attribute failed: ${e.message}`);
      }
    }
    
    // Method 3: Label association
    if (!success) {
      try {
        const startEl = page.getByLabel('Start Date:', { exact: false });
        if (await startEl.isVisible({ timeout: 2000 })) {
          await startEl.clear();
          await startEl.fill(dateStr);
          log('  ✓ Start date set via label');
          success = true;
        }
      } catch (e) {
        log(`  Start date label failed: ${e.message}`);
      }
    }
    
    if (!success) {
      throw new Error('Could not set start date with any method');
    }
  });
  
  // Try multiple approaches for end date
  await safe('Set end date', async () => {
    let success = false;
    
    // Method 1: Direct ID selector
    try {
      const endEl = page.locator('#end-date');
      if (await endEl.isVisible({ timeout: 2000 })) {
        await endEl.clear();
        await endEl.fill(dateStr);
        log('  ✓ End date set via #end-date');
        success = true;
      }
    } catch (e) {
      log(`  End date #end-date failed: ${e.message}`);
    }
    
    // Method 2: Input by name attribute
    if (!success) {
      try {
        const endEl = page.locator('input[name="end-date"]');
        if (await endEl.isVisible({ timeout: 2000 })) {
          await endEl.clear();
          await endEl.fill(dateStr);
          log('  ✓ End date set via name attribute');
          success = true;
        }
      } catch (e) {
        log(`  End date name attribute failed: ${e.message}`);
      }
    }
    
    // Method 3: Label association
    if (!success) {
      try {
        const endEl = page.getByLabel('End Date:', { exact: false });
        if (await endEl.isVisible({ timeout: 2000 })) {
          await endEl.clear();
          await endEl.fill(dateStr);
          log('  ✓ End date set via label');
          success = true;
        }
      } catch (e) {
        log(`  End date label failed: ${e.message}`);
      }
    }
    
    if (!success) {
      throw new Error('Could not set end date with any method');
    }
  });
  
  // CRITICAL: Dismiss any open calendar/datepicker widgets
  log('  Dismissing calendar widgets...');
  await safe('Dismiss calendar', async () => {
    // Method 1: Press Escape key to close any open popups
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    
    // Method 2: Click elsewhere on the page to dismiss calendar
    await page.click('body', { force: true }).catch(() => {});
    await page.waitForTimeout(300);
    
    // Method 3: Click on a safe area (the page title)
    const pageTitle = page.locator('h1.page-title');
    if (await pageTitle.isVisible().catch(() => false)) {
      await pageTitle.click({ force: true });
    }
    await page.waitForTimeout(500);
    
    // Method 4: Wait for any datepicker to disappear
    await page.waitForFunction(() => {
      const datepickers = document.querySelectorAll('.xdsoft_datetimepicker');
      return Array.from(datepickers).every(picker => 
        picker.style.display === 'none' || !picker.offsetParent
      );
    }, { timeout: 5000 }).catch(() => {
      log('  Warning: Calendar may still be visible, proceeding anyway');
    });
  });
  
  log('  Both dates set successfully and calendar dismissed');
}

async function setUser(page, rep) {
  log(`  Setting user to: ${rep.name} (${rep.id})`);
  
  // 1) Try the main dropdown by ID
  try {
    const userSelect = page.locator('#ddUser');
    if (await userSelect.isVisible({ timeout: 2000 })) {
      await userSelect.selectOption(rep.id);
      log(`  ✓ User set via main dropdown`);
      return true;
    }
  } catch (e) {
    log(`  Main dropdown failed: ${e.message}`);
  }
  
  // 2) Try any select element with the matching option value
  try {
    const found = await page.evaluate(({ id, name }) => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const select of selects) {
        const option = Array.from(select.options).find(opt => 
          opt.value === id || opt.text.includes(name)
        );
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, { id: rep.id, name: rep.name });
    
    if (found) {
      log(`  ✓ User set via JavaScript`);
      return true;
    }
  } catch (e) {
    log(`  JavaScript selection failed: ${e.message}`);
  }
  
  return false;
}

async function clickApply(page) {
  log('  Clicking Apply Filters...');
  
  const candidates = [
    page.locator('#ctl00_btnApply'),
    page.getByRole('button', { name: /^Apply Filters$/i }),
    page.locator('input[value="Apply Filters"]'),
    page.locator('button.apply'),
    page.locator('.apply')
  ];
  
  for (const loc of candidates) {
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      await Promise.all([
        page.waitForLoadState('networkidle').catch(() => {}),
        loc.click()
      ]);
      log('  ✓ Apply clicked successfully');
      return true;
    }
  }
  
  log('  ✗ Could not find Apply button');
  return false;
}

// ============= MAIN =============
async function run() {
  const dateStr = yesterdayMMDDYYYY();
  log(`Run started. Date=${dateStr}, Output=${OUT_DIR}, LogFile=${LOG_FILE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  let fatalShot = null;
  let fatalHtml = null;

  try {
    // Login flow
    log('Logging in…');
    await page.goto('https://login.sales-i.com/Account/Login');
    await page.getByRole('textbox', { name: 'UserName' }).fill(SI_USERNAME);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(SI_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/us2t\.sales-i\.com/i, { timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Welcome page
    log(`Navigating to: ${TENANT_WELCOME}`);
    await safeGoto(page, TENANT_WELCOME, { attempts: 6, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Open Call Outcome Report tile
    log('Opening Call Outcome Report…');
    const opened = await openCORFromWelcome(page);
    if (!opened) throw new Error('Could not open Call Outcome Report from welcome');
    await page.waitForLoadState('domcontentloaded');

    // Ensure Filter panel open
    log('Opening Filter panel…');
    const panelOK = await ensureFilterPanel(page);
    if (!panelOK) throw new Error('Could not open Filter panel');

    // Add debug screenshot
    await page.screenshot({ path: path.join(OUT_DIR, 'debug-filter-panel.png'), fullPage: true });
    log('Debug screenshot taken');

    // Loop over all reps
    for (let i = 0; i < REPS.length; i++) {
      const rep = REPS[i];
      log(`--- Running ${rep.name} (${rep.id}) ---`);
      const fileSafe = rep.name.toLowerCase().replace(/\s+/g, '-');
      const filePath = path.join(OUT_DIR, `call-outcome_${fileSafe}_${dateStr.replace(/\//g, '-')}.png`);

      // Dates
      await setDateInputs(page, dateStr);

      // User
      const userOK = await setUser(page, rep);
      if (!userOK) throw new Error(`Could not set user for ${rep.name} (${rep.id})`);

      // Apply
      const applied = await clickApply(page);
      if (!applied) throw new Error('Could not click Apply Filters');

      // Wait for results to load
      await page.waitForTimeout(3000);

      // Open detail - CRITICAL: Must get to the detailed call notes view
      await safe('Open detail link', async () => {
        // Look for the "Click for detail" link in the results table
        const detailCandidates = [
          page.locator('#CreatedCount a').filter({ hasText: /Click for detail/i }),
          page.getByRole('link', { name: /(Click for detail)/i }),
          page.locator('a').filter({ hasText: /Click for detail/i }),
          page.locator('span#CreatedCount a'),
        ];
        
        let clicked = false;
        for (const candidate of detailCandidates) {
          if (await candidate.isVisible({ timeout: 2000 }).catch(() => false)) {
            log(`  Found detail link, clicking...`);
            await candidate.click();
            clicked = true;
            break;
          }
        }
        
        if (!clicked) {
          // Take debug screenshot to see what's on page
          await page.screenshot({ path: path.join(OUT_DIR, `debug-no-detail-link-${rep.name}.png`) });
          throw new Error('Detail link not found - check debug screenshot');
        }
        
        // Wait for the detailed page to load
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        
        // Verify we're on the detailed page by checking for customer data
        const hasDetailData = await page.waitForSelector('td:has-text("Customer")', { timeout: 5000 }).catch(() => false);
        if (!hasDetailData) {
          await page.screenshot({ path: path.join(OUT_DIR, `debug-wrong-page-${rep.name}.png`) });
          throw new Error('Not on detailed call notes page - check debug screenshot');
        }
        
        log(`  Successfully navigated to detailed call notes view`);
      });

      // Columns only for first rep
      if (i === 0) {
        await safe('Adjust columns (first rep only)', async () => {
          const columnsBtn = page.getByRole('button', { name: /^Columns$/i });
          if (await columnsBtn.isVisible({ timeout: 5000 })) {
            await columnsBtn.click();
            await page.getByRole('checkbox', { name: /^Contact$/i }).uncheck({ force: true }).catch(() => {});
            await page.getByRole('checkbox', { name: /^Call Outcome$/i }).uncheck({ force: true }).catch(() => {});
            await page.getByRole('checkbox', { name: /^Next Action$/i }).uncheck({ force: true }).catch(() => {});
            await page.getByRole('button', { name: /^OK$/i }).click().catch(() => {});
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(300);
          }
        });
      }

      // Screenshot + email
      await safe('Screenshot', async () => {
        await page.screenshot({ path: filePath, fullPage: true });
      });
      log(`Saved: ${filePath}`);

      await safe('Email report', async () => {
        await sendEmail({
          subject: `Sales-i Call Outcome Report — ${rep.name} — ${dateStr}`,
          text: `Attached is the Call Outcome Report for ${rep.name} for ${dateStr}.`,
          attachments: [{ filename: path.basename(filePath), path: filePath }]
        });
      });

      log(`Completed: ${rep.name}`);
      
      // If not the last rep, navigate back to filter panel for next iteration
      if (i < REPS.length - 1) {
        log('  Navigating back to Call Outcome Report landing page...');
        
        await safe('Return to COR landing with verification', async () => {
          let attempts = 0;
          const maxAttempts = 5;
          
          while (attempts < maxAttempts) {
            attempts++;
            log(`  Navigation attempt ${attempts}/${maxAttempts}`);
            
            // Try clicking the Call Outcome Report link in sidebar/breadcrumb
            const link = page.getByRole('link', { name: /^Call Outcome Report$/i });
            if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
              await link.click();
              await page.waitForTimeout(2000);
            } else {
              // Fallback: try listitem
              const li = page.getByRole('listitem', { name: /Call Outcome Report/i });
              if (await li.isVisible({ timeout: 2000 }).catch(() => false)) {
                await li.click();
                await page.waitForTimeout(2000);
              } else {
                // Last resort: go back
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
                await page.waitForTimeout(2000);
              }
            }
            
            // CRITICAL: Verify we're actually on the landing page
            // Check for the sales rep summary table (not the detailed view)
            const isOnLandingPage = await Promise.race([
              // Look for the summary table header
              page.locator('th:has-text("Sales Rep Name")').isVisible().catch(() => false),
              page.locator('th:has-text("Total Calls Made")').isVisible().catch(() => false),
            ]);
            
            if (isOnLandingPage) {
              log(`  ✓ Successfully navigated to landing page on attempt ${attempts}`);
              
              // Double check we're NOT still on detail view
              const stillOnDetailView = await page.locator('h1:has-text("CALLS MADE:")').isVisible({ timeout: 1000 }).catch(() => false);
              
              if (stillOnDetailView) {
                log(`  ✗ False positive - still on detail view, retrying...`);
                continue;
              }
              
              // Success!
              return;
            } else {
              log(`  ✗ Not on landing page yet, attempt ${attempts} failed`);
              
              // Take debug screenshot on failures
              if (attempts === maxAttempts) {
                await page.screenshot({ 
                  path: path.join(OUT_DIR, `debug-navigation-failed-${rep.name}.png`),
                  fullPage: true 
                });
              }
              
              await page.waitForTimeout(1000);
            }
          }
          
          throw new Error(`Failed to navigate back to landing page after ${maxAttempts} attempts`);
        });

        // Additional verification before trying to open filter panel
        log('  Verifying we can access filter controls...');
        await page.waitForTimeout(1000);
        
        // Re-open filter panel for next rep
        const panelAgain = await ensureFilterPanel(page);
        if (!panelAgain) {
          // Take debug screenshot
          await page.screenshot({ 
            path: path.join(OUT_DIR, `debug-filter-panel-failed-after-${rep.name}.png`),
            fullPage: true 
          });
          throw new Error('Could not re-open Filter panel for next rep');
        }
        
        // Final verification: make sure user dropdown is accessible
        const userDropdownReady = await page.locator('#ddUser').isVisible({ timeout: 3000 }).catch(() => false);
        if (!userDropdownReady) {
          await page.screenshot({ 
            path: path.join(OUT_DIR, `debug-user-dropdown-not-ready-after-${rep.name}.png`),
            fullPage: true 
          });
          throw new Error('User dropdown not accessible after opening filter panel');
        }
        
        log('  ✓ Ready for next rep - filter panel open and user dropdown accessible');
      }
    }

    log('All reps processed.');
  } catch (fatal) {
    log(`FATAL: ${fatal?.message || fatal}`);
    try {
      fatalShot = path.join(OUT_DIR, `FATAL_${RUN_ID}.png`);
      await page.screenshot({ path: fatalShot, fullPage: true });
      log(`Fatal screenshot saved: ${fatalShot}`);
    } catch {}
    try {
      fatalHtml = path.join(OUT_DIR, `FATAL_${RUN_ID}.html`);
      const html = await page.content();
      fs.writeFileSync(fatalHtml, html);
      log(`Fatal HTML saved: ${fatalHtml}`);
    } catch {}
    const atts = [];
    if (fs.existsSync(LOG_FILE)) atts.push({ filename: path.basename(LOG_FILE), path: LOG_FILE });
    if (fatalShot && fs.existsSync(fatalShot)) atts.push({ filename: path.basename(fatalShot), path: fatalShot });
    await sendAlert({
      subject: `ALERT: Sales-i daily run FAILED (RunID ${RUN_ID})`,
      text: `Fatal error.\nRunID: ${RUN_ID}\n\n${fatal?.stack || fatal}`,
      attachments: atts.length ? atts : undefined
    });
    throw fatal;
  } finally {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    log('Run finished.');
  }
}

// Global handlers
process.on('unhandledRejection', async (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`);
  await sendAlert({
    subject: `ALERT: Sales-i script unhandled rejection (RunID ${RUN_ID})`,
    text: `${reason?.stack || reason}`
  });
  process.exit(1);
});

process.on('uncaughtException', async (err) => {
  log(`UNCAUGHT EXCEPTION: ${err}`);
  await sendAlert({
    subject: `ALERT: Sales-i script uncaught exception (RunID ${RUN_ID})`,
    text: `${err?.stack || err}`
  });
  process.exit(1);
});

run().catch(async (err) => {
  log(`Top-level catch: ${err}`);
  const atts = [];
  if (fs.existsSync(LOG_FILE)) atts.push({ filename: path.basename(LOG_FILE), path: LOG_FILE });
  await sendAlert({
    subject: `ALERT: Sales-i script crashed (RunID ${RUN_ID})`,
    text: `${err?.stack || err}`,
    attachments: atts.length ? atts : undefined
  });
  process.exit(1);
});
