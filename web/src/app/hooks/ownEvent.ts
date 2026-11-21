/**
 * Whether an event began inside the element whose handler has it. A popup an element opened (a
 * date sheet, a menu) is a portal elsewhere in the page, yet React still passes the popup's
 * events up through that element: a tap there is the popup's, not the element's.
 */
export function ownEvent(event: { currentTarget: EventTarget; target: EventTarget }): boolean {
  const { currentTarget, target } = event;
  return currentTarget instanceof Node && target instanceof Node && currentTarget.contains(target);
}
