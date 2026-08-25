const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes as standard Base64 without relying on a host runtime global. */
export function encodeBase64(bytes: number[]): string {
	let encoded = '';
	for (let index = 0; index < bytes.length; index += 3) {
		const first = (bytes[index] ?? 0) & 0xff;
		const hasSecond = index + 1 < bytes.length;
		const hasThird = index + 2 < bytes.length;
		const second = hasSecond ? (bytes[index + 1] ?? 0) & 0xff : 0;
		const third = hasThird ? (bytes[index + 2] ?? 0) & 0xff : 0;
		const combined = (first << 16) | (second << 8) | third;
		encoded += BASE64_ALPHABET[(combined >> 18) & 0x3f];
		encoded += BASE64_ALPHABET[(combined >> 12) & 0x3f];
		encoded += hasSecond ? BASE64_ALPHABET[(combined >> 6) & 0x3f] : '=';
		encoded += hasThird ? BASE64_ALPHABET[combined & 0x3f] : '=';
	}
	return encoded;
}

/** Decode standard Base64 into bytes without relying on a host runtime global. */
export function decodeBase64(value: string): number[] {
	const input = value.replaceAll(/\s/g, '');
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 === 1) {
		throw new Error('Invalid Base64 data');
	}
	const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
	const content = input.slice(0, input.length - padding);
	const bytes: number[] = [];

	for (let index = 0; index < content.length; index += 4) {
		const first = BASE64_ALPHABET.indexOf(content[index] ?? '');
		const second = BASE64_ALPHABET.indexOf(content[index + 1] ?? '');
		const third = BASE64_ALPHABET.indexOf(content[index + 2] ?? '');
		const fourth = BASE64_ALPHABET.indexOf(content[index + 3] ?? '');
		if (
			first < 0 ||
			second < 0 ||
			(index + 2 < content.length && third < 0) ||
			(index + 3 < content.length && fourth < 0)
		) {
			throw new Error('Invalid Base64 data');
		}
		bytes.push((first << 2) | (second >> 4));
		if (index + 2 < content.length) bytes.push(((second & 0x0f) << 4) | (third >> 2));
		if (index + 3 < content.length) bytes.push(((third & 0x03) << 6) | fourth);
	}
	return bytes;
}
