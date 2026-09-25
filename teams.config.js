/*
 * Draft Day: default teams
 * ------------------------
 * Edit this file to change the teams that load on the setup screen.
 *
 *   name    : team name
 *   captain : auto-assigned to the team and kept off the wheel ('' = no captain)
 *   color   : hex colour used for the team across the app
 *   logo    : image path relative to index.html (drop files in /logos).
 *             Leave it '' (or point at a missing file) and the team gets a coloured initials badge.
 *
 * Exactly 6 teams. Edits made on the setup screen are remembered on that device
 * until this file changes, after which this file wins again.
 */
window.DRAFT_DAY_TEAMS = [
  { name: 'Duck Dodgers',          captain: 'Winslow Jooste',   color: '#00c8ff', logo: 'logos/duck-dodgers.jpg' },
  { name: 'Social Sixers',         captain: 'Adrian Braaf',     color: '#f5b800', logo: 'logos/social-sixers.jpg' },
  { name: "Sevi's Superstars",     captain: 'Servriano Cupido', color: '#00e87a', logo: 'logos/sevis-superstars.jpg' },
  { name: 'Brevis & Buttheads',    captain: 'Jason Fortuin',    color: '#ff4050', logo: 'logos/brevis-and-buttheads.png' },
  { name: 'The Luke Warm Yorkers', captain: 'Luke Moses',       color: '#b060ff', logo: 'logos/luke-warm-yorkers.png' },
  { name: 'MI Tygers',             captain: 'Aython Adams',     color: '#ff8030', logo: 'logos/mi-tygers.jpg' },
];
