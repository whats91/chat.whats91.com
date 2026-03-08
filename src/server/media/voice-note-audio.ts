import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { Logger } from '@/lib/logger';

const log = new Logger('VoiceNoteAudio');

const TARGET_MIME_TYPE = 'audio/ogg';
const TARGET_EXTENSION = 'ogg';
const MAX_WHATSAPP_AUDIO_BYTES = 16 * 1024 * 1024;

export type VoiceNoteRecordingMode = 'direct-ogg-opus' | 'server-convert';

export interface PrepareVoiceNoteAudioParams {
  fileBuffer: Buffer;
  mimeType: string;
  originalFilename: string;
  recordingMode: VoiceNoteRecordingMode;
}

export interface PrepareVoiceNoteAudioResult {
  success: boolean;
  fileBuffer?: Buffer;
  mimeType?: string;
  originalFilename?: string;
  converted?: boolean;
  message: string;
}

function buildFilename(filename: string): string {
  const extension = path.extname(filename);
  const baseName = extension ? filename.slice(0, -extension.length) : filename;
  const safeBaseName = path.basename(baseName || 'voice-note').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeBaseName || 'voice-note'}.${TARGET_EXTENSION}`;
}

function shouldConvert(params: PrepareVoiceNoteAudioParams): boolean {
  if (params.recordingMode === 'server-convert') {
    return true;
  }

  return !params.mimeType.toLowerCase().startsWith(TARGET_MIME_TYPE);
}

function getInputExtension(filename: string, mimeType: string): string {
  const existingExtension = path.extname(filename);
  if (existingExtension) {
    return existingExtension;
  }

  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('webm')) return '.webm';
  if (normalizedMimeType.includes('mp4')) return '.m4a';
  if (normalizedMimeType.includes('mpeg')) return '.mp3';
  if (normalizedMimeType.includes('wav')) return '.wav';
  if (normalizedMimeType.includes('ogg')) return '.ogg';
  return '.bin';
}

async function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  const resolvedFfmpegPath = ffmpegPath;
  if (!resolvedFfmpegPath) {
    throw new Error('FFmpeg is not available. Install dependencies to enable voice note conversion.');
  }

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-nostdin',
      '-i',
      inputPath,
      '-vn',
      '-c:a',
      'libopus',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-b:a',
      '64k',
      '-application',
      'voip',
      '-f',
      'ogg',
      outputPath,
    ];

    const ffmpegProcess = spawn(resolvedFfmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpegProcess.on('error', (error) => {
      reject(error);
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

export async function prepareVoiceNoteAudio(
  params: PrepareVoiceNoteAudioParams
): Promise<PrepareVoiceNoteAudioResult> {
  const normalizedFilename = buildFilename(params.originalFilename);

  if (!shouldConvert(params)) {
    if (params.fileBuffer.length > MAX_WHATSAPP_AUDIO_BYTES) {
      return {
        success: false,
        message: 'Voice note is too large for WhatsApp Cloud API',
      };
    }

    return {
      success: true,
      fileBuffer: params.fileBuffer,
      mimeType: TARGET_MIME_TYPE,
      originalFilename: normalizedFilename,
      converted: false,
      message: 'Voice note already in WhatsApp-compatible format',
    };
  }

  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'whats91-voice-note-'));
  const inputPath = path.join(
    tempDirectory,
    `${randomUUID()}${getInputExtension(params.originalFilename, params.mimeType)}`
  );
  const outputPath = path.join(tempDirectory, `${randomUUID()}.${TARGET_EXTENSION}`);

  try {
    await writeFile(inputPath, params.fileBuffer);
    await runFfmpeg(inputPath, outputPath);

    const convertedBuffer = await readFile(outputPath);
    if (!convertedBuffer.length) {
      return {
        success: false,
        message: 'FFmpeg produced an empty voice note file',
      };
    }

    if (convertedBuffer.length > MAX_WHATSAPP_AUDIO_BYTES) {
      return {
        success: false,
        message: 'Converted voice note is too large for WhatsApp Cloud API',
      };
    }

    return {
      success: true,
      fileBuffer: convertedBuffer,
      mimeType: TARGET_MIME_TYPE,
      originalFilename: normalizedFilename,
      converted: true,
      message: 'Voice note converted successfully',
    };
  } catch (error) {
    log.error('Voice note conversion failed', {
      error: error instanceof Error ? error.message : error,
      mimeType: params.mimeType,
      recordingMode: params.recordingMode,
    });

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Voice note conversion failed',
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
