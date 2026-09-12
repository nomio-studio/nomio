const PRIME_X = 0x5205402b9270c86fn;
const PRIME_Y = 0x598cd327003817b5n;
const HASH_MULTIPLIER = 0x53a3f72deec546f5n;
const SKEW_2D = 0.366025403784439;
const UNSKEW_2D = -0.21132486540518713;
const NORMALIZER_2D = 0.05481866495625118;
const RSQUARED_2D = 2 / 3;

const GRADIENTS_2D = [
  0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509, 0.923879532511287,
  -0.38268343236509, 0.38268343236509, -0.923879532511287, -0.38268343236509, -0.923879532511287,
  -0.923879532511287, -0.38268343236509, -0.923879532511287, 0.38268343236509, -0.38268343236509,
  0.923879532511287, 0.130526192220052, 0.99144486137381, 0.608761429008721, 0.793353340291235,
  0.793353340291235, 0.608761429008721, 0.99144486137381, 0.130526192220051, 0.99144486137381,
  -0.130526192220051, 0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235,
  0.130526192220052, -0.99144486137381, -0.130526192220052, -0.99144486137381, -0.608761429008721,
  -0.793353340291235, -0.793353340291235, -0.608761429008721, -0.99144486137381, -0.130526192220052,
  -0.99144486137381, 0.130526192220051, -0.793353340291235, 0.608761429008721, -0.608761429008721,
  0.793353340291235, -0.130526192220052, 0.99144486137381,
] as const;

const toInt64 = (value: bigint): bigint => BigInt.asIntN(64, value);

const falloff = (value: number): number => {
  const squared = value * value;
  return squared * squared;
};

/** OpenSimplex2S 2D, adapted from the CC0 KdotJPG reference implementation. */
export class OpenSimplex2 {
  private readonly seed: bigint;

  public constructor(seed: number) {
    this.seed = BigInt(Math.trunc(seed));
  }

  public noise2(x: number, y: number): number {
    const skew = SKEW_2D * (x + y);
    return this.noise2Unskewed(x + skew, y + skew);
  }

  private noise2Unskewed(xs: number, ys: number): number {
    const xsb = Math.floor(xs);
    const ysb = Math.floor(ys);
    const xi = xs - xsb;
    const yi = ys - ysb;
    const t = (xi + yi) * UNSKEW_2D;
    const dx0 = xi + t;
    const dy0 = yi + t;

    let value = falloff(RSQUARED_2D - dx0 * dx0 - dy0 * dy0) * this.gradient(xsb, ysb, dx0, dy0);

    const offset = 1 + 2 * UNSKEW_2D;
    const a1 =
      2 * offset * (1 / UNSKEW_2D + 2) * t +
      (-2 * offset * offset + RSQUARED_2D - dx0 * dx0 - dy0 * dy0);
    const dx1 = dx0 - offset;
    const dy1 = dy0 - offset;
    value += falloff(a1) * this.gradient(xsb + 1, ysb + 1, dx1, dy1);

    const xmyi = xi - yi;
    if (t < UNSKEW_2D) {
      if (xi + xmyi > 1) {
        value += this.contribution(
          xsb + 2,
          ysb + 1,
          dx0 - (3 * UNSKEW_2D + 2),
          dy0 - (3 * UNSKEW_2D + 1),
        );
      } else {
        value += this.contribution(xsb, ysb + 1, dx0 - UNSKEW_2D, dy0 - (UNSKEW_2D + 1));
      }

      if (yi - xmyi > 1) {
        value += this.contribution(
          xsb + 1,
          ysb + 2,
          dx0 - (3 * UNSKEW_2D + 1),
          dy0 - (3 * UNSKEW_2D + 2),
        );
      } else {
        value += this.contribution(xsb + 1, ysb, dx0 - (UNSKEW_2D + 1), dy0 - UNSKEW_2D);
      }
    } else {
      if (xi + xmyi < 0) {
        value += this.contribution(xsb - 1, ysb, dx0 + (1 + UNSKEW_2D), dy0 + UNSKEW_2D);
      } else {
        value += this.contribution(xsb + 1, ysb, dx0 - (UNSKEW_2D + 1), dy0 - UNSKEW_2D);
      }

      if (yi < xmyi) {
        value += this.contribution(xsb, ysb - 1, dx0 + UNSKEW_2D, dy0 + (UNSKEW_2D + 1));
      } else {
        value += this.contribution(xsb, ysb + 1, dx0 - UNSKEW_2D, dy0 - (UNSKEW_2D + 1));
      }
    }

    return value;
  }

  private contribution(xsb: number, ysb: number, dx: number, dy: number): number {
    const a = RSQUARED_2D - dx * dx - dy * dy;
    return a > 0 ? falloff(a) * this.gradient(xsb, ysb, dx, dy) : 0;
  }

  private gradient(xsb: number, ysb: number, dx: number, dy: number): number {
    let hash = toInt64(this.seed ^ toInt64(BigInt(xsb) * PRIME_X) ^ toInt64(BigInt(ysb) * PRIME_Y));
    hash = toInt64(hash * HASH_MULTIPLIER);
    hash = toInt64(hash ^ (hash >> 58n));
    const gradientIndex = Number(hash & 30n);
    return (
      (GRADIENTS_2D[gradientIndex] * dx + GRADIENTS_2D[gradientIndex + 1] * dy) / NORMALIZER_2D
    );
  }
}
