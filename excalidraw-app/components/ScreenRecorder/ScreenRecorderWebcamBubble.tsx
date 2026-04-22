import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import "./screenRecorder.scss";

export const ScreenRecorderWebcamBubble = ({
  stream,
}: {
  stream: MediaStream | null;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(window.innerWidth - 120 - 20, 12),
    y: Math.max(window.innerHeight - 120 - 84, 12),
  }));

  useEffect(() => {
    const el = videoRef.current;
    if (!el) {
      return;
    }
    if (stream) {
      el.srcObject = stream;
      void el.play().catch(() => {
        /* autoplay policies */
      });
    } else {
      el.srcObject = null;
    }
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const updateWithinBounds = () => {
      setPosition((prev) => {
        const maxX = Math.max(window.innerWidth - 120 - 12, 12);
        const maxY = Math.max(window.innerHeight - 120 - 12, 12);
        return {
          x: Math.min(Math.max(prev.x, 12), maxX),
          y: Math.min(Math.max(prev.y, 12), maxY),
        };
      });
    };

    window.addEventListener("resize", updateWithinBounds);
    return () => {
      window.removeEventListener("resize", updateWithinBounds);
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bubbleEl = bubbleRef.current;
    if (!bubbleEl) {
      return;
    }
    const rect = bubbleEl.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    bubbleEl.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const maxX = Math.max(window.innerWidth - 120 - 12, 12);
    const maxY = Math.max(window.innerHeight - 120 - 12, 12);
    const nextX = Math.min(Math.max(event.clientX - drag.offsetX, 12), maxX);
    const nextY = Math.min(Math.max(event.clientY - drag.offsetY, 12), maxY);
    setPosition({ x: nextX, y: nextY });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragStateRef.current = null;
    bubbleRef.current?.releasePointerCapture(event.pointerId);
  };

  if (!stream) {
    return null;
  }

  return createPortal(
    <div
      ref={bubbleRef}
      className="screen-recorder-webcam"
      role="img"
      aria-label="Camera preview"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <video
        ref={videoRef}
        className="screen-recorder-webcam__video"
        playsInline
        muted
        autoPlay
      />
    </div>,
    document.body,
  );
};
