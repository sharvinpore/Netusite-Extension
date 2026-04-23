# Netusite-Extension

This repository contains two Chrome extensions:

1. **AI Page Dashboard** — Generate AI-powered dashboards from NetSuite (or any) web pages.
2. **Jira My Tasks** — View and manage your Jira tasks from the browser toolbar.

---

## 1. AI Page Dashboard

**Location:** `ai-dashboard-extension/`

View your current page’s data as KPIs and charts, then export to Excel. Uses a **local LLM** (Web LLM) to analyze page content—no cloud API required.

### Features

- **Load Page** — Injects a content script and reads text/tables from the active tab (works well on NetSuite).
- **Generate Dashboard** — Chunks the page, runs a local AI model to extract numeric facts, KPI candidates, and chart candidates, then produces a dashboard (KPIs + charts).
- **Download Excel** — Exports the generated dashboard to an Excel file.

### Tech

- **Vite** for build; **Chart.js** for charts; **xlsx** for Excel export; **@mlc-ai/web-llm** for local LLM.
- Permissions: `activeTab`, `scripting`, `storage`; host access for NetSuite and `<all_urls>`.

### Setup & Build

```bash
cd ai-dashboard-extension
npm install
npm run build
```

Load the extension in Chrome: **Extensions** → **Load unpacked** → select the `ai-dashboard-extension/dist` folder.

---

## 2. Jira My Tasks

**Location:** `jira-extension/`

View your assigned Jira issues by project, open ticket details, and log work—all from a popup.

### Features

- **Connect** — Jira domain (e.g. `yourcompany.atlassian.net`), email, and API token (stored locally in Chrome only).
- **Projects** — List of your projects with task counts; click a project to see its tasks.
- **Tasks** — Filter by All / In Progress / To Do / Done; see key, summary, status, priority, type.
- **Ticket detail** — Full summary, meta (assignee, reporter, dates), time tracking, work logs, description, subtasks, recent comments.
- **Log time** — Add worklogs with time spent (e.g. 2h, 30m, 1d), date, and optional comment.
- **Open in Jira** — Quick link to open the ticket in the browser.
- **Offline** — Shows cached tasks when the API is unavailable.

### Tech

- **Manifest V3**; background service worker performs all Jira API calls (avoids CORS).
- Permissions: `storage`; host: `https://*.atlassian.net/*`.
- No build step: use the `jira-extension` folder as-is.

### Setup

1. Get a [Jira API token](https://id.atlassian.com/manage-profile/security/api-tokens).
2. In Chrome: **Extensions** → **Load unpacked** → select the `jira-extension` folder.
3. Open the extension popup, enter your Jira domain, email, and API token, then connect.

---

## Repository structure

```
Netusite-Extension/
├── README.md                 # This file
├── ai-dashboard-extension/   # AI Page Dashboard (Vite + LLM + Chart.js + Excel)
│   ├── src/
│   │   ├── index.html
│   │   ├── popup.js
│   │   ├── content.js
│   │   ├── dashboard.js
│   │   ├── chunker.js
│   │   ├── llm.js
│   │   └── excelExport.js
│   ├── manifest.json
│   ├── vite.config.js
│   └── package.json
└── jira-extension/           # Jira My Tasks (vanilla JS)
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    ├── background.js
    └── icons/
```

---

## Loading in Chrome

- **AI Page Dashboard:** Load `ai-dashboard-extension/dist` (after `npm run build`).
- **Jira My Tasks:** Load `jira-extension` (no build).

Go to `chrome://extensions`, enable **Developer mode**, then **Load unpacked** and choose the correct folder for each extension.
