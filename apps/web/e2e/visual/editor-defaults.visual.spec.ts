import { expect, test } from '../fixtures/editor';

for (const theme of ['light', 'dark'] as const) {
	test(
		`mixed editor defaults on ${theme} canvas`,
		{ tag: '@visual' },
		async ({ editor, page }) => {
			await editor.open(theme);
			await editor.drawRectangle({ x: 270, y: 400 }, { x: 430, y: 500 });
			await editor.chooseTool('Ellipse');
			await editor.drag({ x: 480, y: 400 }, { x: 600, y: 500 });
			await editor.chooseTool('Frame');
			await editor.drag({ x: 650, y: 380 }, { x: 850, y: 520 });
			await editor.chooseTool('Line');
			await editor.drag({ x: 290, y: 570 }, { x: 430, y: 650 });
			await editor.chooseTool('Arrow');
			await editor.drag({ x: 480, y: 610 }, { x: 610, y: 610 });
			await page.getByRole('button', { name: 'Text', exact: true }).click();
			await page.mouse.click(680, 590);
			await page.getByRole('button', { name: 'Markdown', exact: true }).click();
			await page.mouse.click(790, 570);
			await page.getByRole('button', { name: 'Pen', exact: true }).click();
			await editor.drag({ x: 300, y: 720 }, { x: 460, y: 750 });
			await editor.selectAt({ x: 620, y: 800 });
			await editor.waitForRendering();
			await expect(page).toHaveScreenshot(`editor-defaults-${theme}.png`, {
				fullPage: true
			});
		}
	);
}
