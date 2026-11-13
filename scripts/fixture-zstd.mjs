export function frame(blocks) {
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

export function oversizedSessionFrame() {
  return frame([
    {
      data: Buffer.from(
        '{"type":"session_meta","payload":{"id":"00000000-0000-4000-8000-000000000001"}}\n{"type":"response_item","payload":{"output":"',
      ),
    },
    ...Array.from({ length: 33 }, () => ({
      data: Buffer.from("x"),
      repeat: 128 * 1024,
    })),
    {
      data: Buffer.from(
        '"}}\n{"type":"event_msg","payload":{"type":"token_count"}}\n',
      ),
    },
  ]);
}
