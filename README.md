# Freelance Dashboard

Personal freelance income dashboard with CSV import and fiscal simulation. Single-page HTML/JS application, no backend, all data stored in browser localStorage.

## Features

- CSV import with intelligent deduplication
- Revenue & cash position analytics
- DSO, client breakdown, monthly trends
- Year-end projection with editable inputs
- French income tax simulation (progressive brackets, configurable parts)
- Light/dark theme

## Usage

Open `index.html` in a modern browser, or visit the GitHub Pages URL. All data stays in your browser — nothing is sent to any server.

On first launch, import your CSV, then define your client detection rules via the browser console:

```javascript
addClientRule('KEYWORD_IN_DESCRIPTION', 'Display Name')
listClientRules()
```

## Privacy

No tracking, no analytics, no backend. Your financial data never leaves your browser.
