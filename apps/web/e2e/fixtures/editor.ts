import { expect, test as base, type Page } from '@playwright/test';

export interface Point {
	x: number;
	y: number;
}

/** Thin test driver for user-visible Inkfinite editor operations. */
export class InkfiniteEditor {
	constructor(readonly page: Page) {}

	async open(theme: 'light' | 'dark' = 'light') {
		await this.page.addInitScript((value) => localStorage.setItem('theme', value), theme);
		await this.page.goto('/app', { waitUntil: 'networkidle' });
		await expect(this.page.getByRole('button', { name: 'Shapes', exact: true })).toBeVisible();
		await this.waitForRendering();
	}

	async waitForRendering() {
		await this.page.evaluate(() => document.fonts.ready);
	}

	async chooseTool(name: string) {
		await this.page.getByRole('button', { name: 'Shapes', exact: true }).click();
		await this.page.getByRole('menuitem', { name, exact: true }).click();
	}

	async drag(from: Point, to: Point) {
		await this.page.mouse.move(from.x, from.y);
		await this.page.mouse.down();
		await this.page.mouse.move(to.x, to.y, { steps: 8 });
		await this.page.mouse.up();
	}

	async drawRectangle(from: Point, to: Point) {
		await this.chooseTool('Rectangle');
		await this.drag(from, to);
	}

	async selectAt(point: Point, additive = false) {
		await this.page.getByRole('button', { name: 'Select', exact: true }).click();
		if (additive) await this.page.keyboard.down('Shift');
		await this.page.mouse.click(point.x, point.y);
		if (additive) await this.page.keyboard.up('Shift');
	}

	async createSelectedRectangle(
		from: Point = { x: 300, y: 520 },
		to: Point = { x: 480, y: 640 }
	) {
		await this.drawRectangle(from, to);
		await this.selectAt({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
		await expect(this.page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
	}

	async revealControl(name: string) {
		const control = this.page.getByRole('button', { name, exact: true });
		while (!(await control.isVisible())) {
			await this.page.getByRole('button', { name: 'Show more contextual controls' }).click();
		}
		return control;
	}
}

export const test = base.extend<{ editor: InkfiniteEditor }>({
	editor: async ({ page }, use) => {
		await use(new InkfiniteEditor(page));
	}
});

export { expect };
