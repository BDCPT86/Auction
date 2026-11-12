// Random allocation and the captains' draft
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openApp, roster, download } = require('./helpers');

test('random draw: same code, same result; tier-balanced squads', async () => {
  const app = await openApp();
  try {
    const run = () =>
      app.ev(p => {
        EV.format = 'random';
        EV.rounds = [];
        EV.squadSize = 4;
        EV.tiers.forEach(t => (t.limit = 0));
        EV.random.reveal = 'instant';
        LISTS.pool = p;
        saveLists();
        launchAuction();
        alloc.seed = 'TESTCODE1';
        allocDealRest(true);
        return teams.map(t =>
          t.players
            .filter(x => x.drawn)
            .map(x => x.name)
            .sort()
            .join('|'),
        );
      }, roster(24));
    const a = await run();
    await app.ev(() => {
      window.DLG_AUTO = true;
      return confirmReset();
    });
    const b = await run();
    assert.deepEqual(a, b);
    const mix = await app.ev(() => teams.map(t => EV.tiers.map(x => tierCount(t, x.name)).join('/')));
    assert.equal(new Set(mix).size, 1, 'every team gets the same tier mix: ' + mix.join(' '));
  } finally {
    await app.close();
  }
});

test("captains' draft: snake order, finish banner and exports", async () => {
  const app = await openApp();
  try {
    await app.ev(
      p => {
        EV.format = 'draft';
        EV.squadSize = 2;
        EV.rounds = [];
        EV.teams = EV.teams.slice(0, 3);
        LISTS.pool = p;
        saveLists();
        afterEventChange();
        launchAuction();
      },
      roster(8, 'Drafty'),
    );
    assert.equal(await app.page.textContent('#selTitle'), 'DRAFT');
    const order = await app.ev(() => SR().turnOrder.join(','));
    assert.equal(order, '0,1,2,2,1,0');
    for (let i = 0; i < 6; i++) await app.page.click('.sel-player-card:not(.taken):not(.blocked) >> nth=0');
    assert.match(await app.page.textContent('#selCompleteTxt'), /Draft complete/);
    assert.equal(await app.page.isVisible('#selExports'), true);
    const csvFile = await download(app.page, () => app.page.click('#selExports button:has-text("Results CSV")'));
    const text = csvFile.text();
    assert.equal((text.match(/"Draft"/g) || []).length, 6);
    assert.equal((text.match(/Not picked/g) || []).length, 2);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
