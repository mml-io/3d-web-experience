export type DecodeDebugData = {
  componentsByteLength: number;
  statesByteLength: number;
};

export type DecodeServerMessageOptions = {
  ignoreData?: boolean; // Used when the client doesn't want to process data, e.g., in bot mode
  debugData?: DecodeDebugData;
};
