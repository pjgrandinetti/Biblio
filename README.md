# BibTeX Manager

A lightweight, self-hosted web app for managing BibTeX references. Built for small research groups who want shared, browser-accessible bibliography management without database dependencies.

## Features

- **DOI/arXiv Lookup** — Auto-fetch metadata from CrossRef (with Semantic Scholar fallback) or arXiv
- **Smart Title Formatting** — Automatic LaTeX notation for isotopes (`17O` → `{$^{17}$O}`), subscripts, and chemical formulas
- **Journal Abbreviations** — ~4,700 abbreviations from JabRef database with custom overrides
- **Import/Export** — Merge existing .bib files with duplicate detection; download anytime
- **Single-User Session Lock** — Prevents concurrent editing conflicts; auto-expires after 30 min
- **Bulk Operations** — Refresh all DOIs, clean all titles

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Backend:** PHP 8.0+ (standard on shared hosting)
- **Storage:** Plain `.bib` file (direct LaTeX compatibility)
- **Auth:** HTTP Basic Auth via `.htaccess`

## Quick Start

1. Upload the `public/` folder to your web server
2. Configure HTTP Basic Auth:
   ```bash
   mv .htaccess.example .htaccess
   # Edit AuthUserFile path, then:
   htpasswd -c .htpasswd username
   ```
3. Visit the URL and log in

For cPanel hosting (e.g., GreenGeeks): use Security → Password Protect Directories instead.

## Usage

| Action | How |
|--------|-----|
| Add entry | "Add by DOI", "Add by arXiv", or "Add Manually" |
| Edit/Delete | Click any row in the table |
| Bulk refresh | Tools → Refresh from DOIs |
| Clean titles | Tools → Clean Titles |
| Import | Tools → Import .bib |
| Export | "Download .bib" button |
| Logout | Releases session lock; close browser to clear credentials |

## Configuration

**Custom journal abbreviations:** Edit `journal-abbrevs-custom.json`:
```json
{
  "journal of magnetic resonance": "J. Magn. Reson."
}
```

**Citation key format:** Auto-generated as `journalabbr_volume_page_year`

## Local Development

```bash
cd public && php -S localhost:8000
```

## Limitations

- Single-user access (session lock prevents conflicts, but no real-time collaboration)
- Metadata-only (no PDF attachments)
- Upstream data quality varies—manual review recommended for critical entries

## License

MIT
