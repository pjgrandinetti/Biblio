# BibTeX Manager — Code Overview

A lightweight, self-hosted web application for managing BibTeX references. No database required — stores everything in a plain `.bib` file.

---

## Repository Structure

```
Biblio/
├── public/                         # Web root — deploy this folder
│   ├── index.html                  # Single-page app UI (~350 lines)
│   ├── app.js                      # Frontend logic (~3,950 lines)
│   ├── style.css                   # Styling with dark mode support
│   ├── api.php                     # Backend API (~2,560 lines)
│   ├── refs.bib                    # Bibliography data file
│   ├── journal-abbrevs.json        # ~4,700 journal abbreviations (JabRef database)
│   ├── journal-abbrevs-custom.json # Custom abbreviation overrides
│   ├── proper-names.json           # Protected names for title capitalization
│   └── proper-names-custom.json    # Custom protected names
├── sample/
│   └── refs.bib                    # Example bibliography file
├── README.md                       # Deployment instructions
└── plan.md                         # This file
```

---

## Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | Vanilla HTML/CSS/JS | No build step, no dependencies |
| Backend | PHP 8.0+ | Standard shared hosting compatible |
| Storage | Plain `.bib` file | Direct LaTeX compatibility |
| Auth | HTTP Basic Auth | Via `.htaccess` / `.htpasswd` |

---

## Frontend Architecture (`public/app.js`)

### State Management

```javascript
const state = {
    sessionId,           // Client-generated session ID for locking
    entries,             // All BibTeX entries from server
    filteredEntries,     // After search/filter applied
    currentPage,         // Pagination state
    entriesPerPage,      // 20, 50, 100, 200, or all
    sortField,           // 'year', 'author', 'title', 'citekey', 'type'
    sortDirection,       // 'asc' or 'desc'
    searchQuery,         // Text filter
    filterType,          // Entry type filter (article, book, etc.)
    editingCitekey,      // Citekey being edited (null for new entries)
    journalAbbreviations,// Loaded from JSON files
    properNames          // Protected names for title formatting
};
```

### Views (Single Page Application)

| View | Purpose |
|------|---------|
| `view-list` | Paginated entry table with search/filter |
| `view-doi` | DOI lookup form |
| `view-arxiv` | arXiv ID lookup form |
| `view-form` | Entry editor (add/edit) with dynamic field visibility |
| `view-import` | Import preview with conflict resolution |

### Key Functions

**Metadata Lookup:**
- `htmlToLatex(text)` — Converts HTML markup and MathML to LaTeX (isotopes, subscripts, superscripts)
- `lookupJournalAbbreviation(fullName)` — Finds abbreviated journal name from loaded database
- `formatPersonList(people)` — Formats author/editor arrays to BibTeX style (`Last, First and ...`)
- `detectEntryType(crossrefType, work)` — Maps CrossRef types to BibTeX types
- `fetchSemanticScholarTitle(doi)` — Fallback for better title data
- `fetchPublisherBibtex(doi)` — Fetches BibTeX directly from Elsevier/Springer/Nature APIs

**External API Integration:**
- Publisher BibTeX (Elsevier, Springer, Nature) — Primary source via backend proxy
- CrossRef (`api.crossref.org/works/{DOI}`) — Fallback if no publisher BibTeX
- DataCite (`api.datacite.org`) — Zenodo and arXiv DOIs
- arXiv (`export.arxiv.org/api/query`) — Preprint metadata
- Semantic Scholar (`api.semanticscholar.org`) — Title verification

**Form/UI:**
- `showEntryForm(entry, fromLookup)` — Opens editor with field visibility based on entry type
- `generateCitekey()` — Calls backend for auto-generated citekey
- `refreshFromDoi()` / `refreshFromIsbn()` — Re-fetches metadata for existing entry
- `filterAndSortEntries()` — Applies search/filter/sort to entries
- `renderEntries()` — Renders paginated table with clickable title links

---

## Backend Architecture (`public/api.php`)

### API Endpoints

All requests are POST to `api.php` with JSON body containing `action` parameter.

| Action | Description |
|--------|-------------|
| `list` | Return all entries as JSON |
| `save` | Add or update entry (with optional title cleaning) |
| `delete` | Remove entry by citekey |
| `import` | Upload `.bib` file, returns preview with conflicts |
| `import_confirm` | Confirm import with selected entries |
| `generate_citekey` | Auto-generate citation key from fields |
| `clean_title` | Apply LaTeX formatting to single entry's title |
| `clean_all_titles` | Bulk title cleaning |
| `search_doi` | Search CrossRef/OpenAlex for DOI |
| `search_isbn` | Search Google Books/Open Library for ISBN |
| `lookup_isbn` | Fetch metadata by ISBN |
| `deduplicate_rekey` | Regenerate all citekeys and remove duplicates |
| `fetch_publisher_bibtex` | Proxy to publisher BibTeX APIs (avoids CORS) |
| `validate_bibtex` | Check for unescaped LaTeX characters |
| `fix_bibtex_errors` | Apply fixes for validation errors |

### BibTeX Parser (`BibTeXParser` class)

```php
class BibTeXParser {
    public static function parse(string $bibtex): array
    // Handles: nested braces, @string abbreviations, mixed quoting
    
    public static function format(array $entries): string
    // Outputs normalized BibTeX with consistent field order
}
```

**Field Order (on write):**
author, title, journal, booktitle, publisher, school, year, month, volume, number, pages, article-number, doi, issn, isbn, url, eprint, archiveprefix, primaryclass, howpublished, edition, editor, series, address, note, abstract

### Citation Key Generation

Auto-generated format: `{journalabbr}_{volume}_{page}_{year}`

Special cases:
- **arXiv:** `arxiv_{id}` (e.g., `arxiv_2102_09844`)
- **Zenodo:** `zenodo_{id}_{year}`
- **Software:** `{name}_{version}_{revision}` (detected by title patterns)
- **In Press:** `{journalabbr}_{author}_inpress_{year}`
- **Books:** First letter of each title word + author if not unique

### Session Locking

- Prevents concurrent editing conflicts
- Lock timeout: 5 minutes
- Client heartbeat refreshes lock
- Force-unlock available if session expires

### File Safety

- `flock()` exclusive lock during writes
- Atomic write: temp file → `rename()` to `refs.bib`
- Auto-backup: `refs.bib` → `refs.bib.bak` before each save

---

## Title Cleaning (`cleanTitle` in PHP, `htmlToLatex` in JS)

Transformations applied:

| Input | Output | Reason |
|-------|--------|--------|
| `17O` / `O17` | `{$^{17}$O}` | Isotope notation |
| `SiO2` | `{SiO$_{2}$}` | Chemical formulas |
| `<i>text</i>` | `\textit{text}` | HTML to LaTeX |
| `<sup>x</sup>` | `$^{x}$` | Superscripts |
| `<sub>x</sub>` | `$_{x}$` | Subscripts |
| `NMR`, `MAS` | `{NMR}`, `{MAS}` | Protect acronyms |
| `Fourier` | `{Fourier}` | Protect proper names |
| `Iron(II)` | `Iron({II})` | Protect roman numerals |
| `22 °C` | `{22$^\circ$C}` | Degree symbols |

---

## External API Integration

### DOI Resolution Flow

1. Check if DOI matches publisher pattern (Elsevier `10.1016/`, Springer `10.1007/`, Nature `10.1038/`)
2. If yes, fetch BibTeX directly from publisher API via backend proxy — **most authoritative source**
3. If publisher BibTeX unavailable, fall back to CrossRef + Semantic Scholar in parallel
4. For Zenodo/arXiv DOIs (`10.5281/`, `10.48550/`), use DataCite API instead
5. Apply journal abbreviation lookup
6. Convert HTML/MathML in title to LaTeX
7. Generate citekey

### ISBN Resolution Flow

1. Search CrossRef for ISBN to find associated DOI
2. If DOI found and matches publisher pattern (Springer, Elsevier), fetch BibTeX directly — **most authoritative source**
3. If DOI found but no publisher BibTeX, use CrossRef metadata (includes edition, series, editors)
4. Fall back to Open Library API if no DOI found
5. Fall back to Google Books API if Open Library has no data
6. Return DOI if found (enables DOI-based citekey generation)

---

## UI Components

### Modals

| Modal | Trigger | Purpose |
|-------|---------|---------|
| Delete Confirmation | Delete button | Confirms entry deletion |
| Logout Info | Logout button | Explains session lock release |
| Session Locked | 423 response | Shows who has lock, offers force-unlock |
| Validation Results | Tools → Validate | Lists LaTeX errors with fix buttons |
| DOI/ISBN Selection | Find DOI/ISBN buttons | Choose from search results |

### Form Field Visibility

Entry type controls which fields are shown:

| Type | Visible Fields |
|------|----------------|
| article | journal, volume, number, pages |
| book | publisher, isbn, edition |
| incollection | booktitle, publisher, isbn |
| inproceedings | booktitle, publisher |
| phdthesis / mastersthesis | school |
| misc | howpublished, eprint |

---

## Configuration

### Journal Abbreviations

`journal-abbrevs.json` — ~4,700 entries from JabRef database
`journal-abbrevs-custom.json` — User overrides (loaded second, takes precedence)

```json
{
  "journal of magnetic resonance": "J. Magn. Reson.",
  "the journal of chemical physics": "J. Chem. Phys."
}
```

### Protected Names

`proper-names.json` — Categories: scientists, institutions, algorithms, materials
`proper-names-custom.json` — Custom additions

Names in these lists are wrapped in braces to protect capitalization in BibTeX.

---

## Development

### Local Setup

```bash
cd public && php -S localhost:8000
```

Auth is bypassed when running locally (no `.htaccess` enforcement).

### File Sizes

| File | Lines |
|------|-------|
| app.js | ~3,950 |
| api.php | ~2,560 |
| index.html | ~350 |
| style.css | ~800 |

---

## Limitations

- Single-user access (session lock prevents conflicts)
- No PDF attachments — metadata only
- No real-time collaboration
- Upstream metadata quality varies — manual review recommended
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