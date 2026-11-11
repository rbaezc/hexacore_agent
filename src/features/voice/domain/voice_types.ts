import { Result } from '../../../shared/domain/result.js';

export type VoiceLang = 'en' | 'es';

export type IntentName =
  | 'resume'
  | 'run_checks'
  | 'watch_status'
  | 'list_prototypes'
  | 'open_prototype'
  | 'list_checkpoints'
  | 'rollback_last'
  | 'help'
  | 'exit';

export interface Intent {
  name: IntentName;
  /** run_checks: which checks (default typecheck + test). */
  checks?: string[];
  /** open_prototype: the prototype name, when one was said. */
  target?: string;
}

/** What the session needs from HexaCore: a tool call by name (the MCP tool registry, in practice). */
export interface ToolCaller {
  call(tool: string, input: Record<string, unknown>): Promise<Result<any, Error>>;
}

export interface Recording {
  /** Stops recording and returns the path of a 16 kHz mono WAV file. */
  stop(): Promise<Result<string, Error>>;
}

export interface Recorder {
  start(): Promise<Result<Recording, Error>>;
}

export interface Transcriber {
  transcribe(wavPath: string, lang: VoiceLang): Promise<Result<string, Error>>;
}

export interface VoiceReply {
  /** What is said (and printed). */
  text: string;
  /** Extra detail printed to the terminal only. */
  detail?: string;
  /** The session waits for a yes/no before doing anything that writes. */
  awaitingConfirmation?: boolean;
  /** The user asked to stop listening. */
  done?: boolean;
}
