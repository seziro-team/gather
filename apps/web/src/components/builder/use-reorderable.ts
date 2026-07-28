'use client';

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';

/**
 * Drag-to-reorder for a vertical list, driven by pointer events and the keyboard.
 *
 * Written rather than pulled in: `@dnd-kit/core` 6.3.1 has not been published since
 * December 2024, and its maintained successor (`@dnd-kit/react`) is still pre-1.0. For a
 * single-axis list, neither the staleness nor the churn is worth taking on in a codebase
 * that will hold tax documents. This is ~90 lines with no dependency.
 *
 * Pointer events rather than the HTML5 drag-and-drop API, because HTML5 drag does not fire
 * on touch — and a partner reordering a checklist on an iPad is an ordinary Tuesday.
 * `ArrowUp`/`ArrowDown` on a focused handle does the same job without a pointer at all.
 */
/** How close to the window edge a drag has to get before the page starts scrolling. */
const EDGE_SCROLL_ZONE = 72;
const EDGE_SCROLL_STEP = 16;

export interface Reorderable {
  setRowRef: (index: number) => (element: HTMLElement | null) => void;
  handleProps: (index: number) => {
    'data-drag-handle': true;
    'aria-label': string;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
  draggingIndex: number | null;
}

export function useReorderable(
  count: number,
  onMove: (from: number, to: number) => void,
  label: string,
): Reorderable {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const dragging = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  /**
   * After a keyboard move the handle travels with its row, so focus has to follow it —
   * otherwise the second Arrow press lands on whatever ended up under the old focus.
   * `flushSync` applies the move before we look for the handle, which is what lets this
   * stay inside the event handler instead of becoming a cascading effect.
   */
  const moveAndFollowFocus = useCallback(
    (from: number, to: number) => {
      flushSync(() => onMove(from, to));
      rows.current[to]?.querySelector<HTMLElement>('[data-drag-handle]')?.focus();
    },
    [onMove],
  );

  const setRowRef = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      rows.current[index] = element;
    },
    [],
  );

  const handleProps = useCallback(
    (index: number) => ({
      'data-drag-handle': true as const,
      'aria-label': `${label}. Drag to reorder, or use the up and down arrow keys.`,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = index;
        setDraggingIndex(index);
      },
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const from = dragging.current;
        if (from === null) return;
        const y = event.clientY;

        // An item card is a few hundred pixels tall, so a checklist of any size is longer
        // than the window. Without this, dragging past the edge of the screen is simply
        // impossible and the arrow keys are the only way to make a long move.
        if (y < EDGE_SCROLL_ZONE) window.scrollBy(0, -EDGE_SCROLL_STEP);
        else if (y > window.innerHeight - EDGE_SCROLL_ZONE) window.scrollBy(0, EDGE_SCROLL_STEP);

        let target = from;
        for (let i = 0; i < count; i += 1) {
          const rect = rows.current[i]?.getBoundingClientRect();
          if (rect && y >= rect.top && y <= rect.bottom) {
            target = i;
            break;
          }
        }
        if (target !== from) {
          onMove(from, target);
          dragging.current = target;
          setDraggingIndex(target);
        }
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        dragging.current = null;
        setDraggingIndex(null);
      },
      onPointerCancel: () => {
        dragging.current = null;
        setDraggingIndex(null);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (event.key === 'ArrowUp' && index > 0) {
          event.preventDefault();
          moveAndFollowFocus(index, index - 1);
        } else if (event.key === 'ArrowDown' && index < count - 1) {
          event.preventDefault();
          moveAndFollowFocus(index, index + 1);
        }
      },
    }),
    [count, label, moveAndFollowFocus, onMove],
  );

  return { setRowRef, handleProps, draggingIndex };
}

/** Immutably move one entry of an array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}
