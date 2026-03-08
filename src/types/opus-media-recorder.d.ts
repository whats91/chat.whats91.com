declare module 'opus-media-recorder' {
  export interface OpusMediaRecorderWorkerOptions {
    encoderWorkerFactory?: () => Worker;
    OggOpusEncoderWasmPath?: string;
    WebMOpusEncoderWasmPath?: string;
  }

  const OpusMediaRecorder: {
    new (
      stream: MediaStream,
      options?: MediaRecorderOptions,
      workerOptions?: OpusMediaRecorderWorkerOptions
    ): MediaRecorder;
  };

  export default OpusMediaRecorder;
}
