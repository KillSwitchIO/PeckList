import type { TouchEvent } from 'react';

/**
 * Whether a touch is on the element itself and not in a picker it opened. React hands touches in
 * a portal (the Repeat sheet, a date or reminder picker over the details) to the components that
 * opened it, so without this a swipe in a picker opened the comments underneath.
 */
export const touchInside = (event: TouchEvent<HTMLElement>) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);
