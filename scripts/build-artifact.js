// Extracts the page body between the APP markers in index.html into dist/artifact.html
// (the claude.ai artifact host supplies its own <!doctype>/<head>/<body> wrapper).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<!-- APP:START -->([\s\S]*)<!-- APP:END -->/);
if (!m) throw new Error('APP markers not found in index.html');
const body = m[1].replace(/^<\/head>\s*$/m, '').replace(/^<body>\s*$/m, '');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), body.trim() + '\n');
for (const f of ['solver.js', 'worker.js']) fs.copyFileSync(path.join(root, f), path.join(root, 'dist', f));
console.log('Wrote dist/artifact.html, dist/solver.js, dist/worker.js');
