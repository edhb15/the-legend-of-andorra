/** Seeded 2D/3D gradient noise + fBm helpers (CPU side). */
export class Noise {
  private perm = new Uint8Array(512);
  constructor(seed = 1337) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private grad2(h: number, x: number, y: number): number {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  /** Perlin noise in [-1,1] (approximately). */
  noise2(x: number, y: number): number {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const p = this.perm;
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    const x1 = this.grad2(aa, xf, yf) + u * (this.grad2(ba, xf - 1, yf) - this.grad2(aa, xf, yf));
    const x2 = this.grad2(ab, xf, yf - 1) + u * (this.grad2(bb, xf - 1, yf - 1) - this.grad2(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.7071;
  }

  fbm2(x: number, y: number, octaves = 4, lac = 2, gain = 0.5): number {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.noise2(x * f, y * f);
      n += a;
      a *= gain;
      f *= lac;
    }
    return s / n;
  }

  ridge2(x: number, y: number, octaves = 4): number {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * (1 - Math.abs(this.noise2(x * f, y * f)));
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }
}

export const NOISE = new Noise(4242);
