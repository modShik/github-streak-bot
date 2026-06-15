#!/usr/bin/env node
// ============================================================
// manage.js — Control panel for GitHub Streak automation
// Usage: node manage.js
// ============================================================

const { spawnSync, execSync } = require('child_process');
const fs       = require('fs');
const readline = require('readline');
require('dotenv').config();

const c = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  green:  '\x1b[32m', red:    '\x1b[31m',
  yellow: '\x1b[33m', cyan:   '\x1b[36m',
  dim:    '\x1b[2m',
};

function run(cmd, silent = false) {
  const r = spawnSync(cmd, { shell: true, stdio: silent ? 'pipe' : 'inherit' });
  return { ok: r.status === 0, out: r.stdout?.toString().trim() ?? '' };
}

function pm2Running() {
  const r = run('pm2 describe github-streak 2>/dev/null', true);
  return r.ok && r.out.includes('online');
}

function pm2Status() {
  const r = run('pm2 describe github-streak 2>/dev/null', true);
  if (!r.ok || !r.out) return 'not running';
  if (r.out.includes('online'))  return 'online';
  if (r.out.includes('stopped')) return 'stopped';
  if (r.out.includes('errored')) return 'errored';
  return 'unknown';
}

function sessionAge() {
  const f = process.env.SESSION_FILE || './sessions/github.json';
  if (!fs.existsSync(f)) return null;
  const stat = fs.statSync(f);
  const days = Math.floor((Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24));
  return days;
}

function ask(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); });
  });
}

function printHeader() {
  console.clear();
  console.log(`\n${c.bold}${c.cyan}⚡ GitHub Streak — Control Panel${c.reset}\n`);

  // Status
  const status  = pm2Status();
  const age     = sessionAge();
  const repo    = process.env.GITHUB_REPO || '(not set)';
  const sched   = process.env.SCHEDULE    || '0 21 * * *';

  const statusColor = status === 'online' ? c.green : status === 'stopped' ? c.yellow : c.red;
  const ageWarn     = age !== null && age >= 25;

  console.log(`  Status:   ${statusColor}${c.bold}${status.toUpperCase()}${c.reset}`);
  console.log(`  Repo:     ${c.dim}${repo}${c.reset}`);
  console.log(`  Schedule: ${c.dim}${sched}${c.reset}`);
  console.log(`  Session:  ${age === null ? `${c.red}missing${c.reset}` : `${ageWarn ? c.yellow : c.green}${age} days old${c.reset}${ageWarn ? ' ⚠ renew soon' : ''}`}`);
  console.log();
}

function printMenu() {
  console.log(`  ${c.bold}What do you want to do?${c.reset}\n`);
  console.log(`  ${c.cyan}[1]${c.reset} Start automation`);
  console.log(`  ${c.cyan}[2]${c.reset} Stop automation`);
  console.log(`  ${c.cyan}[3]${c.reset} Restart automation`);
  console.log(`  ${c.cyan}[4]${c.reset} Run once right now`);
  console.log(`  ${c.cyan}[5]${c.reset} View logs (last 30 lines)`);
  console.log(`  ${c.cyan}[6]${c.reset} Re-authenticate (session expired)`);
  console.log(`  ${c.cyan}[7]${c.reset} Change repository URL`);
  console.log(`  ${c.cyan}[8]${c.reset} Change schedule time`);
  console.log(`  ${c.cyan}[9]${c.reset} Enable/disable headless mode`);
  console.log(`  ${c.cyan}[0]${c.reset} Exit\n`);
}

function updateEnv(key, value) {
  const envFile = '.env';
  let content   = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : '';
  const regex   = new RegExp(`^${key}=.*`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envFile, content);
  process.env[key] = value;
}

async function handleChoice(choice) {
  switch (choice) {

    case '1': // Start
      if (pm2Running()) {
        console.log(`\n${c.yellow}Already running.${c.reset}`);
      } else {
        run('pm2 start github-streak.js --name github-streak');
        run('pm2 save');
        console.log(`\n${c.green}✅ Started!${c.reset}`);
      }
      break;

    case '2': // Stop
      run('pm2 stop github-streak');
      console.log(`\n${c.yellow}⏹ Stopped.${c.reset}`);
      break;

    case '3': // Restart
      run('pm2 restart github-streak');
      console.log(`\n${c.green}🔄 Restarted!${c.reset}`);
      break;

    case '4': // Run now
      console.log(`\n${c.cyan}Running commit now...${c.reset}\n`);
      run('node github-streak.js --run');
      break;

    case '5': // Logs
      console.log(`\n${c.cyan}Last 30 log lines:${c.reset}\n`);
      run('pm2 logs github-streak --lines 30 --nostream');
      break;

    case '6': // Re-auth
      console.log();
      run('node github-streak.js --auth');
      if (pm2Running()) { run('pm2 restart github-streak'); }
      break;

    case '7': { // Change repo
      const url = await ask('\n  New repository URL (https://github.com/user/repo): ');
      if (url.startsWith('https://github.com/')) {
        updateEnv('GITHUB_REPO', url);
        console.log(`\n${c.green}✅ Updated!${c.reset} Restart to apply: option [3]`);
      } else {
        console.log(`\n${c.red}Invalid URL.${c.reset}`);
      }
      break;
    }

    case '8': { // Change schedule
      console.log('\n  Common schedules:');
      console.log('  0 21 * * *   →  9:00 PM daily');
      console.log('  0 22 * * *   →  10:00 PM daily');
      console.log('  0 8  * * *   →  8:00 AM daily');
      const sched = await ask('\n  New cron schedule: ');
      if (sched.split(' ').length === 5) {
        updateEnv('SCHEDULE', sched);
        console.log(`\n${c.green}✅ Schedule updated!${c.reset} Restart to apply: option [3]`);
      } else {
        console.log(`\n${c.red}Invalid cron. Need 5 fields (e.g. 0 21 * * *).${c.reset}`);
      }
      break;
    }

    case '9': { // Toggle headless
      const current = process.env.HEADLESS === 'true';
      updateEnv('HEADLESS', current ? 'false' : 'true');
      console.log(`\n${c.green}✅ Headless: ${!current ? 'ON' : 'OFF'}${c.reset}`);
      console.log(current ? '   Browser will now be VISIBLE during commits.' : '   Browser will now run SILENTLY in background.');
      if (pm2Running()) console.log('   Restart to apply: option [3]');
      break;
    }

    case '0':
      console.log('\n  Bye!\n');
      process.exit(0);

    default:
      console.log(`\n${c.red}  Invalid option.${c.reset}`);
  }

  await ask('\n  Press Enter to return to menu...');
}

async function main() {
  // Check pm2 installed
  if (run('which pm2', true).out === '') {
    console.log(`\n${c.red}pm2 not installed.${c.reset}`);
    console.log('Run: sudo npm install -g pm2\n');
    process.exit(1);
  }

  while (true) {
    printHeader();
    printMenu();
    const choice = await ask('  Choose [0-9]: ');
    await handleChoice(choice);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
