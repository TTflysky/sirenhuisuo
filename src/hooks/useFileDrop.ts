import { useRef, useState, type DragEvent } from 'react';

export function useFileDrop(onFiles: (files: File[]) => void | Promise<void>, disabled = false) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files');
  const reset = () => { dragDepth.current = 0; setDragActive(false); };

  return {
    dragActive,
    dropProps: {
      onDragEnter(event: DragEvent<HTMLElement>) {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current += 1;
        setDragActive(true);
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const files = Array.from(event.dataTransfer.files);
        reset();
        if (!disabled && files.length) void onFiles(files);
      },
    },
  };
}
