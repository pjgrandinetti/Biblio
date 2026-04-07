/**
 * BibTeX Manager - Frontend Application
 */

(function() {
    'use strict';

    // ==================== State ====================
    
    // Generate or retrieve session ID (use localStorage to persist across browser restarts)
    function getSessionId() {
        let sessionId = localStorage.getItem('biblio_session_id');
        if (!sessionId) {
            sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            localStorage.setItem('biblio_session_id', sessionId);
        }
        return sessionId;
    }
    
    const state = {
        sessionId: getSessionId(),
        entries: [],
        filteredEntries: [],
        currentPage: 1,
        entriesPerPage: 20,
        sortField: 'year',
        sortDirection: 'desc',
        searchQuery: '',
        filterType: '',
        editingCitekey: null, // Original citekey when editing
        importData: null,
        journalAbbreviations: {}, // Loaded from journal-abbrevs.json
        properNames: [] // Loaded from proper-names.json
    };

    // ==================== DOM Elements ====================
    const elements = {
        // Views
        viewList: document.getElementById('view-list'),
        viewDoi: document.getElementById('view-doi'),
        viewArxiv: document.getElementById('view-arxiv'),
        viewForm: document.getElementById('view-form'),
        viewImport: document.getElementById('view-import'),
        
        // Navigation buttons
        btnAddDoi: document.getElementById('btn-add-doi'),
        btnAddArxiv: document.getElementById('btn-add-arxiv'),
        btnAddManual: document.getElementById('btn-add-manual'),
        btnDownload: document.getElementById('btn-download'),
        btnTools: document.getElementById('btn-tools'),
        toolsMenu: document.getElementById('tools-menu'),
        btnImport: document.getElementById('btn-import'),
        btnCleanTitles: document.getElementById('btn-clean-titles'),
        btnRefreshAllDois: document.getElementById('btn-refresh-all-dois'),
        btnValidate: document.getElementById('btn-validate'),
        
        // List view
        searchInput: document.getElementById('search-input'),
        filterType: document.getElementById('filter-type'),
        entriesBody: document.getElementById('entries-body'),
        entriesTable: document.getElementById('entries-table'),
        btnPrev: document.getElementById('btn-prev'),
        btnNext: document.getElementById('btn-next'),
        pageInfo: document.getElementById('page-info'),
        
        // DOI lookup
        doiInput: document.getElementById('doi-input'),
        btnDoiLookup: document.getElementById('btn-doi-lookup'),
        doiStatus: document.getElementById('doi-status'),
        btnDoiCancel: document.getElementById('btn-doi-cancel'),
        
        // arXiv lookup
        arxivInput: document.getElementById('arxiv-input'),
        btnArxivLookup: document.getElementById('btn-arxiv-lookup'),
        arxivStatus: document.getElementById('arxiv-status'),
        btnArxivCancel: document.getElementById('btn-arxiv-cancel'),
        
        // Entry form
        formTitle: document.getElementById('form-title'),
        entryType: document.getElementById('entry-type'),
        entryCitekey: document.getElementById('entry-citekey'),
        entryCleanTitle: document.getElementById('entry-clean-title'),
        btnGenerateCitekey: document.getElementById('btn-generate-citekey'),
        btnRefreshFromDoi: document.getElementById('btn-refresh-from-doi'),
        btnFindDoi: document.getElementById('btn-find-doi'),
        btnSaveEntry: document.getElementById('btn-save-entry'),
        btnCancelEntry: document.getElementById('btn-cancel-entry'),
        btnDeleteEntry: document.getElementById('btn-delete-entry'),
        formStatus: document.getElementById('form-status'),
        
        // Import
        importFile: document.getElementById('import-file'),
        importStatus: document.getElementById('import-status'),
        btnImportCancel: document.getElementById('btn-import-cancel'),
        importUpload: document.getElementById('import-upload'),
        importPreview: document.getElementById('import-preview'),
        importNewCount: document.getElementById('import-new-count'),
        importDupCount: document.getElementById('import-dup-count'),
        importConflictCount: document.getElementById('import-conflict-count'),
        importConflicts: document.getElementById('import-conflicts'),
        conflictsContainer: document.getElementById('conflicts-container'),
        newEntriesContainer: document.getElementById('new-entries-container'),
        btnImportConfirm: document.getElementById('btn-import-confirm'),
        btnImportBack: document.getElementById('btn-import-back'),
        
        // Delete modal
        modalDelete: document.getElementById('modal-delete'),
        deleteCitekey: document.getElementById('delete-citekey'),
        btnDeleteConfirm: document.getElementById('btn-delete-confirm'),
        btnDeleteCancel: document.getElementById('btn-delete-cancel'),
        
        // Logout modal
        btnLogout: document.getElementById('btn-logout'),
        modalLogout: document.getElementById('modal-logout'),
        
        // Locked modal
        modalLocked: document.getElementById('modal-locked'),
        lockedMinutes: document.getElementById('locked-minutes'),
        btnLockedRetry: document.getElementById('btn-locked-retry'),
        btnLockedForce: document.getElementById('btn-locked-force'),
        
        // Validate modal
        modalValidate: document.getElementById('modal-validate'),
        validateResults: document.getElementById('validate-results'),
        btnValidateClose: document.getElementById('btn-validate-close'),
        
        // DOI Select modal
        modalDoiSelect: document.getElementById('modal-doi-select'),
        doiCurrentEntry: document.getElementById('doi-current-entry'),
        doiResultsList: document.getElementById('doi-results-list'),
        btnDoiSelectCancel: document.getElementById('btn-doi-select-cancel'),
        
        // Loading
        loading: document.getElementById('loading')
    };

    // Form field IDs mapped to BibTeX field names
    const formFields = {
        'entry-author': 'author',
        'entry-title': 'title',
        'entry-journal': 'journal',
        'entry-booktitle': 'booktitle',
        'entry-publisher': 'publisher',
        'entry-isbn': 'isbn',
        'entry-school': 'school',
        'entry-year': 'year',
        'entry-volume': 'volume',
        'entry-number': 'number',
        'entry-pages': 'pages',
        'entry-doi': 'doi',
        'entry-howpublished': 'howpublished',
        'entry-eprint': 'eprint',
        'entry-url': 'url',
        'entry-note': 'note',
        'entry-abstract': 'abstract'
    };

    // ==================== Utility Functions ====================
    
    function showLoading() {
        elements.loading.style.display = 'flex';
    }

    function hideLoading() {
        elements.loading.style.display = 'none';
    }

    function showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
    }

    function setStatus(element, message, type = 'loading') {
        element.className = 'status ' + type;
        element.textContent = message;
    }

    function clearStatus(element) {
        element.className = 'status';
        element.textContent = '';
    }

    /**
     * Convert HTML markup to LaTeX
     * CrossRef titles often contain HTML like <i>italic</i>
     */
    function htmlToLatex(text) {
        if (!text) return text;
        let result = text;
        
        // Convert MathML isotope notation (from CrossRef) to LaTeX
        // Pattern: <mml:math...><mml:mmultiscripts><mml:mi...>ELEMENT</mml:mi><mml:mprescripts/><mml:none/><mml:mn>MASS</mml:mn></mml:mmultiscripts></mml:math>
        result = result.replace(/<mml:math[^>]*><mml:mmultiscripts><mml:mi[^>]*>([A-Za-z]+)<\/mml:mi><mml:mprescripts\/?><mml:none\/?><mml:mn>(\d+)<\/mml:mn><\/mml:mmultiscripts><\/mml:math>/gi,
            (match, elem, mass) => `{$^{${mass}}$${elem}}`);
        
        // Convert MathML presuperscript notation: <msup><mrow/><mrow><mn>N</mn></mrow></msup><mi>X</mi> -> $^{N}$X
        // Used for coupling constants like ²J, ³J in NMR
        result = result.replace(/<mml:math[^>]*>[\s\S]*?<mml:msup>\s*<mml:mrow\s*\/?>\s*<mml:mrow>\s*<mml:mn>(\d+)<\/mml:mn>\s*<\/mml:mrow>\s*<\/mml:msup>\s*<mml:mi>([A-Za-z]+)<\/mml:mi>[\s\S]*?<\/mml:math>/gi,
            (match, num, variable) => `{$^{${num}}${variable}$}`);
        
        // Convert general MathML with msup (superscript): <msup><mi>X</mi><mn>N</mn></msup> -> X$^{N}$
        result = result.replace(/<mml:math[^>]*>[\s\S]*?<mml:msup>\s*<mml:mi>([A-Za-z]+)<\/mml:mi>\s*<mml:mn>(\d+)<\/mml:mn>\s*<\/mml:msup>[\s\S]*?<\/mml:math>/gi,
            (match, base, exp) => `${base}$^{${exp}}$`);
        
        // Convert general MathML with msub (subscript): <msub><mi>X</mi><mn>N</mn></msub> -> X$_{N}$
        result = result.replace(/<mml:math[^>]*>[\s\S]*?<mml:msub>\s*<mml:mi>([A-Za-z]+)<\/mml:mi>\s*<mml:mn>(\d+)<\/mml:mn>\s*<\/mml:msub>[\s\S]*?<\/mml:math>/gi,
            (match, base, sub) => `${base}$_{${sub}}$`);
        
        // Strip any remaining MathML tags but keep the text content
        result = result.replace(/<mml:[^>]+>/gi, '').replace(/<\/mml:[^>]+>/gi, '');
        
        // Normalize whitespace (MathML often has excessive spacing)
        result = result.replace(/\s+/g, ' ').trim();
        
        // Convert HTML isotope notation: <sup>17</sup>O -> {$^{17}$O}
        // Add space before if preceded by non-space character
        result = result.replace(/(\S)?<sup>(\d{1,3})<\/sup>(H|D|T|C|N|O|F|P|S|Si|Na|K|Ca|Fe|Cu|Zn|Br|Cl|I|Al|Mg|B|Li|He|Ne|Ar|Se)\b/gi,
            (match, before, mass, elem) => (before ? before + ' ' : '') + `{$^{${mass}}$${elem}}`);
        
        // Convert HTML tags to LaTeX
        result = result
            .replace(/<i>/gi, '\\textit{')
            .replace(/<\/i>/gi, '}')
            .replace(/<em>/gi, '\\textit{')
            .replace(/<\/em>/gi, '}')
            .replace(/<b>/gi, '\\textbf{')
            .replace(/<\/b>/gi, '}')
            .replace(/<strong>/gi, '\\textbf{')
            .replace(/<\/strong>/gi, '}')
            .replace(/<sub>([^<]+)<\/sub>/gi, '$_{$1}$')
            .replace(/<sup>([^<]+)<\/sup>/gi, '$^{$1}$')
            .replace(/&amp;/gi, '\\&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>');
        
        // Convert plain text chemical formulas (no HTML tags): SiO2 -> {SiO$_{2}$}
        // Match formulas with at least 2 elements where at least one has a subscript number
        result = result.replace(/\b([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*[A-Z][a-z]?\d+|[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)+)\b/g, (match) => {
            const uppercaseCount = (match.match(/[A-Z]/g) || []).length;
            if (uppercaseCount >= 2 && /[A-Z][a-z]?\d/.test(match)) {
                return '{' + match.replace(/([A-Z][a-z]?)(\d+)/g, '$1$_{$2}$') + '}';
            }
            return match;
        });
        // Also handle simple compounds in hyphenated contexts: CaO-MgO -> {CaO}-{MgO}
        result = result.replace(/\b([A-Z][a-z]?)([A-Z][a-z]?)\b(?=-)/g, '{$1$2}');
        result = result.replace(/(?<=-)\b([A-Z][a-z]?)([A-Z][a-z]?)\b/g, '{$1$2}');
        
        // Wrap chemical formulas to protect capitalization in BibTeX
        // Match element (optional subscript) followed by element+subscript sequences
        // SiP$_{2}$O$_{7}$ -> {SiP$_{2}$O$_{7}$}, Na$_{4}$P$_{2}$O$_{7}$ -> {Na$_{4}$P$_{2}$O$_{7}$}
        result = result.replace(/(?<!\{)([A-Z][a-z]?(?:\$_\{\d+\}\$)?(?:[A-Z][a-z]?\$_\{\d+\}\$)+)/g, '{$1}');
        
        // Wrap Q-species and similar notations: Q$^{3}$ -> {Q$^{3}$}, T$^{n}$ -> {T$^{n}$}
        // Common in NMR/glass science for structural units
        result = result.replace(/(?<!\{)\b([A-Z])\$\^\{(\d+)\}\$/g, '{$1$^{$2}$}');
        
        // Convert isotope notation: 13C or 13 C -> {$^{13}$C}, 2H -> {$^{2}$H}, etc.
        // Match mass number followed by optional space and element symbol at word boundary
        // Note: D (deuterium) excluded because 2D/3D usually means two/three-dimensional
        // Wrap in braces to protect case in BibTeX
        result = result.replace(/\b(\d{1,3})\s*(H|T|C|N|O|F|P|S|Si|Na|K|Ca|Fe|Cu|Zn|Br|Cl|I|Al|Mg|B|Li|He|Ne|Ar|Kr|Xe|Se|Te|As|Sb|Bi|Sn|Pb|Ag|Au|Pt|Pd|Rh|Ru|Ir|Os|Co|Ni|Mn|Cr|V|Ti|Sc|Zr|Nb|Mo|Tc|W|Ta|Hf|Re|Cd|Hg|Tl|In|Ga|Ge)\b/g, 
            (match, mass, elem) => `{$^{${mass}}$${elem}}`);
        
        // Also handle reverse notation: O17 or O 17 -> {$^{17}$O}, C13 -> {$^{13}$C}
        // D included here since D17 etc. is clearly isotope notation
        result = result.replace(/\b(H|D|T|C|N|O|F|P|S|Si|Na|K|Ca|Fe|Cu|Zn|Br|Cl|I|Al|Mg|B|Li|He|Ne|Ar|Kr|Xe|Se|Te|As|Sb|Bi|Sn|Pb|Ag|Au|Pt|Pd|Rh|Ru|Ir|Os|Co|Ni|Mn|Cr|V|Ti|Sc|Zr|Nb|Mo|Tc|W|Ta|Hf|Re|Cd|Hg|Tl|In|Ga|Ge)\s*(\d{1,3})\b/g, 
            (match, elem, mass) => `{$^{${mass}}$${elem}}`);
        
        // Convert degree symbol to LaTeX: 22 °C -> {22$^\circ$C}, 590°C -> {590$^\circ$C}
        result = result.replace(/(\d+)\s*°\s*([CKF])\b/g, (m, num, unit) => '{' + num + '$^\\circ$' + unit + '}');
        // Handle standalone °C, °K, °F without preceding number
        result = result.replace(/°([CKF])\b/g, (m, unit) => '$^\\circ$' + unit);
        // Handle any remaining standalone degree symbols
        result = result.replace(/°/g, '$^\\circ$');
        
        // Wrap scientific proper names to protect capitalization (loaded from JSON)
        if (state.properNames.length > 0) {
            const properNamesPattern = new RegExp('(?<!\\{)\\b(' + state.properNames.join('|') + ')\\b(?!\\})', 'g');
            result = result.replace(properNamesPattern, '{$1}');
        }
        
        // Wrap fully capitalized words (2+ chars) in braces to protect case (e.g., NMR, MAS)
        result = result.replace(/(?<!\{)\b([A-Z]{2,})\b(?!\})/g, '{$1}');
        
        // Wrap roman numerals in common contexts:
        // After colon/period with space: "melts: I. A" -> "melts: {I}. A"
        result = result.replace(/([:.]\s*)([IVXLCDM]+)(\.|,|;|:|\s|$)/g, '$1{$2}$3');
        // After words like Part, Section, Volume, Chapter, Phase, Type, Figure, Table
        result = result.replace(/\b(Part|Section|Volume|Chapter|Phase|Type|Figure|Table|Fig|Tab|No|Nr)\s+([IVXLCDM]+)\b/gi, '$1 {$2}');
        
        return result;
    }

    /**
     * Format a list of people (authors or editors) from CrossRef/DataCite format to BibTeX format
     * @param {Array} people - Array of person objects with {family, given} or {name}
     * @returns {string} BibTeX-formatted author/editor string
     */
    function formatPersonList(people) {
        if (!people || !Array.isArray(people) || people.length === 0) {
            return '';
        }
        return people.map(p => {
            if (p.family && p.given) {
                return `${p.family}, ${p.given}`;
            }
            return p.name || p.family || '';
        }).filter(Boolean).join(' and ');
    }

    /**
     * Determine BibTeX entry type from CrossRef/DataCite work type
     * @param {string} crossrefType - CrossRef type like 'journal-article', 'book', 'edited-book'
     * @param {object} work - The work object for additional context
     * @returns {string} BibTeX entry type
     */
    function detectEntryType(crossrefType, work) {
        if (!crossrefType) return 'article';
        
        const typeMap = {
            'journal-article': 'article',
            'article': 'article',
            'proceedings-article': 'inproceedings',
            'book': 'book',
            'edited-book': 'book',
            'monograph': 'book',
            'reference-book': 'book',
            'book-chapter': 'incollection',
            'book-section': 'incollection',
            'book-part': 'incollection',
            'report': 'techreport',
            'dissertation': 'phdthesis',
            'posted-content': 'misc',
            'dataset': 'misc',
            'component': 'misc',
            'peer-review': 'misc'
        };
        
        return typeMap[crossrefType] || 'misc';
    }

    /**
     * Load journal abbreviations from JSON files
     * Custom overrides take precedence over JabRef database
     */
    async function loadJournalAbbreviations() {
        try {
            // Load JabRef database
            const response = await fetch('journal-abbrevs.json', { credentials: 'same-origin' });
            if (response.ok) {
                state.journalAbbreviations = await response.json();
                console.log(`Loaded ${Object.keys(state.journalAbbreviations).length} journal abbreviations`);
            }
            // Load custom overrides (take precedence)
            const customResponse = await fetch('journal-abbrevs-custom.json', { credentials: 'same-origin' });
            if (customResponse.ok) {
                const custom = await customResponse.json();
                Object.assign(state.journalAbbreviations, custom);
                console.log(`Loaded ${Object.keys(custom).length} custom overrides`);
            }
        } catch (e) {
            console.warn('Could not load journal abbreviations:', e);
        }
    }

    /**
     * Look up abbreviated journal name
     * @param {string} fullName - Full journal name from CrossRef
     * @returns {string} - Abbreviated name if found, otherwise the full name
     */
    function lookupJournalAbbreviation(fullName) {
        if (!fullName) return fullName;
        // Normalize: lowercase, collapse whitespace, remove commas before "and"
        let key = fullName.toLowerCase().replace(/\s+/g, ' ').trim();
        // Try direct lookup first
        if (state.journalAbbreviations[key]) {
            return state.journalAbbreviations[key];
        }
        // Try without commas (CrossRef sometimes has "Edinburgh, and" vs JabRef "Edinburgh and")
        key = key.replace(/,\s*and\b/g, ' and');
        if (state.journalAbbreviations[key]) {
            return state.journalAbbreviations[key];
        }
        // Try stripping all commas
        key = key.replace(/,/g, '');
        if (state.journalAbbreviations[key]) {
            return state.journalAbbreviations[key];
        }
        return fullName;
    }

    /**
     * Load proper names from JSON files for title capitalization protection
     * Custom overrides are merged with the base list
     */
    async function loadProperNames() {
        try {
            // Load base proper names
            const response = await fetch('proper-names.json', { credentials: 'same-origin' });
            if (response.ok) {
                const data = await response.json();
                // Flatten all categories into a single array
                const names = [];
                for (const key of Object.keys(data)) {
                    if (key !== '_comment' && Array.isArray(data[key])) {
                        names.push(...data[key]);
                    }
                }
                state.properNames = names;
                console.log(`Loaded ${state.properNames.length} proper names`);
            }
            // Load custom additions (merged with base list)
            const customResponse = await fetch('proper-names-custom.json', { credentials: 'same-origin' });
            if (customResponse.ok) {
                const custom = await customResponse.json();
                if (custom.custom && Array.isArray(custom.custom)) {
                    state.properNames.push(...custom.custom);
                    console.log(`Loaded ${custom.custom.length} custom proper names`);
                }
            }
        } catch (e) {
            console.warn('Could not load proper names:', e);
        }
    }

    /**
     * Fetch title from Semantic Scholar API
     * Used as fallback/verification when CrossRef data may be incomplete
     * @param {string} doi - The DOI to look up
     * @returns {string|null} - Title from Semantic Scholar, or null if not found
     */
    async function fetchSemanticScholarTitle(doi) {
        try {
            const response = await fetch(
                `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(doi)}?fields=title`,
                { headers: { 'Accept': 'application/json' } }
            );
            if (!response.ok) return null;
            const data = await response.json();
            return data.title || null;
        } catch (e) {
            console.warn('Semantic Scholar lookup failed:', e);
            return null;
        }
    }

    /**
     * Check if a DOI should use DataCite API instead of CrossRef
     * Returns true for Zenodo (10.5281/zenodo.*) and arXiv (10.48550/*) DOIs
     */
    function shouldUseDataCite(doi) {
        return doi.startsWith('10.5281/zenodo.') || doi.startsWith('10.48550/');
    }

    /**
     * Parse DataCite creator into {family, given} object
     * Handles DataCite's quirk where familyName sometimes contains the full name
     * and givenName is missing
     */
    function parseDataCiteCreator(creator) {
        // If we have both familyName and givenName, use them
        if (creator.givenName && creator.familyName) {
            return { family: creator.familyName, given: creator.givenName };
        }
        
        // If familyName contains a space (full name) or givenName is missing, parse from name
        if (creator.name) {
            const nameParts = creator.name.trim().split(/\s+/);
            if (nameParts.length >= 2) {
                // Assume last word is family name, rest is given name
                const family = nameParts.pop();
                const given = nameParts.join(' ');
                return { family, given };
            }
            // Single word name - use as family name
            return { family: creator.name, given: '' };
        }
        
        // Fallback to whatever we have
        return { 
            family: creator.familyName || '', 
            given: creator.givenName || '' 
        };
    }

    /**
     * Compare two titles and return the one with more isotope information
     * @param {string} title1 - First title (e.g., from CrossRef)
     * @param {string} title2 - Second title (e.g., from Semantic Scholar)
     * @returns {string} - The title with more complete isotope notation
     */
    function pickBetterTitle(title1, title2) {
        if (!title2) return title1;
        if (!title1) return title2;
        
        // Count isotope patterns in each title
        // Match patterns like: 17O, O17, ¹⁷O, <sup>17</sup>O, etc.
        const isotopePattern = /(\d{1,3})(H|D|T|C|N|O|F|P|S|Si|Na|K|Ca|Fe|Cu|Zn|Br|Cl|I|Al|Mg|B|Li|He|Ne|Ar|Se)\b|\b(H|D|T|C|N|O|F|P|S|Si|Na|K|Ca|Fe|Cu|Zn|Br|Cl|I|Al|Mg|B|Li|He|Ne|Ar|Se)(\d{1,3})\b/gi;
        
        const count1 = (title1.match(isotopePattern) || []).length;
        const count2 = (title2.match(isotopePattern) || []).length;
        
        // If Semantic Scholar has more isotopes, prefer it
        if (count2 > count1) {
            console.log(`Using Semantic Scholar title (more isotopes: ${count2} vs ${count1})`);
            return title2;
        }
        
        // If CrossRef has more or equal isotopes, stick with CrossRef
        return title1;
    }

    async function apiCall(action, data = {}, isFormData = false) {
        const options = {
            method: 'POST',
            credentials: 'same-origin' // Include HTTP Basic Auth credentials
        };

        if (isFormData) {
            // For FormData, append session_id
            data.append('session_id', state.sessionId);
            data.append('action', action);
            options.body = data;
        } else {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify({ action, session_id: state.sessionId, ...data });
        }

        const response = await fetch('api.php', options);
        const result = await response.json();

        // Handle session lock
        if (response.status === 423 || result.error === 'locked') {
            showLockedModal(result.minutes_remaining);
            throw new Error('Session locked');
        }

        if (result.error) {
            throw new Error(result.error);
        }

        return result;
    }

    function truncate(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==================== Entry List Functions ====================
    
    async function loadEntries() {
        showLoading();
        try {
            const result = await apiCall('list');
            state.entries = result.entries || [];
            filterAndSortEntries();
            renderEntries();
        } catch (error) {
            console.error('Failed to load entries:', error);
            elements.entriesBody.innerHTML = `
                <tr><td colspan="6" class="empty-state">
                    Failed to load entries: ${escapeHtml(error.message)}
                </td></tr>
            `;
        } finally {
            hideLoading();
        }
    }

    function filterAndSortEntries() {
        let entries = [...state.entries];

        // Apply search filter
        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            entries = entries.filter(entry => {
                const searchable = [
                    entry.citekey,
                    entry.fields.author || '',
                    entry.fields.title || '',
                    entry.fields.journal || '',
                    entry.fields.year || '',
                    entry.type
                ].join(' ').toLowerCase();
                return searchable.includes(query);
            });
        }

        // Apply type filter
        if (state.filterType) {
            entries = entries.filter(entry => entry.type === state.filterType);
        }

        // Sort
        entries.sort((a, b) => {
            let aVal, bVal;
            
            if (state.sortField === 'citekey') {
                aVal = a.citekey.toLowerCase();
                bVal = b.citekey.toLowerCase();
            } else if (state.sortField === 'type') {
                aVal = a.type;
                bVal = b.type;
            } else {
                aVal = (a.fields[state.sortField] || '').toLowerCase();
                bVal = (b.fields[state.sortField] || '').toLowerCase();
            }

            // For year, sort numerically
            if (state.sortField === 'year') {
                aVal = parseInt(aVal) || 0;
                bVal = parseInt(bVal) || 0;
            }

            if (aVal < bVal) return state.sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return state.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        state.filteredEntries = entries;
        state.currentPage = 1;
    }

    function renderEntries() {
        const start = (state.currentPage - 1) * state.entriesPerPage;
        const end = start + state.entriesPerPage;
        const pageEntries = state.filteredEntries.slice(start, end);
        const totalPages = Math.max(1, Math.ceil(state.filteredEntries.length / state.entriesPerPage));

        if (pageEntries.length === 0) {
            elements.entriesBody.innerHTML = `
                <tr><td colspan="5" class="empty-state">
                    ${state.entries.length === 0 ? 'No entries yet. Add your first entry!' : 'No entries match your search.'}
                </td></tr>
            `;
        } else {
            elements.entriesBody.innerHTML = pageEntries.map(entry => {
                // Build title cell - make it a link if DOI or URL exists
                let titleHtml;
                const titleText = escapeHtml(truncate(entry.fields.title, 60));
                const titleFull = escapeHtml(entry.fields.title || '');
                
                if (entry.fields.doi) {
                    const doiUrl = entry.fields.doi.startsWith('http') 
                        ? entry.fields.doi 
                        : `https://doi.org/${entry.fields.doi}`;
                    titleHtml = `<a href="${escapeHtml(doiUrl)}" target="_blank" rel="noopener" title="${titleFull}">${titleText}</a>`;
                } else if (entry.fields.url) {
                    titleHtml = `<a href="${escapeHtml(entry.fields.url)}" target="_blank" rel="noopener" title="${titleFull}">${titleText}</a>`;
                } else {
                    titleHtml = `<span title="${titleFull}">${titleText}</span>`;
                }
                
                return `
                <tr data-citekey="${escapeHtml(entry.citekey)}">
                    <td class="cell-citekey clickable" title="${escapeHtml(entry.citekey)}">${escapeHtml(entry.citekey)}</td>
                    <td class="cell-authors" title="${escapeHtml(entry.fields.author || '')}">${escapeHtml(truncate(entry.fields.author, 40))}</td>
                    <td class="cell-title">${titleHtml}</td>
                    <td class="cell-year">${escapeHtml(entry.fields.year || '')}</td>
                    <td class="cell-type">${escapeHtml(entry.type)}</td>
                </tr>
            `}).join('');
        }

        // Update pagination
        elements.pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;
        elements.btnPrev.disabled = state.currentPage <= 1;
        elements.btnNext.disabled = state.currentPage >= totalPages;

        // Update sort indicators
        document.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === state.sortField) {
                th.classList.add(state.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // ==================== Entry Form Functions ====================
    
    function showEntryForm(entry = null, fromLookup = false) {
        state.editingCitekey = entry ? entry.citekey : null;
        
        elements.formTitle.textContent = entry ? 'Edit Entry' : 'Add New Entry';
        
        // Reset form
        elements.entryType.value = entry ? entry.type : 'article';
        elements.entryCitekey.value = entry ? entry.citekey : '';
        
        // Set clean title checkbox: checked for DOI/arXiv lookups, unchecked for manual/edit
        elements.entryCleanTitle.checked = fromLookup;
        
        // Show delete button only when editing existing entry
        elements.btnDeleteEntry.style.display = state.editingCitekey ? 'inline-flex' : 'none';
        
        // Set field visibility based on type
        document.body.dataset.entryType = elements.entryType.value;
        
        // Populate fields
        Object.entries(formFields).forEach(([elementId, fieldName]) => {
            const el = document.getElementById(elementId);
            if (el) {
                el.value = entry ? (entry.fields[fieldName] || '') : '';
            }
        });
        
        // Update URL field state based on DOI
        const doiField = document.getElementById('entry-doi');
        const urlField = document.getElementById('entry-url');
        const hasDoi = doiField.value.trim() !== '';
        urlField.disabled = hasDoi;
        urlField.placeholder = hasDoi ? 'Disabled when DOI is present' : 'https://...';
        if (hasDoi) {
            urlField.value = '';
        }
        
        // Hide Find DOI button if DOI already exists
        elements.btnFindDoi.style.display = hasDoi ? 'none' : 'inline-flex';
        
        clearStatus(elements.formStatus);
        showView('view-form');
    }

    function getFormData() {
        const type = elements.entryType.value;
        const citekey = elements.entryCitekey.value.trim();
        
        const fields = {};
        Object.entries(formFields).forEach(([elementId, fieldName]) => {
            const el = document.getElementById(elementId);
            if (el && el.value.trim()) {
                fields[fieldName] = el.value.trim();
            }
        });
        
        return { type, citekey, fields };
    }

    async function saveEntry() {
        const entry = getFormData();
        
        // Debug: log what we're saving
        console.log('Saving entry:', JSON.stringify(entry, null, 2));
        
        if (!entry.citekey) {
            setStatus(elements.formStatus, 'Citekey is required', 'error');
            return;
        }
        
        showLoading();
        setStatus(elements.formStatus, 'Saving...', 'loading');
        
        try {
            const data = { 
                entry,
                cleanTitle: elements.entryCleanTitle.checked
            };
            if (state.editingCitekey) {
                data.originalCitekey = state.editingCitekey;
            }
            
            console.log('Request data:', JSON.stringify(data, null, 2));
            
            const result = await apiCall('save', data);
            
            console.log('Save result:', JSON.stringify(result, null, 2));
            
            if (result.warning) {
                setStatus(elements.formStatus, `Warning: ${result.warning} (${result.existingCitekey})`, 'error');
                hideLoading();
                return;
            }
            
            await loadEntries();
            showView('view-list');
        } catch (error) {
            console.error('Save error:', error);
            setStatus(elements.formStatus, error.message, 'error');
        } finally {
            hideLoading();
        }
    }

    async function generateCitekey() {
        const fields = {};
        Object.entries(formFields).forEach(([elementId, fieldName]) => {
            const el = document.getElementById(elementId);
            if (el && el.value.trim()) {
                fields[fieldName] = el.value.trim();
            }
        });
        
        try {
            const result = await apiCall('generate_citekey', { 
                fields,
                editingCitekey: state.editingCitekey  // Exclude current entry from uniqueness check
            });
            elements.entryCitekey.value = result.citekey;
        } catch (error) {
            console.error('Failed to generate citekey:', error);
        }
    }

    async function refreshFromDoi() {
        const doiField = document.getElementById('entry-doi');
        let doi = doiField.value.trim();
        
        // Clean up DOI input (handle full URLs)
        doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
        
        if (!doi) {
            setStatus(elements.formStatus, 'Please enter a DOI first', 'error');
            return;
        }
        
        setStatus(elements.formStatus, 'Fetching metadata from DOI...', 'loading');
        showLoading();
        
        try {
            const useDataCite = shouldUseDataCite(doi);
            const isArxiv = doi.startsWith('10.48550/');
            let work, ssTitle = null;
            
            if (useDataCite) {
                // Use DataCite API for Zenodo and arXiv DOIs
                const response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error('DOI not found');
                    }
                    throw new Error('Failed to fetch DOI metadata from DataCite');
                }
                const data = await response.json();
                const attrs = data.data.attributes;
                
                work = {
                    author: attrs.creators ? attrs.creators.map(parseDataCiteCreator) : null,
                    title: attrs.titles ? [attrs.titles[0]?.title] : null,
                    published: attrs.publicationYear ? { 'date-parts': [[attrs.publicationYear]] } : null,
                    publisher: attrs.publisher
                };
                
                // For arXiv, extract the arXiv ID for the eprint field
                if (isArxiv && attrs.identifiers) {
                    const arxivId = attrs.identifiers.find(id => id.identifierType === 'arXiv');
                    if (arxivId) {
                        work.arxivId = arxivId.identifier;
                    }
                }
            } else {
                // Fetch CrossRef and Semantic Scholar in parallel
                const [crossrefResponse, ssTitleResult] = await Promise.all([
                    fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
                    fetchSemanticScholarTitle(doi)
                ]);
                ssTitle = ssTitleResult;
                
                if (!crossrefResponse.ok) {
                    if (crossrefResponse.status === 404) {
                        throw new Error('DOI not found');
                    }
                    throw new Error('Failed to fetch DOI metadata');
                }
                
                const data = await crossrefResponse.json();
                work = data.message;
            }
            
            // Keep current citekey
            const currentCitekey = elements.entryCitekey.value;
            
            // Update entry type based on CrossRef type
            let entryType;
            if (isArxiv) {
                entryType = 'article';
            } else if (useDataCite) {
                entryType = 'misc';
            } else {
                entryType = detectEntryType(work.type, work);
            }
            elements.entryType.value = entryType;
            document.body.dataset.entryType = entryType;
            
            // Build fields object
            const fields = {};
            
            // Authors - try authors first, fall back to editors
            if (work.author && work.author.length > 0) {
                fields.author = formatPersonList(work.author);
            } else if (work.editor && work.editor.length > 0) {
                // No authors, use editors (common for edited books)
                fields.editor = formatPersonList(work.editor);
            }
            
            // Title (convert HTML to LaTeX, pick best between CrossRef and Semantic Scholar)
            if (work.title && work.title[0]) {
                fields.title = htmlToLatex(pickBetterTitle(work.title[0], ssTitle));
            }
            
            // Journal - prefer abbreviated name, with fallback to abbreviation database
            if (!useDataCite && entryType === 'article') {
                let journal = null;
                if (work['short-container-title'] && work['short-container-title'][0]) {
                    journal = work['short-container-title'][0];
                } else if (work['container-title'] && work['container-title'][0]) {
                    journal = work['container-title'][0];
                }
                if (journal) {
                    fields.journal = lookupJournalAbbreviation(journal);
                }
            }
            
            // Publisher (for books, reports, Zenodo, but not arXiv)
            if (work.publisher && (entryType === 'book' || entryType === 'incollection' || entryType === 'techreport' || (useDataCite && !isArxiv))) {
                fields.publisher = work.publisher;
            }
            
            // ISBN for books
            if (!useDataCite && work.ISBN && work.ISBN[0] && (entryType === 'book' || entryType === 'incollection')) {
                fields.isbn = work.ISBN[0];
            }
            
            // Edition for books
            if (!useDataCite && work['edition-number'] && (entryType === 'book' || entryType === 'incollection')) {
                fields.edition = work['edition-number'];
            }
            
            // arXiv-specific fields
            if (isArxiv) {
                if (work.arxivId) {
                    fields.eprint = work.arxivId;
                }
                fields.archiveprefix = 'arXiv';
            }
            
            // Year
            if (work.published) {
                const dateParts = work.published['date-parts'];
                if (dateParts && dateParts[0] && dateParts[0][0]) {
                    fields.year = String(dateParts[0][0]);
                }
            } else if (work.issued) {
                const dateParts = work.issued['date-parts'];
                if (dateParts && dateParts[0] && dateParts[0][0]) {
                    fields.year = String(dateParts[0][0]);
                }
            }
            
            // Volume (CrossRef only, for articles)
            if (!useDataCite && work.volume && entryType === 'article') {
                fields.volume = work.volume;
            }
            
            // Issue/Number (CrossRef only, for articles)
            if (!useDataCite && work.issue && entryType === 'article') {
                fields.number = work.issue;
            }
            
            // Pages (CrossRef only)
            if (!useDataCite) {
                if (work.page) {
                    fields.pages = work.page;
                } else if (work['article-number']) {
                    fields.pages = work['article-number'];
                }
            }
            
            // DOI
            fields.doi = doi;
            
            // ISSN (CrossRef only, for articles)
            if (!useDataCite && work.ISSN && work.ISSN[0] && entryType === 'article') {
                fields.issn = work.ISSN[0];
            }
            
            // Populate form fields
            Object.entries(formFields).forEach(([elementId, fieldName]) => {
                const el = document.getElementById(elementId);
                if (el) {
                    el.value = fields[fieldName] || '';
                }
            });
            
            // Restore citekey (or generate new one if empty)
            if (currentCitekey) {
                elements.entryCitekey.value = currentCitekey;
            } else {
                const ckResult = await apiCall('generate_citekey', { fields });
                elements.entryCitekey.value = ckResult.citekey;
            }
            
            // Check the clean title checkbox since this is from a lookup
            elements.entryCleanTitle.checked = true;
            
            // Update URL field state
            const urlField = document.getElementById('entry-url');
            urlField.disabled = true;
            urlField.value = '';
            urlField.placeholder = 'Disabled when DOI is present';
            
            setStatus(elements.formStatus, 'Fields updated from DOI', 'success');
            
        } catch (error) {
            setStatus(elements.formStatus, error.message, 'error');
        } finally {
            hideLoading();
        }
    }

    async function findDoiForEntry() {
        // Get current form values
        const title = document.getElementById('entry-title').value.trim();
        const author = document.getElementById('entry-author').value.trim();
        const year = document.getElementById('entry-year').value.trim();
        const journal = document.getElementById('entry-journal').value.trim();
        const volume = document.getElementById('entry-volume').value.trim();
        const pages = document.getElementById('entry-pages').value.trim();
        const doiField = document.getElementById('entry-doi');
        
        // Extract author last names for search
        function getAuthorLastNames(authorStr) {
            if (!authorStr) return [];
            return authorStr.split(' and ').map(a => {
                const parts = a.split(',');
                return parts[0].trim().replace(/[{}]/g, '');
            }).filter(n => n);
        }
        
        // Check if we have enough info to search
        let query = '';
        if (title) {
            query = title;
            if (author) {
                // Add first author's last name
                const lastNames = getAuthorLastNames(author);
                if (lastNames.length > 0) {
                    query += ' ' + lastNames[0];
                }
            }
        } else if (journal && volume && pages) {
            // No title - use bibliographic info with authors
            let firstPage = pages;
            if (pages.includes('-') || pages.includes('–')) {
                firstPage = pages.split(/[-–]/)[0].trim();
            }
            query = `${journal} ${volume} ${firstPage}`;
            
            // Add author names - crucial for disambiguating
            const lastNames = getAuthorLastNames(author);
            if (lastNames.length > 0) {
                // Add first and last author for better matching
                query += ' ' + lastNames[0];
                if (lastNames.length > 1) {
                    query += ' ' + lastNames[lastNames.length - 1];
                }
            }
            
            if (year) {
                query += ` ${year}`;
            }
        }
        
        if (!query) {
            setStatus(elements.formStatus, 'Need title or journal+volume+pages to search', 'error');
            return;
        }
        
        setStatus(elements.formStatus, 'Searching CrossRef...', 'loading');
        showLoading();
        
        try {
            const data = await apiCall('search_doi', { query });
            let items = data.results || [];
            
            if (items.length === 0) {
                setStatus(elements.formStatus, 'No DOIs found', 'error');
                return;
            }
            
            // Filter by year if we have one
            if (year) {
                const yearNum = parseInt(year, 10);
                items.sort((a, b) => {
                    const aYear = parseInt(a.year, 10) || 0;
                    const bYear = parseInt(b.year, 10) || 0;
                    return Math.abs(aYear - yearNum) - Math.abs(bYear - yearNum);
                });
                const filtered = items.filter(item => {
                    const itemYear = parseInt(item.year, 10);
                    return !itemYear || Math.abs(itemYear - yearNum) <= 2;
                });
                if (filtered.length > 0) {
                    items = filtered;
                }
            }
            
            // Show DOI selection modal with entry metadata for comparison
            const entryMeta = { title, author, year, journal, volume, pages };
            showDoiSelectModal(items, entryMeta, doiField);
            
        } catch (error) {
            setStatus(elements.formStatus, 'Search failed: ' + error.message, 'error');
        } finally {
            hideLoading();
        }
    }

    function showDoiSelectModal(items, entryMeta, doiField) {
        const { title, author, year, journal, volume, pages } = entryMeta;
        
        // Build current entry info for comparison
        let currentEntryHtml = '<div class="doi-current-label">Looking for:</div>';
        if (title) {
            currentEntryHtml += `<div class="doi-current-title">${escapeHtml(title)}</div>`;
        }
        if (author) {
            currentEntryHtml += `<div class="doi-current-authors">${escapeHtml(author)}</div>`;
        }
        const metaParts = [];
        if (year) metaParts.push(`(${year})`);
        if (journal) metaParts.push(escapeHtml(journal));
        if (volume) metaParts.push(`vol. ${volume}`);
        if (pages) metaParts.push(`p. ${pages}`);
        if (metaParts.length > 0) {
            currentEntryHtml += `<div class="doi-current-meta">${metaParts.join(' ')}</div>`;
        }
        elements.doiCurrentEntry.innerHTML = currentEntryHtml;
        
        // Build the results list
        const html = items.map((item, i) => {
            const yearMatch = year && item.year && item.year.toString() === year;
            const volumeMatch = volume && item.volume && item.volume.toString() === volume;
            const isHighlighted = yearMatch || volumeMatch;
            
            // Clean up title (remove HTML tags like <i>)
            const cleanTitle = (item.title || 'Untitled').replace(/<[^>]*>/g, '');
            
            // Build bibliographic details line
            const bibParts = [];
            if (item.year) bibParts.push(`(${item.year})`);
            if (item.journal) bibParts.push(escapeHtml(item.journal));
            if (item.volume) bibParts.push(`vol. ${item.volume}`);
            if (item.page) bibParts.push(`p. ${item.page}`);
            
            return `
                <div class="doi-result-card${isHighlighted ? ' highlighted' : ''}" data-index="${i}">
                    <div class="doi-result-title">
                        ${escapeHtml(cleanTitle)}
                        ${isHighlighted ? '<span class="doi-result-badge">Match</span>' : ''}
                    </div>
                    <div class="doi-result-authors">${escapeHtml(item.authors || 'Unknown authors')}</div>
                    <div class="doi-result-meta">${bibParts.join(' ')}</div>
                    <div class="doi-result-doi">${escapeHtml(item.doi)}</div>
                </div>
            `;
        }).join('');
        
        elements.doiResultsList.innerHTML = html;
        elements.modalDoiSelect.classList.add('active');
        clearStatus(elements.formStatus);
        
        // Store items for selection handler
        elements.doiResultsList.dataset.items = JSON.stringify(items);
        elements.doiResultsList.dataset.doiFieldId = doiField.id;
        
        // Add click handlers to cards
        elements.doiResultsList.querySelectorAll('.doi-result-card').forEach(card => {
            card.addEventListener('click', handleDoiResultClick);
        });
    }

    async function handleDoiResultClick(e) {
        const card = e.currentTarget;
        const index = parseInt(card.dataset.index, 10);
        const items = JSON.parse(elements.doiResultsList.dataset.items);
        const doiFieldId = elements.doiResultsList.dataset.doiFieldId;
        const doiField = document.getElementById(doiFieldId);
        
        const selectedDoi = items[index].doi;
        doiField.value = selectedDoi;
        doiField.dispatchEvent(new Event('input'));
        
        // Close modal
        elements.modalDoiSelect.classList.remove('active');
        
        // Ask if they want to refresh from the DOI
        if (confirm(`DOI set to: ${selectedDoi}\n\nRefresh all fields from this DOI?`)) {
            await refreshFromDoi();
        } else {
            setStatus(elements.formStatus, `DOI set to ${selectedDoi}`, 'success');
        }
    }

    // ==================== DOI Lookup Functions ====================
    
    async function lookupDoi() {
        let doi = elements.doiInput.value.trim();
        
        // Clean up DOI input (handle full URLs)
        doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
        
        if (!doi) {
            setStatus(elements.doiStatus, 'Please enter a DOI', 'error');
            return;
        }
        
        setStatus(elements.doiStatus, 'Looking up DOI...', 'loading');
        showLoading();
        
        try {
            const useDataCite = shouldUseDataCite(doi);
            const isArxiv = doi.startsWith('10.48550/');
            let work, ssTitle = null;
            
            if (useDataCite) {
                // Use DataCite API for Zenodo and arXiv DOIs
                const response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
                if (!response.ok) {
                    if (response.status === 404) {
                        throw new Error('DOI not found');
                    }
                    throw new Error('Failed to fetch DOI metadata from DataCite');
                }
                const data = await response.json();
                const attrs = data.data.attributes;
                
                // Convert DataCite format to work-like structure
                work = {
                    author: attrs.creators ? attrs.creators.map(parseDataCiteCreator) : null,
                    title: attrs.titles ? [attrs.titles[0]?.title] : null,
                    'container-title': attrs.container ? [attrs.container.title] : null,
                    published: attrs.publicationYear ? { 'date-parts': [[attrs.publicationYear]] } : null,
                    publisher: attrs.publisher
                };
                
                // For arXiv, extract the arXiv ID for the eprint field
                if (isArxiv && attrs.identifiers) {
                    const arxivId = attrs.identifiers.find(id => id.identifierType === 'arXiv');
                    if (arxivId) {
                        work.arxivId = arxivId.identifier;
                    }
                }
            } else {
                // Fetch CrossRef and Semantic Scholar in parallel
                const [crossrefResponse, ssTitleResult] = await Promise.all([
                    fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'BibTeXManager/1.0 (mailto:user@example.com)'
                        }
                    }),
                    fetchSemanticScholarTitle(doi)
                ]);
                ssTitle = ssTitleResult;
                
                if (!crossrefResponse.ok) {
                    if (crossrefResponse.status === 404) {
                        throw new Error('DOI not found');
                    }
                    throw new Error('Failed to fetch DOI metadata');
                }
                
                const data = await crossrefResponse.json();
                work = data.message;
            }
            
            // Determine entry type
            let entryType;
            if (isArxiv) {
                entryType = 'article';
            } else if (useDataCite) {
                entryType = 'misc';
            } else {
                entryType = detectEntryType(work.type, work);
            }
            
            // Parse data into BibTeX fields
            const entry = {
                type: entryType,
                citekey: '',
                fields: {}
            };
            
            // Authors - try authors first, fall back to editors
            if (work.author && work.author.length > 0) {
                entry.fields.author = formatPersonList(work.author);
            } else if (work.editor && work.editor.length > 0) {
                entry.fields.editor = formatPersonList(work.editor);
            }
            
            // Title - pick best between CrossRef and Semantic Scholar
            if (work.title && work.title[0]) {
                entry.fields.title = pickBetterTitle(work.title[0], ssTitle);
            }
            
            // Journal - prefer abbreviated name, with fallback to abbreviation database (for articles only)
            if (entryType === 'article') {
                let journal = null;
                if (work['short-container-title'] && work['short-container-title'][0]) {
                    journal = work['short-container-title'][0];
                } else if (work['container-title'] && work['container-title'][0]) {
                    journal = work['container-title'][0];
                }
                // Look up abbreviation (passes through unchanged if not found)
                if (journal) {
                    entry.fields.journal = lookupJournalAbbreviation(journal);
                }
            }
            
            // Publisher (for books, reports, Zenodo/DataCite sources, but not arXiv)
            if (work.publisher && (entryType === 'book' || entryType === 'incollection' || entryType === 'techreport' || (useDataCite && !isArxiv))) {
                entry.fields.publisher = work.publisher;
            }
            
            // ISBN for books
            if (!useDataCite && work.ISBN && work.ISBN[0] && (entryType === 'book' || entryType === 'incollection')) {
                entry.fields.isbn = work.ISBN[0];
            }
            
            // Edition for books
            if (!useDataCite && work['edition-number'] && (entryType === 'book' || entryType === 'incollection')) {
                entry.fields.edition = work['edition-number'];
            }
            
            // arXiv-specific fields
            if (isArxiv) {
                if (work.arxivId) {
                    entry.fields.eprint = work.arxivId;
                }
                entry.fields.archiveprefix = 'arXiv';
            }
            
            // Year
            if (work.published) {
                const dateParts = work.published['date-parts'];
                if (dateParts && dateParts[0] && dateParts[0][0]) {
                    entry.fields.year = String(dateParts[0][0]);
                }
            } else if (work.issued) {
                const dateParts = work.issued['date-parts'];
                if (dateParts && dateParts[0] && dateParts[0][0]) {
                    entry.fields.year = String(dateParts[0][0]);
                }
            }
            
            // Volume (CrossRef only, for articles)
            if (!useDataCite && work.volume && entryType === 'article') {
                entry.fields.volume = work.volume;
            }
            
            // Issue/Number (CrossRef only, for articles)
            if (!useDataCite && work.issue && entryType === 'article') {
                entry.fields.number = work.issue;
            }
            
            // Pages (CrossRef only)
            if (!useDataCite) {
                if (work.page) {
                    entry.fields.pages = work.page;
                } else if (work['article-number']) {
                    entry.fields.pages = work['article-number'];
                }
            }
            
            // DOI
            entry.fields.doi = doi;
            
            // URL
            if (work.URL) {
                entry.fields.url = work.URL;
            } else if (useDataCite) {
                entry.fields.url = `https://doi.org/${doi}`;
            }
            
            // ISSN (CrossRef only, for articles)
            if (!useDataCite && work.ISSN && work.ISSN[0] && entryType === 'article') {
                entry.fields.issn = work.ISSN[0];
            }
            
            // Generate citekey
            const ckResult = await apiCall('generate_citekey', { fields: entry.fields });
            entry.citekey = ckResult.citekey;
            
            // Show entry form with prefilled data (fromLookup = true)
            hideLoading();
            showEntryForm(entry, true);
            
        } catch (error) {
            setStatus(elements.doiStatus, error.message, 'error');
            hideLoading();
        }
    }

    // ==================== arXiv Lookup Functions ====================
    
    async function lookupArxiv() {
        let arxivId = elements.arxivInput.value.trim();
        
        // Clean up arXiv ID (handle full URLs)
        arxivId = arxivId.replace(/^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\//, '');
        arxivId = arxivId.replace(/\.pdf$/, '');
        arxivId = arxivId.replace(/^arXiv:/i, '');
        
        if (!arxivId) {
            setStatus(elements.arxivStatus, 'Please enter an arXiv ID', 'error');
            return;
        }
        
        setStatus(elements.arxivStatus, 'Looking up arXiv ID...', 'loading');
        showLoading();
        
        try {
            const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch arXiv metadata');
            }
            
            const text = await response.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'application/xml');
            
            const entries = xml.getElementsByTagName('entry');
            if (entries.length === 0) {
                throw new Error('arXiv ID not found');
            }
            
            const arxivEntry = entries[0];
            
            // Check for error
            const idElement = arxivEntry.getElementsByTagName('id')[0];
            if (!idElement || idElement.textContent.includes('Error')) {
                throw new Error('arXiv ID not found');
            }
            
            // Parse arXiv data
            const entry = {
                type: 'misc',
                citekey: '',
                fields: {}
            };
            
            // Authors
            const authors = arxivEntry.getElementsByTagName('author');
            const authorNames = [];
            for (let i = 0; i < authors.length; i++) {
                const name = authors[i].getElementsByTagName('name')[0];
                if (name) {
                    authorNames.push(name.textContent);
                }
            }
            if (authorNames.length > 0) {
                entry.fields.author = authorNames.join(' and ');
            }
            
            // Title
            const title = arxivEntry.getElementsByTagName('title')[0];
            if (title) {
                entry.fields.title = title.textContent.replace(/\s+/g, ' ').trim();
            }
            
            // Year from published date
            const published = arxivEntry.getElementsByTagName('published')[0];
            if (published) {
                const date = new Date(published.textContent);
                entry.fields.year = String(date.getFullYear());
            }
            
            // Abstract
            const summary = arxivEntry.getElementsByTagName('summary')[0];
            if (summary) {
                entry.fields.abstract = summary.textContent.replace(/\s+/g, ' ').trim();
            }
            
            // arXiv specific fields
            entry.fields.eprint = arxivId;
            entry.fields.archiveprefix = 'arXiv';
            entry.fields.howpublished = `arXiv:${arxivId}`;
            
            // Primary category
            const primaryCategory = arxivEntry.getElementsByTagNameNS('http://arxiv.org/schemas/atom', 'primary_category')[0];
            if (primaryCategory) {
                entry.fields.primaryclass = primaryCategory.getAttribute('term');
            }
            
            // URL
            const link = arxivEntry.querySelector('link[title="pdf"]');
            if (link) {
                entry.fields.url = link.getAttribute('href');
            } else {
                entry.fields.url = `https://arxiv.org/abs/${arxivId}`;
            }
            
            // Generate citekey (use first author + year for arXiv)
            if (authorNames.length > 0) {
                const firstName = authorNames[0].split(' ').pop().replace(/[^a-zA-Z]/g, '');
                entry.citekey = firstName.toLowerCase() + (entry.fields.year || '');
            }
            
            // Show entry form with prefilled data (fromLookup = true)
            hideLoading();
            showEntryForm(entry, true);
            
        } catch (error) {
            setStatus(elements.arxivStatus, error.message, 'error');
            hideLoading();
        }
    }

    // ==================== Import Functions ====================
    
    async function handleImportFile(file) {
        setStatus(elements.importStatus, 'Processing file...', 'loading');
        showLoading();
        
        try {
            const formData = new FormData();
            formData.append('action', 'import');
            formData.append('file', file);
            
            const result = await apiCall('import', formData, true);
            
            state.importData = result;
            
            // Update preview
            elements.importNewCount.textContent = result.newCount;
            elements.importDupCount.textContent = result.duplicateCount;
            elements.importConflictCount.textContent = result.conflictCount;
            
            // Show new entries
            if (result.new && result.new.length > 0) {
                elements.newEntriesContainer.innerHTML = result.new.map(entry => `
                    <div class="entry-preview">
                        <label>
                            <input type="checkbox" class="import-entry" data-citekey="${escapeHtml(entry.citekey)}" checked>
                            <span class="citekey">${escapeHtml(entry.citekey)}</span>
                        </label>
                        <br>
                        <small>${escapeHtml(truncate(entry.fields.author, 50))} - ${escapeHtml(truncate(entry.fields.title, 80))} (${escapeHtml(entry.fields.year || '')})</small>
                    </div>
                `).join('');
            } else {
                elements.newEntriesContainer.innerHTML = '<p class="hint">No new entries to import.</p>';
            }
            
            // Show conflicts
            if (result.conflicts && result.conflicts.length > 0) {
                elements.importConflicts.style.display = 'block';
                elements.conflictsContainer.innerHTML = result.conflicts.map(conflict => `
                    <div class="conflict-item" data-citekey="${escapeHtml(conflict.citekey)}">
                        <strong>Citekey: ${escapeHtml(conflict.citekey)}</strong>
                        <div class="conflict-choice">
                            <label>
                                <input type="radio" name="conflict-${escapeHtml(conflict.citekey)}" value="keep" checked>
                                Keep existing
                            </label>
                            <label>
                                <input type="radio" name="conflict-${escapeHtml(conflict.citekey)}" value="replace">
                                Replace with imported
                            </label>
                        </div>
                    </div>
                `).join('');
            } else {
                elements.importConflicts.style.display = 'none';
            }
            
            // Switch to preview
            elements.importUpload.style.display = 'none';
            elements.importPreview.style.display = 'block';
            clearStatus(elements.importStatus);
            
        } catch (error) {
            setStatus(elements.importStatus, error.message, 'error');
        } finally {
            hideLoading();
        }
    }

    async function confirmImport() {
        if (!state.importData) return;
        
        showLoading();
        
        try {
            // Gather selected new entries
            const selectedEntries = [];
            const checkboxes = elements.newEntriesContainer.querySelectorAll('.import-entry:checked');
            
            checkboxes.forEach(cb => {
                const citekey = cb.dataset.citekey;
                const entry = state.importData.new.find(e => e.citekey === citekey);
                if (entry) {
                    selectedEntries.push(entry);
                }
            });
            
            // Handle conflict resolutions - replace entries
            if (state.importData.conflicts) {
                state.importData.conflicts.forEach(conflict => {
                    const radio = document.querySelector(`input[name="conflict-${conflict.citekey}"]:checked`);
                    if (radio && radio.value === 'replace') {
                        selectedEntries.push(conflict.imported);
                    }
                });
            }
            
            if (selectedEntries.length === 0) {
                alert('No entries selected for import.');
                hideLoading();
                return;
            }
            
            await apiCall('import_confirm', { entries: selectedEntries });
            
            // Reset import state
            state.importData = null;
            elements.importFile.value = '';
            elements.importUpload.style.display = 'block';
            elements.importPreview.style.display = 'none';
            
            await loadEntries();
            showView('view-list');
            
        } catch (error) {
            if (error.message !== 'Session locked') {
                alert('Import failed: ' + error.message);
            }
        } finally {
            hideLoading();
        }
    }

    // ==================== Delete Functions ====================
    
    let pendingDeleteCitekey = null;

    function showDeleteModal(citekey) {
        pendingDeleteCitekey = citekey;
        elements.deleteCitekey.textContent = citekey;
        elements.modalDelete.classList.add('active');
    }

    function hideDeleteModal() {
        pendingDeleteCitekey = null;
        elements.modalDelete.classList.remove('active');
    }

    async function confirmDelete() {
        if (!pendingDeleteCitekey) return;
        
        const citekeyToDelete = pendingDeleteCitekey;
        hideDeleteModal();
        showLoading();
        
        try {
            await apiCall('delete', { citekey: citekeyToDelete });
            state.editingCitekey = null;
        } catch (error) {
            hideLoading();
            if (error.message !== 'Session locked') {
                alert('Delete failed: ' + error.message);
            }
            return;
        }
        
        try {
            await loadEntries();
            showView('view-list');
        } finally {
            hideLoading();
        }
    }

    // ==================== Session Lock Functions ====================
    
    function showLockedModal(minutesRemaining) {
        elements.lockedMinutes.textContent = minutesRemaining || '30';
        elements.modalLocked.classList.add('active');
        hideLoading();
    }
    
    function hideLockedModal() {
        elements.modalLocked.classList.remove('active');
    }
    
    async function releaseSessionLock() {
        try {
            const response = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ 
                    action: 'release_session', 
                    session_id: state.sessionId 
                })
            });
            return response.ok;
        } catch {
            return false;
        }
    }
    
    async function checkAndAcquireSession() {
        try {
            const response = await fetch('api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ 
                    action: 'check_session', 
                    session_id: state.sessionId 
                })
            });
            const result = await response.json();
            if (result.locked) {
                showLockedModal(result.minutes_remaining);
                return false;
            }
            return true;
        } catch {
            return true; // Allow access on error
        }
    }

    // ==================== Event Listeners ====================
    
    function initEventListeners() {
        // Navigation
        elements.btnAddDoi.addEventListener('click', () => {
            elements.doiInput.value = '';
            clearStatus(elements.doiStatus);
            showView('view-doi');
        });
        
        elements.btnAddArxiv.addEventListener('click', () => {
            elements.arxivInput.value = '';
            clearStatus(elements.arxivStatus);
            showView('view-arxiv');
        });
        
        elements.btnAddManual.addEventListener('click', () => {
            showEntryForm();
        });
        
        if (elements.btnDownload) {
            elements.btnDownload.addEventListener('click', () => {
                // Use hidden iframe to trigger download with existing auth
                let iframe = document.getElementById('download-iframe');
                if (!iframe) {
                    iframe = document.createElement('iframe');
                    iframe.id = 'download-iframe';
                    iframe.style.display = 'none';
                    document.body.appendChild(iframe);
                }
                iframe.src = 'api.php?action=download';
            });
        }
        
        // Tools dropdown
        elements.btnTools.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.toolsMenu.classList.toggle('show');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!elements.toolsMenu.contains(e.target) && e.target !== elements.btnTools) {
                elements.toolsMenu.classList.remove('show');
            }
        });
        
        elements.btnImport.addEventListener('click', () => {
            elements.toolsMenu.classList.remove('show');
            elements.importFile.value = '';
            elements.importUpload.style.display = 'block';
            elements.importPreview.style.display = 'none';
            clearStatus(elements.importStatus);
            state.importData = null;
            showView('view-import');
        });
        
        elements.btnCleanTitles.addEventListener('click', async () => {
            elements.toolsMenu.classList.remove('show');
            
            // Filter to entries that have titles
            const entriesWithTitles = state.entries.filter(e => e.fields.title);
            
            if (entriesWithTitles.length === 0) {
                alert('No entries with titles found.');
                return;
            }
            
            if (!confirm(`This will apply title formatting rules to ${entriesWithTitles.length} entries (wrap acronyms, formulas, etc. in braces for LaTeX). Continue?`)) {
                return;
            }
            
            showLoading();
            
            // Show progress bar
            const progressContainer = document.getElementById('progress-container');
            const progressText = document.getElementById('progress-text');
            const progressFill = document.getElementById('progress-fill');
            const btnStop = document.getElementById('btn-stop-operation');
            progressContainer.style.display = 'block';
            progressFill.style.width = '0%';
            
            // Abort flag
            let aborted = false;
            const abortHandler = () => { aborted = true; };
            btnStop.addEventListener('click', abortHandler);
            
            const total = entriesWithTitles.length;
            let cleaned = 0;
            let processed = 0;
            
            try {
                for (const entry of entriesWithTitles) {
                    if (aborted) {
                        break;
                    }
                    
                    // Update progress
                    progressText.textContent = `${processed + 1} / ${total}: ${entry.citekey}`;
                    
                    // Yield to browser periodically to update UI and allow Stop button to work
                    if (processed % 50 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                    
                    // Clean title client-side using htmlToLatex
                    const originalTitle = entry.fields.title;
                    const cleanedTitle = htmlToLatex(originalTitle);
                    
                    // Only save if title actually changed
                    if (cleanedTitle !== originalTitle) {
                        try {
                            const updatedEntry = {
                                type: entry.type,
                                citekey: entry.citekey,
                                fields: { ...entry.fields, title: cleanedTitle }
                            };
                            
                            await apiCall('save', {
                                entry: updatedEntry,
                                originalCitekey: entry.citekey,
                                cleanTitle: false  // Already cleaned
                            });
                            
                            // Update local state
                            entry.fields.title = cleanedTitle;
                            cleaned++;
                        } catch (error) {
                            console.error(`Failed to save cleaned title for ${entry.citekey}:`, error);
                        }
                    }
                    
                    processed++;
                    progressFill.style.width = `${(processed / total) * 100}%`;
                }
                
                if (aborted) {
                    alert(`Stopped. Cleaned ${cleaned} of ${processed} titles processed (${total - processed} skipped).`);
                } else {
                    alert(`Cleaned ${cleaned} of ${total} titles.`);
                }
                
                // Refresh display
                filterAndSortEntries();
                renderEntries();
                
            } catch (error) {
                if (error.message !== 'Session locked') {
                    alert('Failed to clean titles: ' + error.message);
                }
            } finally {
                btnStop.removeEventListener('click', abortHandler);
                progressContainer.style.display = 'none';
                hideLoading();
            }
        });
        
        elements.btnRefreshAllDois.addEventListener('click', async () => {
            elements.toolsMenu.classList.remove('show');
            // Find entries with DOIs
            const entriesWithDoi = state.entries.filter(e => e.fields.doi);
            
            if (entriesWithDoi.length === 0) {
                alert('No entries with DOIs found.');
                return;
            }
            
            if (!confirm(`This will refresh ${entriesWithDoi.length} entries from CrossRef (updating journal names, authors, etc.). Citekeys will be preserved. Continue?`)) {
                return;
            }
            
            showLoading();
            
            // Show progress bar
            const progressContainer = document.getElementById('progress-container');
            const progressText = document.getElementById('progress-text');
            const progressFill = document.getElementById('progress-fill');
            const btnStop = document.getElementById('btn-stop-operation');
            progressContainer.style.display = 'block';
            progressFill.style.width = '0%';
            
            // Abort flag
            let aborted = false;
            const abortHandler = () => { aborted = true; };
            btnStop.addEventListener('click', abortHandler);
            
            const total = entriesWithDoi.length;
            let updated = 0;
            let failed = 0;
            let corruptDois = [];
            let processed = 0;
            
            for (const entry of entriesWithDoi) {
                // Check if user clicked Stop
                if (aborted) {
                    break;
                }
                
                // Update progress
                progressText.textContent = `${processed + 1} / ${total}: ${entry.citekey}`;
                
                try {
                    let doi = entry.fields.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
                    
                    // Clean up malformed DOIs
                    // Remove curly braces (sometimes DOIs are wrapped in {})
                    doi = doi.replace(/[{}]/g, '');
                    // Remove internal whitespace
                    doi = doi.replace(/\s+/g, '');
                    
                    // Find all valid DOI prefixes (10.XXXX/) and use the last one
                    // This handles concatenated DOIs like "10.1002/aenm.v12.1810.1002/aenm.202200427"
                    const doiPrefixPattern = /10\.\d{4,}\//g;
                    const matches = [...doi.matchAll(doiPrefixPattern)];
                    if (matches.length > 1) {
                        // Use the last valid DOI prefix
                        const lastMatch = matches[matches.length - 1];
                        doi = doi.substring(lastMatch.index);
                        console.log(`Cleaned concatenated DOI for ${entry.citekey}: ${doi}`);
                    }
                    
                    // Validate DOI format: must be 10.XXXX/something (at least 4 digits after 10., then slash)
                    if (!/^10\.\d{4,}\//.test(doi)) {
                        console.warn(`Corrupt DOI for ${entry.citekey}: ${doi}`);
                        corruptDois.push({ citekey: entry.citekey, doi: doi });
                        processed++;
                        progressFill.style.width = `${(processed / total) * 100}%`;
                        continue;
                    }
                    
                    let work = null;
                    const useDataCite = shouldUseDataCite(doi);
                    const isArxiv = doi.startsWith('10.48550/');
                    let ssTitle = null;
                    
                    if (useDataCite) {
                        // Use DataCite API for Zenodo and arXiv DOIs
                        const response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
                        
                        if (!response.ok) {
                            console.error(`DataCite failed for ${entry.citekey}: HTTP ${response.status}`);
                            failed++;
                            processed++;
                            progressFill.style.width = `${(processed / total) * 100}%`;
                            continue;
                        }
                        
                        const data = await response.json();
                        const attrs = data.data.attributes;
                        
                        // Convert DataCite format to work-like structure
                        work = {
                            author: attrs.creators ? attrs.creators.map(parseDataCiteCreator) : null,
                            title: attrs.titles ? [attrs.titles[0]?.title] : null,
                            'container-title': attrs.container ? [attrs.container.title] : null,
                            published: attrs.publicationYear ? { 'date-parts': [[attrs.publicationYear]] } : null,
                            publisher: attrs.publisher
                        };
                        
                        // For arXiv, extract the arXiv ID for the eprint field
                        if (isArxiv && attrs.identifiers) {
                            const arxivId = attrs.identifiers.find(id => id.identifierType === 'arXiv');
                            if (arxivId) {
                                work.arxivId = arxivId.identifier;
                            }
                        }
                    } else {
                        // Use CrossRef API and Semantic Scholar in parallel
                        const [crossrefResponse, ssTitleResult] = await Promise.all([
                            fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
                            fetchSemanticScholarTitle(doi)
                        ]);
                        ssTitle = ssTitleResult;
                        
                        if (!crossrefResponse.ok) {
                            console.error(`CrossRef failed for ${entry.citekey}: HTTP ${crossrefResponse.status}`);
                            failed++;
                            processed++;
                            progressFill.style.width = `${(processed / total) * 100}%`;
                            continue;
                        }
                        
                        const data = await crossrefResponse.json();
                        work = data.message;
                    }
                    
                    // Keep original citekey
                    const originalCitekey = entry.citekey;
                    
                    // Build updated fields
                    const fields = { ...entry.fields };
                    
                    // Authors
                    if (work.author) {
                        fields.author = work.author.map(a => {
                            if (a.family && a.given) {
                                return `${a.family}, ${a.given}`;
                            }
                            return a.name || a.family || '';
                        }).filter(Boolean).join(' and ');
                    }
                    
                    // Title (convert HTML to LaTeX, pick best between CrossRef and Semantic Scholar)
                    if (work.title && work.title[0]) {
                        fields.title = htmlToLatex(pickBetterTitle(work.title[0], ssTitle));
                    }
                    
                    // Journal - prefer abbreviated, with fallback to abbreviation database (only for CrossRef)
                    if (!useDataCite) {
                        let journal = null;
                        if (work['short-container-title'] && work['short-container-title'][0]) {
                            journal = work['short-container-title'][0];
                        } else if (work['container-title'] && work['container-title'][0]) {
                            journal = work['container-title'][0];
                        }
                        // Look up abbreviation (passes through unchanged if not found)
                        if (journal) {
                            fields.journal = lookupJournalAbbreviation(journal);
                        }
                    }
                    
                    // Year
                    if (work.published) {
                        const dateParts = work.published['date-parts'];
                        if (dateParts && dateParts[0] && dateParts[0][0]) {
                            fields.year = String(dateParts[0][0]);
                        }
                    } else if (work.issued) {
                        const dateParts = work.issued['date-parts'];
                        if (dateParts && dateParts[0] && dateParts[0][0]) {
                            fields.year = String(dateParts[0][0]);
                        }
                    }
                    
                    // Volume (CrossRef only)
                    if (!useDataCite && work.volume) {
                        fields.volume = work.volume;
                    }
                    
                    // Issue/Number (CrossRef only)
                    if (!useDataCite && work.issue) {
                        fields.number = work.issue;
                    }
                    
                    // Pages (CrossRef only)
                    if (!useDataCite) {
                        if (work.page) {
                            fields.pages = work.page;
                        } else if (work['article-number']) {
                            fields.pages = work['article-number'];
                        }
                    }
                    
                    // DOI
                    fields.doi = doi;
                    
                    // ISSN (CrossRef only)
                    if (!useDataCite && work.ISSN && work.ISSN[0]) {
                        fields.issn = work.ISSN[0];
                    }
                    
                    // Publisher (useful for Zenodo, but not arXiv)
                    if (useDataCite && !isArxiv && work.publisher) {
                        fields.publisher = work.publisher;
                    }
                    
                    // arXiv-specific fields
                    if (isArxiv) {
                        if (work.arxivId) {
                            fields.eprint = work.arxivId;
                        }
                        fields.archiveprefix = 'arXiv';
                    }
                    
                    // Save the updated entry
                    await apiCall('save', {
                        entry: {
                            citekey: originalCitekey,
                            type: isArxiv ? 'article' : (useDataCite ? 'misc' : entry.type),
                            fields: fields
                        },
                        originalCitekey: originalCitekey,
                        cleanTitle: true
                    });
                    
                    updated++;
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`Failed to refresh ${entry.citekey}:`, error.message || error);
                    failed++;
                }
                
                // Update progress bar
                processed++;
                progressFill.style.width = `${(processed / total) * 100}%`;
            }
            
            // Hide progress bar
            btnStop.removeEventListener('click', abortHandler);
            progressContainer.style.display = 'none';
            hideLoading();
            await loadEntries();
            
            let message = `Refreshed ${updated} entries.`;
            if (failed > 0) message += ` Failed: ${failed}.`;
            if (corruptDois.length > 0) {
                message += `\n\nWarning: ${corruptDois.length} entries have invalid DOIs:\n`;
                message += corruptDois.slice(0, 10).map(c => `  ${c.citekey}: ${c.doi}`).join('\n');
                if (corruptDois.length > 10) message += `\n  ...and ${corruptDois.length - 10} more`;
            }
            if (aborted) message += `\n\nStopped by user (${total - processed} remaining).`;
            alert(message);
        });
        
        // Validate entries
        elements.btnValidate.addEventListener('click', async () => {
            elements.toolsMenu.classList.remove('show');
            
            // Reload entries first to ensure we have fresh data
            await loadEntries();
            
            const issues = [];
            const seenDois = new Map(); // doi -> citekey
            
            for (const entry of state.entries) {
                const citekey = entry.citekey;
                const fields = entry.fields || {};
                const entryIssues = [];
                
                // Check for missing or empty entry type
                if (!entry.type || entry.type.trim() === '') {
                    entryIssues.push('Missing entry type (e.g., @article, @book)');
                }
                
                // Check for duplicated author names (like "Name, Name")
                if (fields.author) {
                    const authors = fields.author.split(/\s+and\s+/i);
                    for (const author of authors) {
                        // Pattern: "Word Word, Word" where first and last words match
                        const parts = author.split(',').map(p => p.trim());
                        if (parts.length >= 2) {
                            const lastNamePart = parts[0].split(/\s+/);
                            const firstNamePart = parts[1].split(/\s+/);
                            // Check if any word in last name matches any word in first name (case-insensitive)
                            for (const lastName of lastNamePart) {
                                for (const firstName of firstNamePart) {
                                    if (lastName.toLowerCase() === firstName.toLowerCase() && lastName.length > 2) {
                                        entryIssues.push(`Duplicated author name: "${author}"`);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Check for year mismatch with citekey
                // Match year at the END of citekey (last 4 digits, possibly followed by letter suffix)
                // Skip for arxiv/zenodo entries which use different citekey patterns
                if (fields.year && !citekey.startsWith('arxiv_') && !citekey.startsWith('zenodo_')) {
                    const yearMatch = citekey.match(/(\d{4})[a-z]?$/);
                    if (yearMatch && yearMatch[1] !== fields.year) {
                        entryIssues.push(`Year mismatch: citekey has ${yearMatch[1]} but year field is ${fields.year}`);
                    }
                }
                
                // Check for missing required fields
                if (!fields.author && !fields.editor) {
                    entryIssues.push('Missing author/editor');
                }
                if (!fields.title) {
                    entryIssues.push('Missing title');
                }
                if (!fields.year) {
                    entryIssues.push('Missing year');
                }
                
                // Check for malformed DOI
                if (fields.doi) {
                    const doi = fields.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
                    if (!/^10\.\d{4,}\//.test(doi)) {
                        entryIssues.push(`Malformed DOI: ${fields.doi}`);
                    }
                    
                    // Check for duplicate DOI
                    const normalizedDoi = doi.toLowerCase();
                    if (seenDois.has(normalizedDoi)) {
                        entryIssues.push(`Duplicate DOI (also in ${seenDois.get(normalizedDoi)})`);
                    } else {
                        seenDois.set(normalizedDoi, citekey);
                    }
                }
                
                if (entryIssues.length > 0) {
                    issues.push({ 
                        citekey, 
                        issues: entryIssues, 
                        hasDoi: !!fields.doi, 
                        doi: fields.doi,
                        title: fields.title || '',
                        author: fields.author || '',
                        year: fields.year || '',
                        journal: fields.journal || '',
                        volume: fields.volume || '',
                        pages: fields.pages || ''
                    });
                }
            }
            
            // Build results HTML
            let html;
            if (issues.length === 0) {
                html = '<p class="success">No issues found in ' + state.entries.length + ' entries.</p>';
            } else {
                html = '<p class="warning">Found issues in ' + issues.length + ' of ' + state.entries.length + ' entries:</p>';
                html += '<div class="validate-issues">';
                for (const item of issues) {
                    html += '<div class="validate-entry" data-citekey="' + escapeHtml(item.citekey) + '">';
                    html += '<div class="validate-entry-header">';
                    html += '<strong>' + escapeHtml(item.citekey) + '</strong>';
                    if (item.hasDoi) {
                        html += ' <button class="btn btn-small btn-fix-doi" data-doi="' + escapeHtml(item.doi) + '">Fix from DOI</button>';
                    } else if (item.title || (item.journal && item.volume && item.pages)) {
                        // No DOI but has title OR bibliographic info (journal/volume/pages) - offer to find DOI
                        html += ' <button class="btn btn-small btn-find-doi" data-title="' + escapeHtml(item.title) + '" data-author="' + escapeHtml(item.author) + '" data-year="' + escapeHtml(item.year) + '" data-journal="' + escapeHtml(item.journal) + '" data-volume="' + escapeHtml(item.volume) + '" data-pages="' + escapeHtml(item.pages) + '">Find DOI</button>';
                    }
                    html += '</div>';
                    html += '<ul>';
                    for (const issue of item.issues) {
                        html += '<li>' + escapeHtml(issue) + '</li>';
                    }
                    html += '</ul>';
                    html += '<div class="doi-search-results" style="display:none;"></div>';
                    html += '</div>';
                }
                html += '</div>';
            }
            
            elements.validateResults.innerHTML = html;
            elements.modalValidate.classList.add('active');
            
            // Add click handlers for Fix from DOI buttons
            elements.validateResults.querySelectorAll('.btn-fix-doi').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const doi = e.target.dataset.doi;
                    const entryDiv = e.target.closest('.validate-entry');
                    
                    e.target.disabled = true;
                    e.target.textContent = 'Fixing...';
                    
                    try {
                        // Clean up DOI
                        let cleanDoi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
                        cleanDoi = cleanDoi.replace(/[{}]/g, '').replace(/\s+/g, '');
                        const normalizedDoi = cleanDoi.toLowerCase();
                        
                        // Find ALL entries with this DOI (for duplicate handling)
                        const entriesWithDoi = state.entries.filter(ent => {
                            const entDoi = (ent.fields.doi || '').toLowerCase()
                                .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
                                .replace(/[{}]/g, '')
                                .trim();
                            return entDoi === normalizedDoi;
                        });
                        
                        // Delete all entries with this DOI
                        for (const ent of entriesWithDoi) {
                            await apiCall('delete', { citekey: ent.citekey });
                            const idx = state.entries.findIndex(e => e.citekey === ent.citekey);
                            if (idx !== -1) {
                                state.entries.splice(idx, 1);
                            }
                        }
                        
                        // Fetch fresh metadata from DOI via backend
                        const lookupResult = await apiCall('lookup_doi', { doi: cleanDoi });
                        const work = lookupResult.work;
                        const useDataCite = lookupResult.useDataCite;
                        const isArxiv = lookupResult.isArxiv;
                        
                        // Determine entry type
                        let entryType;
                        if (isArxiv) {
                            entryType = 'article';
                        } else if (useDataCite) {
                            entryType = 'misc';
                        } else {
                            entryType = detectEntryType(work.type, work);
                        }
                        
                        // Build fresh entry from DOI metadata
                        const fields = {};
                        
                        // Authors - try authors first, fall back to editors
                        if (work.author && work.author.length > 0) {
                            fields.author = formatPersonList(work.author);
                        } else if (work.editor && work.editor.length > 0) {
                            // No authors, use editors (common for edited books)
                            fields.editor = formatPersonList(work.editor);
                        }
                        
                        if (work.title) {
                            fields.title = htmlToLatex(work.title);
                        }
                        
                        // Journal (for articles only)
                        if (entryType === 'article') {
                            let journal = work['short-container-title'] || work['container-title'];
                            if (journal) {
                                fields.journal = lookupJournalAbbreviation(journal);
                            }
                        }
                        
                        // Year
                        if (work.year) {
                            fields.year = String(work.year);
                        }
                        
                        // Volume, number, pages (for articles)
                        if (entryType === 'article') {
                            if (work.volume) fields.volume = work.volume;
                            if (work.issue) fields.number = work.issue;
                            if (work.page) {
                                fields.pages = work.page;
                            } else if (work['article-number']) {
                                fields.pages = work['article-number'];
                            }
                        }
                        
                        // DOI
                        fields.doi = cleanDoi;
                        
                        // arXiv-specific
                        if (isArxiv) {
                            if (work.arxivId) fields.eprint = work.arxivId;
                            fields.archiveprefix = 'arXiv';
                        }
                        
                        // Publisher (for books, reports, DataCite but not arXiv)
                        if (work.publisher && (entryType === 'book' || entryType === 'incollection' || entryType === 'techreport' || (useDataCite && !isArxiv))) {
                            fields.publisher = work.publisher;
                        }
                        
                        // ISBN for books
                        if (work.ISBN && (entryType === 'book' || entryType === 'incollection')) {
                            fields.isbn = work.ISBN;
                        }
                        
                        // Edition for books
                        if (work.edition && (entryType === 'book' || entryType === 'incollection')) {
                            fields.edition = work.edition;
                        }
                        
                        // Generate citekey
                        const ckResult = await apiCall('generate_citekey', { fields });
                        const newCitekey = ckResult.citekey;
                        
                        // Save the fresh entry
                        await apiCall('save', {
                            entry: { type: entryType, citekey: newCitekey, fields: fields },
                            cleanTitle: true
                        });
                        
                        // Add to local state
                        state.entries.push({ type: entryType, citekey: newCitekey, fields: fields });
                        
                        // Mark as fixed
                        entryDiv.classList.add('fixed');
                        const deletedCount = entriesWithDoi.length;
                        e.target.textContent = deletedCount > 1 
                            ? `Regenerated as ${newCitekey} (deleted ${deletedCount} duplicates)`
                            : `Fixed → ${newCitekey}`;
                        e.target.classList.add('btn-success');
                        
                    } catch (error) {
                        e.target.textContent = 'Failed';
                        e.target.classList.add('btn-danger');
                        console.error('Fix from DOI failed:', error);
                    }
                });
            });
            
            // Add click handlers for Find DOI buttons
            elements.validateResults.querySelectorAll('.btn-find-doi').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const title = e.target.dataset.title;
                    const author = e.target.dataset.author;
                    const year = e.target.dataset.year;
                    const journal = e.target.dataset.journal;
                    const volume = e.target.dataset.volume;
                    const pages = e.target.dataset.pages;
                    const entryDiv = e.target.closest('.validate-entry');
                    const citekey = entryDiv.dataset.citekey;
                    const resultsDiv = entryDiv.querySelector('.doi-search-results');
                    
                    e.target.disabled = true;
                    e.target.textContent = 'Searching...';
                    
                    try {
                        // Build search query
                        let query = '';
                        
                        // Extract author last names for search
                        function getAuthorLastNames(authorStr) {
                            if (!authorStr) return [];
                            return authorStr.split(' and ').map(a => {
                                const parts = a.split(',');
                                return parts[0].trim().replace(/[{}]/g, '');
                            }).filter(n => n);
                        }
                        
                        if (title) {
                            // Use title as primary search term
                            query = title;
                            if (author) {
                                // Add first author's last name
                                const lastNames = getAuthorLastNames(author);
                                if (lastNames.length > 0) {
                                    query += ' ' + lastNames[0];
                                }
                            }
                        } else if (journal && volume && pages) {
                            // No title - use bibliographic info
                            // Extract first page number from pages range
                            let firstPage = pages;
                            if (pages.includes('-') || pages.includes('–')) {
                                firstPage = pages.split(/[-–]/)[0].trim();
                            }
                            query = `${journal} ${volume} ${firstPage}`;
                            
                            // Add author names - crucial for disambiguating
                            const lastNames = getAuthorLastNames(author);
                            if (lastNames.length > 0) {
                                query += ' ' + lastNames[0];
                                if (lastNames.length > 1) {
                                    query += ' ' + lastNames[lastNames.length - 1];
                                }
                            }
                            
                            if (year) {
                                query += ` ${year}`;
                            }
                        }
                        
                        if (!query) {
                            e.target.textContent = 'No search data';
                            e.target.classList.add('btn-danger');
                            return;
                        }
                        
                        // Search via backend API (avoids CORS issues)
                        const data = await apiCall('search_doi', { query });
                        let items = data.results || [];
                        
                        if (items.length === 0) {
                            e.target.textContent = 'No results';
                            e.target.classList.add('btn-danger');
                            return;
                        }
                        
                        // Filter/rank results by year match if we have a year
                        if (year) {
                            const yearNum = parseInt(year, 10);
                            // Sort: exact year match first, then close years, then others
                            items.sort((a, b) => {
                                const aYear = parseInt(a.year, 10) || 0;
                                const bYear = parseInt(b.year, 10) || 0;
                                const aDiff = Math.abs(aYear - yearNum);
                                const bDiff = Math.abs(bYear - yearNum);
                                return aDiff - bDiff;
                            });
                            // Filter out items with year mismatch > 2 years (likely wrong results)
                            const filtered = items.filter(item => {
                                const itemYear = parseInt(item.year, 10);
                                return !itemYear || Math.abs(itemYear - yearNum) <= 2;
                            });
                            if (filtered.length > 0) {
                                items = filtered;
                            }
                        }
                        
                        // Show existing entry metadata for comparison
                        let resultsHtml = '<div class="doi-results-list">';
                        resultsHtml += '<div class="existing-entry-info">';
                        resultsHtml += '<p><strong>Existing entry:</strong></p>';
                        if (title) {
                            resultsHtml += `<div class="existing-title">${escapeHtml(title)}</div>`;
                        } else {
                            resultsHtml += `<div class="existing-title">(No title)</div>`;
                        }
                        let metaParts = [];
                        if (author) metaParts.push(escapeHtml(author));
                        if (year) metaParts.push('(' + year + ')');
                        if (journal) metaParts.push(escapeHtml(journal));
                        if (volume) metaParts.push('vol. ' + escapeHtml(volume));
                        if (pages) metaParts.push('pp. ' + escapeHtml(pages));
                        resultsHtml += `<div class="existing-meta">${metaParts.join(' ')}</div>`;
                        resultsHtml += '</div>';
                        resultsHtml += '<p><strong>Select matching DOI:</strong></p>';
                        
                        for (const item of items) {
                            const yearMatch = year && item.year && item.year.toString() === year;
                            const volumeMatch = volume && item.volume && item.volume.toString() === volume;
                            const pageMatch = pages && item.page && item.page.startsWith(pages.split(/[-–]/)[0]);
                            const matchClass = (yearMatch || volumeMatch || pageMatch) ? ' year-match' : '';
                            resultsHtml += `<div class="doi-result-item${matchClass}" data-doi="${escapeHtml(item.doi)}">`;
                            resultsHtml += `<div class="doi-result-title">${escapeHtml(item.title)}</div>`;
                            let resultMeta = escapeHtml(item.authors);
                            if (item.year) resultMeta += ' (' + item.year + ')';
                            if (item.journal) resultMeta += ' — ' + escapeHtml(item.journal);
                            if (item.volume) resultMeta += ' vol. ' + escapeHtml(item.volume);
                            if (item.page) resultMeta += ', pp. ' + escapeHtml(item.page);
                            resultsHtml += `<div class="doi-result-meta">${resultMeta}</div>`;
                            resultsHtml += `<div class="doi-result-doi">${escapeHtml(item.doi)}</div>`;
                            resultsHtml += '</div>';
                        }
                        resultsHtml += '<button class="btn btn-small btn-cancel-search">Cancel</button></div>';
                        
                        resultsDiv.innerHTML = resultsHtml;
                        resultsDiv.style.display = 'block';
                        e.target.style.display = 'none';
                        
                        // Add click handlers for results
                        resultsDiv.querySelectorAll('.doi-result-item').forEach(item => {
                            item.addEventListener('click', async () => {
                                const selectedDoi = item.dataset.doi;
                                resultsDiv.innerHTML = '<p>Fixing with DOI: ' + escapeHtml(selectedDoi) + '...</p>';
                                
                                try {
                                    // Delete the old entry
                                    await apiCall('delete', { citekey: citekey });
                                    const idx = state.entries.findIndex(ent => ent.citekey === citekey);
                                    if (idx !== -1) {
                                        state.entries.splice(idx, 1);
                                    }
                                    
                                    // Fetch metadata from selected DOI via backend
                                    const lookupResult = await apiCall('lookup_doi', { doi: selectedDoi });
                                    const work = lookupResult.work;
                                    const useDataCite = lookupResult.useDataCite;
                                    const isArxiv = lookupResult.isArxiv;
                                    
                                    // Determine entry type
                                    let entryType;
                                    if (isArxiv) {
                                        entryType = 'article';
                                    } else if (useDataCite) {
                                        entryType = 'misc';
                                    } else {
                                        entryType = detectEntryType(work.type, work);
                                    }
                                    
                                    // Build entry from metadata
                                    const fields = {};
                                    
                                    // Authors - try authors first, fall back to editors
                                    if (work.author && work.author.length > 0) {
                                        fields.author = formatPersonList(work.author);
                                    } else if (work.editor && work.editor.length > 0) {
                                        fields.editor = formatPersonList(work.editor);
                                    }
                                    
                                    if (work.title) {
                                        fields.title = htmlToLatex(work.title);
                                    }
                                    
                                    // Journal (for articles only)
                                    if (entryType === 'article') {
                                        let journal = work['short-container-title'] || work['container-title'];
                                        if (journal) {
                                            fields.journal = lookupJournalAbbreviation(journal);
                                        }
                                    }
                                    
                                    if (work.year) {
                                        fields.year = String(work.year);
                                    }
                                    
                                    // Volume, number, pages (for articles)
                                    if (entryType === 'article') {
                                        if (work.volume) fields.volume = work.volume;
                                        if (work.issue) fields.number = work.issue;
                                        if (work.page) {
                                            fields.pages = work.page;
                                        } else if (work['article-number']) {
                                            fields.pages = work['article-number'];
                                        }
                                    }
                                    
                                    fields.doi = selectedDoi;
                                    
                                    if (isArxiv) {
                                        if (work.arxivId) fields.eprint = work.arxivId;
                                        fields.archiveprefix = 'arXiv';
                                    }
                                    
                                    // Publisher (for books, reports, DataCite but not arXiv)
                                    if (work.publisher && (entryType === 'book' || entryType === 'incollection' || entryType === 'techreport' || (useDataCite && !isArxiv))) {
                                        fields.publisher = work.publisher;
                                    }
                                    
                                    // ISBN for books
                                    if (work.ISBN && (entryType === 'book' || entryType === 'incollection')) {
                                        fields.isbn = work.ISBN;
                                    }
                                    
                                    // Edition for books
                                    if (work.edition && (entryType === 'book' || entryType === 'incollection')) {
                                        fields.edition = work.edition;
                                    }
                                    
                                    // Generate citekey
                                    const ckResult = await apiCall('generate_citekey', { fields });
                                    const newCitekey = ckResult.citekey;
                                    
                                    // Save
                                    await apiCall('save', {
                                        entry: { type: entryType, citekey: newCitekey, fields: fields },
                                        cleanTitle: true
                                    });
                                    
                                    state.entries.push({ type: entryType, citekey: newCitekey, fields: fields });
                                    
                                    // Mark as fixed
                                    entryDiv.classList.add('fixed');
                                    resultsDiv.innerHTML = `<p class="success">Fixed → ${escapeHtml(newCitekey)}</p>`;
                                    
                                } catch (err) {
                                    resultsDiv.innerHTML = `<p class="error">Failed: ${escapeHtml(err.message)}</p>`;
                                    console.error('Find DOI fix failed:', err);
                                }
                            });
                        });
                        
                        // Cancel button
                        resultsDiv.querySelector('.btn-cancel-search').addEventListener('click', () => {
                            resultsDiv.style.display = 'none';
                            e.target.style.display = '';
                            e.target.disabled = false;
                            e.target.textContent = 'Find DOI';
                        });
                        
                    } catch (error) {
                        e.target.textContent = 'Search failed';
                        e.target.classList.add('btn-danger');
                        console.error('Find DOI search failed:', error);
                    }
                });
            });
        });
        
        elements.btnValidateClose.addEventListener('click', async () => {
            elements.modalValidate.classList.remove('active');
            // Reload entries if any fixes were made
            if (elements.validateResults.querySelector('.fixed')) {
                await loadEntries();
            }
        });
        
        elements.btnDoiSelectCancel.addEventListener('click', () => {
            elements.modalDoiSelect.classList.remove('active');
            setStatus(elements.formStatus, 'Search cancelled', 'info');
        });
        
        // Close DOI select modal when clicking overlay
        elements.modalDoiSelect.addEventListener('click', (e) => {
            if (e.target === elements.modalDoiSelect) {
                elements.modalDoiSelect.classList.remove('active');
                setStatus(elements.formStatus, 'Search cancelled', 'info');
            }
        });
        
        // Search and filter
        let searchTimeout;
        elements.searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                state.searchQuery = elements.searchInput.value;
                filterAndSortEntries();
                renderEntries();
            }, 300);
        });
        
        elements.filterType.addEventListener('change', () => {
            state.filterType = elements.filterType.value;
            filterAndSortEntries();
            renderEntries();
        });
        
        // Sorting
        elements.entriesTable.querySelector('thead').addEventListener('click', (e) => {
            const th = e.target.closest('th.sortable');
            if (!th) return;
            
            const field = th.dataset.sort;
            if (state.sortField === field) {
                state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortField = field;
                state.sortDirection = 'asc';
            }
            
            filterAndSortEntries();
            renderEntries();
        });
        
        // Pagination
        elements.btnPrev.addEventListener('click', () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                renderEntries();
            }
        });
        
        elements.btnNext.addEventListener('click', () => {
            const totalPages = Math.ceil(state.filteredEntries.length / state.entriesPerPage);
            if (state.currentPage < totalPages) {
                state.currentPage++;
                renderEntries();
            }
        });
        
        // Entry click to edit
        elements.entriesBody.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (!row) return;
            
            const citekey = row.dataset.citekey;
            
            if (e.target.classList.contains('cell-citekey')) {
                const entry = state.entries.find(en => en.citekey === citekey);
                if (entry) {
                    showEntryForm(entry);
                }
            }
        });
        
        // DOI lookup
        elements.btnDoiLookup.addEventListener('click', lookupDoi);
        elements.doiInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') lookupDoi();
        });
        elements.btnDoiCancel.addEventListener('click', () => showView('view-list'));
        
        // arXiv lookup
        elements.btnArxivLookup.addEventListener('click', lookupArxiv);
        elements.arxivInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') lookupArxiv();
        });
        elements.btnArxivCancel.addEventListener('click', () => showView('view-list'));
        
        // Entry form
        elements.entryType.addEventListener('change', () => {
            document.body.dataset.entryType = elements.entryType.value;
        });
        
        // Disable URL field and hide Find DOI button when DOI is present
        const doiField = document.getElementById('entry-doi');
        const urlField = document.getElementById('entry-url');
        doiField.addEventListener('input', () => {
            const hasDoi = doiField.value.trim() !== '';
            urlField.disabled = hasDoi;
            elements.btnFindDoi.style.display = hasDoi ? 'none' : 'inline-flex';
            if (hasDoi) {
                urlField.value = '';
                urlField.placeholder = 'Disabled when DOI is present';
            } else {
                urlField.placeholder = 'https://...';
            }
        });
        
        elements.btnGenerateCitekey.addEventListener('click', generateCitekey);
        elements.btnRefreshFromDoi.addEventListener('click', refreshFromDoi);
        elements.btnFindDoi.addEventListener('click', findDoiForEntry);
        elements.btnSaveEntry.addEventListener('click', saveEntry);
        elements.btnCancelEntry.addEventListener('click', () => {
            state.editingCitekey = null;
            showView('view-list');
        });
        elements.btnDeleteEntry.addEventListener('click', () => {
            if (state.editingCitekey) {
                showDeleteModal(state.editingCitekey);
            }
        });
        
        // Import
        elements.importFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleImportFile(file);
            }
        });
        
        elements.btnImportCancel.addEventListener('click', () => showView('view-list'));
        elements.btnImportBack.addEventListener('click', () => {
            elements.importUpload.style.display = 'block';
            elements.importPreview.style.display = 'none';
            elements.importFile.value = '';
            state.importData = null;
        });
        elements.btnImportConfirm.addEventListener('click', confirmImport);
        
        // Delete modal
        elements.btnDeleteConfirm.addEventListener('click', confirmDelete);
        elements.btnDeleteCancel.addEventListener('click', hideDeleteModal);
        elements.modalDelete.addEventListener('click', (e) => {
            if (e.target === elements.modalDelete) {
                hideDeleteModal();
            }
        });
        
        // Logout modal
        elements.btnLogout.addEventListener('click', async () => {
            // Release the session lock and show logout info
            await releaseSessionLock();
            elements.modalLogout.classList.add('active');
        });
        // No dismiss - user must close the tab
        
        // Locked modal
        elements.btnLockedRetry.addEventListener('click', async () => {
            hideLockedModal();
            const acquired = await checkAndAcquireSession();
            if (acquired) {
                elements.modalLogout.classList.remove('active'); // Also hide logout modal if shown
                loadEntries();
                startSessionHeartbeat(); // Start keeping the session alive
            }
        });
        
        elements.btnLockedForce.addEventListener('click', async () => {
            // Force unlock - take over the session
            try {
                const response = await fetch('api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'force_unlock', session_id: state.sessionId })
                });
                const data = await response.json();
                if (data.success) {
                    hideLockedModal();
                    elements.modalLogout.classList.remove('active');
                    loadEntries();
                    startSessionHeartbeat(); // Start keeping the session alive
                } else {
                    alert('Failed to force unlock: ' + (data.error || 'Unknown error'));
                }
            } catch (error) {
                alert('Failed to force unlock: ' + error.message);
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (elements.modalLocked.classList.contains('active')) {
                    // Don't allow escape from locked modal
                } else if (elements.modalLogout.classList.contains('active')) {
                    // Don't allow escape from logout modal (session is released)
                } else if (elements.modalDelete.classList.contains('active')) {
                    hideDeleteModal();
                } else if (!elements.viewList.classList.contains('active')) {
                    showView('view-list');
                }
            }
        });
    }

    // ==================== Initialize ====================
    
    // Heartbeat to keep session lock alive (every 2 minutes)
    let heartbeatStarted = false;
    function startSessionHeartbeat() {
        if (heartbeatStarted) return; // Only start once
        heartbeatStarted = true;
        setInterval(async () => {
            // Only send heartbeat if we're not showing the locked modal
            if (!elements.modalLocked.classList.contains('active')) {
                try {
                    await fetch('api.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'check_session', session_id: state.sessionId })
                    });
                } catch (e) {
                    // Ignore heartbeat errors silently
                }
            }
        }, 2 * 60 * 1000); // 2 minutes
    }
    
    async function init() {
        initEventListeners();
        document.body.dataset.entryType = 'article';
        loadJournalAbbreviations(); // Load abbreviations in background
        loadProperNames(); // Load proper names in background
        
        // Check if session is available
        const acquired = await checkAndAcquireSession();
        if (acquired) {
            loadEntries();
            startSessionHeartbeat(); // Keep the session alive
        }
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
