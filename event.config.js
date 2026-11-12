/*
 * Draft Day: default event
 * ------------------------
 * This is the event the setup wizard opens with. Everything here can also be
 * changed in the wizard before launch, and saved there as a named preset.
 * Edits made in the wizard are remembered on that device until this file
 * changes; after that, this file wins again.
 */
window.DRAFT_DAY_EVENT = {
  // ── Event ────────────────────────────────────────────────────────────────
  name: 'Draft Day', // shown in the header, PDF and results image
  // How players are shared out:
  //   'auction' — teams bid with a budget
  //   'random'  — a seeded draw, no money (see `random` below)
  //   'draft'   — captains take turns picking from the pool, no money (see `draft` below)
  format: 'auction',
  currency: 'R', // symbol put in front of every amount
  budget: 10000000, // starting budget per team
  squadSize: 5, // players each team buys at auction (0 = no limit)
  captains: true, // false = no captain field, nobody is pre-assigned
  draw: 'wheel', // how players come up: 'wheel' | 'random' | 'order' | 'manual'
  wheelIcon: '🏏', // emoji in the centre of the wheel
  spin: 'normal', // spin / draw length: 'quick' (~2s) | 'normal' (~5s) | 'dramatic' (~8s)

  // ── Random allocation (format: 'random') ──────────────────────────────────
  random: {
    balance: true, // deal one tier at a time so every team gets the same mix
    reveal: 'live', // 'live' (player, then team, one at a time) | 'instant' (deal everyone at once)
    teamPick: 'spin', // how the team appears in a live reveal: 'spin' | 'flip' | 'straight'
  },

  // ── Captains' draft (format: 'draft') ────────────────────────────────────
  // Each team picks squadSize players from the pool, after any pre-rounds below.
  draft: { order: 'snake' }, // 'snake' (1→n, then n→1, …) or 'straight'

  // ── Teams (any number, 2 or more) ────────────────────────────────────────
  // logo: path relative to index.html, or '' for a coloured initials badge
  teams: [
    { name: 'Duck Dodgers', captain: 'Winslow Jooste', color: '#00c8ff', logo: 'logos/duck-dodgers.jpg' },
    { name: 'Social Sixers', captain: 'Adrian Braaf', color: '#f5b800', logo: 'logos/social-sixers.jpg' },
    { name: "Sevi's Superstars", captain: 'Servriano Cupido', color: '#00e87a', logo: 'logos/sevis-superstars.jpg' },
    { name: 'Brevis & Buttheads', captain: 'Jason Fortuin', color: '#ff4050', logo: 'logos/brevis-and-buttheads.png' },
    { name: 'The Luke Warm Yorkers', captain: 'Luke Moses', color: '#b060ff', logo: 'logos/luke-warm-yorkers.png' },
    { name: 'MI Tygers', captain: 'Aython Adams', color: '#ff8030', logo: 'logos/mi-tygers.jpg' },
  ],

  // ── Pre-auction rounds (zero or more, run in this order) ─────────────────
  // picks:  picks per team in this round
  // order:  'snake' (1→n, then n→1, …) or 'straight' (1→n every pass)
  // cost:   'free' or 'price' (the player's CSV price comes off the budget)
  // countsTowardSquad: picks use up auction squad slots
  // countsTowardTiers: picks count toward per-tier limits
  rounds: [{ name: 'Former players', picks: 2, order: 'snake', cost: 'free', countsTowardSquad: false, countsTowardTiers: true }],

  // ── Tiers (empty list = no tiers) ────────────────────────────────────────
  // minBid: lowest opening bid for the tier · limit: max per team (0 = no limit)
  tiers: [
    { name: 'Platinum', color: '#b8ccd8', minBid: 500000, limit: 2 },
    { name: 'Gold', color: '#e0a020', minBid: 200000, limit: 2 },
    { name: 'Silver', color: '#98a8b8', minBid: 50000, limit: 2 },
    { name: 'Bronze', color: '#c07840', minBid: 10000, limit: 2 },
  ],

  // ── Bidding ──────────────────────────────────────────────────────────────
  bidding: {
    increment: 10000, // step between bids
    enforceIncrement: true, // reject bids that don't beat the leader by at least the increment
    prefill: true, // pre-fill each team's bid box with the next valid amount
    timer: 0, // seconds per player (0 = off)
    timerResetsOnBid: true, // a new bid restarts the countdown
    autoSell: false, // sell automatically once every other team has passed
    reserve: true, // purse reserve: a team must keep enough to fill its squad at the cheapest opening bid
    inThousands: false, // bid boxes in thousands: type 350 for 350 000 (k / m suffixes always work)
  },

  // ── Unsold players ───────────────────────────────────────────────────────
  // enabled: a player nobody buys goes to an unsold queue instead of back on the wheel.
  //          When the main pool is empty, the queue is re-auctioned in an unsold round,
  //          open only to teams with squad space and budget left.
  // discount: % taken off each player's opening bid in the unsold round
  unsold: { enabled: true, discount: 50 },

  // ── Outputs: results image, cards, PDF and projector ─────────────────────
  branding: {
    exportTitle: '6-A-SIDE',
    exportSubtitle: 'OFFICIAL TEAM ROSTERS',
    hashtags: '#tygerbergcc  #6aside  #lekkersoosacracker',
    // Sponsor: shown on the projector, cards, PDF and results image. Leave name '' for none.
    // logo: a path such as 'logos/sponsor.png', or upload one in the wizard (Review → Outputs)
    sponsor: { name: '', line: 'Presented by', logo: '' },
  },
};
