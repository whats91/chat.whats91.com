'use client';

// Dependency note:
// Media preview/send changes here should stay aligned with:
// - src/components/chat/ConversationView.tsx
// - src/lib/api/client.ts
// - src/server/controllers/conversation-controller.ts

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Crop,
  FileText,
  Loader2,
  PenLine,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type MediaPreviewKind = 'image' | 'video' | 'audio' | 'document';

type HighlightPoint = {
  x: number;
  y: number;
};

type HighlightStroke = {
  points: HighlightPoint[];
};

type ToolMode = 'crop' | 'highlight' | null;

interface MediaComposerDialogProps {
  open: boolean;
  file: File | null;
  initialCaption?: string;
  isSending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (payload: { file: File; caption: string }) => Promise<boolean> | boolean;
}

interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_CROP: CropState = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

function inferPreviewKind(file: File | null): MediaPreviewKind {
  if (!file) {
    return 'document';
  }

  const mimeType = file.type.toLowerCase();
  const filename = file.name.toLowerCase();

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png') || filename.endsWith('.gif') || filename.endsWith('.webp')) {
    return 'image';
  }
  if (filename.endsWith('.mp4') || filename.endsWith('.mov') || filename.endsWith('.webm')) {
    return 'video';
  }

  return 'document';
}

function getDocumentDetails(file: File): string {
  const sizeInKb = Math.max(1, Math.round(file.size / 1024));
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : 'FILE';
  return `${extension || 'FILE'} • ${sizeInKb} KB`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isDefaultCrop(crop: CropState): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 100 && crop.height === 100;
}

function pointsForPreviewStroke(
  stroke: HighlightStroke,
  naturalWidth: number,
  naturalHeight: number,
  crop: CropState,
  previewWidth: number,
  previewHeight: number
): HighlightPoint[] {
  const cropX = (crop.x / 100) * naturalWidth;
  const cropY = (crop.y / 100) * naturalHeight;
  const cropWidth = (crop.width / 100) * naturalWidth;
  const cropHeight = (crop.height / 100) * naturalHeight;

  return stroke.points.map((point) => ({
    x: ((point.x * naturalWidth - cropX) / cropWidth) * previewWidth,
    y: ((point.y * naturalHeight - cropY) / cropHeight) * previewHeight,
  }));
}

async function loadImageFromObjectUrl(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image preview'));
    image.src = objectUrl;
  });
}

export function MediaComposerDialog({
  open,
  file,
  initialCaption = '',
  isSending = false,
  onOpenChange,
  onSend,
}: MediaComposerDialogProps) {
  const previewKind = useMemo(() => inferPreviewKind(file), [file]);
  const [caption, setCaption] = useState(initialCaption);
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);
  const [activeTool, setActiveTool] = useState<ToolMode>(null);
  const [strokes, setStrokes] = useState<HighlightStroke[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const drawingStrokeRef = useRef<HighlightPoint[]>([]);
  const cropDragStartRef = useRef<HighlightPoint | null>(null);
  const isDrawingRef = useRef(false);

  const supportsCaption = previewKind !== 'audio';
  const supportsEditing = previewKind === 'image' && Boolean(imageElement);
  const imageAspectRatio = useMemo(() => {
    if (!imageElement) {
      return 4 / 3;
    }

    return imageElement.naturalWidth / imageElement.naturalHeight;
  }, [imageElement]);

  useEffect(() => {
    if (!open) {
      setCaption(initialCaption);
      setCrop(DEFAULT_CROP);
      setActiveTool(null);
      setStrokes([]);
      setImageElement(null);
      setImageError(null);
      return;
    }

    setCaption(initialCaption);
    setCrop(DEFAULT_CROP);
    setActiveTool(null);
    setStrokes([]);
    setImageError(null);
  }, [initialCaption, open]);

  useEffect(() => {
    if (!file || !open) {
      setPreviewUrl(null);
      setImageElement(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    if (previewKind === 'image') {
      void loadImageFromObjectUrl(objectUrl)
        .then((image) => {
          setImageElement(image);
          setImageError(null);
        })
        .catch((error) => {
          setImageElement(null);
          setImageError(error instanceof Error ? error.message : 'Unable to load image preview');
        });
    } else {
      setImageElement(null);
    }

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, open, previewKind]);

  useEffect(() => {
    const element = previewViewportRef.current;
    if (!element || !supportsEditing) {
      setPreviewWidth(0);
      return;
    }

    const updateWidth = () => {
      setPreviewWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [supportsEditing]);

  useEffect(() => {
    if (!supportsEditing || !imageElement || !previewCanvasRef.current || previewWidth <= 0) {
      return;
    }

    const canvas = previewCanvasRef.current;
    const previewHeight = Math.max(1, Math.round(previewWidth / imageAspectRatio));
    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(previewWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(previewHeight * pixelRatio));
    canvas.style.width = `${previewWidth}px`;
    canvas.style.height = `${previewHeight}px`;

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, previewWidth, previewHeight);
    context.drawImage(
      imageElement,
      0,
      0,
      imageElement.naturalWidth,
      imageElement.naturalHeight,
      0,
      0,
      previewWidth,
      previewHeight
    );

    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(255, 225, 0, 0.75)';
    context.lineWidth = Math.max(6, Math.min(16, previewWidth * 0.018));

    for (const stroke of strokes) {
      const previewPoints = stroke.points.map((point) => ({
        x: point.x * previewWidth,
        y: point.y * previewHeight,
      }));

      if (previewPoints.length < 2) {
        continue;
      }

      context.beginPath();
      context.moveTo(previewPoints[0].x, previewPoints[0].y);
      for (const point of previewPoints.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    }
    if (!isDefaultCrop(crop) || activeTool === 'crop') {
      const cropLeft = (crop.x / 100) * previewWidth;
      const cropTop = (crop.y / 100) * previewHeight;
      const cropWidth = (crop.width / 100) * previewWidth;
      const cropHeight = (crop.height / 100) * previewHeight;

      context.fillStyle = 'rgba(0, 0, 0, 0.38)';
      context.fillRect(0, 0, previewWidth, cropTop);
      context.fillRect(0, cropTop + cropHeight, previewWidth, previewHeight - (cropTop + cropHeight));
      context.fillRect(0, cropTop, cropLeft, cropHeight);
      context.fillRect(cropLeft + cropWidth, cropTop, previewWidth - (cropLeft + cropWidth), cropHeight);

      context.save();
      context.setLineDash([10, 8]);
      context.strokeStyle = 'rgba(255, 255, 255, 0.96)';
      context.lineWidth = 2;
      context.strokeRect(cropLeft, cropTop, cropWidth, cropHeight);
      context.restore();
    }
  }, [activeTool, crop, imageAspectRatio, imageElement, previewWidth, strokes, supportsEditing]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!supportsEditing || !imageElement || !previewCanvasRef.current || !activeTool) {
      return;
    }

    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const relativeX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const relativeY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    const point = {
      x: relativeX,
      y: relativeY,
    };

    isDrawingRef.current = true;

    if (activeTool === 'crop') {
      cropDragStartRef.current = point;
      setCrop({
        x: point.x * 100,
        y: point.y * 100,
        width: 2,
        height: 2,
      });
    }

    if (activeTool === 'highlight') {
      drawingStrokeRef.current = [point];
      setStrokes((current) => [...current, { points: [point] }]);
    }

    canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!supportsEditing || !isDrawingRef.current || !imageElement || !previewCanvasRef.current || !activeTool) {
      return;
    }

    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const relativeX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const relativeY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    if (activeTool === 'crop') {
      const start = cropDragStartRef.current;
      if (!start) {
        return;
      }

      const left = clamp(Math.min(start.x, relativeX) * 100, 0, 100);
      const top = clamp(Math.min(start.y, relativeY) * 100, 0, 100);
      const right = clamp(Math.max(start.x, relativeX) * 100, 0, 100);
      const bottom = clamp(Math.max(start.y, relativeY) * 100, 0, 100);

      setCrop({
        x: left,
        y: top,
        width: Math.max(2, right - left),
        height: Math.max(2, bottom - top),
      });
      return;
    }

    drawingStrokeRef.current.push({
      x: relativeX,
      y: relativeY,
    });

    setStrokes((current) => {
      if (current.length === 0 || !isDrawingRef.current) {
        return [{ points: [...drawingStrokeRef.current] }];
      }

      const next = [...current];
      next[next.length - 1] = { points: [...drawingStrokeRef.current] };
      return next;
    });
  };

  const finishStroke = (pointerId?: number) => {
    if (pointerId !== undefined && previewCanvasRef.current?.hasPointerCapture(pointerId)) {
      previewCanvasRef.current.releasePointerCapture(pointerId);
    }

    if (!isDrawingRef.current) {
      return;
    }

    if (activeTool === 'highlight' && drawingStrokeRef.current.length > 0) {
      setStrokes((current) => {
        if (current.length === 0) {
          return [{ points: [...drawingStrokeRef.current] }];
        }

        const next = [...current];
        next[next.length - 1] = { points: [...drawingStrokeRef.current] };
        return next;
      });
    }

    drawingStrokeRef.current = [];
    cropDragStartRef.current = null;
    isDrawingRef.current = false;
  };

  const handleUndoStroke = () => {
    setStrokes((current) => current.slice(0, -1));
  };

  const handleResetImageEdits = () => {
    setCrop(DEFAULT_CROP);
    setStrokes([]);
    setActiveTool(null);
  };

  const buildPreparedFile = async (): Promise<File> => {
    if (!file) {
      throw new Error('No file selected');
    }

    if (!supportsEditing || !imageElement) {
      return file;
    }

    if (isDefaultCrop(crop) && strokes.length === 0) {
      return file;
    }

    const cropX = Math.round((crop.x / 100) * imageElement.naturalWidth);
    const cropY = Math.round((crop.y / 100) * imageElement.naturalHeight);
    const cropWidth = Math.max(1, Math.round((crop.width / 100) * imageElement.naturalWidth));
    const cropHeight = Math.max(1, Math.round((crop.height / 100) * imageElement.naturalHeight));
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = cropWidth;
    outputCanvas.height = cropHeight;

    const context = outputCanvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to prepare image for send');
    }

    context.drawImage(
      imageElement,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(255, 225, 0, 0.78)';
    context.lineWidth = Math.max(8, Math.min(24, cropWidth * 0.018));

    for (const stroke of strokes) {
      const previewPoints = pointsForPreviewStroke(
        stroke,
        imageElement.naturalWidth,
        imageElement.naturalHeight,
        crop,
        cropWidth,
        cropHeight
      );

      if (previewPoints.length < 2) {
        continue;
      }

      context.beginPath();
      context.moveTo(previewPoints[0].x, previewPoints[0].y);
      for (const point of previewPoints.slice(1)) {
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    const outputMimeType =
      file.type === 'image/png' || file.type === 'image/webp'
        ? file.type
        : 'image/jpeg';

    const blob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob((nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
          return;
        }

        reject(new Error('Unable to export edited image'));
      }, outputMimeType, 0.92);
    });

    const filename = file.name.includes('.')
      ? `${file.name.replace(/\.[^.]+$/, '')}-edited.${outputMimeType === 'image/png' ? 'png' : outputMimeType === 'image/webp' ? 'webp' : 'jpg'}`
      : `${file.name}-edited`;

    return new File([blob], filename, {
      type: outputMimeType,
      lastModified: Date.now(),
    });
  };

  const handleSendClick = async () => {
    if (!file) {
      return;
    }

    try {
      setIsPreparingImage(true);
      const preparedFile = await buildPreparedFile();
      const didSend = await onSend({
        file: preparedFile,
        caption,
      });
      if (didSend) {
        onOpenChange(false);
      }
    } finally {
      setIsPreparingImage(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!isSending ? onOpenChange(nextOpen) : null)}>
      <DialogContent className="flex h-[min(92vh,54rem)] w-[min(52rem,calc(100vw-1.5rem))] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Preview media</DialogTitle>
          <DialogDescription>
            Review your media, add a caption, and make quick edits before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto px-6 pb-4">
          {!file ? (
            <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
              No media selected.
            </div>
          ) : (
            <div className="mx-auto min-h-full w-full max-w-3xl">
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
                <div className="bg-muted/20 p-3 md:p-4">
                  {previewKind === 'image' ? (
                    <div className="space-y-3">
                      <div
                        ref={previewViewportRef}
                        className="relative mx-auto w-full overflow-hidden rounded-xl border border-border/60 bg-black/5"
                        style={{ aspectRatio: imageAspectRatio }}
                      >
                        {imageError ? (
                          <div className="flex h-full min-h-[18rem] items-center justify-center px-6 text-center text-sm text-destructive">
                            {imageError}
                          </div>
                        ) : (
                          <>
                            <canvas
                              ref={previewCanvasRef}
                              className={cn(
                                'block h-full w-full touch-none',
                                activeTool ? 'cursor-crosshair' : 'cursor-default'
                              )}
                              onPointerDown={handlePointerDown}
                              onPointerMove={handlePointerMove}
                              onPointerUp={(event) => finishStroke(event.pointerId)}
                              onPointerLeave={() => finishStroke()}
                            />
                            <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full border border-border/60 bg-background/88 p-1 shadow-sm backdrop-blur">
                              <Button
                                type="button"
                                variant={activeTool === 'crop' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                disabled={!supportsEditing}
                                title="Crop"
                                aria-label="Crop"
                                onClick={() => setActiveTool((current) => (current === 'crop' ? null : 'crop'))}
                              >
                                <Crop className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant={activeTool === 'highlight' ? 'default' : 'ghost'}
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                disabled={!supportsEditing}
                                title="Highlight"
                                aria-label="Highlight"
                                onClick={() => setActiveTool((current) => (current === 'highlight' ? null : 'highlight'))}
                              >
                                <PenLine className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                disabled={!supportsEditing || strokes.length === 0}
                                title="Undo highlight"
                                aria-label="Undo highlight"
                                onClick={handleUndoStroke}
                              >
                                <Undo2 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                disabled={!supportsEditing || (isDefaultCrop(crop) && strokes.length === 0)}
                                title="Reset edits"
                                aria-label="Reset edits"
                                onClick={handleResetImageEdits}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {previewKind === 'video' && previewUrl ? (
                    <video
                      src={previewUrl}
                      controls
                      className="mx-auto max-h-[32rem] w-full rounded-xl bg-black"
                    />
                  ) : null}

                  {previewKind === 'audio' && previewUrl ? (
                    <div className="rounded-xl border border-border/70 bg-background/80 p-4">
                      <audio src={previewUrl} controls className="w-full" />
                    </div>
                  ) : null}

                  {previewKind === 'document' ? (
                    <div className="flex min-h-[14rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-background/60 p-6 text-center">
                      <FileText className="h-10 w-10 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-foreground">{file.name}</div>
                        <div className="text-sm text-muted-foreground">{getDocumentDetails(file)}</div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {supportsCaption ? (
                  <div className="border-t border-border/70 p-3 md:p-4">
                    <Textarea
                      id="media-preview-caption"
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                      placeholder="Add a caption"
                      className="min-h-[104px] resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border/70 px-6 py-4">
          <Button type="button" variant="ghost" disabled={isSending || isPreparingImage} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!file || isSending || isPreparingImage} onClick={() => void handleSendClick()}>
            {isSending || isPreparingImage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing...
              </>
            ) : (
              'Send media'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
