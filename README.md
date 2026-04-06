# BibTeX Manager

A lightweight, self-hosted web application for collaborative BibTeX reference management. Designed for small research groups who want a shared, browser-accessible bibliography without the complexity of Zotero, Mendeley, or a full CMS.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![PHP](https://img.shields.io/badge/PHP-7.4%2B-purple.svg)

## Features

- **Browse & Search** - Paginated table with search by author, title, year, journal, and entry type
- **Add by DOI** - Automatically fetch metadata from CrossRef for journal articles
- **Add by arXiv ID** - Automatically fetch metadata for preprints
- **Manual Entry** - Add entries manually with form validation
- **Edit & Delete** - Full CRUD operations on your bibliography
- **Import/Merge** - Upload existing .bib files with duplicate detection
- **Export** - Download the complete .bib file anytime
- **Auto-generated Citation Keys** - Format: `journalabbr_volume_page_year`
- **Title Formatting** - Automatic handling of capitalized words, formulas, and HTML conversion

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | Vanilla HTML/CSS/JS | No build step, easy to deploy |
| Backend | PHP 7.4+ | Available by default on shared hosting |
| Data Store | Plain `.bib` file | Direct LaTeX compatibility, no DB needed |
| Auth | HTTP Basic Auth | Zero-code, browser caches credentials |
| DOI Lookup | CrossRef API | Free, no key required |
| arXiv Lookup | arXiv API | Free, no key required |

## Repository Structure

```
bibtex-manager/
├── public/                  # Deploy this folder to your server
│   ├── index.html           # Main UI (single-page app)
│   ├── app.js               # All frontend logic
│   ├── style.css            # Styling
│   ├── api.php              # Backend: file read/write, BibTeX parsing
│   └── .htaccess.example    # Rename to .htaccess and configure
├── sample/
│   └── refs.bib             # Sample BibTeX file for testing
├── plan.md                  # Project specification
└── README.md                # This file
```

## Deployment

### Requirements

- PHP 7.4 or higher
- Apache with `mod_rewrite` and `mod_auth_basic` (standard on shared hosting)
- Write permissions on the deployment directory

### Quick Start

1. **Clone or download this repository**
   ```bash
   git clone https://github.com/yourusername/bibtex-manager.git
   cd bibtex-manager
   ```

2. **Upload the `public/` directory** to your web server
   
   Upload to your preferred location, e.g., `public_html/biblio/`

3. **Configure authentication**
   
   ```bash
   # Rename the example file
   mv .htaccess.example .htaccess
   
   # Edit .htaccess and update the AuthUserFile path:
   # AuthUserFile /home/yourusername/public_html/biblio/.htpasswd
   
   # Generate .htpasswd (or use cPanel → Security → Password Protect Directories)
   htpasswd -c .htpasswd yourusername
   ```

4. **Set up permissions**
   
   Ensure PHP can write to the directory:
   ```bash
   chmod 755 /path/to/biblio
   chmod 644 /path/to/biblio/refs.bib  # if you have an existing file
   ```

5. **Add your bibliography** (optional)
   
   Either upload an existing `refs.bib` file to the directory, copy the sample file, or start fresh (the file will be created automatically).

6. **Visit your deployment** and enter your credentials

### Example: GreenGeeks Deployment

1. Log into cPanel
2. Open File Manager → navigate to `public_html`
3. Create a new folder `biblio`
4. Upload all files from `public/` to this folder
5. Go to Security → Password Protect Directories
6. Select the `biblio` folder and create a user
7. The system will create `.htaccess` and `.htpasswd` for you

## Usage

### Entry List

The main view shows all entries in a paginated, sortable table. Use the search box to filter by any field, or the dropdown to filter by entry type.

### Adding Entries

**By DOI:** Click "Add by DOI", enter the DOI (e.g., `10.1021/acs.jpclett.1c02254`), and the metadata will be fetched automatically. Review and save.

**By arXiv:** Click "Add by arXiv", enter the arXiv ID (e.g., `2103.12345`), and the preprint metadata will be fetched. Review and save.

**Manually:** Click "Add Manually" to open a blank entry form. Select the entry type and fill in the fields.

### Citation Key Format

Citation keys are auto-generated using this format:
- First letter of each significant word in the journal title (ignoring articles like "the", "of", "and")
- Underscore separator
- Volume number
- First page or article number
- Publication year

Example: *The Journal of Chemical Physics*, vol 123, page 456, 2020 → `jcp_123_456_2020`

### Import/Merge

Upload an existing `.bib` file to merge with your current bibliography:
- **New entries** are added automatically
- **Exact duplicates** are skipped
- **Conflicts** (same citekey, different fields) prompt you to choose which version to keep

### Backup

The system automatically creates a backup (`refs.bib.bak`) before every save operation. For additional protection, consider setting up automated backups of your hosting directory.

## API Reference

The `api.php` file exposes these endpoints (all POST except download):

| Action | Description |
|--------|-------------|
| `list` | Returns all parsed entries as JSON |
| `save` | Add new entry or update existing by citekey |
| `delete` | Remove entry by citekey |
| `import` | Upload and preview a .bib file merge |
| `import_confirm` | Confirm and execute the merge |
| `generate_citekey` | Generate a citekey from fields |
| `download` (GET) | Return raw refs.bib file |

### Example API Calls

```bash
# List all entries
curl -X POST -H "Content-Type: application/json" \
  -d '{"action":"list"}' \
  https://yoursite.com/biblio/api.php

# Delete an entry
curl -X POST -H "Content-Type: application/json" \
  -d '{"action":"delete","citekey":"jcp_123_456_2020"}' \
  https://yoursite.com/biblio/api.php

# Download the .bib file
curl "https://yoursite.com/biblio/api.php?action=download" -o refs.bib
```

## Development

### Testing Locally

You can test locally using PHP's built-in server:

```bash
cd public
php -S localhost:8000
```

Then open http://localhost:8000 in your browser. Note that HTTP Basic Auth won't be active in this mode.

### File Safety Features

- **File locking:** Exclusive lock (`flock()`) before every write operation
- **Atomic writes:** Changes are written to a temp file first, then atomically renamed
- **Auto-backup:** `refs.bib` is copied to `refs.bib.bak` before each save
- **Normalized formatting:** Consistent indentation and field ordering on output

## Known Limitations

- **Last-write-wins:** No real-time collaboration or conflict resolution for simultaneous edits
- **No user tracking:** All changes are anonymous
- **No PDF attachments:** This is a metadata-only manager
- **No citation formatting:** Use your LaTeX workflow for formatted citations

## License

MIT License - feel free to use, modify, and distribute.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
