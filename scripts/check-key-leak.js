const fs = require('fs');
const path = require('path');

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Match Groq API key format: gsk_[a-zA-Z0-9]{30,}
  const keyRegex = /gsk_[a-zA-Z0-9]{20,}/g;
  const matches = content.match(keyRegex);
  if (matches) {
    console.error(`❌ SECURITY ALERT: Unmasked Groq API key detected in ${filePath}!`);
    console.error(`Matches found: ${matches.map(m => m.slice(0, 8) + '...').join(', ')}`);
    return true;
  }
  return false;
}

function scanDir(dir) {
  let leaks = false;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'node_modules' || f === '.git' || f === 'data' || f === '.env') continue;
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (scanDir(fullPath)) leaks = true;
    } else if (f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.html') || f.endsWith('.css')) {
      if (scanFile(fullPath)) leaks = true;
    }
  }
  return leaks;
}

console.log('🔍 Executing Security Pre-Commit Key Leak Scan...');
const leaksFound = scanDir(process.cwd());

if (leaksFound) {
  console.error('⛔ Key leak scan FAILED: Real API key detected in source/test files!');
  process.exit(1);
} else {
  console.log('✅ Key leak scan PASSED: No API keys found in codebase.');
}
