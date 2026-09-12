import type { ChunkCoordinate, VoxelChunk } from "./chunk-types";

/**
 * Nomio Voxel Storage Format (NSVF).
 *
 * A voxel-aware, dependency-free, worker-friendly storage format. Every chunk is
 * encoded independently by trying a family of codecs that exploit the structure
 * of voxel data (palettes, vertical columns, layered terrain, sparse edits) and
 * keeping the smallest result. Regions then group chunks for random access and
 * archives group regions into a single seekable file.
 *
 * The codec is deliberately generic: it never imports block definitions or
 * terrain generation, so it can run on the main thread, in a worker, or in a
 * plain Node script. Callers pass the chunk dimensions and, optionally, a
 * baseline provider that turns `Sparse` chunks into deltas.
 */

export interface VoxelFormatDimensions {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly minY: number;
}

export type ChunkBaseProvider = (coordinate: ChunkCoordinate) => Uint8Array | null;

export const CHUNK_CODEC = {
  /** A single value fills the chunk. */
  CONSTANT: 0,
  /** Per-chunk palette with fixed-width bit-packed indices. */
  BITPACK: 1,
  /** Per-chunk palette with run-length encoding over the plane-major buffer. */
  RLE: 2,
  /** Deduplicated vertical columns with run-length encoded ids. */
  COLUMN_DICT: 3,
  /** Shared top-down profile plus one surface height per column. */
  SURFACE_PROFILE: 4,
  /** Only cells that differ from a baseline, as sorted index deltas. */
  SPARSE: 5,
  /** Canonical Huffman coding of the palette indices. */
  HUFFMAN: 6,
} as const;

export type ChunkCodec = (typeof CHUNK_CODEC)[keyof typeof CHUNK_CODEC];

/** Chunks are grouped into square regions of this many chunks per axis. */
export const VOXEL_REGION_SIZE = 32;

const REGION_MAGIC = 0x4e565247; // "NVRG"
const ARCHIVE_MAGIC = 0x4e535646; // "NSVF"
const FORMAT_VERSION = 1;

const MAX_CHUNK_VOLUME = 1 << 24;

// ---------------------------------------------------------------------------
// Byte primitives
// ---------------------------------------------------------------------------

class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  public constructor(initialCapacity = 64) {
    this.buffer = new Uint8Array(Math.max(8, initialCapacity));
    this.view = new DataView(this.buffer.buffer);
  }

  public get length(): number {
    return this.offset;
  }

  public u8(value: number): void {
    this.ensure(1);
    this.buffer[this.offset] = value & 0xff;
    this.offset += 1;
  }

  public u16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, value & 0xffff, true);
    this.offset += 2;
  }

  public u32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  public i16(value: number): void {
    this.ensure(2);
    this.view.setInt16(this.offset, value | 0, true);
    this.offset += 2;
  }

  public i32(value: number): void {
    this.ensure(4);
    this.view.setInt32(this.offset, value | 0, true);
    this.offset += 4;
  }

  public bytes(values: Uint8Array): void {
    this.ensure(values.length);
    this.buffer.set(values, this.offset);
    this.offset += values.length;
  }

  public varint(value: number): void {
    let remaining = Math.floor(value);
    if (remaining < 0) {
      throw new Error(`Cannot encode a negative varint: ${value}`);
    }
    while (remaining > 0x7f) {
      this.u8((remaining % 128) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    this.u8(remaining);
  }

  public toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  private ensure(extra: number): void {
    const required = this.offset + extra;
    if (required <= this.buffer.length) {
      return;
    }
    let capacity = this.buffer.length;
    while (capacity < required) {
      capacity *= 2;
    }
    const next = new Uint8Array(capacity);
    next.set(this.buffer);
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }
}

class ByteReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private offset: number;

  public constructor(bytes: Uint8Array, offset = 0) {
    this.data = bytes;
    this.offset = offset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public get position(): number {
    return this.offset;
  }

  public get remaining(): number {
    return this.data.length - this.offset;
  }

  public u8(): number {
    this.require(1);
    return this.data[this.offset++];
  }

  public u16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  public u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public i16(): number {
    this.require(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  public i32(): number {
    this.require(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  public varint(): number {
    let result = 0;
    let shift = 1;
    for (let index = 0; index < 8; index += 1) {
      const byte = this.u8();
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift *= 128;
    }
    throw new Error("Malformed varint");
  }

  public bytes(length: number): Uint8Array {
    this.require(length);
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  public skip(length: number): void {
    this.require(length);
    this.offset += length;
  }

  private require(length: number): void {
    if (this.offset + length > this.data.length) {
      throw new Error("Unexpected end of voxel payload");
    }
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export const crc32 = (bytes: Uint8Array, seed = 0): number => {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const bitWidth = (count: number): number => (count <= 1 ? 0 : 32 - Math.clz32(count - 1));

const indexOf = (dimensions: VoxelFormatDimensions, x: number, y: number, z: number): number =>
  x + z * dimensions.sizeX + y * dimensions.sizeX * dimensions.sizeZ;

export const voxelVolume = (dimensions: VoxelFormatDimensions): number =>
  dimensions.sizeX * dimensions.sizeY * dimensions.sizeZ;

const assertVolume = (blocks: Uint8Array, dimensions: VoxelFormatDimensions): number => {
  const volume = voxelVolume(dimensions);
  if (volume > MAX_CHUNK_VOLUME) {
    throw new Error(`Chunk volume ${volume} exceeds the supported maximum`);
  }
  if (blocks.length !== volume) {
    throw new Error(`Expected ${volume} cells but received ${blocks.length}`);
  }
  return volume;
};

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

interface Palette {
  readonly values: number[];
  readonly indices: Uint8Array;
}

const buildPalette = (blocks: Uint8Array): Palette => {
  const map = new Int16Array(256).fill(-1);
  const values: number[] = [];
  const indices = new Uint8Array(blocks.length);
  for (let index = 0; index < blocks.length; index += 1) {
    const value = blocks[index];
    let paletteIndex = map[value];
    if (paletteIndex < 0) {
      paletteIndex = values.length;
      values.push(value);
      map[value] = paletteIndex;
    }
    indices[index] = paletteIndex;
  }
  return { values, indices };
};

const writePalette = (writer: ByteWriter, values: readonly number[]): void => {
  writer.varint(values.length);
  for (const value of values) {
    writer.u8(value);
  }
};

const readPalette = (reader: ByteReader): number[] => {
  const count = reader.varint();
  const values: number[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = reader.u8();
  }
  return values;
};

// ---------------------------------------------------------------------------
// Bit packing
// ---------------------------------------------------------------------------

const packBits = (indices: Uint8Array, bits: number): Uint8Array => {
  if (bits <= 0) {
    return new Uint8Array(0);
  }
  const output = new Uint8Array(Math.ceil((indices.length * bits) / 8));
  let bit = 0;
  for (let index = 0; index < indices.length; index += 1) {
    let value = indices[index];
    for (let offset = 0; offset < bits; offset += 1) {
      if (value & 1) {
        output[bit >> 3] |= 1 << (bit & 7);
      }
      value >>>= 1;
      bit += 1;
    }
  }
  return output;
};

const unpackBits = (
  reader: ByteReader,
  bits: number,
  count: number,
  output: Uint8Array,
  outputOffset = 0,
): void => {
  if (bits <= 0) {
    output.fill(0, outputOffset, outputOffset + count);
    return;
  }
  const byteLength = Math.ceil((count * bits) / 8);
  const bytes = reader.bytes(byteLength);
  let bit = 0;
  for (let index = 0; index < count; index += 1) {
    let value = 0;
    for (let offset = 0; offset < bits; offset += 1) {
      value |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << offset;
      bit += 1;
    }
    output[outputOffset + index] = value;
  }
};

// ---------------------------------------------------------------------------
// Canonical Huffman (MSB-first)
// ---------------------------------------------------------------------------

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private used = 0;

  public write(value: number, bits: number): void {
    for (let offset = bits - 1; offset >= 0; offset -= 1) {
      this.current = (this.current << 1) | ((value >>> offset) & 1);
      this.used += 1;
      if (this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  public finish(): Uint8Array {
    if (this.used > 0) {
      this.bytes.push(this.current << (8 - this.used));
    }
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  private readonly bytes: Uint8Array;
  private position = 0;
  private current = 0;
  private used = 0;

  public constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  public read(): number {
    if (this.used === 0) {
      if (this.position >= this.bytes.length) {
        throw new Error("Unexpected end of Huffman stream");
      }
      this.current = this.bytes[this.position++];
      this.used = 8;
    }
    this.used -= 1;
    return (this.current >>> this.used) & 1;
  }
}

interface HuffmanTable {
  readonly lengths: Uint8Array;
  readonly codes: Uint32Array;
  readonly maxBits: number;
}

const buildHuffmanTable = (frequencies: readonly number[]): HuffmanTable | null => {
  const symbolCount = frequencies.length;
  const lengths = new Uint8Array(symbolCount);

  const weight: number[] = [];
  const parent: number[] = [];
  const leafOfSymbol: number[] = new Array(symbolCount).fill(-1);
  const roots: number[] = [];
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    if (frequencies[symbol] > 0) {
      leafOfSymbol[symbol] = weight.length;
      weight.push(frequencies[symbol]);
      parent.push(-1);
      roots.push(weight.length - 1);
    }
  }

  if (roots.length === 0) {
    return null;
  }
  if (roots.length === 1) {
    lengths[leafOfSymbol.indexOf(roots[0])] = 1;
  }

  while (roots.length > 1) {
    let first = -1;
    let second = -1;
    for (const root of roots) {
      if (first < 0 || weight[root] < weight[first]) {
        second = first;
        first = root;
      } else if (second < 0 || weight[root] < weight[second]) {
        second = root;
      }
    }
    const merged = weight.length;
    weight.push(weight[first] + weight[second]);
    parent.push(-1);
    parent[first] = merged;
    parent[second] = merged;
    roots.splice(roots.indexOf(first), 1);
    roots.splice(roots.indexOf(second), 1);
    roots.push(merged);
  }

  let maxBits = 0;
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    let node = leafOfSymbol[symbol];
    if (node < 0) {
      continue;
    }
    let depth = 0;
    while (parent[node] >= 0) {
      depth += 1;
      node = parent[node];
    }
    lengths[symbol] = depth;
    if (depth > maxBits) {
      maxBits = depth;
    }
  }

  // Canonical code assignment needs to stay inside 32-bit shifts.
  if (maxBits === 0 || maxBits > 24) {
    return null;
  }

  const countByLength = new Array<number>(maxBits + 1).fill(0);
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    if (lengths[symbol] > 0) {
      countByLength[lengths[symbol]] += 1;
    }
  }
  const nextCode = new Array<number>(maxBits + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code + countByLength[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const codes = new Uint32Array(symbolCount);
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    const length = lengths[symbol];
    if (length > 0) {
      codes[symbol] = nextCode[length] >>> 0;
      nextCode[length] += 1;
    }
  }

  return { lengths, codes, maxBits };
};

const decodeHuffmanSymbol = (
  reader: BitReader,
  countByLength: readonly number[],
  firstCode: readonly number[],
  symbolsByLength: readonly number[][],
  maxBits: number,
): number => {
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code << 1) | reader.read();
    const offset = code - firstCode[bits];
    if (offset >= 0 && offset < countByLength[bits]) {
      return symbolsByLength[bits][offset];
    }
  }
  throw new Error("Invalid Huffman code");
};

// ---------------------------------------------------------------------------
// Compact small-integer sequences (heights, column ids, profiles)
// ---------------------------------------------------------------------------

const SEQUENCE_RAW = 0;
const SEQUENCE_BITPACK = 1;
const SEQUENCE_RLE = 2;

const writeCompactSequence = (writer: ByteWriter, values: readonly number[]): void => {
  const count = values.length;
  let max = 0;
  for (const value of values) {
    if (value > max) {
      max = value;
    }
  }
  const bits = Math.max(1, bitWidth(max + 1));
  if (max > 255) {
    throw new Error("Compact sequence values must fit in one byte");
  }
  writer.varint(count);
  const raw = new ByteWriter(count + 4);
  for (const value of values) {
    raw.varint(value);
  }
  const rawBytes = raw.toUint8Array();

  const packed = packBits(Uint8Array.from(values), bits);
  const bitpack = new ByteWriter(1 + packed.length);
  bitpack.u8(bits);
  bitpack.bytes(packed);
  const bitpackBytes = bitpack.toUint8Array();

  let runCount = 0;
  const rle = new ByteWriter(count + 4);
  let index = 0;
  while (index < count) {
    const value = values[index];
    let length = 1;
    while (index + length < count && values[index + length] === value) {
      length += 1;
    }
    rle.varint((length << bits) | value);
    index += length;
    runCount += 1;
  }
  const rleBody = rle.toUint8Array();
  const rleTotal = new ByteWriter(1 + rleBody.length + 2);
  rleTotal.u8(bits);
  rleTotal.varint(runCount);
  rleTotal.bytes(rleBody);
  const rleBytes = rleTotal.toUint8Array();

  if (rawBytes.length <= bitpackBytes.length && rawBytes.length <= rleBytes.length) {
    writer.u8(SEQUENCE_RAW);
    writer.bytes(rawBytes);
  } else if (bitpackBytes.length <= rleBytes.length) {
    writer.u8(SEQUENCE_BITPACK);
    writer.bytes(bitpackBytes);
  } else {
    writer.u8(SEQUENCE_RLE);
    writer.bytes(rleBytes);
  }
};

const readCompactSequence = (reader: ByteReader, expectedCount?: number): Uint8Array => {
  const count = reader.varint();
  if (expectedCount !== undefined && count !== expectedCount) {
    throw new Error("Compact sequence length mismatch");
  }
  const output = new Uint8Array(count);
  const mode = reader.u8();
  if (mode === SEQUENCE_RAW) {
    for (let index = 0; index < count; index += 1) {
      output[index] = reader.varint();
    }
    return output;
  }
  if (mode === SEQUENCE_BITPACK) {
    const bits = reader.u8();
    unpackBits(reader, bits, count, output);
    return output;
  }
  if (mode === SEQUENCE_RLE) {
    const bits = reader.u8();
    const runCount = reader.varint();
    const mask = (1 << bits) - 1;
    let index = 0;
    for (let run = 0; run < runCount; run += 1) {
      const code = reader.varint();
      const length = code >>> bits;
      const value = code & mask;
      output.fill(value, index, index + length);
      index += length;
    }
    if (index !== count) {
      throw new Error("Malformed compact sequence");
    }
    return output;
  }
  throw new Error(`Unknown sequence mode: ${mode}`);
};

// ---------------------------------------------------------------------------
// Codec: Constant
// ---------------------------------------------------------------------------

const encodeConstant = (blocks: Uint8Array): Uint8Array | null => {
  const value = blocks[0];
  for (let index = 1; index < blocks.length; index += 1) {
    if (blocks[index] !== value) {
      return null;
    }
  }
  const writer = new ByteWriter(2);
  writer.u8(CHUNK_CODEC.CONSTANT);
  writer.u8(value);
  return writer.toUint8Array();
};

// ---------------------------------------------------------------------------
// Codec: Bitpack
// ---------------------------------------------------------------------------

const encodeBitpack = (palette: Palette): Uint8Array => {
  const bits = Math.max(1, bitWidth(palette.values.length));
  const packed = packBits(palette.indices, bits);
  const writer = new ByteWriter(8 + palette.values.length + packed.length);
  writer.u8(CHUNK_CODEC.BITPACK);
  writePalette(writer, palette.values);
  writer.u8(bits);
  writer.bytes(packed);
  return writer.toUint8Array();
};

const decodeBitpack = (reader: ByteReader, volume: number): Uint8Array => {
  const palette = readPalette(reader);
  const bits = reader.u8();
  const output = new Uint8Array(volume);
  unpackBits(reader, bits, volume, output);
  for (let index = 0; index < volume; index += 1) {
    output[index] = palette[output[index]];
  }
  return output;
};

// ---------------------------------------------------------------------------
// Codec: RLE (plane-major linear runs)
// ---------------------------------------------------------------------------

const encodeRle = (palette: Palette): Uint8Array => {
  const bits = Math.max(1, bitWidth(palette.values.length));
  const writer = new ByteWriter(8 + palette.values.length + 32);
  writer.u8(CHUNK_CODEC.RLE);
  writePalette(writer, palette.values);

  const runs: number[] = [];
  const indices = palette.indices;
  let runIndex = 0;
  while (runIndex < indices.length) {
    const value = indices[runIndex];
    let length = 1;
    while (runIndex + length < indices.length && indices[runIndex + length] === value) {
      length += 1;
    }
    runs.push((length << bits) | value);
    runIndex += length;
  }
  writer.varint(runs.length);
  for (const code of runs) {
    writer.varint(code);
  }
  return writer.toUint8Array();
};

const decodeRle = (reader: ByteReader, volume: number): Uint8Array => {
  const palette = readPalette(reader);
  const bits = Math.max(1, bitWidth(palette.length));
  const mask = (1 << bits) - 1;
  const runCount = reader.varint();
  const output = new Uint8Array(volume);
  let index = 0;
  for (let run = 0; run < runCount; run += 1) {
    const code = reader.varint();
    const length = code >>> bits;
    const value = palette[code & mask];
    output.fill(value, index, index + length);
    index += length;
  }
  if (index !== volume) {
    throw new Error("Malformed RLE chunk");
  }
  return output;
};

// ---------------------------------------------------------------------------
// Codec: Huffman
// ---------------------------------------------------------------------------

const encodeHuffman = (palette: Palette): Uint8Array | null => {
  const frequencies = new Array<number>(palette.values.length).fill(0);
  for (let index = 0; index < palette.indices.length; index += 1) {
    frequencies[palette.indices[index]] += 1;
  }
  const table = buildHuffmanTable(frequencies);
  if (!table) {
    return null;
  }

  const bits = new BitWriter();
  for (let index = 0; index < palette.indices.length; index += 1) {
    const symbol = palette.indices[index];
    bits.write(table.codes[symbol], table.lengths[symbol]);
  }
  const stream = bits.finish();

  const writer = new ByteWriter(16 + palette.values.length * 2 + stream.length);
  writer.u8(CHUNK_CODEC.HUFFMAN);
  writePalette(writer, palette.values);
  for (const length of table.lengths) {
    writer.u8(length);
  }
  writer.varint(stream.length);
  writer.bytes(stream);
  return writer.toUint8Array();
};

const decodeHuffman = (reader: ByteReader, volume: number): Uint8Array => {
  const palette = readPalette(reader);
  const symbolCount = palette.length;
  const lengths = new Uint8Array(symbolCount);
  let maxBits = 0;
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    const length = reader.u8();
    lengths[symbol] = length;
    if (length > maxBits) {
      maxBits = length;
    }
  }
  if (maxBits === 0) {
    throw new Error("Malformed Huffman table");
  }

  const countByLength = new Array<number>(maxBits + 1).fill(0);
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    countByLength[lengths[symbol]] += 1;
  }
  const firstCode = new Array<number>(maxBits + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code + countByLength[bits - 1]) << 1;
    firstCode[bits] = code;
  }
  const symbolsByLength: number[][] = Array.from({ length: maxBits + 1 }, () => []);
  for (let symbol = 0; symbol < symbolCount; symbol += 1) {
    symbolsByLength[lengths[symbol]].push(symbol);
  }

  const streamLength = reader.varint();
  const bitReader = new BitReader(reader.bytes(streamLength));
  const output = new Uint8Array(volume);
  for (let index = 0; index < volume; index += 1) {
    output[index] =
      palette[decodeHuffmanSymbol(bitReader, countByLength, firstCode, symbolsByLength, maxBits)];
  }
  return output;
};

// ---------------------------------------------------------------------------
// Codec: Column dictionary
// ---------------------------------------------------------------------------

const encodeColumnDict = (palette: Palette, dimensions: VoxelFormatDimensions): Uint8Array => {
  const { sizeX, sizeY, sizeZ } = dimensions;
  const columnCount = sizeX * sizeZ;
  const columnData = new Uint8Array(columnCount * sizeY);
  for (let z = 0; z < sizeZ; z += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const column = x + z * sizeX;
      const base = column * sizeY;
      for (let y = 0; y < sizeY; y += 1) {
        columnData[base + y] = palette.indices[indexOf(dimensions, x, y, z)];
      }
    }
  }

  const unique = new Map<string, number>();
  const grid = new Uint8Array(columnCount);
  const columns: number[] = [];
  const runsPerColumn: number[][] = [];

  for (let column = 0; column < columnCount; column += 1) {
    const base = column * sizeY;
    let key = "";
    for (let y = 0; y < sizeY; y += 1) {
      key += String.fromCharCode(columnData[base + y]);
    }
    let id = unique.get(key);
    if (id === undefined) {
      id = columns.length;
      unique.set(key, id);
      columns.push(base);
      const runs: number[] = [];
      let y = 0;
      while (y < sizeY) {
        const value = columnData[base + y];
        let length = 1;
        while (y + length < sizeY && columnData[base + y + length] === value) {
          length += 1;
        }
        runs.push((length << 8) | value);
        y += length;
      }
      runsPerColumn.push(runs);
    }
    grid[column] = id;
  }

  const writer = new ByteWriter(16 + palette.values.length + columns.length * 8 + grid.length);
  writer.u8(CHUNK_CODEC.COLUMN_DICT);
  writePalette(writer, palette.values);
  writer.varint(columns.length);
  for (const runs of runsPerColumn) {
    writer.varint(runs.length);
    for (const code of runs) {
      writer.varint(code);
    }
  }
  writeCompactSequence(writer, Array.from(grid));
  return writer.toUint8Array();
};

const decodeColumnDict = (
  reader: ByteReader,
  volume: number,
  dimensions: VoxelFormatDimensions,
): Uint8Array => {
  const { sizeX, sizeY, sizeZ } = dimensions;
  const columnCount = sizeX * sizeZ;
  const palette = readPalette(reader);
  const uniqueCount = reader.varint();
  const columnData = new Uint8Array(uniqueCount * sizeY);
  for (let id = 0; id < uniqueCount; id += 1) {
    const runCount = reader.varint();
    const base = id * sizeY;
    let y = 0;
    for (let run = 0; run < runCount; run += 1) {
      const code = reader.varint();
      const length = code >>> 8;
      const value = palette[code & 0xff];
      columnData.fill(value, base + y, base + y + length);
      y += length;
    }
  }
  const grid = readCompactSequence(reader, columnCount);
  const output = new Uint8Array(volume);
  for (let column = 0; column < columnCount; column += 1) {
    const base = grid[column] * sizeY;
    const x = column % sizeX;
    const z = Math.floor(column / sizeX);
    for (let y = 0; y < sizeY; y += 1) {
      output[indexOf(dimensions, x, y, z)] = columnData[base + y];
    }
  }
  return output;
};

// ---------------------------------------------------------------------------
// Codec: Surface profile
// ---------------------------------------------------------------------------

interface SurfaceProfile {
  /** Palette indices by depth below the surface, with a repeating tail. */
  readonly profile: number[];
  /** Ground height (inclusive) per column, -1 when empty. */
  readonly heights: number[];
  /** Deviation cells pre-packed as `(indexDelta << paletteBits) | paletteIndex`. */
  readonly exceptions: number[];
}

const detectSurfaceProfile = (
  blocks: Uint8Array,
  palette: Palette,
  dimensions: VoxelFormatDimensions,
): SurfaceProfile | null => {
  const { sizeX, sizeY, sizeZ } = dimensions;
  const columnCount = sizeX * sizeZ;
  const volume = sizeX * sizeY * sizeZ;
  const ground = new Int16Array(columnCount);
  let maxHeight = -1;

  for (let z = 0; z < sizeZ; z += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const column = x + z * sizeX;
      let top = -1;
      for (let y = sizeY - 1; y >= 0; y -= 1) {
        if (blocks[indexOf(dimensions, x, y, z)] !== 0) {
          top = y;
          break;
        }
      }
      ground[column] = top;
      if (top > maxHeight) {
        maxHeight = top;
      }
    }
  }

  if (maxHeight < 0) {
    return null;
  }

  // Majority vote per depth: robust to scattered edits and floating outliers.
  const counts = new Int32Array(256);
  const profileValue: number[] = new Array(maxHeight + 1);
  for (let depth = 0; depth <= maxHeight; depth += 1) {
    counts.fill(0);
    for (let z = 0; z < sizeZ; z += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        const top = ground[x + z * sizeX];
        if (top < depth) {
          continue;
        }
        counts[blocks[indexOf(dimensions, x, top - depth, z)]] += 1;
      }
    }
    let bestValue = 0;
    let bestCount = -1;
    for (let value = 0; value < 256; value += 1) {
      if (counts[value] > bestCount) {
        bestCount = counts[value];
        bestValue = value;
      }
    }
    profileValue[depth] = bestValue;
  }

  // Collapse the repeating tail so only the distinct layers are stored.
  const tail = profileValue[maxHeight];
  let profileLength = maxHeight + 1;
  while (profileLength > 1 && profileValue[profileLength - 2] === tail) {
    profileLength -= 1;
  }
  const profile = profileValue.slice(0, profileLength);

  const paletteIndex = new Int16Array(256).fill(-1);
  for (let index = 0; index < palette.values.length; index += 1) {
    paletteIndex[palette.values[index]] = index;
  }

  const exceptionBudget = Math.max(32, volume >> 4);
  const exceptionPositions: number[] = [];
  const exceptionValues: number[] = [];

  for (let z = 0; z < sizeZ; z += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const top = ground[x + z * sizeX];
      for (let y = 0; y < sizeY; y += 1) {
        const expected = y <= top ? profile[Math.min(top - y, profile.length - 1)] : 0;
        const index = indexOf(dimensions, x, y, z);
        const actual = blocks[index];
        if (actual !== expected) {
          if (exceptionPositions.length >= exceptionBudget) {
            return null;
          }
          exceptionPositions.push(index);
          exceptionValues.push(actual);
        }
      }
    }
  }

  const bits = Math.max(1, bitWidth(palette.values.length));
  const mask = (1 << bits) - 1;
  const order = exceptionPositions
    .map((_, index) => index)
    .sort((a, b) => exceptionPositions[a] - exceptionPositions[b]);
  const exceptions: number[] = [];
  let previous = -1;
  for (const index of order) {
    const position = exceptionPositions[index];
    const delta = position - previous;
    previous = position;
    exceptions.push((delta << bits) | (paletteIndex[exceptionValues[index]] & mask));
  }

  return {
    profile: profile.map((value) => paletteIndex[value]),
    heights: Array.from(ground, (height) => height + 1),
    exceptions,
  };
};

const encodeSurfaceProfile = (
  blocks: Uint8Array,
  palette: Palette,
  dimensions: VoxelFormatDimensions,
): Uint8Array | null => {
  const detected = detectSurfaceProfile(blocks, palette, dimensions);
  if (!detected) {
    return null;
  }
  const writer = new ByteWriter(48 + detected.heights.length + detected.exceptions.length * 2);
  writer.u8(CHUNK_CODEC.SURFACE_PROFILE);
  writePalette(writer, palette.values);
  writeCompactSequence(writer, detected.profile);
  writeCompactSequence(writer, detected.heights);
  writer.varint(detected.exceptions.length);
  for (const code of detected.exceptions) {
    writer.varint(code);
  }
  return writer.toUint8Array();
};

const decodeSurfaceProfile = (
  reader: ByteReader,
  volume: number,
  dimensions: VoxelFormatDimensions,
): Uint8Array => {
  const { sizeX, sizeZ } = dimensions;
  const columnCount = sizeX * sizeZ;
  const palette = readPalette(reader);
  const profile = readCompactSequence(reader);
  const heights = readCompactSequence(reader, columnCount);
  const output = new Uint8Array(volume);
  for (let z = 0; z < sizeZ; z += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const column = x + z * sizeX;
      const ground = heights[column] - 1;
      for (let y = 0; y <= ground; y += 1) {
        const depth = Math.min(ground - y, profile.length - 1);
        output[indexOf(dimensions, x, y, z)] = palette[profile[depth]];
      }
    }
  }

  const exceptionCount = reader.varint();
  const bits = Math.max(1, bitWidth(palette.length));
  const mask = (1 << bits) - 1;
  let previous = -1;
  for (let index = 0; index < exceptionCount; index += 1) {
    const code = reader.varint();
    const position = previous + (code >>> bits);
    if (position < 0 || position >= volume) {
      throw new Error("Surface exception is out of range");
    }
    previous = position;
    output[position] = palette[code & mask];
  }
  return output;
};

// ---------------------------------------------------------------------------
// Codec: Sparse (baseline delta)
// ---------------------------------------------------------------------------

const encodeSparse = (blocks: Uint8Array, base: Uint8Array | null): Uint8Array => {
  const baselineKind = base ? 1 : 0;
  const values: number[] = [];
  const valueIndex = new Int16Array(256).fill(-1);
  const positions: number[] = [];
  const codes: number[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const expected = base ? base[index] : 0;
    const value = blocks[index];
    if (value === expected) {
      continue;
    }
    let paletteIndex = valueIndex[value];
    if (paletteIndex < 0) {
      paletteIndex = values.length;
      values.push(value);
      valueIndex[value] = paletteIndex;
    }
    positions.push(index);
    codes.push(paletteIndex);
  }

  const bits = bitWidth(values.length);
  const mask = (1 << bits) - 1;
  const writer = new ByteWriter(16 + values.length + positions.length * 2);
  writer.u8(CHUNK_CODEC.SPARSE);
  writer.u8(baselineKind);
  writePalette(writer, values);
  writer.varint(positions.length);

  let previous = -1;
  for (let diff = 0; diff < positions.length; diff += 1) {
    const delta = positions[diff] - previous;
    previous = positions[diff];
    writer.varint((delta << bits) | (codes[diff] & mask));
  }
  return writer.toUint8Array();
};

const decodeSparse = (
  reader: ByteReader,
  volume: number,
  coordinate: ChunkCoordinate,
  baseProvider?: ChunkBaseProvider,
): Uint8Array => {
  const baselineKind = reader.u8();
  const palette = readPalette(reader);
  const count = reader.varint();
  const bits = bitWidth(palette.length);
  const mask = (1 << bits) - 1;

  let output: Uint8Array;
  if (baselineKind === 1) {
    const base = baseProvider?.(coordinate);
    if (!base || base.length !== volume) {
      throw new Error("A sparse chunk needs its baseline to decode");
    }
    output = base.slice();
  } else if (baselineKind === 0) {
    output = new Uint8Array(volume);
  } else {
    throw new Error(`Unknown sparse baseline: ${baselineKind}`);
  }

  let previous = -1;
  for (let diff = 0; diff < count; diff += 1) {
    const code = reader.varint();
    const position = previous + (code >>> bits);
    if (position < 0 || position >= volume) {
      throw new Error("Sparse chunk position is out of range");
    }
    previous = position;
    output[position] = palette[code & mask];
  }
  return output;
};

// ---------------------------------------------------------------------------
// Chunk codec dispatch
// ---------------------------------------------------------------------------

export interface ChunkEncodeOptions {
  /** Baseline for the `Sparse` codec; omit for an absolute encoding. */
  readonly base?: Uint8Array | null;
}

export interface ChunkCodecMeasurement {
  readonly codec: ChunkCodec;
  readonly bytes: number;
}

const encodeCandidates = (
  blocks: Uint8Array,
  dimensions: VoxelFormatDimensions,
  options: ChunkEncodeOptions,
): Uint8Array[] => {
  const candidates: Uint8Array[] = [];
  const constant = encodeConstant(blocks);
  if (constant) {
    candidates.push(constant);
    return candidates;
  }

  const palette = buildPalette(blocks);
  candidates.push(encodeBitpack(palette));
  candidates.push(encodeRle(palette));
  const huffman = encodeHuffman(palette);
  if (huffman) {
    candidates.push(huffman);
  }
  candidates.push(encodeColumnDict(palette, dimensions));
  const surface = encodeSurfaceProfile(blocks, palette, dimensions);
  if (surface) {
    candidates.push(surface);
  }
  const base = options.base ?? null;
  if (base && base.length !== blocks.length) {
    throw new Error("Sparse baseline must match the chunk volume");
  }
  candidates.push(encodeSparse(blocks, base));
  return candidates;
};

/** Encodes one chunk, choosing the smallest codec. Includes the one-byte tag. */
export const encodeChunk = (
  blocks: Uint8Array,
  dimensions: VoxelFormatDimensions,
  options: ChunkEncodeOptions = {},
): Uint8Array => {
  assertVolume(blocks, dimensions);
  const candidates = encodeCandidates(blocks, dimensions, options);
  let best = candidates[0];
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index].length < best.length) {
      best = candidates[index];
    }
  }
  return best;
};

/** Reports the size each codec would produce; used by the benchmark. */
export const measureChunkCodecs = (
  blocks: Uint8Array,
  dimensions: VoxelFormatDimensions,
  options: ChunkEncodeOptions = {},
): ChunkCodecMeasurement[] => {
  assertVolume(blocks, dimensions);
  return encodeCandidates(blocks, dimensions, options)
    .map((candidate) => ({ codec: candidate[0] as ChunkCodec, bytes: candidate.length }))
    .sort((a, b) => a.bytes - b.bytes);
};

export const decodeChunk = (
  payload: Uint8Array,
  dimensions: VoxelFormatDimensions,
  coordinate: ChunkCoordinate,
  baseProvider?: ChunkBaseProvider,
): Uint8Array => {
  const volume = voxelVolume(dimensions);
  const reader = new ByteReader(payload);
  const codec = reader.u8() as ChunkCodec;
  switch (codec) {
    case CHUNK_CODEC.CONSTANT: {
      const output = new Uint8Array(volume);
      output.fill(reader.u8());
      return output;
    }
    case CHUNK_CODEC.BITPACK:
      return decodeBitpack(reader, volume);
    case CHUNK_CODEC.RLE:
      return decodeRle(reader, volume);
    case CHUNK_CODEC.COLUMN_DICT:
      return decodeColumnDict(reader, volume, dimensions);
    case CHUNK_CODEC.SURFACE_PROFILE:
      return decodeSurfaceProfile(reader, volume, dimensions);
    case CHUNK_CODEC.SPARSE:
      return decodeSparse(reader, volume, coordinate, baseProvider);
    case CHUNK_CODEC.HUFFMAN:
      return decodeHuffman(reader, volume);
    default:
      throw new Error(`Unknown chunk codec: ${codec}`);
  }
};

// ---------------------------------------------------------------------------
// Region container
// ---------------------------------------------------------------------------

export interface VoxelFingerprints {
  readonly blockFingerprint: number;
  readonly generatorFingerprint: number;
}

export interface VoxelRegionHeader extends VoxelFingerprints {
  readonly version: number;
  readonly dimensions: VoxelFormatDimensions;
  readonly regionX: number;
  readonly regionZ: number;
  readonly chunkCount: number;
}

export interface VoxelRegionEncodeOptions extends VoxelFingerprints {
  readonly dimensions: VoxelFormatDimensions;
  readonly regionX: number;
  readonly regionZ: number;
  readonly baseProvider?: ChunkBaseProvider;
}

export const chunkRegionCoordinate = (coordinate: number): number =>
  Math.floor(coordinate / VOXEL_REGION_SIZE);

const localChunkIndex = (x: number, z: number): number => {
  const localX = ((x % VOXEL_REGION_SIZE) + VOXEL_REGION_SIZE) % VOXEL_REGION_SIZE;
  const localZ = ((z % VOXEL_REGION_SIZE) + VOXEL_REGION_SIZE) % VOXEL_REGION_SIZE;
  return localX | (localZ << 5);
};

const headerBytes = (): number => 4 + 2 + 2 + 2 + 2 + 2 + 2 + 4 + 4 + 4 + 4 + 4;

const writeHeader = (
  writer: ByteWriter,
  dimensions: VoxelFormatDimensions,
  fingerprints: VoxelFingerprints,
  regionX: number,
  regionZ: number,
  chunkCount: number,
): void => {
  writer.u32(REGION_MAGIC);
  writer.u16(FORMAT_VERSION);
  writer.u16(0);
  writer.u16(dimensions.sizeX);
  writer.u16(dimensions.sizeY);
  writer.u16(dimensions.sizeZ);
  writer.i16(dimensions.minY);
  writer.u32(fingerprints.blockFingerprint);
  writer.u32(fingerprints.generatorFingerprint);
  writer.i32(regionX);
  writer.i32(regionZ);
  writer.u32(chunkCount);
};

export const readVoxelRegionHeader = (bytes: Uint8Array): VoxelRegionHeader => {
  const reader = new ByteReader(bytes);
  if (reader.u32() !== REGION_MAGIC) {
    throw new Error("Not a Nomio voxel region");
  }
  const version = reader.u16();
  reader.u16();
  const dimensions: VoxelFormatDimensions = {
    sizeX: reader.u16(),
    sizeY: reader.u16(),
    sizeZ: reader.u16(),
    minY: reader.i16(),
  };
  return {
    version,
    dimensions,
    blockFingerprint: reader.u32(),
    generatorFingerprint: reader.u32(),
    regionX: reader.i32(),
    regionZ: reader.i32(),
    chunkCount: reader.u32(),
  };
};

export const encodeVoxelRegion = (
  chunks: readonly VoxelChunk[],
  options: VoxelRegionEncodeOptions,
): Uint8Array => {
  for (const chunk of chunks) {
    if (
      chunkRegionCoordinate(chunk.x) !== options.regionX ||
      chunkRegionCoordinate(chunk.z) !== options.regionZ
    ) {
      throw new Error(`Chunk ${chunk.x},${chunk.z} is outside the region being encoded`);
    }
  }
  const sorted = [...chunks].sort((a, b) => localChunkIndex(a.x, a.z) - localChunkIndex(b.x, b.z));
  const payloads: Uint8Array[] = [];
  for (const chunk of sorted) {
    const base = options.baseProvider?.(chunk) ?? null;
    payloads.push(encodeChunk(chunk.blocks, options.dimensions, { base }));
  }

  const writer = new ByteWriter(headerBytes() + sorted.length * 10 + 64);
  writeHeader(writer, options.dimensions, options, options.regionX, options.regionZ, sorted.length);
  for (let index = 0; index < sorted.length; index += 1) {
    const chunk = sorted[index];
    const payload = payloads[index];
    writer.u16(localChunkIndex(chunk.x, chunk.z));
    writer.u32(payload.length);
    writer.u32(crc32(payload));
  }
  for (const payload of payloads) {
    writer.bytes(payload);
  }
  return writer.toUint8Array();
};

export const decodeVoxelRegion = (
  bytes: Uint8Array,
  baseProvider?: ChunkBaseProvider,
): VoxelChunk[] => {
  const reader = new ByteReader(bytes);
  if (reader.u32() !== REGION_MAGIC) {
    throw new Error("Not a Nomio voxel region");
  }
  reader.u16();
  reader.u16();
  const dimensions: VoxelFormatDimensions = {
    sizeX: reader.u16(),
    sizeY: reader.u16(),
    sizeZ: reader.u16(),
    minY: reader.i16(),
  };
  reader.u32();
  reader.u32();
  const regionX = reader.i32();
  const regionZ = reader.i32();
  const chunkCount = reader.u32();

  const directory: { localIndex: number; length: number; crc: number }[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    directory.push({ localIndex: reader.u16(), length: reader.u32(), crc: reader.u32() });
  }

  const chunks: VoxelChunk[] = [];
  for (const entry of directory) {
    const payload = reader.bytes(entry.length);
    if (crc32(payload) !== entry.crc) {
      throw new Error("Voxel chunk failed its integrity check");
    }
    const x = regionX * VOXEL_REGION_SIZE + (entry.localIndex & 31);
    const z = regionZ * VOXEL_REGION_SIZE + (entry.localIndex >> 5);
    chunks.push({ x, z, blocks: decodeChunk(payload, dimensions, { x, z }, baseProvider) });
  }
  return chunks;
};

// ---------------------------------------------------------------------------
// Archive container
// ---------------------------------------------------------------------------

export interface VoxelArchiveRegionRef {
  readonly regionX: number;
  readonly regionZ: number;
  readonly offset: number;
  readonly length: number;
  readonly chunkCount: number;
}

export interface VoxelArchiveHeader extends VoxelFingerprints {
  readonly version: number;
  readonly dimensions: VoxelFormatDimensions;
  readonly regionCount: number;
  readonly regions: VoxelArchiveRegionRef[];
}

export interface VoxelArchiveEncodeOptions extends VoxelFingerprints {
  readonly dimensions: VoxelFormatDimensions;
  readonly baseProvider?: ChunkBaseProvider;
}

const archiveHeaderBytes = (regionCount: number): number =>
  4 + 2 + 2 + 2 + 2 + 2 + 2 + 4 + 4 + 4 + regionCount * 20;

const writeArchiveHeader = (
  writer: ByteWriter,
  dimensions: VoxelFormatDimensions,
  fingerprints: VoxelFingerprints,
  regionCount: number,
): void => {
  writer.u32(ARCHIVE_MAGIC);
  writer.u16(FORMAT_VERSION);
  writer.u16(0);
  writer.u16(dimensions.sizeX);
  writer.u16(dimensions.sizeY);
  writer.u16(dimensions.sizeZ);
  writer.i16(dimensions.minY);
  writer.u32(fingerprints.blockFingerprint);
  writer.u32(fingerprints.generatorFingerprint);
  writer.u32(regionCount);
};

export const encodeVoxelArchive = (
  chunks: readonly VoxelChunk[],
  options: VoxelArchiveEncodeOptions,
): Uint8Array => {
  const groups = new Map<string, VoxelChunk[]>();
  for (const chunk of chunks) {
    const regionX = chunkRegionCoordinate(chunk.x);
    const regionZ = chunkRegionCoordinate(chunk.z);
    const key = `${regionX},${regionZ}`;
    const group = groups.get(key);
    if (group) {
      group.push(chunk);
    } else {
      groups.set(key, [chunk]);
    }
  }

  const ordered = [...groups.entries()]
    .map(([key, group]) => {
      const [regionX, regionZ] = key.split(",").map(Number);
      return { regionX, regionZ, group };
    })
    .sort((a, b) => a.regionZ - b.regionZ || a.regionX - b.regionX);

  const regionBlobs = ordered.map(({ regionX, regionZ, group }) =>
    encodeVoxelRegion(group, {
      ...options,
      regionX,
      regionZ,
    }),
  );

  const writer = new ByteWriter(archiveHeaderBytes(ordered.length) + 64);
  writeArchiveHeader(writer, options.dimensions, options, ordered.length);

  let offset = archiveHeaderBytes(ordered.length);
  for (let index = 0; index < ordered.length; index += 1) {
    const blob = regionBlobs[index];
    writer.i32(ordered[index].regionX);
    writer.i32(ordered[index].regionZ);
    writer.u32(offset);
    writer.u32(blob.length);
    writer.u32(ordered[index].group.length);
    offset += blob.length;
  }
  for (const blob of regionBlobs) {
    writer.bytes(blob);
  }
  writer.u32(crc32(writer.toUint8Array()));
  return writer.toUint8Array();
};

export const readVoxelArchiveHeader = (bytes: Uint8Array): VoxelArchiveHeader => {
  const reader = new ByteReader(bytes);
  if (reader.u32() !== ARCHIVE_MAGIC) {
    throw new Error("Not a Nomio voxel archive");
  }
  const version = reader.u16();
  reader.u16();
  const dimensions: VoxelFormatDimensions = {
    sizeX: reader.u16(),
    sizeY: reader.u16(),
    sizeZ: reader.u16(),
    minY: reader.i16(),
  };
  const blockFingerprint = reader.u32();
  const generatorFingerprint = reader.u32();
  const regionCount = reader.u32();
  const regions: VoxelArchiveRegionRef[] = [];
  for (let index = 0; index < regionCount; index += 1) {
    regions.push({
      regionX: reader.i32(),
      regionZ: reader.i32(),
      offset: reader.u32(),
      length: reader.u32(),
      chunkCount: reader.u32(),
    });
  }
  return {
    version,
    dimensions,
    blockFingerprint,
    generatorFingerprint,
    regionCount,
    regions,
  };
};

export const decodeVoxelArchiveRegion = (
  bytes: Uint8Array,
  region: VoxelArchiveRegionRef,
  baseProvider?: ChunkBaseProvider,
): VoxelChunk[] =>
  decodeVoxelRegion(bytes.subarray(region.offset, region.offset + region.length), baseProvider);

export const decodeVoxelArchive = (
  bytes: Uint8Array,
  baseProvider?: ChunkBaseProvider,
): VoxelChunk[] => {
  const header = readVoxelArchiveHeader(bytes);
  const chunks: VoxelChunk[] = [];
  for (const region of header.regions) {
    chunks.push(...decodeVoxelArchiveRegion(bytes, region, baseProvider));
  }
  return chunks;
};

/** Finds the region containing a chunk coordinate, if the archive stores it. */
export const findArchiveRegion = (
  header: VoxelArchiveHeader,
  coordinate: ChunkCoordinate,
): VoxelArchiveRegionRef | null => {
  const regionX = chunkRegionCoordinate(coordinate.x);
  const regionZ = chunkRegionCoordinate(coordinate.z);
  return (
    header.regions.find((region) => region.regionX === regionX && region.regionZ === regionZ) ??
    null
  );
};
