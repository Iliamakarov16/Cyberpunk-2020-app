import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const destination=path.join(root,'dist','crew-client');
fs.rmSync(destination,{recursive:true,force:true});
fs.mkdirSync(destination,{recursive:true});
const allowlist=['index.html','app.js','style.css','map-graphics.css','dossier.css','atlas-palette.css','cyberdeck.css','cyberdeck.js','raster-refinement.js','city-atlas-transition.css','theme.js','cartography.js','data.js','atlas-data.json','streets-data.js','streets-data.json','world-data.js','world-data.json','transit-data.js','transit-data.json','transit.js','crew-campaign.js','crew-bridge.js','assets','fonts','style-textures'];
for(const name of allowlist)fs.cpSync(path.join(root,'public',name),path.join(destination,name),{recursive:true});
// Regeneration inputs remain in the source archive; the runtime needs only
// the palette variants and optional printed comparison, never these duplicates.
for(const file of ['assets/geography-2020/draken-original-v8.jpg','assets/geography-2020/clean-basemap-v8.webp'])fs.rmSync(path.join(destination,file),{force:true});
// A reused output directory must never retain the standalone independent service.
fs.rmSync(path.join(destination,'campaign.js'),{force:true});
let html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
html=html.replace('<meta name="referrer"',`<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer"`);
html=html.replace('<script defer src="campaign.js?v=8"></script>','<script defer src="crew-campaign.js?v=9"></script><script defer src="crew-bridge.js?v=9"></script>');
html=html.replace('<body>','<body class="crew-atlas">');
fs.writeFileSync(path.join(destination,'index.html'),html);
const manifest=[];
function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Unexpected symlink in public client: '+file);if(entry.isDirectory())scan(file);else{const bytes=fs.readFileSync(file);manifest.push({path:path.relative(destination,file),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}}
scan(destination);manifest.sort((a,b)=>a.path.localeCompare(b.path));fs.mkdirSync(path.join(root,'qa'),{recursive:true});fs.writeFileSync(path.join(root,'qa','crew-client-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Crew iframe assets prepared at '+destination+'; authenticated same-origin API only, no standalone campaign service.');
