import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";

export type DecoderMode = "auto" | "native" | "js" | "none";
const nativeZlib = zlib as typeof zlib & {
  createZstdDecompress?: () => Readable & NodeJS.WritableStream;
};
const maxWindow = 32 * 1024 * 1024;
type StreamingDecoder = new (onData: (chunk: Uint8Array) => void) => {
  push(chunk: Uint8Array, final?: boolean): void;
};
const requireFromHere = createRequire(import.meta.url);
let fallback: StreamingDecoder | null | undefined;

function jsDecoder() {
  if (fallback === undefined) {
    try {
      const module = requireFromHere("fzstd") as {
        Decompress?: StreamingDecoder;
      };
      fallback =
        typeof module.Decompress === "function" ? module.Decompress : null;
    } catch {
      fallback = null;
    }
  }
  return fallback;
}

export function zstdCapability(mode: DecoderMode = "auto") {
  if (mode === "none") return "unavailable" as const;
  if (mode !== "js" && nativeZlib.createZstdDecompress)
    return "native" as const;
  return mode !== "native" && jsDecoder()
    ? ("js" as const)
    : ("unavailable" as const);
}

// Validate each frame before a decoder can allocate its advertised window.
// Only a frame header and one compressed block are retained here.
async function* frameChunks(file: string): AsyncGenerator<Buffer> {
  const source = createReadStream(file, { highWaterMark: 128 * 1024 });
  const iterator = source[Symbol.asyncIterator]();
  let pending: Buffer = Buffer.alloc(0);
  let offset = 0;

  async function read(
    size: number,
    eofAllowed = false,
  ): Promise<Buffer | null> {
    const parts: Buffer[] = [];
    let remaining = size;
    while (remaining > 0) {
      if (offset === pending.length) {
        const next = await iterator.next();
        if (next.done) {
          if (eofAllowed && remaining === size) return null;
          throw new Error("ZSTD_TRUNCATED");
        }
        pending = next.value as Buffer;
        offset = 0;
      }
      const count = Math.min(remaining, pending.length - offset);
      parts.push(pending.subarray(offset, offset + count));
      offset += count;
      remaining -= count;
    }
    return Buffer.concat(parts, size);
  }

  const required = async (size: number) => (await read(size))!;
  try {
    for (;;) {
      const magic = await read(4, true);
      if (!magic) break;
      const value = magic.readUInt32LE();
      if ((value & 0xfffffff0) >>> 0 === 0x184d2a50) {
        const length = await required(4);
        yield Buffer.concat([magic, length]);
        let left = length.readUInt32LE();
        while (left > 0) {
          const chunk = await required(Math.min(left, 128 * 1024));
          left -= chunk.length;
          yield chunk;
        }
        continue;
      }
      if (value !== 0xfd2fb528) throw new Error("ZSTD_INVALID_MAGIC");
      const descriptor = await required(1);
      const flag = descriptor[0];
      if (flag & 8) throw new Error("ZSTD_INVALID_HEADER");
      const single = Boolean(flag & 32);
      const windowDescriptor = single ? Buffer.alloc(0) : await required(1);
      const dictSize = [0, 1, 2, 4][flag & 3];
      const dict = await required(dictSize);
      const contentSizeFlag = flag >> 6;
      const sizeLength =
        contentSizeFlag === 0 ? Number(single) : 1 << contentSizeFlag;
      const size = await required(sizeLength);
      let windowBytes: number;
      if (single) {
        const contentBytes =
          sizeLength === 8
            ? Number(size.readBigUInt64LE())
            : size.readUIntLE(0, sizeLength);
        windowBytes = contentBytes + (contentSizeFlag === 1 ? 256 : 0);
      } else {
        const base = 2 ** (10 + (windowDescriptor[0] >> 3));
        windowBytes = base + (base / 8) * (windowDescriptor[0] & 7);
      }
      if (windowBytes > maxWindow) throw new Error("ZSTD_WINDOW_LIMIT_32_MIB");
      yield Buffer.concat([magic, descriptor, windowDescriptor, dict, size]);
      let last = false;
      while (!last) {
        const header = await required(3);
        const bits = header.readUIntLE(0, 3);
        last = Boolean(bits & 1);
        const type = (bits >> 1) & 3;
        const blockSize = bits >> 3;
        if (type === 3 || blockSize > 128 * 1024)
          throw new Error("ZSTD_INVALID_BLOCK");
        yield header;
        yield await required(type === 1 ? 1 : blockSize);
      }
      if (flag & 4) yield await required(4);
    }
  } finally {
    source.destroy();
  }
}

export async function* decodedChunks(
  file: string,
  mode: DecoderMode = "auto",
): AsyncGenerator<Uint8Array> {
  const capability = zstdCapability(mode);
  if (capability === "unavailable") throw new Error("ZSTD_UNAVAILABLE");
  if (capability === "native") {
    const source = Readable.from(frameChunks(file));
    const decoder = nativeZlib.createZstdDecompress!();
    const transfer = pipeline(source, decoder);
    transfer.catch(() => {});
    try {
      for await (const chunk of decoder) yield chunk as Buffer;
      await transfer;
    } finally {
      source.destroy();
      decoder.destroy();
    }
    return;
  }
  const Decompress = jsDecoder()!;
  let output: Uint8Array[] = [];
  const decoder = new Decompress((chunk) => {
    if (chunk.length > 0) output.push(chunk);
  });
  for await (const compressed of frameChunks(file)) {
    decoder.push(compressed);
    for (const chunk of output) yield chunk;
    output = [];
  }
  decoder.push(new Uint8Array(0), true);
  for (const chunk of output) yield chunk;
}
