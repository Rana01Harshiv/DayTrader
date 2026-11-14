import fs from 'fs';
// template.html = head/styles + <body> start; body.html = controls + script. Joined and data-embedded here.
let t = fs.readFileSync('template.html', 'utf8');
const cut = t.indexOf('<div class="bar">');
if (cut > -1) t = t.slice(0, cut);                       // keep head + title + meta + warning
t = t.replace(/<\/body>[\s\S]*$/, '');
const data = fs.readFileSync('picks.json', 'utf8').replace(/</g, '\\u003c');
const html = t + fs.readFileSync('body.html', 'utf8').replace('/*DATA*/', () => data) + '</body></html>\n';
fs.writeFileSync('trade-scanner.html', html);
console.log('built', html.length, 'bytes');
