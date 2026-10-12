// Reference files are unmodified copies of the accepted firefight module.
import fs from 'node:fs';
import {createDemoScene} from './scene.mjs';
import {applyCommand, previewCommand, resolveHit} from './engine.mjs';
const fixtures = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = fixtures.map(f => {
  if (f.operation === 'demo') return createDemoScene();
  let calls = 0;
  const rng = () => { if (calls >= f.random.length) throw Error('RNG fixture exhausted'); return f.random[calls++]; };
  if (f.operation === 'hit') {
    const target = structuredClone(f.target);
    const event = resolveHit(target, f.rawDamage, f.location, f.settings, rng);
    return {target, event, calls};
  }
  const context = {role:f.gm === false ? 'player' : 'gm', controlledId:f.command.actorId};
  const preview = previewCommand(f.scene, f.command, context);
  if (!preview.ok) return {ok:false, calls};
  const {state, event} = applyCommand(f.scene, f.command, context, rng);
  return {ok:true, state, event, calls, preview:f.command.type === 'shoot' ? {
    distance:preview.distance, difficulty:preview.difficulty, base:preview.base, called:preview.called, cover:!!preview.line.cover
  } : Object.fromEntries(Object.entries(preview).filter(([k]) => !['actor','target','line'].includes(k)))};
});
process.stdout.write(JSON.stringify(results));
