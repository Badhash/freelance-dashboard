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

## Exporting from the portage intranet

`tools/reecho-export.user.js` is a Tampermonkey userscript that adds an "Exporter CSV" button on the activity account page of the Reecho intranet. It walks every page of the "Opérations" tab and downloads a CSV in the exact format `parseCSV()` expects (historical headers, `DD/MM/YYYY` dates, amounts positive in the direction of their nature). It refuses to export while a search or filter is active, since the import treats an export as the complete state of the months it covers.

## Privacy

No tracking, no analytics, no backend. Your financial data never leaves your browser.
