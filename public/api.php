<?php
/**
 * BibTeX Manager API
 * 
 * Single PHP file handling all server-side operations via JSON API.
 * Endpoints: list, save, delete, import, download
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

// Configuration
define('BIB_FILE', __DIR__ . '/refs.bib');
define('BACKUP_FILE', __DIR__ . '/refs.bib.bak');
define('SESSION_LOCK_FILE', __DIR__ . '/.session_lock');
define('SESSION_LOCK_TIMEOUT', 30 * 60); // 30 minutes in seconds

/**
 * BibTeX Parser Class
 */
class BibTeXParser {
    
    /**
     * Parse a BibTeX string into an array of entries
     */
    public static function parse(string $bibtex): array {
        $entries = [];
        $strings = [];
        
        // First, extract @string definitions
        preg_match_all('/@string\s*\{\s*(\w+)\s*=\s*["{]([^"}]+)["}]\s*\}/i', $bibtex, $stringMatches, PREG_SET_ORDER);
        foreach ($stringMatches as $match) {
            $strings[strtolower($match[1])] = $match[2];
        }
        
        // Match all entries: @type{key, ... }
        // Use a more robust approach to handle nested braces
        $pattern = '/@(\w+)\s*\{\s*([^,\s]+)\s*,/i';
        preg_match_all($pattern, $bibtex, $matches, PREG_OFFSET_CAPTURE);
        
        for ($i = 0; $i < count($matches[0]); $i++) {
            $type = strtolower($matches[1][$i][0]);
            $citekey = trim($matches[2][$i][0]);
            $startPos = $matches[0][$i][1];
            
            // Skip @string, @preamble, @comment
            if (in_array($type, ['string', 'preamble', 'comment'])) {
                continue;
            }
            
            // Find the matching closing brace
            $braceStart = strpos($bibtex, '{', $startPos);
            $content = self::extractBracedContent($bibtex, $braceStart);
            
            if ($content === null) {
                continue;
            }
            
            // Parse fields from content (skip the citekey part)
            $fieldsStart = strpos($content, ',');
            if ($fieldsStart === false) {
                continue;
            }
            
            $fieldsStr = substr($content, $fieldsStart + 1);
            $fields = self::parseFields($fieldsStr, $strings);
            
            $entries[] = [
                'type' => $type,
                'citekey' => $citekey,
                'fields' => $fields
            ];
        }
        
        return $entries;
    }
    
    /**
     * Extract content within matching braces
     */
    private static function extractBracedContent(string $str, int $start): ?string {
        if ($str[$start] !== '{') {
            return null;
        }
        
        $depth = 0;
        $len = strlen($str);
        
        for ($i = $start; $i < $len; $i++) {
            $char = $str[$i];
            if ($char === '{') {
                $depth++;
            } elseif ($char === '}') {
                $depth--;
                if ($depth === 0) {
                    return substr($str, $start + 1, $i - $start - 1);
                }
            }
        }
        
        return null;
    }
    
    /**
     * Parse fields from the entry content
     */
    private static function parseFields(string $fieldsStr, array $strings): array {
        $fields = [];
        
        // Match field = value patterns
        // Value can be: "quoted", {braced}, or bare (for @string refs or numbers)
        $pattern = '/(\w+)\s*=\s*/';
        preg_match_all($pattern, $fieldsStr, $matches, PREG_OFFSET_CAPTURE);
        
        for ($i = 0; $i < count($matches[0]); $i++) {
            $fieldName = strtolower($matches[1][$i][0]);
            $valueStart = $matches[0][$i][1] + strlen($matches[0][$i][0]);
            
            // Determine end position (next field or end of string)
            $nextFieldPos = ($i + 1 < count($matches[0])) 
                ? $matches[0][$i + 1][1] 
                : strlen($fieldsStr);
            
            $valueStr = trim(substr($fieldsStr, $valueStart, $nextFieldPos - $valueStart));
            
            // Remove trailing comma if present
            $valueStr = rtrim($valueStr, ", \t\n\r");
            
            // Parse the value
            $value = self::parseValue($valueStr, $strings);
            
            if ($value !== '') {
                $fields[$fieldName] = $value;
            }
        }
        
        return $fields;
    }
    
    /**
     * Parse a field value (handles quotes, braces, concatenation, @string refs)
     */
    private static function parseValue(string $valueStr, array $strings): string {
        $parts = [];
        $current = '';
        $inQuotes = false;
        $braceDepth = 0;
        $len = strlen($valueStr);
        
        for ($i = 0; $i < $len; $i++) {
            $char = $valueStr[$i];
            
            if ($char === '"' && $braceDepth === 0) {
                if ($inQuotes) {
                    $parts[] = $current;
                    $current = '';
                }
                $inQuotes = !$inQuotes;
            } elseif ($char === '{' && !$inQuotes) {
                if ($braceDepth === 0) {
                    // Starting a braced value
                    $braceDepth++;
                } else {
                    $current .= $char;
                    $braceDepth++;
                }
            } elseif ($char === '}' && !$inQuotes) {
                $braceDepth--;
                if ($braceDepth === 0) {
                    $parts[] = $current;
                    $current = '';
                } else {
                    $current .= $char;
                }
            } elseif ($char === '#' && !$inQuotes && $braceDepth === 0) {
                // Concatenation - save current bare word if any
                $bareWord = trim($current);
                if ($bareWord !== '') {
                    // Check if it's a @string reference or number
                    if (isset($strings[strtolower($bareWord)])) {
                        $parts[] = $strings[strtolower($bareWord)];
                    } elseif (is_numeric($bareWord)) {
                        $parts[] = $bareWord;
                    } else {
                        $parts[] = $bareWord;
                    }
                }
                $current = '';
            } elseif ($inQuotes || $braceDepth > 0) {
                $current .= $char;
            } else {
                $current .= $char;
            }
        }
        
        // Handle any remaining bare word
        $bareWord = trim($current);
        if ($bareWord !== '' && !$inQuotes && $braceDepth === 0) {
            if (isset($strings[strtolower($bareWord)])) {
                $parts[] = $strings[strtolower($bareWord)];
            } elseif (is_numeric($bareWord)) {
                $parts[] = $bareWord;
            } else {
                $parts[] = $bareWord;
            }
        }
        
        return implode('', $parts);
    }
    
    /**
     * Format entries back to BibTeX string
     */
    public static function format(array $entries): string {
        $output = '';
        
        // Standard field order for consistent formatting
        $fieldOrder = [
            'author', 'title', 'journal', 'booktitle', 'publisher', 'school',
            'year', 'month', 'volume', 'number', 'pages', 'article-number',
            'doi', 'issn', 'isbn', 'url', 'eprint', 'archiveprefix', 'primaryclass',
            'howpublished', 'edition', 'editor', 'series', 'address', 'note', 'abstract'
        ];
        
        foreach ($entries as $entry) {
            $output .= "@{$entry['type']}{{$entry['citekey']},\n";
            
            // Sort fields according to standard order
            $sortedFields = [];
            foreach ($fieldOrder as $field) {
                if (isset($entry['fields'][$field])) {
                    $sortedFields[$field] = $entry['fields'][$field];
                }
            }
            // Add any remaining fields not in the standard order
            foreach ($entry['fields'] as $field => $value) {
                if (!isset($sortedFields[$field])) {
                    $sortedFields[$field] = $value;
                }
            }
            
            $fieldStrings = [];
            foreach ($sortedFields as $field => $value) {
                // Escape and format value
                $formattedValue = self::formatFieldValue($value);
                $fieldStrings[] = "  {$field} = {{$formattedValue}}";
            }
            
            $output .= implode(",\n", $fieldStrings);
            $output .= "\n}\n\n";
        }
        
        return $output;
    }
    
    /**
     * Format a field value for output
     */
    private static function formatFieldValue(string $value): string {
        // The value is already stored without outer braces/quotes
        // Just return as-is, the braces will be added by format()
        return $value;
    }
}

/**
 * Generate citation key from entry fields
 * Format: journalabbr_volume_page_year
 */
function generateCitekey(array $fields): string {
    $journal = $fields['journal'] ?? '';
    $volume = $fields['volume'] ?? '';
    $pages = $fields['pages'] ?? ($fields['article-number'] ?? '');
    $year = $fields['year'] ?? '';
    
    // Extract first page if range given
    if (strpos($pages, '-') !== false || strpos($pages, '--') !== false) {
        $pages = preg_split('/[-–—]+/', $pages)[0];
    }
    $pages = trim($pages);
    
    // Generate journal abbreviation: first letter of each word, ignoring articles
    $ignoreWords = ['the', 'of', 'and', 'for', 'in', 'on', 'a', 'an'];
    $words = preg_split('/\s+/', $journal);
    $abbr = '';
    foreach ($words as $word) {
        $word = strtolower(trim($word, '.,;:'));
        if ($word !== '' && !in_array($word, $ignoreWords)) {
            $abbr .= $word[0];
        }
    }
    $abbr = strtolower($abbr);
    
    // Build citekey
    $parts = [];
    if ($abbr) $parts[] = $abbr;
    if ($volume) $parts[] = $volume;
    if ($pages) $parts[] = $pages;
    if ($year) $parts[] = $year;
    
    if (empty($parts)) {
        // Fallback: use author + year
        $author = $fields['author'] ?? 'unknown';
        $firstAuthor = preg_split('/\s+and\s+/i', $author)[0];
        // Get last name
        if (strpos($firstAuthor, ',') !== false) {
            $lastName = trim(explode(',', $firstAuthor)[0]);
        } else {
            $nameParts = preg_split('/\s+/', trim($firstAuthor));
            $lastName = end($nameParts);
        }
        $lastName = preg_replace('/[^a-zA-Z]/', '', $lastName);
        return strtolower($lastName) . ($year ?: date('Y'));
    }
    
    return implode('_', $parts);
}

/**
 * Load proper names from JSON files for title capitalization protection
 * Uses static caching so files are only read once per request
 */
function loadProperNames(): array {
    static $properNames = null;
    
    if ($properNames !== null) {
        return $properNames;
    }
    
    $properNames = [];
    
    // Load base proper names
    $baseFile = __DIR__ . '/proper-names.json';
    if (file_exists($baseFile)) {
        $data = json_decode(file_get_contents($baseFile), true);
        if (is_array($data)) {
            foreach ($data as $key => $names) {
                if ($key !== '_comment' && is_array($names)) {
                    $properNames = array_merge($properNames, $names);
                }
            }
        }
    }
    
    // Load custom additions
    $customFile = __DIR__ . '/proper-names-custom.json';
    if (file_exists($customFile)) {
        $custom = json_decode(file_get_contents($customFile), true);
        if (is_array($custom) && isset($custom['custom']) && is_array($custom['custom'])) {
            $properNames = array_merge($properNames, $custom['custom']);
        }
    }
    
    return $properNames;
}

/**
 * Clean title: wrap capitalized words and formulas in braces, convert HTML to LaTeX
 */
function cleanTitle(string $title): string {
    // Convert HTML entities
    $title = html_entity_decode($title, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    
    // Convert degree symbol to LaTeX and protect capitalization
    // Handle temperatures like 22°C, 22 °C, 590°C → {22$^\circ$C}
    $title = preg_replace_callback('/(\d+)\s*°\s*([CKF])\b/', function($m) {
        return '{' . $m[1] . '$^\circ$' . $m[2] . '}';
    }, $title);
    // Handle standalone °C, °K, °F (without preceding number)
    $title = preg_replace_callback('/°([CKF])\b/', function($m) {
        return '$^\circ$' . $m[1];
    }, $title);
    // Handle any remaining standalone degree symbols (e.g., 45°)
    $title = str_replace('°', '$^\circ$', $title);
    
    // Convert common HTML tags to LaTeX
    $title = preg_replace('/<sup>([^<]+)<\/sup>/i', '$^{$1}$', $title);
    $title = preg_replace('/<sub>([^<]+)<\/sub>/i', '$_{$1}$', $title);
    $title = preg_replace('/<i>([^<]+)<\/i>/i', '\\textit{$1}', $title);
    $title = preg_replace('/<em>([^<]+)<\/em>/i', '\\textit{$1}', $title);
    $title = preg_replace('/<b>([^<]+)<\/b>/i', '\\textbf{$1}', $title);
    $title = preg_replace('/<strong>([^<]+)<\/strong>/i', '\\textbf{$1}', $title);
    $title = strip_tags($title);
    
    // Convert plain text chemical formulas (no HTML tags): SiO2 -> {SiO$_{2}$}
    // Match formulas with at least 2 elements where at least one has a subscript number
    $title = preg_replace_callback('/\b([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*[A-Z][a-z]?\d+|[A-Z][a-z]?\d+(?:[A-Z][a-z]?\d*)+)\b/', function($m) {
        $match = $m[0];
        preg_match_all('/[A-Z]/', $match, $caps);
        if (count($caps[0]) >= 2 && preg_match('/[A-Z][a-z]?\d/', $match)) {
            return '{' . preg_replace('/([A-Z][a-z]?)(\d+)/', '$1$_{$2}$', $match) . '}';
        }
        return $match;
    }, $title);
    // Also handle simple compounds in hyphenated contexts: CaO-MgO -> {CaO}-{MgO}
    $title = preg_replace('/\b([A-Z][a-z]?)([A-Z][a-z]?)\b(?=-)/', '{$1$2}', $title);
    $title = preg_replace('/(?<=-)\b([A-Z][a-z]?)([A-Z][a-z]?)\b/', '{$1$2}', $title);
    
    // Wrap chemical formulas to protect capitalization in BibTeX
    // Match element (optional subscript) followed by element+subscript sequences
    // SiP$_{2}$O$_{7}$ -> {SiP$_{2}$O$_{7}$}, Na$_{4}$P$_{2}$O$_{7}$ -> {Na$_{4}$P$_{2}$O$_{7}$}
    $title = preg_replace('/(?<!\{)([A-Z][a-z]?(?:\$_\{\d+\}\$)?(?:[A-Z][a-z]?\$_\{\d+\}\$)+)/', '{$1}', $title);
    
    // Wrap Q-species and similar notations: Q$^{3}$ -> {Q$^{3}$}, T$^{n}$ -> {T$^{n}$}
    // Common in NMR/glass science for structural units
    $title = preg_replace('/(?<!\{)\b([A-Z])\$\^\{(\d+)\}\$/', '{$1$^{$2}$}', $title);
    
    // Check if title already has LaTeX notation (from JS htmlToLatex)
    // This includes isotopes like $^{29}$Si or subscripts like $_{4}$ from chemical formulas
    $hasLatexMath = preg_match('/\$[\^_]/', $title);
    
    if (!$hasLatexMath) {
        // Wrap isotope notation: $^{num}$Element or $^num$Element (e.g., $^{29}$Si, $^{27}$Al)
        // Match math formula followed by 1-2 uppercase letters (element symbols)
        $title = preg_replace_callback('/(?<!\{)(\$[^$]+\$)([A-Z][a-z]?)(?!\})/', function($m) {
            return '{' . $m[1] . $m[2] . '}';
        }, $title);
        
        // Wrap standalone math formulas (e.g., $J$, $T_1$) - require 2+ chars to avoid matching elements
        $title = preg_replace_callback('/(?<!\{)(\$[^$]{2,}\$)(?![A-Za-z])(?!\})/', function($m) {
            return '{' . $m[1] . '}';
        }, $title);
    }
    // If already has LaTeX math, skip wrapping to avoid double-processing
    
    // Wrap number + uppercase letter combinations (e.g., 2D, 3D, 1H, 13C) - but skip if already in $...$
    $title = preg_replace_callback('/(?<!\{)(?<!\$)\b(\d+[A-Z]+)\b(?!\})(?!\$)/', function($m) {
        return '{' . $m[1] . '}';
    }, $title);
    
    // Wrap scientific proper names to protect capitalization (loaded from JSON)
    $properNames = loadProperNames();
    if (!empty($properNames)) {
        $properNamesPattern = '/(?<!\{)\b(' . implode('|', $properNames) . ')\b(?!\})/';
        $title = preg_replace($properNamesPattern, '{$1}', $title);
    }
    
    // Wrap fully capitalized words (2+ chars) in braces if not already
    $title = preg_replace_callback('/(?<!\{)\b([A-Z]{2,})\b(?!\})/', function($m) {
        return '{' . $m[1] . '}';
    }, $title);
    
    // Wrap roman numerals in common contexts (for single-letter numerals like I, V, X)
    // After colon or period with space
    $title = preg_replace('/([:.]\s*)([IVXLCDM]+)([\.,;:\s]|$)/', '$1{$2}$3', $title);
    // After words like Part, Section, Volume, Chapter, Phase, Type, Figure, Table
    $title = preg_replace('/\b(Part|Section|Volume|Chapter|Phase|Type|Figure|Table|Fig|Tab|No|Nr)\s+([IVXLCDM]+)\b/i', '$1 {$2}', $title);
    
    return $title;
}

/**
 * Read and parse the BibTeX file
 */
function readBibFile(): array {
    if (!file_exists(BIB_FILE)) {
        return [];
    }
    
    $content = file_get_contents(BIB_FILE);
    if ($content === false) {
        throw new Exception('Failed to read BibTeX file');
    }
    
    return BibTeXParser::parse($content);
}

/**
 * Write entries to the BibTeX file with safety measures
 */
function writeBibFile(array $entries): void {
    // Create backup
    if (file_exists(BIB_FILE)) {
        copy(BIB_FILE, BACKUP_FILE);
    }
    
    $content = BibTeXParser::format($entries);
    
    // Write to temp file first
    $tempFile = BIB_FILE . '.tmp';
    
    $fp = fopen($tempFile, 'w');
    if (!$fp) {
        throw new Exception('Failed to open temp file for writing');
    }
    
    // Get exclusive lock
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        throw new Exception('Failed to acquire file lock');
    }
    
    fwrite($fp, $content);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    
    // Atomic rename
    if (!rename($tempFile, BIB_FILE)) {
        unlink($tempFile);
        throw new Exception('Failed to save BibTeX file');
    }
}

/**
 * Find entry by citekey
 */
function findEntry(array $entries, string $citekey): ?int {
    foreach ($entries as $index => $entry) {
        if ($entry['citekey'] === $citekey) {
            return $index;
        }
    }
    return null;
}

/**
 * Find entry by DOI
 */
function findEntryByDoi(array $entries, string $doi): ?int {
    $doi = strtolower(trim($doi));
    foreach ($entries as $index => $entry) {
        if (isset($entry['fields']['doi'])) {
            if (strtolower(trim($entry['fields']['doi'])) === $doi) {
                return $index;
            }
        }
    }
    return null;
}

/**
 * API Response helpers
 */
/**
 * Session Lock Functions
 * Ensures only one user can actively use the app at a time
 */

function getSessionLock(): ?array {
    if (!file_exists(SESSION_LOCK_FILE)) {
        return null;
    }
    $data = json_decode(file_get_contents(SESSION_LOCK_FILE), true);
    if (!$data || !isset($data['session_id']) || !isset($data['timestamp'])) {
        return null;
    }
    // Check if lock has expired
    if (time() - $data['timestamp'] > SESSION_LOCK_TIMEOUT) {
        @unlink(SESSION_LOCK_FILE);
        return null;
    }
    return $data;
}

function acquireSessionLock(string $sessionId): bool {
    $currentLock = getSessionLock();
    
    // No lock or same session - acquire/refresh
    if ($currentLock === null || $currentLock['session_id'] === $sessionId) {
        $data = [
            'session_id' => $sessionId,
            'timestamp' => time()
        ];
        return file_put_contents(SESSION_LOCK_FILE, json_encode($data)) !== false;
    }
    
    // Different session holds the lock
    return false;
}

function releaseSessionLock(string $sessionId): bool {
    $currentLock = getSessionLock();
    if ($currentLock === null) {
        return true; // Already released
    }
    if ($currentLock['session_id'] === $sessionId) {
        return @unlink(SESSION_LOCK_FILE);
    }
    return false; // Can't release someone else's lock
}

function checkSessionLock(string $sessionId): array {
    $currentLock = getSessionLock();
    
    if ($currentLock === null) {
        // No lock - acquire it
        acquireSessionLock($sessionId);
        return ['locked' => false];
    }
    
    if ($currentLock['session_id'] === $sessionId) {
        // Our lock - refresh it
        acquireSessionLock($sessionId);
        return ['locked' => false];
    }
    
    // Someone else's lock
    $remaining = SESSION_LOCK_TIMEOUT - (time() - $currentLock['timestamp']);
    return [
        'locked' => true,
        'minutes_remaining' => ceil($remaining / 60)
    ];
}

function jsonResponse(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

function errorResponse(string $message, int $status = 400): void {
    jsonResponse(['error' => $message], $status);
}

/**
 * Main API handler
 */
function handleRequest(): void {
    $method = $_SERVER['REQUEST_METHOD'];
    
    // Handle GET for download
    if ($method === 'GET' && isset($_GET['action']) && $_GET['action'] === 'download') {
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="refs.bib"');
        if (file_exists(BIB_FILE)) {
            readfile(BIB_FILE);
        }
        exit;
    }
    
    // All other actions are POST
    if ($method !== 'POST') {
        errorResponse('Method not allowed', 405);
    }
    
    // Parse JSON body or form data
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    
    if (strpos($contentType, 'application/json') !== false) {
        $input = json_decode(file_get_contents('php://input'), true);
        if ($input === null) {
            errorResponse('Invalid JSON');
        }
    } elseif (strpos($contentType, 'multipart/form-data') !== false) {
        $input = $_POST;
    } else {
        $input = $_POST;
    }
    
    $action = $input['action'] ?? '';
    $sessionId = $input['session_id'] ?? '';
    
    // Session management actions (don't require lock)
    if ($action === 'check_session') {
        if (!$sessionId) {
            errorResponse('Session ID required');
        }
        $lockStatus = checkSessionLock($sessionId);
        jsonResponse($lockStatus);
        return;
    }
    
    if ($action === 'release_session') {
        if (!$sessionId) {
            errorResponse('Session ID required');
        }
        releaseSessionLock($sessionId);
        jsonResponse(['success' => true]);
        return;
    }
    
    // All other actions require a valid session
    if (!$sessionId) {
        errorResponse('Session ID required', 401);
    }
    
    $lockStatus = checkSessionLock($sessionId);
    if ($lockStatus['locked']) {
        jsonResponse([
            'error' => 'locked',
            'message' => 'Another session is currently using the application.',
            'minutes_remaining' => $lockStatus['minutes_remaining']
        ], 423);
        return;
    }
    
    try {
        switch ($action) {
            case 'list':
                $entries = readBibFile();
                jsonResponse(['entries' => $entries]);
                break;
                
            case 'save':
                $entry = $input['entry'] ?? null;
                if (!$entry || !isset($entry['type']) || !isset($entry['citekey'])) {
                    errorResponse('Invalid entry data');
                }
                
                $entries = readBibFile();
                
                // Clean title only if requested
                $shouldCleanTitle = $input['cleanTitle'] ?? false;
                if ($shouldCleanTitle && isset($entry['fields']['title'])) {
                    $entry['fields']['title'] = cleanTitle($entry['fields']['title']);
                }
                
                // Check if updating existing or adding new
                $existingIndex = findEntry($entries, $entry['citekey']);
                $originalCitekey = $input['originalCitekey'] ?? null;
                
                if ($originalCitekey && $originalCitekey !== $entry['citekey']) {
                    // Renaming citekey - check new one doesn't exist
                    if ($existingIndex !== null) {
                        errorResponse('An entry with this citekey already exists');
                    }
                    // Remove old entry
                    $oldIndex = findEntry($entries, $originalCitekey);
                    if ($oldIndex !== null) {
                        array_splice($entries, $oldIndex, 1);
                    }
                    $entries[] = $entry;
                } elseif ($existingIndex !== null) {
                    // Update existing
                    $entries[$existingIndex] = $entry;
                } else {
                    // Check for duplicate DOI
                    if (isset($entry['fields']['doi'])) {
                        $doiIndex = findEntryByDoi($entries, $entry['fields']['doi']);
                        if ($doiIndex !== null) {
                            jsonResponse([
                                'warning' => 'An entry with this DOI already exists',
                                'existingCitekey' => $entries[$doiIndex]['citekey']
                            ]);
                            return;
                        }
                    }
                    // Add new
                    $entries[] = $entry;
                }
                
                writeBibFile($entries);
                jsonResponse(['success' => true, 'entry' => $entry]);
                break;
                
            case 'delete':
                $citekey = $input['citekey'] ?? '';
                if (!$citekey) {
                    errorResponse('Citekey required');
                }
                
                $entries = readBibFile();
                $index = findEntry($entries, $citekey);
                
                if ($index === null) {
                    errorResponse('Entry not found', 404);
                }
                
                array_splice($entries, $index, 1);
                writeBibFile($entries);
                jsonResponse(['success' => true]);
                break;
                
            case 'import':
                if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                    errorResponse('No file uploaded or upload error');
                }
                
                $uploadedContent = file_get_contents($_FILES['file']['tmp_name']);
                if ($uploadedContent === false) {
                    errorResponse('Failed to read uploaded file');
                }
                
                $importedEntries = BibTeXParser::parse($uploadedContent);
                $existingEntries = readBibFile();
                
                // Build lookup for existing entries
                $existingByKey = [];
                foreach ($existingEntries as $entry) {
                    $existingByKey[$entry['citekey']] = $entry;
                }
                
                $results = [
                    'new' => [],
                    'duplicates' => [],
                    'conflicts' => []
                ];
                
                foreach ($importedEntries as $imported) {
                    $key = $imported['citekey'];
                    
                    if (!isset($existingByKey[$key])) {
                        // New entry
                        $results['new'][] = $imported;
                    } else {
                        // Check if exact duplicate or conflict
                        $existing = $existingByKey[$key];
                        if ($existing['type'] === $imported['type'] && 
                            $existing['fields'] == $imported['fields']) {
                            $results['duplicates'][] = $key;
                        } else {
                            $results['conflicts'][] = [
                                'citekey' => $key,
                                'existing' => $existing,
                                'imported' => $imported
                            ];
                        }
                    }
                }
                
                jsonResponse([
                    'preview' => true,
                    'newCount' => count($results['new']),
                    'duplicateCount' => count($results['duplicates']),
                    'conflictCount' => count($results['conflicts']),
                    'new' => $results['new'],
                    'conflicts' => $results['conflicts']
                ]);
                break;
                
            case 'import_confirm':
                $newEntries = $input['entries'] ?? [];
                if (empty($newEntries)) {
                    errorResponse('No entries to import');
                }
                
                $existingEntries = readBibFile();
                
                // Clean titles for new entries
                foreach ($newEntries as &$entry) {
                    if (isset($entry['fields']['title'])) {
                        $entry['fields']['title'] = cleanTitle($entry['fields']['title']);
                    }
                }
                
                $merged = array_merge($existingEntries, $newEntries);
                writeBibFile($merged);
                jsonResponse(['success' => true, 'importedCount' => count($newEntries)]);
                break;
                
            case 'generate_citekey':
                $fields = $input['fields'] ?? [];
                $citekey = generateCitekey($fields);
                jsonResponse(['citekey' => $citekey]);
                break;
                
            case 'clean_all_titles':
                $entries = readBibFile();
                $cleaned = 0;
                
                foreach ($entries as &$entry) {
                    if (isset($entry['fields']['title'])) {
                        $original = $entry['fields']['title'];
                        $entry['fields']['title'] = cleanTitle($original);
                        if ($entry['fields']['title'] !== $original) {
                            $cleaned++;
                        }
                    }
                }
                
                writeBibFile($entries);
                jsonResponse(['success' => true, 'cleanedCount' => $cleaned, 'totalCount' => count($entries)]);
                break;
                
            default:
                errorResponse('Unknown action');
        }
    } catch (Exception $e) {
        errorResponse($e->getMessage(), 500);
    }
}

// Run the API
handleRequest();
