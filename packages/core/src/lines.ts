import { createReadStream } from "node:fs";
import { decodedChunks, type DecoderMode } from "./zstd.js";

export interface JsonLine {
  text: string;
  oversized: boolean;
  terminated: boolean;
}
export interface ReadOptions {
  maxLineBytes?: number;
  decoder?: DecoderMode;
  signal?: AbortSignal;
}

export async function* readLines(
  file: string,
  options: ReadOptions = {},
): AsyncGenerator<JsonLine> {
  options.signal?.throwIfAborted();
  const limit = options.maxLineBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("INVALID_LINE_LIMIT");
  const prefixLimit = Math.min(limit, 64 * 1024);
  const stream = file.endsWith(".zst")
    ? decodedChunks(file, options.decoder)
    : createReadStream(file, { highWaterMark: 64 * 1024 });
  let pieces: Uint8Array[] = [];
  let kept = 0;
  let length = 0;
  let oversized = false;

  function append(part: Uint8Array) {
    length += part.length;
    if (!oversized && length > limit) {
      const prefix = Buffer.concat(pieces, kept).subarray(0, prefixLimit);
      pieces = [Buffer.from(prefix)];
      kept = prefix.length;
      oversized = true;
    }
    const room = (oversized ? prefixLimit : limit) - kept;
    if (room > 0 && part.length > 0) {
      const piece = part.subarray(0, room);
      pieces.push(piece);
      kept += piece.length;
    }
  }

  function finish(terminated: boolean): JsonLine {
    const line = {
      text: Buffer.concat(pieces, kept)
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .replace(/\r$/, ""),
      oversized,
      terminated,
    };
    pieces = [];
    kept = 0;
    length = 0;
    oversized = false;
    return line;
  }

  for await (const chunk of stream) {
    options.signal?.throwIfAborted();
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    for (
      let end = bytes.indexOf(10);
      end !== -1;
      end = bytes.indexOf(10, start)
    ) {
      append(bytes.subarray(start, end));
      yield finish(true);
      start = end + 1;
    }
    append(bytes.subarray(start));
  }
  if (length > 0) yield finish(false);
}
