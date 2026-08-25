import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyPngBlob } from '../../../../packages/ui/src/lib/editor/clipboard';

/** Exercises the shared clipboard path used by the Tauri editor WebView. */
describe('desktop PNG clipboard integration', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('writes PNG data through the WebView clipboard API', async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		class TestClipboardItem {
			constructor(readonly data: Record<string, Blob>) {}
		}
		vi.stubGlobal('navigator', { clipboard: { write } });
		vi.stubGlobal('ClipboardItem', TestClipboardItem);

		const result = await copyPngBlob(new Blob(['desktop-png'], { type: 'image/png' }), 'drawing.png');

		expect(result).toBe('rich');
		expect(write).toHaveBeenCalledOnce();
		expect(Object.keys(write.mock.calls[0][0][0].data)).toEqual(['image/png']);
	});
});
