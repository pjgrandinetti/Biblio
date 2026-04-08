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
define('SESSION_LOCK_TIMEOUT', 5 * 60); // 5 minutes in seconds

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
     * Properly handles = signs inside braced/quoted values
     */
    private static function parseFields(string $fieldsStr, array $strings): array {
        $fields = [];
        $len = strlen($fieldsStr);
        $i = 0;
        
        while ($i < $len) {
            // Skip whitespace and commas
            while ($i < $len && (ctype_space($fieldsStr[$i]) || $fieldsStr[$i] === ',')) {
                $i++;
            }
            if ($i >= $len) break;
            
            // Match field name (word characters)
            $fieldStart = $i;
            while ($i < $len && (ctype_alnum($fieldsStr[$i]) || $fieldsStr[$i] === '-' || $fieldsStr[$i] === '_')) {
                $i++;
            }
            if ($i === $fieldStart) {
                // No field name found, skip character
                $i++;
                continue;
            }
            $fieldName = strtolower(substr($fieldsStr, $fieldStart, $i - $fieldStart));
            
            // Skip whitespace
            while ($i < $len && ctype_space($fieldsStr[$i])) {
                $i++;
            }
            
            // Expect '='
            if ($i >= $len || $fieldsStr[$i] !== '=') {
                // Not a valid field assignment, skip
                continue;
            }
            $i++; // Skip '='
            
            // Skip whitespace
            while ($i < $len && ctype_space($fieldsStr[$i])) {
                $i++;
            }
            
            // Parse value - track braces and quotes properly
            $valueStart = $i;
            $braceDepth = 0;
            $inQuotes = false;
            
            while ($i < $len) {
                $char = $fieldsStr[$i];
                
                if ($char === '"' && $braceDepth === 0) {
                    $inQuotes = !$inQuotes;
                } elseif ($char === '{' && !$inQuotes) {
                    $braceDepth++;
                } elseif ($char === '}' && !$inQuotes) {
                    $braceDepth--;
                    if ($braceDepth < 0) $braceDepth = 0; // Safety
                } elseif ($char === ',' && $braceDepth === 0 && !$inQuotes) {
                    // End of this field's value
                    break;
                }
                $i++;
            }
            
            $valueStr = trim(substr($fieldsStr, $valueStart, $i - $valueStart));
            
            // Remove trailing comma if present (shouldn't be, but safety)
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
function generateCitekey(array $fields, ?string $editingCitekey = null): string {
    // Check for arXiv entry - use arxiv_{id}_{year}
    // Detect by DOI, archiveprefix, or eprint containing arXiv ID pattern
    $archiveprefix = $fields['archiveprefix'] ?? '';
    $eprint = $fields['eprint'] ?? '';
    $doi = $fields['doi'] ?? '';
    $arxivId = null;
    
    // Check DOI first (10.48550/arXiv.2102.09844 or 10.48550/ARXIV.2102.09844)
    if (preg_match('/^10\.48550\/arXiv\.(\d{4}\.\d{4,5})/i', $doi, $matches)) {
        $arxivId = $matches[1];
    } elseif (strtolower($archiveprefix) === 'arxiv' || preg_match('/^arXiv:/i', $eprint)) {
        // Extract ID from eprint field (may be "arXiv:2102.09844" or just "2102.09844")
        $arxivId = preg_replace('/^arXiv:/i', '', $eprint);
    } elseif (preg_match('/^(\d{4}\.\d{4,5})(v\d+)?$/', $eprint, $matches)) {
        $arxivId = $matches[1];
    }
    
    if ($arxivId) {
        // Replace dots with underscores for cleaner citekey
        // arXiv ID is globally unique, no need for year suffix
        $cleanId = str_replace('.', '_', $arxivId);
        return 'arxiv_' . $cleanId;
    }
    
    // Check for Zenodo entry - use zenodo_{id}_{year}
    if (preg_match('/^10\.5281\/zenodo\.(\d+)$/i', $doi, $matches)) {
        $zenodoId = $matches[1];
        $year = $fields['year'] ?? date('Y');
        return 'zenodo_' . $zenodoId . '_' . $year;
    }
    
    $journal = $fields['journal'] ?? '';
    $volume = $fields['volume'] ?? '';
    $pages = $fields['pages'] ?? ($fields['article-number'] ?? '');
    $year = $fields['year'] ?? '';
    $title = $fields['title'] ?? '';
    
    // Extract first page if range given
    if (strpos($pages, '-') !== false || strpos($pages, '--') !== false) {
        $pages = preg_split('/[-–—]+/', $pages)[0];
    }
    $pages = trim($pages);
    
    // Words to ignore in abbreviations
    $ignoreWords = ['the', 'of', 'and', 'for', 'in', 'on', 'a', 'an', 'to', 'with'];
    
    // Generate journal abbreviation: first letter of each word, ignoring articles
    $words = preg_split('/\s+/', $journal);
    $journalAbbr = '';
    foreach ($words as $word) {
        $word = strtolower(trim($word, '.,;:'));
        if ($word !== '' && !in_array($word, $ignoreWords)) {
            $journalAbbr .= $word[0];
        }
    }
    $journalAbbr = strtolower($journalAbbr);
    
    // Build citekey for journal articles
    $parts = [];
    if ($journalAbbr) $parts[] = $journalAbbr;
    if ($volume) $parts[] = $volume;
    if ($pages) $parts[] = $pages;
    if ($year) $parts[] = $year;
    
    // If we have journal info, use journal-based citekey
    if (!empty($parts) && $journalAbbr) {
        return implode('_', $parts);
    }
    
    // For books/non-journal entries: use first letter of each title word
    if ($title) {
        // Clean title: remove braces and special chars
        $cleanTitle = preg_replace('/[{}]/', '', $title);
        $titleWords = preg_split('/\s+/', $cleanTitle);
        $titleAbbr = '';
        foreach ($titleWords as $word) {
            $word = strtolower(trim($word, '.,;:()[]'));
            if ($word !== '' && !in_array($word, $ignoreWords)) {
                // Get first letter (handle unicode)
                $firstChar = mb_substr($word, 0, 1);
                if (preg_match('/[a-z]/i', $firstChar)) {
                    $titleAbbr .= strtolower($firstChar);
                }
            }
        }
        
        if ($titleAbbr) {
            $citekey = $titleAbbr;
            
            // Check uniqueness, add author if needed
            $existingKeys = getExistingCitekeys($editingCitekey);
            
            if (!isset($existingKeys[$citekey])) {
                return $citekey;
            }
            
            // Not unique - try adding first author last name
            $author = $fields['author'] ?? '';
            if (empty($author)) {
                $author = $fields['editor'] ?? '';
            }
            
            if ($author) {
                $firstAuthor = preg_split('/\s+and\s+/i', $author)[0];
                if (strpos($firstAuthor, ',') !== false) {
                    $lastName = trim(explode(',', $firstAuthor)[0]);
                } else {
                    $nameParts = preg_split('/\s+/', trim($firstAuthor));
                    $lastName = end($nameParts);
                }
                $lastName = preg_replace('/[^a-zA-Z]/', '', $lastName);
                $lastName = strtolower($lastName);
                
                if ($lastName) {
                    $citekeyWithAuthor = $titleAbbr . '_' . $lastName;
                    if (!isset($existingKeys[$citekeyWithAuthor])) {
                        return $citekeyWithAuthor;
                    }
                    // Still not unique - add letter suffix
                    return addLetterSuffix($citekeyWithAuthor, $existingKeys);
                }
            }
            
            // No author available - add letter suffix to title abbr
            return addLetterSuffix($citekey, $existingKeys);
        }
    }
    
    // Ultimate fallback: author + year
    $author = $fields['author'] ?? '';
    if (empty($author)) {
        $author = $fields['editor'] ?? 'unknown';
    }
    $firstAuthor = preg_split('/\s+and\s+/i', $author)[0];
    if (strpos($firstAuthor, ',') !== false) {
        $lastName = trim(explode(',', $firstAuthor)[0]);
    } else {
        $nameParts = preg_split('/\s+/', trim($firstAuthor));
        $lastName = end($nameParts);
    }
    $lastName = preg_replace('/[^a-zA-Z]/', '', $lastName);
    $lastName = strtolower($lastName) ?: 'unknown';
    
    $citekey = $lastName . ($year ?: date('Y'));
    $existingKeys = getExistingCitekeys($editingCitekey);
    return addLetterSuffix($citekey, $existingKeys);
}

/**
 * Get existing citekeys, excluding the one being edited
 */
function getExistingCitekeys(?string $editingCitekey = null): array {
    $entries = readBibFile();
    $existingKeys = [];
    foreach ($entries as $entry) {
        if ($editingCitekey !== null && $entry['citekey'] === $editingCitekey) {
            continue;
        }
        $existingKeys[$entry['citekey']] = true;
    }
    return $existingKeys;
}

/**
 * Add letter suffix if citekey already exists
 */
function addLetterSuffix(string $citekey, array $existingKeys): string {
    if (!isset($existingKeys[$citekey])) {
        return $citekey;
    }
    
    $suffix = 'a';
    while (isset($existingKeys[$citekey . $suffix])) {
        $suffix++;
    }
    return $citekey . $suffix;
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
 * Convert all-caps title to proper title case
 * Handles common lowercase words and preserves important uppercase patterns
 */
function convertToTitleCase(string $title): string {
    // Words that should be lowercase (unless first word)
    $lowercaseWords = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 
                       'to', 'by', 'of', 'in', 'with', 'as', 'vs', 'via'];
    
    // Chemical elements that should stay uppercase when standalone
    $elements = ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 
                 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Br', 'I', 'Se'];
    
    // Split by word boundaries but preserve delimiters  
    // Include various hyphen/dash characters: -, –, —, ‐ (U+2010 hyphen)
    $parts = preg_split('/(\s+|[-–—‐:;,.])/u', $title, -1, PREG_SPLIT_DELIM_CAPTURE);
    $result = [];
    $isFirst = true;
    
    foreach ($parts as $part) {
        // Skip empty parts and delimiters
        if (trim($part) === '' || preg_match('/^[\s\-–—‐:;,.]+$/u', $part)) {
            $result[] = $part;
            // After colon, next word should be capitalized
            if (strpos($part, ':') !== false) {
                $isFirst = true;
            }
            continue;
        }
        
        $lowerPart = strtolower($part);
        
        // Check if it's a chemical element (1-2 letters)
        if (in_array($part, $elements) || in_array(ucfirst($lowerPart), $elements)) {
            $result[] = ucfirst($lowerPart);
        }
        // Roman numerals - keep uppercase
        elseif (preg_match('/^[IVXLCDM]+$/i', $part) && strlen($part) <= 5) {
            $result[] = strtoupper($part);
        }
        // First word or not a common lowercase word - capitalize
        elseif ($isFirst || !in_array($lowerPart, $lowercaseWords)) {
            $result[] = ucfirst($lowerPart);
        }
        // Common lowercase word
        else {
            $result[] = $lowerPart;
        }
        
        $isFirst = false;
    }
    
    return implode('', $result);
}

/**
 * Clean title: wrap capitalized words and formulas in braces, convert HTML to LaTeX
 */
function cleanTitle(string $title): string {
    // Convert HTML entities
    $title = html_entity_decode($title, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    
    // Detect all-caps titles and convert to title case
    // Only letters count - ignore numbers, symbols, spaces
    $letters = preg_replace('/[^a-zA-Z]/', '', $title);
    $uppercase = preg_replace('/[^A-Z]/', '', $letters);
    // If >80% of letters are uppercase, it's likely an all-caps title from old sources
    if (strlen($letters) > 10 && strlen($uppercase) / strlen($letters) > 0.8) {
        $title = convertToTitleCase($title);
    }
    
    // Convert MathML isotope notation to LaTeX
    // Pattern: <mml:mmultiscripts><mml:mi>ELEMENT</mml:mi><mml:mprescripts/><mml:none/><mml:mn>MASS</mml:mn></mml:mmultiscripts>
    $title = preg_replace_callback('/<mml:math[^>]*>.*?<mml:mmultiscripts><mml:mi[^>]*>([A-Za-z]+)<\/mml:mi><mml:mprescripts\/?><mml:none\/?><mml:mn>(\d+)<\/mml:mn><\/mml:mmultiscripts>.*?<\/mml:math>/si',
        function($m) { return '{$^{' . $m[2] . '}$' . $m[1] . '}'; }, $title);
    
    // Convert MathML presuperscript notation: <msup><mrow/><mrow><mn>N</mn></mrow></msup><mi>X</mi> -> $^{N}$X
    // Used for coupling constants like ²J, ³J in NMR
    $title = preg_replace_callback('/<mml:math[^>]*>.*?<mml:msup>\s*<mml:mrow\s*\/?>\s*<mml:mrow>\s*<mml:mn>(\d+)<\/mml:mn>\s*<\/mml:mrow>\s*<\/mml:msup>\s*<mml:mi>([A-Za-z]+)<\/mml:mi>.*?<\/mml:math>/si',
        function($m) { return '{$^{' . $m[1] . '}' . $m[2] . '$}'; }, $title);
    
    // Convert general MathML with msup (superscript): <msup><mi>X</mi><mn>N</mn></msup> -> X$^{N}$
    $title = preg_replace_callback('/<mml:math[^>]*>.*?<mml:msup>\s*<mml:mi>([A-Za-z]+)<\/mml:mi>\s*<mml:mn>(\d+)<\/mml:mn>\s*<\/mml:msup>.*?<\/mml:math>/si',
        function($m) { return $m[1] . '$^{' . $m[2] . '}$'; }, $title);
    
    // Convert general MathML with msub (subscript): <msub><mi>X</mi><mn>N</mn></msub> -> X$_{N}$
    $title = preg_replace_callback('/<mml:math[^>]*>.*?<mml:msub>\s*<mml:mi>([A-Za-z]+)<\/mml:mi>\s*<mml:mn>(\d+)<\/mml:mn>\s*<\/mml:msub>.*?<\/mml:math>/si',
        function($m) { return $m[1] . '$_{' . $m[2] . '}$'; }, $title);
    
    // Strip any remaining MathML tags but keep the text content
    $title = preg_replace('/<mml:[^>]+>/i', '', $title);
    $title = preg_replace('/<\/mml:[^>]+>/i', '', $title);
    
    // Normalize whitespace (MathML often has excessive spacing)
    $title = preg_replace('/\s+/', ' ', $title);
    $title = trim($title);
    
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
    
    if ($action === 'force_unlock') {
        // Allow user to forcefully take over the lock
        // Useful for single-user scenarios where an old lock is stuck
        if (!$sessionId) {
            errorResponse('Session ID required');
        }
        @unlink(SESSION_LOCK_FILE);
        acquireSessionLock($sessionId);
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
                $editingCitekey = $input['editingCitekey'] ?? null;
                $citekey = generateCitekey($fields, $editingCitekey);
                jsonResponse(['citekey' => $citekey]);
                break;
                
            case 'clean_title':
                // Clean title for a single entry
                $citekey = $input['citekey'] ?? '';
                if (!$citekey) {
                    errorResponse('Citekey required');
                }
                
                $entries = readBibFile();
                $found = false;
                $changed = false;
                
                foreach ($entries as &$entry) {
                    if ($entry['citekey'] === $citekey) {
                        $found = true;
                        if (isset($entry['fields']['title'])) {
                            $original = $entry['fields']['title'];
                            $entry['fields']['title'] = cleanTitle($original);
                            $changed = ($entry['fields']['title'] !== $original);
                        }
                        break;
                    }
                }
                
                if (!$found) {
                    errorResponse('Entry not found: ' . $citekey);
                }
                
                if ($changed) {
                    writeBibFile($entries);
                }
                
                jsonResponse(['success' => true, 'changed' => $changed]);
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
            
            case 'search_doi':
                $query = $input['query'] ?? '';
                $journal = $input['journal'] ?? '';
                $volume = $input['volume'] ?? '';
                $page = $input['page'] ?? '';
                
                if (!$query && !($journal && $volume && $page)) {
                    errorResponse('Search query or journal+volume+page required');
                }
                
                $context = stream_context_create([
                    'http' => [
                        'method' => 'GET',
                        'header' => "Accept: application/json\r\nUser-Agent: BibTeXManager/1.0 (mailto:user@example.com)\r\n",
                        'timeout' => 15
                    ]
                ]);
                
                $results = [];
                $seenDois = [];
                
                // Extract first page number
                $firstPage = $page;
                if (preg_match('/^(\d+)/', $page, $m)) {
                    $firstPage = $m[1];
                }
                
                // Try to construct DOI directly for known journal patterns
                $constructedDois = [];
                $journalLower = strtolower($journal);
                
                // APS journals - DOI pattern: 10.1103/{JournalCode}.{volume}.{page}
                $apsPatterns = [
                    'phys. rev. lett.' => 'PhysRevLett',
                    'physical review letters' => 'PhysRevLett',
                    'prl' => 'PhysRevLett',
                    'phys. rev. b' => 'PhysRevB',
                    'physical review b' => 'PhysRevB',
                    'prb' => 'PhysRevB',
                    'phys. rev. a' => 'PhysRevA',
                    'physical review a' => 'PhysRevA',
                    'pra' => 'PhysRevA',
                    'phys. rev. c' => 'PhysRevC',
                    'phys. rev. d' => 'PhysRevD',
                    'phys. rev. e' => 'PhysRevE',
                    'rev. mod. phys.' => 'RevModPhys',
                    'reviews of modern physics' => 'RevModPhys',
                ];
                
                foreach ($apsPatterns as $pattern => $code) {
                    if (strpos($journalLower, $pattern) !== false && $volume && $firstPage) {
                        $constructedDois[] = "10.1103/{$code}.{$volume}.{$firstPage}";
                        break;
                    }
                }
                
                // IOP journals - pattern: 10.1088/{issn}/{volume}/{issue}/{page}
                // Simpler pattern for older papers: 10.1088/0022-3719/{volume}/{issue}/{page}
                if (strpos($journalLower, 'j. phys. c') !== false || strpos($journalLower, 'journal of physics c') !== false) {
                    if ($volume && $firstPage) {
                        // Try common issue numbers
                        for ($issue = 1; $issue <= 24; $issue++) {
                            $constructedDois[] = "10.1088/0022-3719/{$volume}/{$issue}/{$firstPage}";
                        }
                    }
                }
                
                // Validate constructed DOIs by trying to fetch them
                foreach ($constructedDois as $doi) {
                    $checkUrl = "https://api.crossref.org/works/" . urlencode($doi);
                    $checkResponse = @file_get_contents($checkUrl, false, $context);
                    if ($checkResponse !== false) {
                        $checkData = json_decode($checkResponse, true);
                        if ($checkData && isset($checkData['message'])) {
                            $item = $checkData['message'];
                            $authorNames = [];
                            if (isset($item['author'])) {
                                foreach ($item['author'] as $a) {
                                    $family = $a['family'] ?? '';
                                    $given = $a['given'] ?? '';
                                    if ($family && $given) {
                                        $authorNames[] = $given . ' ' . $family;
                                    } elseif ($family) {
                                        $authorNames[] = $family;
                                    }
                                }
                            }
                            $seenDois[$doi] = true;
                            $results[] = [
                                'doi' => $doi,
                                'title' => ($item['title'][0] ?? 'No title'),
                                'authors' => implode(', ', $authorNames),
                                'year' => $item['published']['date-parts'][0][0] ?? $item['issued']['date-parts'][0][0] ?? '',
                                'journal' => $item['container-title'][0] ?? '',
                                'volume' => $item['volume'] ?? '',
                                'page' => $item['page'] ?? '',
                                'source' => 'Direct DOI'
                            ];
                            break; // Found valid DOI, stop checking
                        }
                    }
                }
                
                // Search CrossRef for DOIs matching the query
                if ($query) {
                    $url = 'https://api.crossref.org/works?' . http_build_query([
                        'query.bibliographic' => $query,
                        'rows' => 5
                    ]);
                
                $response = @file_get_contents($url, false, $context);
                if ($response !== false) {
                    $data = json_decode($response, true);
                    if ($data && isset($data['message']['items'])) {
                        foreach ($data['message']['items'] as $item) {
                            $doi = $item['DOI'] ?? '';
                            if (!$doi || isset($seenDois[$doi])) continue;
                            $seenDois[$doi] = true;
                            
                            $authorNames = [];
                            if (isset($item['author'])) {
                                foreach ($item['author'] as $a) {
                                    $family = $a['family'] ?? '';
                                    $given = $a['given'] ?? '';
                                    if ($family && $given) {
                                        $authorNames[] = $given . ' ' . $family;
                                    } elseif ($family) {
                                        $authorNames[] = $family;
                                    } elseif (isset($a['name'])) {
                                        $authorNames[] = $a['name'];
                                    }
                                }
                            }
                            $results[] = [
                                'doi' => $doi,
                                'title' => ($item['title'][0] ?? 'No title'),
                                'authors' => implode(', ', $authorNames),
                                'year' => $item['published']['date-parts'][0][0] ?? $item['issued']['date-parts'][0][0] ?? '',
                                'journal' => $item['container-title'][0] ?? '',
                                'volume' => $item['volume'] ?? '',
                                'page' => $item['page'] ?? '',
                                'source' => 'CrossRef'
                            ];
                        }
                    }
                }
                } // end if ($query)
                
                // If CrossRef found few/no results, also search OpenAlex (better coverage for older papers)
                if (count($results) < 3 && $query) {
                    $openAlexUrl = 'https://api.openalex.org/works?' . http_build_query([
                        'search' => $query,
                        'per_page' => 5,
                        'select' => 'doi,title,authorships,publication_year,primary_location,biblio'
                    ]);
                    
                    $oaResponse = @file_get_contents($openAlexUrl, false, $context);
                    if ($oaResponse !== false) {
                        $oaData = json_decode($oaResponse, true);
                        if ($oaData && isset($oaData['results'])) {
                            foreach ($oaData['results'] as $item) {
                                $doi = $item['doi'] ?? '';
                                // OpenAlex returns full URL, extract DOI
                                if ($doi && strpos($doi, 'doi.org/') !== false) {
                                    $doi = preg_replace('/^https?:\/\/doi\.org\//', '', $doi);
                                }
                                if (!$doi || isset($seenDois[$doi])) continue;
                                $seenDois[$doi] = true;
                                
                                $authorNames = [];
                                if (isset($item['authorships'])) {
                                    foreach ($item['authorships'] as $auth) {
                                        if (isset($auth['author']['display_name'])) {
                                            $authorNames[] = $auth['author']['display_name'];
                                        }
                                    }
                                }
                                
                                $journal = '';
                                if (isset($item['primary_location']['source']['display_name'])) {
                                    $journal = $item['primary_location']['source']['display_name'];
                                }
                                
                                $results[] = [
                                    'doi' => $doi,
                                    'title' => ($item['title'] ?? 'No title'),
                                    'authors' => implode(', ', $authorNames),
                                    'year' => $item['publication_year'] ?? '',
                                    'journal' => $journal,
                                    'volume' => $item['biblio']['volume'] ?? '',
                                    'page' => $item['biblio']['first_page'] ?? '',
                                    'source' => 'OpenAlex'
                                ];
                            }
                        }
                    }
                }
                
                if (count($results) === 0) {
                    errorResponse('No DOIs found in CrossRef or OpenAlex');
                }
                
                jsonResponse(['results' => $results]);
                break;
            
            case 'search_isbn':
                // Search for books using Google Books API
                $query = $input['query'] ?? '';
                $title = $input['title'] ?? '';
                $author = $input['author'] ?? '';
                $publisher = $input['publisher'] ?? '';
                $year = $input['year'] ?? '';
                
                if (!$query && !$title) {
                    errorResponse('Search query or title required');
                }
                
                $context = stream_context_create([
                    'http' => [
                        'method' => 'GET',
                        'header' => "Accept: application/json\r\nUser-Agent: BibTeXManager/1.0\r\n",
                        'timeout' => 15
                    ]
                ]);
                
                $results = [];
                
                // Build Google Books query
                $searchParts = [];
                if ($title) {
                    $searchParts[] = 'intitle:' . urlencode($title);
                }
                if ($author) {
                    // Extract first author's last name
                    $authorParts = preg_split('/\s+and\s+/i', $author);
                    if (!empty($authorParts[0])) {
                        $firstAuthor = trim($authorParts[0]);
                        if (strpos($firstAuthor, ',') !== false) {
                            $firstAuthor = trim(explode(',', $firstAuthor)[0]);
                        }
                        $searchParts[] = 'inauthor:' . urlencode($firstAuthor);
                    }
                }
                if ($publisher) {
                    $searchParts[] = 'inpublisher:' . urlencode($publisher);
                }
                
                $googleQuery = !empty($searchParts) ? implode('+', $searchParts) : urlencode($query);
                $googleUrl = "https://www.googleapis.com/books/v1/volumes?q={$googleQuery}&maxResults=10";
                
                $response = @file_get_contents($googleUrl, false, $context);
                if ($response !== false) {
                    $data = json_decode($response, true);
                    if ($data && isset($data['items'])) {
                        foreach ($data['items'] as $item) {
                            $info = $item['volumeInfo'] ?? [];
                            
                            // Extract ISBNs
                            $isbn10 = '';
                            $isbn13 = '';
                            if (isset($info['industryIdentifiers'])) {
                                foreach ($info['industryIdentifiers'] as $id) {
                                    if ($id['type'] === 'ISBN_10') {
                                        $isbn10 = $id['identifier'];
                                    } elseif ($id['type'] === 'ISBN_13') {
                                        $isbn13 = $id['identifier'];
                                    }
                                }
                            }
                            
                            // Skip entries without ISBN
                            if (!$isbn10 && !$isbn13) continue;
                            
                            // Extract authors
                            $authors = isset($info['authors']) ? implode(' and ', $info['authors']) : '';
                            
                            // Extract year from publishedDate
                            $pubYear = '';
                            if (isset($info['publishedDate'])) {
                                if (preg_match('/^(\d{4})/', $info['publishedDate'], $m)) {
                                    $pubYear = $m[1];
                                }
                            }
                            
                            $results[] = [
                                'isbn' => $isbn13 ?: $isbn10,
                                'isbn10' => $isbn10,
                                'isbn13' => $isbn13,
                                'title' => $info['title'] ?? 'No title',
                                'authors' => $authors,
                                'year' => $pubYear,
                                'publisher' => $info['publisher'] ?? '',
                                'source' => 'Google Books'
                            ];
                        }
                    }
                }
                
                // Also try Open Library
                $olQuery = urlencode($title ?: $query);
                // Timeout context for edition lookups (Open Library can be slow)
                $editionContext = stream_context_create([
                    'http' => [
                        'method' => 'GET',
                        'header' => "Accept: application/json\r\nUser-Agent: BibTeXManager/1.0\r\n",
                        'timeout' => 12
                    ]
                ]);
                
                $olUrl = "https://openlibrary.org/search.json?title={$olQuery}&limit=5";
                
                $olResponse = @file_get_contents($olUrl, false, $context);
                $editionLookups = 0; // Limit edition API calls (slow, ~10s each)
                $maxEditionLookups = 1;
                
                if ($olResponse !== false) {
                    $olData = json_decode($olResponse, true);
                    if ($olData && isset($olData['docs'])) {
                        foreach ($olData['docs'] as $doc) {
                            // Get ISBN - first try direct from search results
                            $isbn = '';
                            $isbn10 = '';
                            $isbn13 = '';
                            if (isset($doc['isbn']) && !empty($doc['isbn'])) {
                                // Prefer ISBN-13 (starts with 978 or 979)
                                foreach ($doc['isbn'] as $i) {
                                    if (strlen($i) === 13) {
                                        $isbn13 = $i;
                                        if (!$isbn) $isbn = $i;
                                    } elseif (strlen($i) === 10) {
                                        $isbn10 = $i;
                                        if (!$isbn) $isbn = $i;
                                    }
                                }
                            }
                            
                            // Track edition data for fallback
                            $editionAuthors = '';
                            $editionPublisher = '';
                            $editionYear = '';
                            
                            // If no ISBN in search results, try to fetch from editions endpoint (limited)
                            if (!$isbn && isset($doc['key']) && $editionLookups < $maxEditionLookups) {
                                $editionLookups++;
                                $workKey = $doc['key']; // e.g., /works/OL19605581W
                                $editionsUrl = "https://openlibrary.org{$workKey}/editions.json?limit=1";
                                $edResponse = @file_get_contents($editionsUrl, false, $editionContext);
                                if ($edResponse !== false) {
                                    $edData = json_decode($edResponse, true);
                                    if ($edData && isset($edData['entries'])) {
                                        foreach ($edData['entries'] as $edition) {
                                            // Check for ISBN-13 first
                                            if (isset($edition['isbn_13']) && !empty($edition['isbn_13'])) {
                                                $isbn13 = $edition['isbn_13'][0];
                                                $isbn = $isbn13;
                                            }
                                            // Check for ISBN-10
                                            if (isset($edition['isbn_10']) && !empty($edition['isbn_10'])) {
                                                $isbn10 = $edition['isbn_10'][0];
                                                if (!$isbn) $isbn = $isbn10;
                                            }
                                            
                                            // Extract contributors/editors (for edited volumes)
                                            if (isset($edition['contributions']) && !empty($edition['contributions'])) {
                                                $editionAuthors = implode(' and ', $edition['contributions']);
                                            }
                                            // Extract authors if available
                                            if (isset($edition['authors']) && !empty($edition['authors'])) {
                                                // Authors are references like {"key": "/authors/OL123A"}
                                                // Use by_statement as fallback
                                            }
                                            // Use by_statement as additional info (e.g., "edited by X and Y")
                                            if (!$editionAuthors && isset($edition['by_statement'])) {
                                                $byStmt = $edition['by_statement'];
                                                // Extract names from "edited by X and Y" or "by X"
                                                if (preg_match('/(?:edited\s+)?by\s+(.+?)\.?$/i', $byStmt, $m)) {
                                                    $editionAuthors = trim($m[1]);
                                                }
                                            }
                                            
                                            // Extract publisher
                                            if (isset($edition['publishers']) && !empty($edition['publishers'])) {
                                                $editionPublisher = $edition['publishers'][0];
                                            }
                                            
                                            // Extract year from publish_date
                                            if (isset($edition['publish_date'])) {
                                                if (preg_match('/(\d{4})/', $edition['publish_date'], $ym)) {
                                                    $editionYear = $ym[1];
                                                }
                                            }
                                            
                                            if ($isbn) break; // Found ISBN, stop looking
                                        }
                                    }
                                }
                            }
                            
                            if (!$isbn) continue;
                            
                            // Skip duplicates
                            $isDupe = false;
                            foreach ($results as $r) {
                                if ($r['isbn'] === $isbn || $r['isbn13'] === $isbn || $r['isbn10'] === $isbn) {
                                    $isDupe = true;
                                    break;
                                }
                            }
                            if ($isDupe) continue;
                            
                            // Get authors from search results, fallback to edition data
                            $authors = isset($doc['author_name']) ? implode(' and ', $doc['author_name']) : '';
                            if (!$authors && $editionAuthors) {
                                $authors = $editionAuthors;
                            }
                            
                            // Get year from search results, fallback to edition data
                            $pubYear = '';
                            if (isset($doc['publish_year']) && !empty($doc['publish_year'])) {
                                $pubYear = $doc['publish_year'][0];
                            } elseif (isset($doc['first_publish_year'])) {
                                $pubYear = $doc['first_publish_year'];
                            } elseif ($editionYear) {
                                $pubYear = $editionYear;
                            }
                            
                            // Get publisher from search results, fallback to edition data
                            $publisher = isset($doc['publisher']) ? $doc['publisher'][0] : '';
                            if (!$publisher && $editionPublisher) {
                                $publisher = $editionPublisher;
                            }
                            
                            $results[] = [
                                'isbn' => $isbn,
                                'isbn10' => $isbn10,
                                'isbn13' => $isbn13,
                                'title' => $doc['title'] ?? 'No title',
                                'authors' => $authors,
                                'year' => $pubYear,
                                'publisher' => $publisher,
                                'source' => 'Open Library'
                            ];
                        }
                    }
                }
                
                // Filter by year if provided and rank by title match
                if (count($results) > 0) {
                    $searchTitle = strtolower(preg_replace('/[^a-z0-9]+/', ' ', strtolower($title ?: $query)));
                    $yearNum = $year ? intval($year) : 0;
                    
                    usort($results, function($a, $b) use ($searchTitle, $yearNum) {
                        // Calculate title similarity
                        $aTitle = strtolower(preg_replace('/[^a-z0-9]+/', ' ', strtolower($a['title'])));
                        $bTitle = strtolower(preg_replace('/[^a-z0-9]+/', ' ', strtolower($b['title'])));
                        
                        $aTitleMatch = ($aTitle === $searchTitle) ? 2 : (strpos($aTitle, $searchTitle) !== false || strpos($searchTitle, $aTitle) !== false ? 1 : 0);
                        $bTitleMatch = ($bTitle === $searchTitle) ? 2 : (strpos($bTitle, $searchTitle) !== false || strpos($searchTitle, $bTitle) !== false ? 1 : 0);
                        
                        if ($aTitleMatch !== $bTitleMatch) {
                            return $bTitleMatch - $aTitleMatch; // Higher match first
                        }
                        
                        // Then by year proximity
                        if ($yearNum > 0) {
                            $aYear = intval($a['year']) ?: 0;
                            $bYear = intval($b['year']) ?: 0;
                            $aYearDiff = $aYear ? abs($aYear - $yearNum) : 100;
                            $bYearDiff = $bYear ? abs($bYear - $yearNum) : 100;
                            return $aYearDiff - $bYearDiff;
                        }
                        
                        return 0;
                    });
                }
                
                if (count($results) === 0) {
                    errorResponse('No ISBNs found in Google Books or Open Library');
                }
                
                jsonResponse(['results' => $results]);
                break;
            
            case 'lookup_doi':
                $doi = $input['doi'] ?? '';
                if (!$doi) {
                    errorResponse('DOI required');
                }
                
                // Clean DOI
                $doi = preg_replace('/^https?:\/\/(dx\.)?doi\.org\//', '', trim($doi));
                $doi = preg_replace('/[{}]/', '', $doi);
                
                // Determine if DataCite or CrossRef
                $useDataCite = preg_match('/^10\.(5281|48550|5072|7910|17632|6084|5067|5061)\//', $doi);
                $isArxiv = str_starts_with($doi, '10.48550/');
                
                $context = stream_context_create([
                    'http' => [
                        'method' => 'GET',
                        'header' => "Accept: application/json\r\nUser-Agent: BibTeXManager/1.0 (mailto:user@example.com)\r\n",
                        'timeout' => 15
                    ]
                ]);
                
                $work = null;
                
                if ($useDataCite) {
                    $url = "https://api.datacite.org/dois/" . urlencode($doi);
                    $response = @file_get_contents($url, false, $context);
                    if ($response === false) {
                        errorResponse('DataCite lookup failed');
                    }
                    $data = json_decode($response, true);
                    if (!$data || !isset($data['data']['attributes'])) {
                        errorResponse('Invalid DataCite response');
                    }
                    $attrs = $data['data']['attributes'];
                    
                    // Convert DataCite to common format
                    $work = [
                        'author' => [],
                        'title' => $attrs['titles'][0]['title'] ?? null,
                        'container-title' => $attrs['container']['title'] ?? null,
                        'year' => $attrs['publicationYear'] ?? null,
                        'publisher' => $attrs['publisher'] ?? null,
                        'arxivId' => null
                    ];
                    
                    if (isset($attrs['creators'])) {
                        foreach ($attrs['creators'] as $creator) {
                            if (isset($creator['familyName']) && isset($creator['givenName'])) {
                                $work['author'][] = ['family' => $creator['familyName'], 'given' => $creator['givenName']];
                            } elseif (isset($creator['name'])) {
                                $work['author'][] = ['name' => $creator['name']];
                            }
                        }
                    }
                    
                    if ($isArxiv && isset($attrs['identifiers'])) {
                        foreach ($attrs['identifiers'] as $id) {
                            if (($id['identifierType'] ?? '') === 'arXiv') {
                                $work['arxivId'] = $id['identifier'];
                                break;
                            }
                        }
                    }
                } else {
                    $url = "https://api.crossref.org/works/" . urlencode($doi);
                    $response = @file_get_contents($url, false, $context);
                    if ($response === false) {
                        errorResponse('CrossRef lookup failed');
                    }
                    $data = json_decode($response, true);
                    if (!$data || !isset($data['message'])) {
                        errorResponse('Invalid CrossRef response');
                    }
                    $msg = $data['message'];
                    
                    $work = [
                        'author' => $msg['author'] ?? [],
                        'editor' => $msg['editor'] ?? [],
                        'title' => $msg['title'][0] ?? null,
                        'short-container-title' => $msg['short-container-title'][0] ?? null,
                        'container-title' => $msg['container-title'][0] ?? null,
                        'year' => $msg['published']['date-parts'][0][0] ?? $msg['issued']['date-parts'][0][0] ?? null,
                        'volume' => $msg['volume'] ?? null,
                        'issue' => $msg['issue'] ?? null,
                        'page' => $msg['page'] ?? null,
                        'article-number' => $msg['article-number'] ?? null,
                        'ISSN' => $msg['ISSN'][0] ?? null,
                        'ISBN' => $msg['ISBN'][0] ?? null,
                        'publisher' => $msg['publisher'] ?? null,
                        'type' => $msg['type'] ?? null,
                        'edition' => $msg['edition-number'] ?? null
                    ];
                }
                
                jsonResponse([
                    'work' => $work,
                    'doi' => $doi,
                    'useDataCite' => $useDataCite,
                    'isArxiv' => $isArxiv
                ]);
                break;
            
            case 'lookup_isbn':
                $isbn = $input['isbn'] ?? '';
                if (!$isbn) {
                    errorResponse('ISBN required');
                }
                
                // Clean ISBN: remove hyphens, spaces, and any non-alphanumeric chars
                $isbn = preg_replace('/[^0-9Xx]/', '', $isbn);
                
                // Query Open Library API
                $url = "https://openlibrary.org/api/books?bibkeys=ISBN:{$isbn}&format=json&jscmd=data";
                
                $context = stream_context_create([
                    'http' => [
                        'method' => 'GET',
                        'header' => "Accept: application/json\r\nUser-Agent: BibTeXManager/1.0\r\n",
                        'timeout' => 15
                    ]
                ]);
                
                $response = @file_get_contents($url, false, $context);
                if ($response === false) {
                    errorResponse('Open Library lookup failed');
                }
                
                $data = json_decode($response, true);
                $key = "ISBN:{$isbn}";
                
                if (!$data || !isset($data[$key])) {
                    errorResponse('ISBN not found in Open Library');
                }
                
                $book = $data[$key];
                
                // Extract authors
                $authors = [];
                if (isset($book['authors'])) {
                    foreach ($book['authors'] as $a) {
                        $authors[] = $a['name'] ?? '';
                    }
                }
                
                // Extract year from publish_date (can be "2020", "January 2020", etc.)
                $year = null;
                if (isset($book['publish_date'])) {
                    if (preg_match('/\b(19|20)\d{2}\b/', $book['publish_date'], $matches)) {
                        $year = $matches[0];
                    }
                }
                
                // Get ISBN-13 if available, else ISBN-10
                $isbn13 = $book['identifiers']['isbn_13'][0] ?? null;
                $isbn10 = $book['identifiers']['isbn_10'][0] ?? null;
                $cleanIsbn = $isbn13 ?? $isbn10 ?? $isbn;
                
                // Format ISBN with hyphens (basic formatting for ISBN-13)
                if (strlen($cleanIsbn) === 13) {
                    $cleanIsbn = substr($cleanIsbn, 0, 3) . '-' . 
                                 substr($cleanIsbn, 3, 1) . '-' . 
                                 substr($cleanIsbn, 4, 3) . '-' . 
                                 substr($cleanIsbn, 7, 5) . '-' . 
                                 substr($cleanIsbn, 12, 1);
                }
                
                $work = [
                    'title' => $book['title'] ?? null,
                    'author' => $authors,
                    'year' => $year,
                    'publisher' => isset($book['publishers'][0]) ? $book['publishers'][0]['name'] : null,
                    'isbn' => $cleanIsbn,
                    'pages' => $book['number_of_pages'] ?? null
                ];
                
                jsonResponse(['work' => $work, 'isbn' => $cleanIsbn]);
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
