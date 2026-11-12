// Setup wizard: formats, templates, validation, pale colours
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers');

test('format step leads, bidding only appears for an auction', async () => {
  const app = await openApp();
  try {
    assert.equal(await app.ev(() => WIZ_STEPS.map(s => s.id).join()), 'format,event,teams,rounds,tiers,bidding,review');
    await app.page.click('.wiz-card:has-text("Random allocation")');
    assert.equal(await app.ev(() => WIZ_STEPS.map(s => s.id).join()), 'format,event,teams,rounds,tiers,review');
    await app.page.click('.wiz-card:has-text("Captains")');
    assert.equal(await app.ev(() => EV.format), 'draft');
    assert.match(await app.page.textContent('#wizSteps'), /Pre-draft/);
  } finally {
    await app.close();
  }
});

test('a template sets the rules but keeps the teams and name', async () => {
  const app = await openApp();
  try {
    const before = await app.ev(() => {
      EV.name = 'My Club';
      return EV.teams.map(t => t.name);
    });
    await app.page.click('.wiz-tpl:has-text("Social league draw")');
    const after = await app.ev(() => ({ f: EV.format, tiers: EV.tiers.map(t => t.name), teams: EV.teams.map(t => t.name), name: EV.name }));
    assert.equal(after.f, 'random');
    assert.deepEqual(after.tiers, ['A', 'B', 'C']);
    assert.deepEqual(after.teams, before);
    assert.equal(after.name, 'My Club');
  } finally {
    await app.close();
  }
});

test('validation: draft needs a squad size, pale colours warn', async () => {
  const app = await openApp();
  try {
    const v = await app.ev(() => {
      EV.format = 'draft';
      EV.squadSize = 0;
      EV.teams[0].color = '#fffbe0';
      return validateEvent(EV);
    });
    assert.ok(v.errors.some(e => /at least 1/.test(e.msg)));
    assert.ok(v.warnings.some(e => /very pale/.test(e.msg)));
  } finally {
    await app.close();
  }
});

test('light / dark switch is remembered and applied before the page draws', async () => {
  const app = await openApp();
  try {
    assert.equal(await app.ev(() => document.documentElement.dataset.theme || 'light'), 'light');
    await app.page.click('#setupScreen .theme-btn');
    assert.equal(await app.ev(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await app.ev(() => getComputedStyle(document.body).backgroundColor), 'rgb(10, 15, 21)');
    await app.page.reload();
    assert.equal(await app.ev(() => document.documentElement.dataset.theme), 'dark');
    await app.page.click('#setupScreen .theme-btn');
    assert.equal(await app.ev(() => localStorage.getItem('draftday.theme.v1')), 'light');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
