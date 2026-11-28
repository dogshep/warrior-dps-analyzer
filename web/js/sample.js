// "Try a sample report": shows what the analyzer finds on a made-up fight without running anything. The results
// in sample/sample-report.json were worked out ahead of time by scripts/make-sample.mjs, which runs the real page
// on sample/sample-WoWCombatLog.txt (a log written by scripts/make-sample-log.mjs, with no real players in it).

import { $ } from './format.js';
import { tidyTips } from './tips-ui.js';

// The parts of the results page the snapshot fills in, by element id. Anything else in the file is ignored.
export const SAMPLE_PARTS = ['stats', 'tips', 'simnote', 'cds', 'cdnote', 'execSum', 'execTable', 'upgOut', 'upgNote', 'abil', 'gear'];

let snapshot = null;

// Fills the results page from the snapshot and marks it as a sample. Resolves false if the file can't be loaded.
export async function showSample() {
  try {
    snapshot ??= await fetch('sample/sample-report.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  } catch {
    snapshot = null;
    return false;
  }
  for (const id of SAMPLE_PARTS) if ($(id) && typeof snapshot.html?.[id] === 'string') $(id).innerHTML = snapshot.html[id];
  $('exec').hidden = !snapshot.html?.execSum;
  tidyTips($('tips'));
  $('out').classList.add('sample');
  $('sampleBanner').hidden = false;
  $('out').hidden = false;
  $('sampleBanner').scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

// Back to a normal results page, before the viewer's own log is shown.
export function clearSample() {
  if (!$('out').classList.contains('sample')) return;
  $('out').classList.remove('sample');
  $('sampleBanner').hidden = true;
  for (const id of SAMPLE_PARTS) if ($(id)) $(id).innerHTML = '';
}

// The sample log itself, to run through the real analyzer.
export const sampleLog = () => fetch('sample/sample-WoWCombatLog.txt').then(r => {
  if (!r.ok) throw new Error(`Could not load the sample log (${r.status}).`);
  return r.blob();
}).then(b => new File([b], 'sample-WoWCombatLog.txt', { type: 'text/plain' }));
