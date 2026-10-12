import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true});
fs.cpSync(path.join(root,'public'),path.join(dist,'client'),{recursive:true});
fs.mkdirSync(path.join(dist,'server'));fs.copyFileSync(path.join(root,'worker/index.js'),path.join(dist,'server/index.js'));
fs.mkdirSync(path.join(dist,'.openai'));fs.copyFileSync(path.join(root,'.openai/hosting.json'),path.join(dist,'.openai/hosting.json'));
console.log('Built map assets and campaign Worker');
