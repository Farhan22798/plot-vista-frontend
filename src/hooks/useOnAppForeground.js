import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Runs `callback` when the app returns to the foreground after being
 * backgrounded or inactive (lock screen, timeout, app switcher, etc.).
 * Does not run on initial mount.
 */
export function useOnAppForeground(callback) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const lastStateRef = useRef(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = lastStateRef.current;
      lastStateRef.current = next;
      if (prev !== 'active' && next === 'active') {
        cbRef.current();
      }
    });
    return () => sub.remove();
  }, []);
}
