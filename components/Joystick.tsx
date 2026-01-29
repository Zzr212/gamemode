import React, { useCallback, useEffect, useRef, useState } from 'react';
import { JoystickData } from '../types';

interface JoystickProps {
  onMove: (data: JoystickData) => void;
}

export const Joystick: React.FC<JoystickProps> = ({ onMove }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const touchId = useRef<number | null>(null);

  const maxRadius = 50; // Max distance knob can move from center

  const handleStart = useCallback((clientX: number, clientY: number, id: number) => {
    if (active) return;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Only activate if touch is within the container bounds
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        setActive(true);
        touchId.current = id;
        handleMove(clientX, clientY);
      }
    }
  }, [active]);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const angle = Math.atan2(deltaY, deltaX);

    const clampedDist = Math.min(distance, maxRadius);
    const x = Math.cos(angle) * clampedDist;
    const y = Math.sin(angle) * clampedDist;

    setPosition({ x, y });

    // Normalize -1 to 1
    onMove({
      x: x / maxRadius,
      y: y / maxRadius,
    });
  }, [onMove]);

  const handleEnd = useCallback(() => {
    setActive(false);
    setPosition({ x: 0, y: 0 });
    touchId.current = null;
    onMove({ x: 0, y: 0 });
  }, [onMove]);

  // Mouse events
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => handleStart(e.clientX, e.clientY, 0);
    const onMouseMove = (e: MouseEvent) => {
      if (active && touchId.current === 0) {
        handleMove(e.clientX, e.clientY);
      }
    };
    const onMouseUp = () => {
        if(active && touchId.current === 0) handleEnd();
    };

    const el = containerRef.current;
    if (el) {
        el.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
        if(el) el.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
  }, [active, handleStart, handleMove, handleEnd]);

  // Touch events
  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
        // Prevent scrolling while using joystick
        e.preventDefault(); 
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            handleStart(t.clientX, t.clientY, t.identifier);
        }
    };
    const onTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === touchId.current) {
                handleMove(t.clientX, t.clientY);
            }
        }
    };
    const onTouchEnd = (e: TouchEvent) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === touchId.current) {
                handleEnd();
            }
        }
    };

    const el = containerRef.current;
    if (el) {
        el.addEventListener('touchstart', onTouchStart, { passive: false });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd);
        el.addEventListener('touchcancel', onTouchEnd);
    }
    return () => {
        if(el) {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        }
    };
  }, [active, handleStart, handleMove, handleEnd]);


  return (
    <div 
        ref={containerRef}
        className="relative w-32 h-32 bg-gray-800/50 rounded-full border-2 border-gray-600 backdrop-blur-sm pointer-events-auto touch-none select-none"
    >
        <div 
            ref={knobRef}
            style={{ 
                transform: `translate(${position.x}px, ${position.y}px)`,
                left: '50%',
                top: '50%',
                marginLeft: '-1.5rem',
                marginTop: '-1.5rem'
            }}
            className="absolute w-12 h-12 bg-white/80 rounded-full shadow-lg"
        />
    </div>
  );
};
