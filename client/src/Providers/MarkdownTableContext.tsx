import { createContext, useCallback, useContext, useRef } from 'react';
import type { ReactNode } from 'react';

type MarkdownTableContextValue = {
  getNextIndex: () => number;
};

const MarkdownTableContext = createContext<MarkdownTableContextValue>({
  getNextIndex: () => 0,
});

export const useMarkdownTableContext = () => useContext(MarkdownTableContext);

export function MarkdownTableProvider({
  baseIndex = 0,
  children,
}: {
  baseIndex?: number;
  children: ReactNode;
}) {
  const counterRef = useRef(0);
  const getNextIndex = useCallback(() => {
    const nextIndex = counterRef.current;
    counterRef.current += 1;
    return baseIndex + nextIndex;
  }, [baseIndex]);

  return (
    <MarkdownTableContext.Provider value={{ getNextIndex }}>
      {children}
    </MarkdownTableContext.Provider>
  );
}
