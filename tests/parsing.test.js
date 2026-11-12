// Player lists: CSV, pasted spreadsheet columns, optional prices and tiers
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

test('player lists parse from CSV, tabs and short rows', async () => {
  const app = await openApp();
  try {
    const r = await app.ev(() => {
      const out = parsePlayerRows(
        'Name,Price,Tier\n"Smith, J",250k,gold\nTab Man\t50000\tSilver\nNo Price\nTier Only, Bronze\n,100,Gold\nBad Tier,10,Diamond',
      );
      return { rows: out.rows, unknown: [...out.unknownTiers] };
    });
    assert.deepEqual(
      r.rows.map(x => [x.name, x.price, x.tier]),
      [
        ['Smith, J', 250000, 'Gold'],
        ['Tab Man', 50000, 'Silver'],
        ['No Price', 0, ''],
        ['Tier Only', 0, 'Bronze'],
        ['Bad Tier', 10, ''],
      ],
    );
    assert.deepEqual(r.unknown, ['Diamond']);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('saves from older versions migrate to the current format', async () => {
  const app = await openApp();
  try {
    const v = await app.ev(() => {
      const s = {
        version: 2,
        event: EV,
        teams: [{ id: 0, name: 'A', budget: 5, players: [{ name: 'X', sold: true, isCaptain: true }] }],
        players: [{ name: 'Y', unsold: true }],
      };
      migrateSave(s);
      return [s.version, s.teams[0].players[0].status, s.players[0].status];
    });
    assert.deepEqual(v, [3, 'captain', 'queued']);
  } finally {
    await app.close();
  }
});
