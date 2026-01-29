import React, { useEffect, useRef } from 'react';

interface TouchLookProps {
  onRotate: (deltaX: number, deltaY: number) => void;
}

export const TouchLook: React.FC<TouchLookProps> = ({ onRotate }) => {
  const ref = useRef<HTMLDivElement>(null);
  const touchId = useRef<number | null>(null);
  const lastPos = useRef<{x: number, y: number} | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleStart = (clientX: number, clientY: number, id: number) => {
        touchId.current = id;
        lastPos.current = { x: clientX, y: clientY };
    };

    const handleMove = (clientX: number, clientY: number, id: number) => {
        if (touchId.current === id && lastPos.current) {
            const dx = clientX - lastPos.current.x;
            const dy = clientY - lastPos.current.y;
            onRotate(dx, dy);
            lastPos.current = { x: clientX, y: clientY };
        }
    };

    const handleEnd = (id: number) => {
        if (touchId.current === id) {
            touchId.current = null;
            lastPos.current = null;
        }
    };

    // Touch
    const onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        for (let i=0; i<e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            handleStart(t.clientX, t.clientY, t.identifier);
        }
    };
    const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        for (let i=0; i<e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            handleMove(t.clientX, t.clientY, t.identifier);
        }
    };
    const onTouchEnd = (e: TouchEvent) => {
        for (let i=0; i<e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            handleEnd(t.identifier);
        }
    };

    // Mouse
    const onMouseDown = (e: MouseEvent) => handleStart(e.clientX, e.clientY, 999);
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY, 999);
    const onMouseUp = () => handleEnd(999);

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onRotate]);

  return (
    <div ref={ref} className="w-full h-full pointer-events-auto touch-none bg-transparent" />
  );
};
