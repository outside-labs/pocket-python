import {tokenize} from "./source-tokens.mjs";

export function runTokenRequest(request) {
  try {
    const source = Array.isArray(request.bytes) ? new Uint8Array(request.bytes) : request.source;
    return {ok: true, ...tokenize(source, request.options)};
  } catch (error) {
    return {ok: false, error: {code: error.code || "HOST", type: error.name, phase: error.phase,
      message: error.message, location: error.location}};
  }
}
