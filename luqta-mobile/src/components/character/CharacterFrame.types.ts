// Messages the avatar engine (web-engines/avatar.js) posts back, and the handle used to send it commands.
export type EngineMessage = { type?: string; code?: string; action?: string; [key: string]: unknown };
export type FrameHandle = { send: (message: Record<string, unknown>) => void };
