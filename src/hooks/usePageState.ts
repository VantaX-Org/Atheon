import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

export function usePageState<T extends Record<string, string>>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  const getParam = useCallback((key: string) => {
    return searchParams.get(key) || defaults[key] || '';
  }, [searchParams, defaults]);

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === defaults[key] || !value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams, defaults]);

  const clearAll = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return { getParam, setParam, clearAll };
}
