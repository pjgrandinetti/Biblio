# BibTeX Manager — Project Plan

## Overview

A lightweight, self-hosted web application for collaborative BibTeX reference management.
Designed for small research groups who want a shared, browser-accessible bibliography
without the complexity of Zotero, Mendeley, or a full CMS.

The canonical data store is a plain `.bib` file on the server — compatible directly
with any LaTeX workflow. No database required.

---

## Goals

- Browse, search, and edit a shared `.bib` file via a web browser
- Add new entries by DOI or arXiv ID (metadata fetched automatically)
- Review and edit pre-populated entry forms before committing to file
- Import an existing `.bib` file (with merge and duplicate detection)
- Export the .bib file
- in Title, 
    - all capitalized words should be put inside curly brakets, e.g., {NMR}
    - all formulas should be put inside curly brackets, e.g. {$^{27}Al}
    - any html should be converted to latex
- Simple access control suitable for a trusted research group
- Deployable on any standard shared hosting account (GreenGeeks, etc.)
- Codebase shareable via GitHub so others can deploy their own instance
- Auto-generate bibtex citation key based on rule:
    - use first letter of each word in journal title (ignore definite articles)
    - followed by volume
    - followed by first page (or article number)
    - followed by year
    - use underscore to separate journal abbr from volume, page, and year
    - e.g., The Journal of Chemical Physics, vol 11, page 3443, 1969 becomes jcp_11_3443_1969


---

## Technology Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | Vanilla HTML/CSS/JS | No build step, easy to deploy |
| Backend | PHP 7.4+ | Available by default on shared hosting |
| Data store | Plain `.bib` file | Direct LaTeX compatibility, no DB needed |
| Auth | HTTP Basic Auth (`.htaccess`) | Zero-code, browser caches credentials |
| DOI lookup | CrossRef API | Free, no key, excellent journal coverage |
| arXiv lookup | arXiv API | Free, no key, covers preprints |
| Version control | Git / GitHub | Code sharing and deployment history |

---

## Repository Structure

```
bibtex-manager/
├── public/                  # Deploy this folder to your server
│   ├── index.html           # Main UI (single-page app)
│   ├── app.js               # All frontend logic
│   ├── style.css            # Styling
│   ├── api.php              # Backend: file read/write, BibTeX parsing
│   └── .htaccess.example    # Rename to .htaccess and configure password
├── sample/
│   └── refs.bib             # Small representative sample BibTeX file
└── README.md                # Deployment instructions
```

The `public/` directory maps directly to `public_html/biblio/` (or equivalent)
on the hosting server. No build step — just upload and go.

---

## UI — Three Views (single page, no reloads)

### 1. Entry List
- Paginated table of all entries in `refs.bib`
- Search/filter by: author, year, title keyword, entry type, journal
- Each row: citekey, authors, title, year, type
- Actions per row: **Edit**, **Delete** (with confirmation)
- Top-level actions: **Add by DOI**, **Add by arXiv ID**, **Import .bib file**, **Download refs.bib**

### 2. DOI / arXiv Lookup
- Input field for DOI or arXiv ID
- Fetches metadata from CrossRef or arXiv API
- Populates entry form on success
- Error handling: not found, network failure, ambiguous results

### 3. Entry Form
- Editable fields for all standard BibTeX entry types
- Auto-generated citekey (e.g. `Grandinetti2025`) — user-editable
- Entry type selector (article, book, inproceedings, misc, etc.) — adjusts visible fields
- Pre-populated from DOI/arXiv lookup or existing entry (for edits)
- **Save** → writes to `refs.bib` via `api.php`
- **Cancel** → returns to entry list without saving
- Duplicate detection on save: warns if citekey or DOI already exists

---

## Backend — `api.php`

Single PHP file handling all server-side operations via JSON API.

### Endpoints (POST with `action` parameter)

| Action | Description |
|--------|-------------|
| `list` | Return all parsed entries as JSON |
| `save` | Add new entry or update existing entry by citekey |
| `delete` | Remove entry by citekey |
| `import` | Upload and merge a `.bib` file (with conflict report) |
| `download` | Return raw `refs.bib` content |

### File Safety
- `flock()` exclusive lock before every write
- Write to temp file first, then atomic `rename()` to `refs.bib`
- Auto-backup: copy `refs.bib` → `refs.bib.bak` before each save
- Normalize formatting on write (consistent indentation, brace quoting, field order)

### BibTeX Parser
- Written in PHP, no external libraries
- Handles: mixed quoting styles, inconsistent whitespace, `@string` abbreviations,
  entries with missing optional fields, UTF-8 / LaTeX-encoded characters
- Outputs normalized BibTeX on write

---

## Access Control

`.htaccess` HTTP Basic Auth:

```apache
AuthType Basic
AuthName "BibTeX Manager"
AuthUserFile /home/yourusername/public_html/biblio/.htpasswd
Require valid-user
```

`.htpasswd` generated via:
- cPanel → Security → Password Protect Directories, or
- Command line: `htpasswd -c .htpasswd yourusername`

The repo ships `.htaccess.example` — deployers rename and configure for their own server path.

---

## External APIs

### CrossRef (DOI lookup)
```
GET https://api.crossref.org/works/{DOI}
```
- No API key required
- Returns: authors, title, journal, year, volume, issue, pages, DOI, ISSN
- Rate limit: polite pool (add `mailto:` param in User-Agent header)

### arXiv (preprint lookup)
```
GET https://export.arxiv.org/api/query?id_list={arXiv_ID}
```
- No API key required
- Returns: authors, title, abstract, submission date, arXiv ID
- Entry type mapped to `@misc` with `howpublished = {arXiv:\{ID\}}`

---

## Import / Merge Logic

1. User uploads a `.bib` file via the browser
2. PHP parses the uploaded file
3. Compare against current `refs.bib`:
   - **New entries** (citekey not present): queued for addition
   - **Exact duplicates** (all fields match): silently skipped
   - **Conflicts** (same citekey, different fields): flagged for user resolution
4. UI shows a preview table: new / skip / conflict counts
5. User confirms → PHP writes merged file atomically

---

## Deployment Steps (for README)

1. Clone or download the repository
2. Upload contents of `public/` to your server subdomain document root
   (e.g. `public_html/biblio/`)
3. Rename `.htaccess.example` → `.htaccess`
4. Edit `.htaccess`: update `AuthUserFile` path to your server's absolute path
5. Generate `.htpasswd` via cPanel or `htpasswd` command
6. Upload your existing `refs.bib` to the same directory (or start fresh)
7. Ensure PHP has write permission on the directory
8. Visit your subdomain — enter credentials — done

**Requirements:** PHP 7.4+, Apache with `mod_rewrite` and `mod_auth_basic` (standard on all shared hosting)

---

## Out of Scope (for now)

- Per-user edit tracking
- Real-time collaborative editing (last-write-wins is acceptable for small groups)
- Full-text PDF attachment storage
- Citation style formatting / CSL output
- Automatic git commit on save (can be added later via shell_exec if SSH available)

---

## Development Notes for Claude in VSCode

Build order recommended:

1. `api.php` — BibTeX parser and file I/O first (testable with `curl`)
2. `index.html` + `style.css` — static scaffold
3. `app.js` — entry list view, wired to `api.php`
4. `app.js` — entry form (add/edit)
5. `app.js` — DOI lookup → form pre-fill
6. `app.js` — arXiv lookup → form pre-fill
7. `app.js` — import/merge flow
8. `.htaccess.example` + `sample/refs.bib`
9. `README.md`

When prompting Claude in VSCode, provide this `PLAN.md` as context at the start
of each session. Build one file at a time and test before moving to the next.