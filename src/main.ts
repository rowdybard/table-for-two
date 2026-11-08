// Preserve the original multiplayer playtest, including room invitation links.
const params = new URLSearchParams(location.search);
if (params.get('venue') === 'bowling' || params.has('room')) {
  void import('./legacy-main');
} else {
  void import('./restaurant/main');
}
