// Single import surface for pi-tui so the bundled artifact keeps one external
// import statement with the original binding names (the CLI test suite inspects
// the emitted `matchesKey(...)` calls in the artifact).
export { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
