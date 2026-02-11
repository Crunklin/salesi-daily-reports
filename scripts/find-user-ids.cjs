// One-off: log in to Call Spend Summary and print User + Analysis Value dropdown options (value, label)
// to find IDs for reps (e.g. Matthew Blondeau). Run: node scripts/find-user-ids.cjs
require('dotenv/config');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { chromium } = require('playwright');

const CALL_SPEND_URL = 'https://us2t.sales-i.com/Net/RecordCard_v3/CallSpendSummary.aspx';
const { SI_USERNAME, SI_PASSWORD } = process.env;

if (!SI_USERNAME || !SI_PASSWORD) {
  console.error('Need SI_USERNAME and SI_PASSWORD in .env');
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    console.log('Logging in…');
    await page.goto('https://login.sales-i.com/Account/Login');
    await page.getByRole('textbox', { name: 'UserName' }).fill(SI_USERNAME);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(SI_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/us2t\.sales-i\.com/i, { timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    console.log('Opening Call Spend Summary…');
    await page.goto(CALL_SPEND_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // User dropdown
    const userOptions = await page.evaluate(() => {
      const select = document.querySelector('select[name*="ddUser"], #ddUser');
      if (!select) return [];
      return Array.from(select.options).map(o => ({ value: o.value, label: o.text.trim() }));
    });
    console.log('\n--- User dropdown (value → label) ---');
    userOptions.forEach(o => console.log(`${o.value}\t${o.label}`));

    const matthewUser = userOptions.find(o => /Matthew Blondeau/i.test(o.label));
    if (matthewUser) {
      console.log('\n>>> Matthew Blondeau (User) ID:', matthewUser.value, '<<<');
    }

    // Open filter and set Analysis Field to Sales Rep so Analysis Value appears
    const filterBtn = page.getByText('Filter', { exact: true });
    if (await filterBtn.isVisible().catch(() => false)) {
      await filterBtn.click();
      await page.waitForTimeout(1000);
    }
    const analysisField = page.getByRole('combobox', { name: /Analysis Field/i });
    if (await analysisField.isVisible().catch(() => false)) {
      await analysisField.selectOption('Sales Rep');
      await page.waitForTimeout(2000);
    }

    const analysisValueOptions = await page.evaluate(() => {
      const select = document.querySelector('select[name*="ddlAnalysisValue"], #ddlAnalysisValue');
      if (!select) return [];
      return Array.from(select.options).map(o => ({ value: o.value, label: o.text.trim() }));
    });
    console.log('\n--- Analysis Value dropdown (Sales Rep) (value → label) ---');
    analysisValueOptions.forEach(o => console.log(`${o.value}\t${o.label}`));

    const matthewAnalysis = analysisValueOptions.find(o => /Matthew Blondeau/i.test(o.label));
    if (matthewAnalysis) {
      console.log('\n>>> Matthew Blondeau (Analysis Value) ID:', matthewAnalysis.value, '<<<');
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
