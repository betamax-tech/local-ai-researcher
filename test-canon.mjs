import { canonicalizeUrl } from './dist/lib/url.js';

const urls = [
  'https://example.com/article',
  'https://www.example.com/article/',
  'https://EXAMPLE.COM/ARTICLE#section',
];

console.log('Canonicalizations:');
const canonical = urls.map(u => {
  try {
    return canonicalizeUrl(u);
  } catch(e) {
    return 'ERROR: ' + e.message;
  }
});

canonical.forEach((c, i) => {
  console.log(`  [${i}] ${urls[i]} → ${c}`);
});

console.log('\nUnique:');
console.log(`  Set size: ${new Set(canonical).size}`);
console.log(`  Deduped: ${urls.length - new Set(canonical).size}`);
