import { expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { DinnerState } from '../src/restaurant/types';
import type { RestaurantScenarioState } from '../src/restaurant/scenario-types';

/** Software rendering needs time for real UI/caption delivery while the authored evening advances. */
export const RESTAURANT_BROWSER_STORY_RATE = process.env.LFS_SOFTWARE_GPU === '1' ? 5 : 30;

/** DOM menus remain usable before this gate; movement and scene assertions wait. */
export async function waitForRestaurantScene(page: Page) {
  const deadline = Date.now() + 30_000;
  await expect(page.locator('.restaurant-canvas')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(page.locator('#scene-loading')).toBeHidden({ timeout: Math.max(1, deadline - Date.now()) });
}

export async function captureRestaurantScene(page: Page, path: string) {
  if (process.env.RESTAURANT_CAPTURE_SCREENSHOTS === '1') await page.bringToFront();
  await waitForRestaurantScene(page);
  // Software CI PNG readbacks measured 7–15 seconds; artifact capture has its own bounded budget.
  if (process.env.RESTAURANT_CAPTURE_SCREENSHOTS === '1') {
    // Read the opt-in HUD before PNG readback can stall rendering. Tests without
    // ?stats explicitly record null rather than inventing performance numbers.
    const snapshot = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.restaurant-canvas');
      const rect = canvas?.getBoundingClientRect();
      return {
        perfText: document.querySelector('#perf-stats')?.textContent ?? null,
        canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: rect?.width ?? 0, cssHeight: rect?.height ?? 0 } : null,
        devicePixelRatio: window.devicePixelRatio,
        visibility: document.visibilityState,
      };
    });
    const started = performance.now();
    await page.screenshot({ path, timeout: 30_000 });
    const screenshotReadbackMs = performance.now() - started;
    const statsPath = /\.png$/i.test(path) ? path.replace(/\.png$/i, '.stats.json') : `${path}.stats.json`;
    await writeFile(statsPath, JSON.stringify({ ...snapshot, screenshotReadbackMs }, null, 2) + '\n');
  }
}

export function restaurantEvening(state: DinnerState) {
  return state.doubleDate?.role === 'wingman' ? state.doubleDate.otherView?.evening ?? state.evening : state.evening;
}
export function restaurantScenario(state: DinnerState): RestaurantScenarioState | undefined {
  return state.doubleDate?.scenario ?? restaurantEvening(state).scenario;
}
export function restaurantInterrupted(state: DinnerState) {
  return !!restaurantEvening(state).incident || restaurantScenario(state)?.phase === 'active';
}

/** Finish each visible story beat; a second choice must never be treated as already resolved. */
export async function resolveRestaurantScenario(page: Page, read: () => Promise<DinnerState>, openActions: () => Promise<void>) {
  if (restaurantScenario(await read())?.phase !== 'active') return false;
  for (let step = 0; step < 3; step++) {
    const current = restaurantScenario(await read());
    if (current?.phase !== 'active') return true;
    const decisions = current.decisions?.length ?? 0;
    const choice = current.choices[0];
    if (!choice) throw new Error(`Active ${current.id} beat has no player choices.`);
    await openActions();
    const button = page.locator(`[data-scenario="${choice.id}"]`);
    await expect(button).toBeVisible();
    try { await button.click({ timeout: 5000 }); }
    catch (error) {
      const next = restaurantScenario(await read());
      if (next?.phase === 'active' && next.id === current.id && next.beat === current.beat && (next.decisions?.length ?? 0) === decisions) throw error;
    }
    await expect.poll(async () => {
      const next = restaurantScenario(await read());
      return next?.phase !== 'active' || next.id !== current.id || next.beat !== current.beat || (next.decisions?.length ?? 0) > decisions;
    }).toBe(true);
  }
  throw new Error('The table story did not resolve after its visible choices.');
}
