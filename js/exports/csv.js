/*
 * Draft Day: Results CSV
 * ----------------------
 * One row per player on every team, then everyone not placed.
 */

// Results CSV: one row per player on every team (captains, picks, buys or draws), then anyone not placed
function exportLog() {
  const R = noMoney(),
    q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const how = p => (p.isCaptain ? 'Captain' : p.isFormer ? roundLabel(p) || 'Pre-auction pick' : p.drawn ? 'Drawn' : 'Bought');
  const rows = [
    R ? 'Team,Player,Tier,How' + (isRandom() ? ',Draw #' : '') : `Team,Player,Tier,How,Base price (${EV.currency}),Paid (${EV.currency})`,
  ];
  teams.forEach(t =>
    t.players.forEach(p =>
      rows.push(
        (R
          ? [q(t.name), q(p.name), q(p.tier), q(how(p)), ...(isRandom() ? [p.drawNo || ''] : [])]
          : [q(t.name), q(p.name), q(p.tier), q(how(p)), p.isCaptain ? '' : p.price || 0, p.isCaptain ? '' : p.finalPrice || 0]
        ).join(','),
      ),
    ),
  );
  const caps = getCaptainNames();
  notPlaced()
    .filter(p => !caps.includes(p.name.toLowerCase()))
    .forEach(p =>
      rows.push(
        (R
          ? ['', q(p.name), q(p.tier), isDraft() ? 'Not picked' : 'Not drawn', ...(isRandom() ? [''] : [])]
          : ['', q(p.name), q(p.tier), 'Unsold', p.price || 0, '']
        ).join(','),
      ),
    );
  if (rows.length === 1) {
    showToast('Nothing to export yet');
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv' }));
  a.download = slugify(EV.name) + '-results.csv';
  a.click();
  showToast('Results CSV exported');
}
