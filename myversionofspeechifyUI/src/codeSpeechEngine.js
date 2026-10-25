/**
 * Client-side CodeSpeechEngine for instant spoken previews
 */

export function splitIdentifier(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

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
  { regex: /</g, spoken: ' less than ' },
  { regex: />/g, spoken: ' greater than ' },
  { regex: /=/g, spoken: ' equals ' },
];

const KEYWORD_MAP = [
  { regex: /\bconst\b/g, spoken: 'constant' },
  { regex: /\blet\b/g, spoken: 'let' },
  { regex: /\bvar\b/g, spoken: 'variable' },
  { regex: /\basync\s+function\b/g, spoken: 'async function' },
  { regex: /\bfunction\b/g, spoken: 'function' },
  { regex: /\bdef\s+/g, spoken: 'define function ' },
  { regex: /\breturn\b/g, spoken: 'return' },
  { regex: /\bconsole\.log\b/g, spoken: 'console log' },
  { regex: /\bimport\s+(.*?)\s+from\s+/g, spoken: 'import $1 from ' },
  { regex: /\bexport\s+default\b/g, spoken: 'export default' },
];

export function isCodeContent(text) {
  if (!text) return false;
  if (text.includes('```')) return true;
  
  const codeIndicators = [
    /\b(const|let|var|function|def|class|import|export|return|async|await)\b/,
    /[{};]\s*$/,
    /(=>|===|!==|console\.log|<div|<template)/,
    /\b(public|private|protected|interface|struct|fn|pub)\b/,
    /\bdef\s+\w+\s*\(.*\):/,
  ];

  let matches = 0;
  for (const indicator of codeIndicators) {
    if (indicator.test(text)) matches++;
  }
  return matches >= 2 || (matches >= 1 && (text.includes('{') && text.includes('}')));
}

export function formatCodeLineNatural(line) {
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

  let spoken = trimmed;

  for (const item of KEYWORD_MAP) {
    spoken = spoken.replace(item.regex, item.spoken);
  }

  for (const item of OPERATOR_MAP) {
    spoken = spoken.replace(item.regex, item.spoken);
  }

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

  spoken = spoken.replace(/\b([a-zA-Z][a-zA-Z0-9_]{3,})\b/g, (match) => {
    return splitIdentifier(match);
  });

  spoken = spoken.replace(/\s+/g, ' ').trim();
  if (spoken && !spoken.endsWith('.')) {
    spoken += '.';
  }

  return spoken;
}

export function processCodeForSpeech(code) {
  if (!code) return '';
  const lines = code.split('\n');
  const spokenLines = [];

  lines.forEach((line) => {
    const naturalSpoken = formatCodeLineNatural(line);
    if (naturalSpoken) {
      spokenLines.push(naturalSpoken);
    }
  });

  return spokenLines.join('\n');
}
