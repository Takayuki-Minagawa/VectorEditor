import { useEffect, useRef } from 'react';

/**
 * Subscribe to a `window` event for the lifetime of the component.
 *
 * The latest handler is always invoked, so callers can pass an inline
 * closure without re-subscribing on every render.
 */
export function useWindowEvent<E extends Event = Event>(
  type: string,
  handler: (event: E) => void,
  deps: readonly unknown[] = [],
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: Event) => handlerRef.current(event as E);
    window.addEventListener(type, listener);
    return () => window.removeEventListener(type, listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, ...deps]);
}
