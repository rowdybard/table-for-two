/** Shared date-night palette and type roles for DOM and authored canvas surfaces. */
export const UI_THEME = {
  ink: '#21121f', paper: '#fff2dc', signal: '#d82f70', live: '#ff3e89', muted: '#6f4b5d', line: '#b7a0a4', board: '#f3e2cc', boardAccent: '#b42e63',
  display: "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif", body: "'Inter', Arial, sans-serif",
} as const;
export function installUiTheme() {
  if (typeof document === 'undefined') return;
  for (const [key, value] of Object.entries(UI_THEME)) document.documentElement.style.setProperty(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
}
export const canvasFont = (size: number, role: 'display' | 'body' = 'body', weight = role === 'display' ? 700 : 400) => `${weight} ${size}px ${UI_THEME[role]}`;

