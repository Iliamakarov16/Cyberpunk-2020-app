import {readFileSync,existsSync} from 'node:fs';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// Keep fixtures in memory, but resolve the same runtime module graph as production.
// Transpiling first removes type-only edges (including type-only back references).
export function createTestModuleLoader({
  root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),
  transformSource=source=>source,
  cacheTag='',
}={}) {
  const project=resolve(root);
  const ts=createRequire(join(project,'package.json'))('typescript');
  const modules=new Map();
  const compiling=new Set();
  function moduleFile(file) {
    const path=file instanceof URL?fileURLToPath(file):resolve(project,file);
    if(extname(path))return path;
    for(const suffix of ['.ts','.tsx','.js','.mjs','/index.ts'])if(existsSync(path+suffix))return path+suffix;
    throw new Error(`Cannot resolve test module ${path}`);
  }
  function moduleUrl(input) {
    const file=moduleFile(input);
    if(modules.has(file))return modules.get(file);
    if(compiling.has(file))throw new Error(`Runtime import cycle in test fixture: ${file}`);
    compiling.add(file);
    try {
      const source=transformSource(readFileSync(file,'utf8'),file);
      let output=ts.transpileModule(source,{fileName:file,compilerOptions:{
        module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,
      }}).outputText;
      const emitted=ts.createSourceFile(file+'.js',output,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
      const replacements=[];
      for(const statement of emitted.statements) {
        if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
        const specifier=statement.moduleSpecifier;
        if(!specifier||!ts.isStringLiteral(specifier))continue;
        const spec=specifier.text;
        if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;
        const next=spec.startsWith('@/')?resolve(project,spec.slice(2)):resolve(dirname(file),spec);
        replacements.push({start:specifier.getStart(emitted),end:specifier.end,value:JSON.stringify(moduleUrl(next))});
      }
      for(const replacement of replacements.reverse())output=output.slice(0,replacement.start)+replacement.value+output.slice(replacement.end);
      const url='data:text/javascript;base64,'+Buffer.from(output+`\n// fixture ${cacheTag}`).toString('base64');
      modules.set(file,url);
      return url;
    } finally {compiling.delete(file);}
  }
  return {moduleUrl,load:file=>import(moduleUrl(file))};
}
