
require('dotenv').config();
const { chromium } = require('playwright');
const cron         = require('node-cron');
const { format }   = require('date-fns');
const fs           = require('fs');
const path         = require('path');
const readline     = require('readline');
const {
  isCompletedToday,
  markCompleted
} = require('./src/state/dailyState');
const CONFIG = {
  repo:        process.env.GITHUB_REPO   || '',
  sessionFile: process.env.SESSION_FILE  || './sessions/github.json',
  chromium:    process.env.CHROMIUM_PATH || '/snap/bin/chromium',
  schedule:    process.env.SCHEDULE      || '0 21 * * *',
  headless:    process.env.HEADLESS === 'true',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ask(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); });
  });
}

function sessionExists() {
  return fs.existsSync(CONFIG.sessionFile);
}

// ── Auth ─────────────────────────────────────────────────────

async function captureSession() {
  console.log('\n════════════════════════════════════════');
  console.log('  GitHub Authentication');
  console.log('════════════════════════════════════════\n');

  // Ask for repo URL if not set
  if (!CONFIG.repo) {
    console.log('  Create a GitHub repository first:');
    console.log('  → Go to https://github.com/new');
    console.log('  → Name it anything (e.g. "streak-log")');
    console.log('  → Make it Public, check "Add README"\n');
    const repoUrl = await ask('  Paste your repository URL here: ');
    if (!repoUrl.startsWith('https://github.com/')) {
      console.error('\n❌ Invalid URL. Should look like: https://github.com/username/repo-name');
      process.exit(1);
    }
    // Save to .env
    let envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
    if (envContent.includes('GITHUB_REPO=')) {
      envContent = envContent.replace(/GITHUB_REPO=.*/,  `GITHUB_REPO=${repoUrl}`);
    } else {
      envContent += `\nGITHUB_REPO=${repoUrl}`;
    }
    fs.writeFileSync('.env', envContent);
    CONFIG.repo = repoUrl;
    console.log(`\n  ✓ Repo saved: ${repoUrl}`);
  }

  console.log('\n  Opening GitHub login in browser...');
  console.log('  Log in completely — including any 2FA codes.');
  console.log('  When you see your GitHub dashboard, come back here.\n');

  fs.mkdirSync(path.dirname(CONFIG.sessionFile), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    executablePath: CONFIG.chromium,
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page    = await context.newPage();
  await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });

  await ask('  Press ENTER when fully logged in → ');

  await context.storageState({ path: CONFIG.sessionFile });
  await browser.close();

  console.log('\n✅ Session saved!');
  console.log('   Run: npm run run-now   (to test it works)');
}

// ── Core commit ───────────────────────────────────────────────

async function commitToGitHub() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const time  = format(new Date(), 'HH:mm');

  console.log(`\n[${today} ${time}] Running GitHub commit...`);

  if (!CONFIG.repo) {
    console.error('❌ GITHUB_REPO not set. Run: npm run auth');
    return false;
  }
  if (!sessionExists()) {
    console.error('❌ No session. Run: npm run auth');
    return false;
  }

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    executablePath: CONFIG.chromium,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    storageState: CONFIG.sessionFile,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    // Verify session
    await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if ((await page.locator('a[href="/login"]').count()) > 0) {
      console.error('❌ Session expired. Run: npm run auth');
      return false;
    }
    console.log('  ✓ Logged in');

    // Check if file exists
    await page.goto(`${CONFIG.repo}/blob/main/streak-log.md`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(2000);
    const fileExists = page.url().includes('/blob/');

    // Build content — watermark comment
    const watermark = `project: streakkeeper by github/modshik`;
    const entry = fileExists
      ? `## ${today} ${time}\n<!-- ${watermark} -->\n- Daily streak maintained\n\n`
      : `# Streak Log\n\n<!-- ${watermark} -->\n\nAutomated daily commit log.\n\n---\n\n## ${today} ${time}\n- Daily streak maintained\n\n`;

    // Open editor
    const editUrl = fileExists
      ? `${CONFIG.repo}/edit/main/streak-log.md`
      : `${CONFIG.repo}/new/main`;
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(5000);

    // Set filename for new file
    if (!fileExists) {
      try {
        const inp = page.locator('input[placeholder*="Name your file"]').first();
        await inp.waitFor({ timeout: 5000 });
        await inp.fill('streak-log.md');
        await page.keyboard.press('Tab');
        await sleep(1000);
      } catch { /* continue */ }
    }

    // Type into editor
    for (const sel of ['.CodeMirror-scroll', '.cm-content', '.cm-editor', 'textarea.file-editor-textarea']) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) { await el.click(); break; }
      } catch { /* next */ }
    }
    await sleep(500);
    if (fileExists) await page.keyboard.press('Control+Home');
    await page.keyboard.type(entry, { delay: 10 });
    await sleep(2000);
    console.log('  ✓ Content typed');

    // Find and click commit button
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    let committed = false;
    for (const text of ['Commit changes...', 'Commit changes', 'Commit new file']) {
      try {
        const btn = page.getByRole('button', { name: text, exact: false }).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          committed = true;
          console.log(`  ✓ Clicked "${text}"`);
          break;
        }
      } catch { /* next */ }
    }

    if (!committed) {
      // Scan all visible buttons
      const btns = await page.locator('button').all();
      for (const b of btns) {
        try {
          const t = (await b.textContent())?.toLowerCase().trim() ?? '';
          if (await b.isVisible() && t.includes('commit')) {
            await b.click(); committed = true;
            console.log(`  ✓ Clicked via scan: "${t}"`); break;
          }
        } catch { /* next */ }
      }
    }

    if (!committed) { console.error('❌ Commit button not found'); return false; }

    // Handle confirmation modal
    await sleep(2500);
    try {
      const modal = page.locator('[role="dialog"]').first();
      if (await modal.isVisible({ timeout: 2000 })) {
        const btn = modal.locator('button').filter({ hasText: /commit/i }).last();
        if (await btn.isVisible({ timeout: 1500 })) { await btn.click(); }
        await sleep(3000);
      }
    } catch { /* no modal */ }

    const finalUrl = page.url();
    console.log(`\n✅ Success! ${today} ${time}`);
    console.log(`   ${finalUrl}`);
    markCompleted();
    return true;

  } catch (err) {
    console.error('❌ Error:', err.message);
    return false;
  } finally {
    await browser.close();
  }
}

// ── Scheduler ─────────────────────────────────────────────────
async function executeIfNeeded() {

  if (isCompletedToday()) {
    console.log('✓ Already completed today');
    return;
  }

  console.log('⏳ No completion recorded today');
  console.log('🚀 Starting GitHub streak task');

  const success = await commitToGitHub();

  if (success) {
    console.log('✓ Daily task completed');
  } else {
    console.log('✗ Daily task failed');
  }
}

function startScheduler() {
  if (!CONFIG.repo) { console.error('❌ GITHUB_REPO not set. Run: npm run auth'); process.exit(1); }
  if (!sessionExists()) { console.error('❌ No session. Run: npm run auth'); process.exit(1); }

  console.log('\n⚡ GitHub Streak — Scheduler Active');
  console.log('══════════════════════════════════════');
  console.log(`  Repo:     ${CONFIG.repo}`);
  console.log('  Check Frequency: every hour');
  console.log(`  Mode:     ${CONFIG.headless ? 'headless (background)' : 'headed (visible)'}`);
  console.log('══════════════════════════════════════');
  console.log('  You can close this terminal — pm2 keeps it running.');
  console.log('  To stop: pm2 stop github-streak');
  console.log('  To check: npm run status\n');
  
  executeIfNeeded();
  cron.schedule(CONFIG.schedule, async () => {
    await commitToGitHub();
  });
}

// ── CLI ───────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  if (arg === '--auth')    { await captureSession(); }
  else if (arg === '--run') { const ok = await commitToGitHub(); process.exit(ok ? 0 : 1); }
  else                      { startScheduler(); }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

