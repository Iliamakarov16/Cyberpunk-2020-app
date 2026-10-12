// Reuse the existing security/draft/download scenarios, but explicitly load
// both newly integrated scripts. The original test is never modified.
import fs from 'node:fs';
const sourceURL=new URL('../checks/crew-campaign.mjs',import.meta.url);
const text=fs.readFileSync(sourceURL,'utf8')
 .replace("const scripts = ['data.js'","const scripts = ['theme.js','cyberdeck.js','data.js'")
 .replace("from 'jsdom'",`from '${import.meta.resolve('jsdom')}'`)
 .replaceAll('import.meta.url',JSON.stringify(sourceURL.href));
await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
console.log('Independent decoration integration: Crew security, draft, back and download contracts also pass with theme.js and cyberdeck.js loaded.');
