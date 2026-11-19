// Reuse only the inputs available to a participant. Score shared non-stop words
// by inverse document frequency. Abstain on a tie or an empty intersection.
const stop = new Set('a an and as at beside by for from in into is it its of on or the this to use with'.split(' '));

function terms(text) {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(term => !stop.has(term)));
}

export function lexicalPredictions(assets, prompts, { forceSelection = false } = {}) {
  const index = assets.map(({id, title, category, description}) => ({
    id, words: terms([title, category, description].join(' '))
  }));
  const frequencies = new Map();
  for (const item of index) {
    for (const word of item.words) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  }
  return prompts.map(({id, intent}) => {
    const words = terms(intent);
    const ranked = index.map(item => {
      let score = 0;
      for (const word of words) {
        if (item.words.has(word)) score += Math.log((index.length + 1) / frequencies.get(word));
      }
      return {id: item.id, score};
    }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [best, runnerUp] = ranked;
    const supported = best.score > 0 && best.score - runnerUp.score > 1e-12;
    return [id, supported || forceSelection ? best.id : null];
  });
}
