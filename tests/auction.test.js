// The auction: preloaded pool, bidding, undo, edit in place, exports, save and resume
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openApp, roster, download } = require('./helpers');

async function launchAuction(app, pool) {
  await app.ev(p => {
    EV.rounds = [];
    LISTS.pool = p;
    saveLists();
    goStep(stepIdx('review'));
  }, pool);
  await app.page.click('#wizNext');
  await app.page.waitForFunction(() => document.getElementById('appScreen').style.display !== 'none');
}

test('preloaded pool, a sale, undo and edit-in-place', async () => {
  const app = await openApp();
  try {
    await launchAuction(app, roster(12));
    assert.equal(await app.ev(() => players.length), 12);
    const sold = await app.ev(() => {
      const p = players[0];
      putUpForBid(p.id);
      quickBid(teams[1].id, 2);
      declareWinner();
      dismissWinner();
      return { team: teams[1].players.at(-1).name, budget: teams[1].budget, start: teams[1].startBudget };
    });
    assert.equal(sold.team, 'Player 01');
    assert.ok(sold.budget < sold.start);
    await app.ev(() => undoLast());
    assert.equal(await app.ev(() => teams[1].budget === teams[1].startBudget && !players[0].sold), true);
    // U4: edit name, tier and price
    await app.ev(() => {
      window.DLG_ANSWERS = [{ name: 'Fixed Name', tier: 'Gold', price: '75k' }];
      return editPoolPlayer(players[1].id);
    });
    assert.deepEqual(await app.ev(() => [players[1].name, players[1].tier, players[1].price]), ['Fixed Name', 'Gold', 75000]);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('exports: CSV rows, PDF with recap, and a resumable save', async () => {
  const app = await openApp();
  try {
    await launchAuction(app, roster(16));
    await app.ev(() => {
      for (const p of players.slice(0, 6)) {
        putUpForBid(p.id);
        const ok = teams.filter(t => !isTeamBlocked(t));
        quickBid(ok[0].id, 1);
        quickBid(ok[1].id, 1);
        declareWinner();
        dismissWinner();
      }
    });
    const csvFile = await download(app.page, () => app.ev(() => exportLog()));
    const lines = csvFile.text().trim().split('\n');
    assert.match(lines[0], /^\uFEFF?Team,Player,Tier,How,Base price/);
    assert.equal(lines.filter(l => /"Bought"/.test(l)).length, 6);
    assert.equal(lines.filter(l => /,Unsold,/.test(l)).length, 10);
    const recap = await app.ev(() => recapData());
    assert.equal(recap.stats[1][0], '6');
    assert.equal(recap.highlights[0].label, 'Top buy');
    const pdf = await download(app.page, () => app.ev(() => exportRosters()));
    assert.match(pdf.name, /rosters\.pdf$/);
    // save → reset → resume
    const state = await app.ev(() => JSON.stringify(buildState()));
    await app.ev(s => applyState(JSON.parse(s)), state);
    assert.equal(await app.ev(() => auctionLog.length), 6);
  } finally {
    await app.close();
  }
});

test('rehearsal uses made-up players and never touches the autosave', async () => {
  const app = await openApp();
  try {
    await app.ev(() => {
      EV.rounds = [];
      localStorage.setItem(AUTOSAVE_KEY, '"keep me"');
      goStep(stepIdx('review'));
    });
    await app.page.click('button:has-text("Rehearse")');
    assert.equal(await app.ev(() => rehearsal && players.length > 0 && players[0].name.startsWith('Player')), true);
    await app.ev(() => autosaveNow());
    await app.ev(() => confirmReset());
    assert.equal(await app.ev(() => localStorage.getItem(AUTOSAVE_KEY)), '"keep me"');
    assert.equal(await app.ev(() => rehearsal), false);
  } finally {
    await app.close();
  }
});
