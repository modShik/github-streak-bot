# GitHub Automation by modShik

A Linux-based GitHub streak automation tool that performs a small daily commit to keep contribution streaks active.

Author: modShik

## Features

- One-time GitHub authentication
- Session persistence
- PM2 integration
- Configurable schedule
- Randomized execution window
- Headless or visible browser mode
- Interactive management panel
- Linux-friendly deployment

## Security Notice

This project stores authenticated GitHub session cookies locally.

Never share:

- sessions/github.json
- .env

Anyone with access to your session file may be able to access your GitHub account.

## Requirements

- Linux (Ubuntu recommended)
- Node.js 18+
- Chromium
- GitHub account

## Quick Start

```bash
git clone <repo>
cd github-automation-by-modshik
npm install
cp .env.example .env
npm run auth
npm run run-now
```

## PM2 Setup

```bash
pm2 start github-streak.js --name github-streak
pm2 save
pm2 startup
```

## Recommended Checks

```bash
node -v
npm -v
pm2 -v
which chromium
```

## Limitations

This project automates GitHub through a browser using Playwright. If GitHub changes its interface, selectors may require updates.

## Troubleshooting

### Session expired

Run:

```bash
npm run auth
```

### Automation stopped

Check:

```bash
pm2 logs github-streak
```

### Browser not found

Update CHROMIUM_PATH in .env.

## Roadmap

- GitHub API support
- Auto repository creation
- Telegram notifications
- Better selector recovery
- Cross-platform support

## Credits

Created and maintained by modShik.
Community contributions are welcome.
