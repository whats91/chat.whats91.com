'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import OpusMediaRecorder, { type OpusMediaRecorderWorkerOptions } from 'opus-media-recorder';
import { sendVoiceNote } from '@/lib/api/client';

const DIRECT_OGG_OPUS_MIME_TYPE = 'audio/ogg;codecs=opus';
const FALLBACK_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
] as const;

const OPUS_MEDIA_RECORDER_ASSET_BASE = '/vendor/opus-media-recorder';

export type VoiceRecorderState = 'idle' | 'recording' | 'processing' | 'sent' | 'error';
export type VoiceRecorderTransport = 'direct-ogg-opus' | 'server-convert';

interface UseVoiceRecorderOptions {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => Promise<void> | void;
}

interface RecorderSession {
  recorder: MediaRecorder;
  stream: MediaStream;
  mimeType: string;
  transport: VoiceRecorderTransport;
}

function getFileExtensionFromMimeType(mimeType: string): string {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType.includes('ogg')) return 'ogg';
  if (normalizedMimeType.includes('webm')) return 'webm';
  if (normalizedMimeType.includes('mp4')) return 'm4a';
  if (normalizedMimeType.includes('mpeg')) return 'mp3';
  return 'bin';
}

function getWorkerOptions(): OpusMediaRecorderWorkerOptions {
  return {
    encoderWorkerFactory: () =>
      new Worker(`${OPUS_MEDIA_RECORDER_ASSET_BASE}/encoderWorker.umd.js`),
    OggOpusEncoderWasmPath: `${OPUS_MEDIA_RECORDER_ASSET_BASE}/OggOpusEncoder.wasm`,
    WebMOpusEncoderWasmPath: `${OPUS_MEDIA_RECORDER_ASSET_BASE}/WebMOpusEncoder.wasm`,
  };
}

async function createRecorderSession(stream: MediaStream): Promise<RecorderSession> {
  const NativeMediaRecorder = window.MediaRecorder;

  if (NativeMediaRecorder?.isTypeSupported?.(DIRECT_OGG_OPUS_MIME_TYPE)) {
    return {
      recorder: new NativeMediaRecorder(stream, { mimeType: DIRECT_OGG_OPUS_MIME_TYPE }),
      stream,
      mimeType: 'audio/ogg',
      transport: 'direct-ogg-opus',
    };
  }

  try {
    const recorder = new OpusMediaRecorder(
      stream,
      { mimeType: DIRECT_OGG_OPUS_MIME_TYPE },
      getWorkerOptions()
    );

    return {
      recorder,
      stream,
      mimeType: 'audio/ogg',
      transport: 'direct-ogg-opus',
    };
  } catch {
    if (!NativeMediaRecorder) {
      throw new Error('This browser does not support microphone recording.');
    }

    const fallbackMimeType =
      FALLBACK_MIME_CANDIDATES.find((candidate) =>
        NativeMediaRecorder.isTypeSupported?.(candidate)
      ) || '';

    if (!fallbackMimeType) {
      throw new Error(
        'This browser cannot record audio in a format that can be converted into a WhatsApp voice note.'
      );
    }

    return {
      recorder: fallbackMimeType
        ? new NativeMediaRecorder(stream, { mimeType: fallbackMimeType })
        : new NativeMediaRecorder(stream),
      stream,
      mimeType: fallbackMimeType || 'audio/webm',
      transport: 'server-convert',
    };
  }
}

export function useVoiceRecorder({
  conversationId,
  disabled = false,
  onSent,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const recorderSessionRef = useRef<RecorderSession | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldDiscardRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSupported = useMemo(() => {
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopTracks = () => {
    const session = recorderSessionRef.current;
    if (!session) {
      return;
    }

    for (const track of session.stream.getTracks()) {
      track.stop();
    }
  };

  const resetSentTimeout = () => {
    if (sentResetTimeoutRef.current) {
      clearTimeout(sentResetTimeoutRef.current);
      sentResetTimeoutRef.current = null;
    }
  };

  const reset = () => {
    clearTimer();
    resetSentTimeout();
    stopTracks();
    recorderSessionRef.current = null;
    chunksRef.current = [];
    shouldDiscardRef.current = false;
    setDurationSeconds(0);
  };

  const handleFailure = (message: string) => {
    reset();
    setError(message);
    setState('error');
  };

  const finalizeRecording = async () => {
    const session = recorderSessionRef.current;
    const chunks = [...chunksRef.current];
    const shouldDiscard = shouldDiscardRef.current;

    reset();

    if (shouldDiscard) {
      setState('idle');
      setError(null);
      return;
    }

    if (!session || !chunks.length) {
      handleFailure('No audio was captured. Please record again.');
      return;
    }

    const blob = new Blob(chunks, { type: session.mimeType });
    if (!blob.size) {
      handleFailure('No audio was captured. Please record again.');
      return;
    }

    setState('processing');
    setError(null);

    try {
      const file = new File(
        [blob],
        `voice-note-${Date.now()}.${getFileExtensionFromMimeType(session.mimeType)}`,
        { type: session.mimeType }
      );

      const response = await sendVoiceNote(conversationId, file, {
        recordingMode: session.transport,
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to send voice note');
      }

      await onSent?.();

      setState('sent');
      resetSentTimeout();
      sentResetTimeoutRef.current = setTimeout(() => {
        setState('idle');
      }, 1500);
    } catch (sendError) {
      handleFailure(
        sendError instanceof Error ? sendError.message : 'Failed to send voice note'
      );
    }
  };

  const startRecording = async () => {
    if (disabled) {
      return;
    }

    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      handleFailure('This browser does not support microphone recording.');
      return;
    }

    resetSentTimeout();
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const session = await createRecorderSession(stream);
      recorderSessionRef.current = session;
      chunksRef.current = [];
      shouldDiscardRef.current = false;

      session.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      session.recorder.onerror = () => {
        handleFailure('Recording failed. Please try again.');
      };

      session.recorder.onstop = () => {
        void finalizeRecording();
      };

      session.recorder.start();
      setDurationSeconds(0);
      setState('recording');
      timerRef.current = setInterval(() => {
        setDurationSeconds((currentValue) => currentValue + 1);
      }, 1000);
    } catch (recordError) {
      if (recordError instanceof DOMException && recordError.name === 'NotAllowedError') {
        handleFailure('Microphone permission denied. Allow microphone access and try again.');
        return;
      }

      if (recordError instanceof DOMException && recordError.name === 'NotFoundError') {
        handleFailure('No microphone was found on this device.');
        return;
      }

      handleFailure(
        recordError instanceof Error ? recordError.message : 'Unable to start voice recording.'
      );
    }
  };

  const stopRecording = async () => {
    const session = recorderSessionRef.current;
    if (!session) {
      return;
    }

    clearTimer();
    setState('processing');
    if (session.recorder.state !== 'inactive') {
      session.recorder.stop();
    } else {
      await finalizeRecording();
    }
  };

  const cancelRecording = () => {
    shouldDiscardRef.current = true;
    clearTimer();

    const session = recorderSessionRef.current;
    if (session?.recorder.state && session.recorder.state !== 'inactive') {
      session.recorder.stop();
      return;
    }

    reset();
    setState('idle');
  };

  const toggleRecording = async () => {
    if (state === 'recording') {
      await stopRecording();
      return;
    }

    if (state === 'processing') {
      return;
    }

    await startRecording();
  };

  useEffect(() => {
    setState('idle');
    setError(null);
    cancelRecording();
  }, [conversationId]);

  useEffect(() => {
    return () => {
      shouldDiscardRef.current = true;
      cancelRecording();
      resetSentTimeout();
    };
  }, []);

  return {
    state,
    error,
    durationSeconds,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
    toggleRecording,
  };
}
