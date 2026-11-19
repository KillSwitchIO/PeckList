import { afterEach, describe, expect, it, vi } from 'vitest';
import { mainHref } from './openOutside.ts';

const ADDRESS = '12 Oak Street';
const query = encodeURIComponent(ADDRESS);

function on(agent: string, touchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
  // jsdom has no maxTouchPoints to spy on.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('a tap on an address (PL-146)', () => {
  it("opens the phone's own maps app on Android, Apple Maps on an iPhone or iPad", () => {
    on('Mozilla/5.0 (Linux; Android 16; Pixel 9) Mobile');
    expect(mainHref('address', ADDRESS)).toBe(`geo:0,0?q=${query}`);
    on('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Mobile');
    expect(mainHref('address', ADDRESS)).toBe(`https://maps.apple.com/?q=${query}`);
    // An iPad says Macintosh, with a touch screen.
    on('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5);
    expect(mainHref('address', ADDRESS)).toBe(`https://maps.apple.com/?q=${query}`);
  });

  it('opens OpenStreetMap elsewhere, not Google Maps (the menu still offers it)', () => {
    on('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 10);
    expect(mainHref('address', ADDRESS)).toBe(
      `https://www.openstreetmap.org/search?query=${query}`,
    );
  });
});
