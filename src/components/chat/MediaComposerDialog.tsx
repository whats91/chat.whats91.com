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
  Highlighter,
  Image as ImageIcon,
  Loader2,
  Undo2,
  Video,
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
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
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
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [strokes, setStrokes] = useState<HighlightStroke[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const drawingStrokeRef = useRef<HighlightPoint[]>([]);
  const isDrawingRef = useRef(false);

  const supportsCaption = previewKind !== 'audio';
  const supportsEditing = previewKind === 'image' && Boolean(imageElement);
  const cropAspectRatio = useMemo(() => {
    if (!imageElement) {
      return 4 / 3;
    }

    const cropWidth = Math.max(1, (crop.width / 100) * imageElement.naturalWidth);
    const cropHeight = Math.max(1, (crop.height / 100) * imageElement.naturalHeight);
    return cropWidth / cropHeight;
  }, [crop.height, crop.width, imageElement]);

  useEffect(() => {
    if (!open) {
      setCaption(initialCaption);
      setCrop(DEFAULT_CROP);
      setIsHighlightMode(false);
      setStrokes([]);
      setImageElement(null);
      setImageError(null);
      return;
    }

    setCaption(initialCaption);
    setCrop(DEFAULT_CROP);
    setIsHighlightMode(false);
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
    const previewHeight = Math.max(1, Math.round(previewWidth / cropAspectRatio));
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

    const cropX = (crop.x / 100) * imageElement.naturalWidth;
    const cropY = (crop.y / 100) * imageElement.naturalHeight;
    const cropWidth = Math.max(1, (crop.width / 100) * imageElement.naturalWidth);
    const cropHeight = Math.max(1, (crop.height / 100) * imageElement.naturalHeight);

    context.drawImage(
      imageElement,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
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
      const previewPoints = pointsForPreviewStroke(
        stroke,
        imageElement.naturalWidth,
        imageElement.naturalHeight,
        crop,
        previewWidth,
        previewHeight
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
  }, [crop, cropAspectRatio, imageElement, previewWidth, strokes, supportsEditing]);

  const handleCropValueChange = (key: keyof CropState, nextValue: number) => {
    setCrop((current) => {
      const draft = { ...current, [key]: nextValue };

      if (key === 'x') {
        draft.x = clamp(nextValue, 0, 90);
        draft.width = clamp(draft.width, 10, 100 - draft.x);
      }

      if (key === 'y') {
        draft.y = clamp(nextValue, 0, 90);
        draft.height = clamp(draft.height, 10, 100 - draft.y);
      }

      if (key === 'width') {
        draft.width = clamp(nextValue, 10, 100 - draft.x);
      }

      if (key === 'height') {
        draft.height = clamp(nextValue, 10, 100 - draft.y);
      }

      return draft;
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!supportsEditing || !isHighlightMode || !imageElement || !previewCanvasRef.current) {
      return;
    }

    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const cropX = (crop.x / 100) * imageElement.naturalWidth;
    const cropY = (crop.y / 100) * imageElement.naturalHeight;
    const cropWidth = (crop.width / 100) * imageElement.naturalWidth;
    const cropHeight = (crop.height / 100) * imageElement.naturalHeight;
    const relativeX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const relativeY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    const point = {
      x: (cropX + relativeX * cropWidth) / imageElement.naturalWidth,
      y: (cropY + relativeY * cropHeight) / imageElement.naturalHeight,
    };

    drawingStrokeRef.current = [point];
    isDrawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!supportsEditing || !isHighlightMode || !isDrawingRef.current || !imageElement || !previewCanvasRef.current) {
      return;
    }

    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const cropX = (crop.x / 100) * imageElement.naturalWidth;
    const cropY = (crop.y / 100) * imageElement.naturalHeight;
    const cropWidth = (crop.width / 100) * imageElement.naturalWidth;
    const cropHeight = (crop.height / 100) * imageElement.naturalHeight;
    const relativeX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const relativeY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    drawingStrokeRef.current.push({
      x: (cropX + relativeX * cropWidth) / imageElement.naturalWidth,
      y: (cropY + relativeY * cropHeight) / imageElement.naturalHeight,
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

    if (drawingStrokeRef.current.length > 0) {
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
    isDrawingRef.current = false;
  };

  const handleUndoStroke = () => {
    setStrokes((current) => current.slice(0, -1));
  };

  const handleResetImageEdits = () => {
    setCrop(DEFAULT_CROP);
    setStrokes([]);
    setIsHighlightMode(false);
  };

  const buildPreparedFile = async (): Promise<File> => {
    if (!file) {
      throw new Error('No file selected');
    }

    if (!supportsEditing || !imageElement) {
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
            <div className="grid min-h-full gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0 space-y-4">
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
                  <div className="border-b border-border/70 px-4 py-3 text-sm text-muted-foreground">
                    {file.name}
                  </div>
                  <div className="bg-muted/20 p-4">
                    {previewKind === 'image' ? (
                      <div className="space-y-3">
                        <div
                          ref={previewViewportRef}
                          className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border/60 bg-black/5"
                          style={{ aspectRatio: cropAspectRatio }}
                        >
                          {imageError ? (
                            <div className="flex h-full min-h-[18rem] items-center justify-center px-6 text-center text-sm text-destructive">
                              {imageError}
                            </div>
                          ) : (
                            <canvas
                              ref={previewCanvasRef}
                              className={cn(
                                'block h-full w-full touch-none',
                                isHighlightMode ? 'cursor-crosshair' : 'cursor-default'
                              )}
                              onPointerDown={handlePointerDown}
                              onPointerMove={handlePointerMove}
                              onPointerUp={(event) => finishStroke(event.pointerId)}
                              onPointerLeave={() => finishStroke()}
                            />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant={isHighlightMode ? 'default' : 'outline'}
                            size="sm"
                            disabled={!supportsEditing}
                            onClick={() => setIsHighlightMode((current) => !current)}
                          >
                            <Highlighter className="mr-2 h-4 w-4" />
                            Highlight
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!supportsEditing || strokes.length === 0}
                            onClick={handleUndoStroke}
                          >
                            <Undo2 className="mr-2 h-4 w-4" />
                            Undo
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!supportsEditing}
                            onClick={handleResetImageEdits}
                          >
                            <Crop className="mr-2 h-4 w-4" />
                            Reset edits
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {previewKind === 'video' && previewUrl ? (
                      <video
                        src={previewUrl}
                        controls
                        className="mx-auto max-h-[26rem] w-full rounded-xl bg-black"
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
                </div>

                {supportsCaption ? (
                  <div className="space-y-2">
                    <Label htmlFor="media-preview-caption">Caption</Label>
                    <Textarea
                      id="media-preview-caption"
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                      placeholder="Add a caption"
                      className="min-h-[96px] resize-none"
                    />
                  </div>
                ) : null}
              </div>

              <ScrollArea className="max-h-[calc(92vh-11rem)] min-h-0 rounded-2xl border border-border/70 bg-card/50">
                <div className="space-y-5 p-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">Preview details</div>
                    <p className="text-sm text-muted-foreground">
                      {previewKind === 'image'
                        ? 'Crop the image and use highlight mode to emphasize parts before sending.'
                        : previewKind === 'video'
                          ? 'Preview the video and add a caption before sending.'
                          : previewKind === 'audio'
                            ? 'Preview the audio before sending.'
                            : 'Review the document details before sending.'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      {previewKind === 'image' ? <ImageIcon className="h-4 w-4" /> : null}
                      {previewKind === 'video' ? <Video className="h-4 w-4" /> : null}
                      {previewKind === 'document' ? <FileText className="h-4 w-4" /> : null}
                      <span className="capitalize">{previewKind}</span>
                    </div>
                    <div className="mt-2 text-muted-foreground">{getDocumentDetails(file)}</div>
                  </div>

                  {supportsEditing ? (
                    <div className="space-y-4">
                      <div className="text-sm font-medium text-foreground">Crop</div>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Left</span>
                            <span>{Math.round(crop.x)}%</span>
                          </div>
                          <Slider
                            value={[crop.x]}
                            min={0}
                            max={90}
                            step={1}
                            onValueChange={(values) => handleCropValueChange('x', values[0] || 0)}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Top</span>
                            <span>{Math.round(crop.y)}%</span>
                          </div>
                          <Slider
                            value={[crop.y]}
                            min={0}
                            max={90}
                            step={1}
                            onValueChange={(values) => handleCropValueChange('y', values[0] || 0)}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Width</span>
                            <span>{Math.round(crop.width)}%</span>
                          </div>
                          <Slider
                            value={[crop.width]}
                            min={10}
                            max={100 - crop.x}
                            step={1}
                            onValueChange={(values) => handleCropValueChange('width', values[0] || 10)}
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Height</span>
                            <span>{Math.round(crop.height)}%</span>
                          </div>
                          <Slider
                            value={[crop.height]}
                            min={10}
                            max={100 - crop.y}
                            step={1}
                            onValueChange={(values) => handleCropValueChange('height', values[0] || 10)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
                      Editing tools are currently available for images only. Videos, audio, and documents still open in preview before send.
                    </div>
                  )}
                </div>
              </ScrollArea>
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
