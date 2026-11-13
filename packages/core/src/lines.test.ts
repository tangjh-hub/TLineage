import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readLines, type ReadOptions } from "./lines.js";
import { zstdCapability } from "./zstd.js";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "tlineage-lines-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function collect(file: string, options?: ReadOptions) {
  const result = [];
  for await (const line of readLines(file, options)) result.push(line);
  return result;
}

function frame(blocks: { data: Buffer; repeat?: number }[]) {
  const header = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0, 0, 0, 0]);
  header.writeUInt32LE(
    blocks.reduce(
      (size, block) => size + (block.repeat ?? block.data.length),
      0,
    ),
    5,
  );
  return Buffer.concat([
    header,
    ...blocks.flatMap(({ data, repeat }, index) => {
      const block = Buffer.alloc(3);
      block.writeUIntLE(
        ((repeat ?? data.length) << 3) |
          (repeat === undefined ? 0 : 2) |
          Number(index === blocks.length - 1),
        0,
        3,
      );
      return [block, data];
    }),
  ]);
}

test("streams BOM, UTF-8, CRLF, and a final line without a newline", async () => {
  const file = join(scratch, "plain.jsonl");
  await writeFile(file, '\uFEFF{"text":"中文"}\r\n{"text":"tail"}');
  expect(await collect(file)).toEqual([
    { text: '{"text":"中文"}', oversized: false, terminated: true },
    { text: '{"text":"tail"}', oversized: false, terminated: false },
  ]);
});

test.each(["js", "native"] as const)(
  "limits a 22 MiB line and reads the next frame with %s zstd",
  async (decoder) => {
    if (zstdCapability(decoder) === "unavailable") return;
    const file = join(scratch, "large.jsonl.zst");
    const first = frame([
      { data: Buffer.from('{"type":"response_item","text":"') },
      ...Array.from({ length: 22 * 8 }, () => ({
        data: Buffer.from("x"),
        repeat: 128 * 1024,
      })),
      { data: Buffer.from('"}\n') },
    ]);
    const second = frame([{ data: Buffer.from('{"type":"event_msg"}\n') }]);
    const skippable = Buffer.from([
      0x50, 0x2a, 0x4d, 0x18, 0x01, 0x00, 0x00, 0x00, 0xff,
    ]);
    await writeFile(file, Buffer.concat([first, skippable, second]));
    const [large, next] = await collect(file, { decoder });
    expect(large.oversized).toBe(true);
    expect(Buffer.byteLength(large.text)).toBe(64 * 1024);
    expect(large.text.startsWith('{"type":"response_item"')).toBe(true);
    expect(next).toEqual({
      text: '{"type":"event_msg"}',
      oversized: false,
      terminated: true,
    });
  },
);

test("reports unavailable zstd, oversized frame windows and truncated compressed data", async () => {
  const file = join(scratch, "invalid.jsonl.zst");
  const header = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0, 0, 0, 0]);
  header.writeUInt32LE(256 * 1024 * 1024, 5);
  await writeFile(file, header);
  await expect(collect(file, { decoder: "none" })).rejects.toThrow(
    "ZSTD_UNAVAILABLE",
  );
  await expect(collect(file, { decoder: "js" })).rejects.toThrow(
    "ZSTD_WINDOW_LIMIT_32_MIB",
  );
  await writeFile(
    file,
    frame([{ data: Buffer.from("incomplete") }]).subarray(0, -1),
  );
  await expect(collect(file, { decoder: "js" })).rejects.toThrow(
    "ZSTD_TRUNCATED",
  );
});
