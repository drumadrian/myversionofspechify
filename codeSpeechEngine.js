/**
 * CodeSpeechEngine
 * 
 * Intelligent preprocessor that translates code syntax, programming identifiers,
 * operators, and structural blocks into natural, crystal-clear spoken words and SSML
 * for Amazon Polly Neural TTS.
 */

// Split camelCase, PascalCase, snake_case, kebab-case into natural words
function splitIdentifier(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    // Replace underscores and hyphens with spaces
    .replace(/[_-]+/g, ' ')
    // Split camelCase and PascalCase
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

// Map common programming operators and symbols to spoken equivalents
const OPERATOR_MAP = [
  { regex: /===/g, spoken: ' strictly equals ' },
  { regex: /!==/g, spoken: ' does not strictly equal ' },
  { regex: /==/g, spoken: ' equals ' },
  { regex: /!=/g, spoken: ' is not equal to ' },
  { regex: /<=/g, spoken: ' is less than or equal to ' },
  { regex: />=/g, spoken: ' is greater than or equal to ' },
  { regex: /=>/g, spoken: ' arrow function ' },
  { regex: /->/g, spoken: ' arrow ' },
  { regex: /\+\+/g, spoken: ' plus plus ' },
  { regex: /--/g, spoken: ' minus minus ' },
  { regex: /\+=/g, spoken: ' plus equals ' },
  { regex: /-=/g, spoken: ' minus equals ' },
  { regex: /\*=/g, spoken: ' times equals ' },
  { regex: /\/=/g, spoken: ' divided by equals ' },
  { regex: /&&/g, spoken: ' and ' },
  { regex: /\|\|/g, spoken: ' or ' },
  { regex: /\?\./g, spoken: ' optional dot ' },
  { regex: /\?\?/g, spoken: ' nullish coalescing ' },
  { regex: /\.\.\./g, spoken: ' spread operator ' },
  { regex: /<<|>>/g, spoken: ' bitshift ' },
  { regex: /</g, spoken: ' less than ' },
  { regex: />/g, spoken: ' greater than ' },
  { regex: /=/g, spoken: ' equals ' },
  { regex: /!([a-zA-Z0-9_])/g, spoken: ' not $1' },
];

// Keywords pronunciation enhancements
const KEYWORD_MAP = [
  { regex: /\bconst\b/g, spoken: 'constant' },
  { regex: /\blet\b/g, spoken: 'let' },
  { regex: /\bvar\b/g, spoken: 'variable' },
  { regex: /\basync\s+function\b/g, spoken: 'async function' },
  { regex: /\bfunction\b/g, spoken: 'function' },
  { regex: /\bdef\s+/g, spoken: 'define function ' },
  { regex: /\breturn\b/g, spoken: 'return' },
  { regex: /\bconsole\.log\b/g, spoken: 'console log' },
  { regex: /\bconsole\.error\b/g, spoken: 'console error' },
  { regex: /\bconsole\.warn\b/g, spoken: 'console warn' },
  { regex: /\bimport\s+(.*?)\s+from\s+/g, spoken: 'import $1 from ' },
  { regex: /\bexport\s+default\b/g, spoken: 'export default' },
  { regex: /\btypeof\b/g, spoken: 'type of' },
  { regex: /\binstanceof\b/g, spoken: 'instance of' },
  { regex: /\bNaN\b/g, spoken: 'Not a Number' },
  { regex: /\bnull\b/g, spoken: 'null' },
  { regex: /\bundefined\b/g, spoken: 'undefined' },
  { regex: /\bbool|boolean\b/g, spoken: 'boolean' },
];

/**
 * Detect whether input text looks like code or contains code snippets
 */
function isCodeContent(text) {
  if (!text) return false;
  // Markdown code block
  if (text.includes('```')) return true;
  
  // Strong code indicators
  const codeIndicators = [
    /\b(const|let|var|function|def|class|import|export|return|async|await)\b/,
    /[{};]\s*$/,
    /(=>|===|!==|console\.log|<div|<template)/,
    /\b(public|private|protected|interface|struct|fn|pub)\b/,
    /\bdef\s+\w+\s*\(.*\):/,
    /#include\s*<.*>/,
  ];

  let matches = 0;
  for (const indicator of codeIndicators) {
    if (indicator.test(text)) matches++;
  }
  return matches >= 2 || (matches >= 1 && (text.includes('{') && text.includes('}')));
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Clean and pronounce a single line of code in natural spoken English
 */
function formatCodeLineNatural(line, lineNum) {
  let trimmed = line.trim();
  if (!trimmed) return '';

  // Handle markdown horizontal dividers
  if (/^[-*_]{3,}$/.test(trimmed)) {
    return '';
  }

  // Handle markdown headers (e.g. #, ##, ###)
  if (/^#{1,6}\s+/.test(trimmed)) {
    const headerText = trimmed.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '');
    return `Section: ${headerText}.`;
  }

  // Handle single-line comments
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    const commentText = trimmed.replace(/^(\/\/|#+)\s*/, '').replace(/[*_`]/g, '');
    return `Comment: ${commentText}.`;
  }

  // Handle multi-line comment starts
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    const commentText = trimmed.replace(/^(\/\*|\*|\*\/)\s*/, '').replace(/[*_`]/g, '');
    return commentText ? `Comment: ${commentText}.` : '';
  }

  let spoken = trimmed;

  // Replace common keywords
  for (const item of KEYWORD_MAP) {
    spoken = spoken.replace(item.regex, item.spoken);
  }

  // Replace operators
  for (const item of OPERATOR_MAP) {
    spoken = spoken.replace(item.regex, item.spoken);
  }

  // Handle braces and parentheses nicely
  spoken = spoken
    .replace(/\{\s*$/g, ', opens block.')
    .replace(/^\s*\}/g, 'close block.')
    .replace(/\(\s*\)/g, ' with empty parameters ')
    .replace(/\(\s*\(/g, ' with argument ')
    .replace(/\)/g, ' ')
    .replace(/\(/g, ' with argument ')
    .replace(/\[/g, ' index ')
    .replace(/\]/g, ' ')
    .replace(/;/g, '. ')
    .replace(/,\s*/g, ', ');

  // Split any remaining identifiers like camelCase
  spoken = spoken.replace(/\b([a-zA-Z][a-zA-Z0-9_]{3,})\b/g, (match) => {
    return splitIdentifier(match);
  });

  // Clean up excessive whitespace
  spoken = spoken.replace(/\s+/g, ' ').trim();
  if (spoken && !spoken.endsWith('.')) {
    spoken += '.';
  }

  return spoken;
}

/**
 * Format entire code into natural spoken text
 * @param {string} code 
 * @param {object} options { mode: 'natural' | 'detailed' | 'ssml', includeLineNumbers: boolean, returnLines: boolean }
 */
function processCodeForSpeech(code, options = {}) {
  const { mode = 'natural', useSSML = false, includeLineNumbers = false, returnLines = false } = options;

  // Extract from markdown code fences if present
  let cleanCode = code;
  const codeBlockRegex = /```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g;
  let codeBlocks = [];
  let match;
  while ((match = codeBlockRegex.exec(code)) !== null) {
    codeBlocks.push(match[1]);
  }
  if (codeBlocks.length > 0) {
    cleanCode = codeBlocks.join('\n\n');
  }

  const lines = cleanCode.split('\n');
  const spokenLines = [];

  lines.forEach((line, index) => {
    const naturalSpoken = formatCodeLineNatural(line, index + 1);
    if (naturalSpoken) {
      if (includeLineNumbers) {
        spokenLines.push(`Line ${index + 1}: ${naturalSpoken}`);
      } else {
        spokenLines.push(naturalSpoken);
      }
    }
  });

  if (returnLines) {
    return spokenLines;
  }

  if (useSSML) {
    // Wrap with SSML pauses for high quality Neural synthesis
    const ssmlContent = spokenLines
      .map(line => `<s>${escapeXml(line)}</s><break time="250ms"/>`)
      .join('\n');
    return `<speak>\n<p>\n${ssmlContent}\n</p>\n</speak>`;
  }

  return spokenLines.join('\n');
}

module.exports = {
  splitIdentifier,
  isCodeContent,
  processCodeForSpeech,
  escapeXml,
};
