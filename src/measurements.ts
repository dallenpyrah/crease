import type { Bounds } from './domain';

export interface Distance {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly value: number;
}

export const distancesBetween = (a: Bounds, b: Bounds): ReadonlyArray<Distance> => {
  const distances: Array<Distance> = [];
  const left = a.x <= b.x ? a : b;
  const right = left === a ? b : a;
  const top = a.y <= b.y ? a : b;
  const bottom = top === a ? b : a;
  const horizontal = right.x - (left.x + left.width);
  const vertical = bottom.y - (top.y + top.height);
  if (horizontal >= 0) {
    const y =
      Math.max(a.y, b.y) +
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) / 2;
    distances.push({
      x1: left.x + left.width,
      y1: y,
      x2: right.x,
      y2: y,
      value: horizontal,
    });
  }
  if (vertical >= 0) {
    const x =
      Math.max(a.x, b.x) +
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) / 2;
    distances.push({
      x1: x,
      y1: top.y + top.height,
      x2: x,
      y2: bottom.y,
      value: vertical,
    });
  }
  return distances;
};

export const rulerMarkup = (width: number, height: number): string => {
  const marks: Array<string> = [
    `<path d="M0 0H${width}V20H20V${height}H0Z" fill="white" fill-opacity=".96"/>`,
    `<path d="M20 ${height}V20H${width}" fill="none" stroke="#e3e3e3"/>`,
  ];
  for (let x = 50; x < width; x += 10) {
    const major = x % 50 === 0;
    marks.push(`<path d="M${x} 20v-${major ? 8 : 4}" stroke="#aaa"/>`);
    if (major) marks.push(`<text x="${x + 3}" y="9">${x}</text>`);
  }
  for (let y = 50; y < height; y += 10) {
    const major = y % 50 === 0;
    marks.push(`<path d="M20 ${y}h-${major ? 8 : 4}" stroke="#aaa"/>`);
    if (major)
      marks.push(`<text transform="translate(9 ${y + 3}) rotate(-90)">${y}</text>`);
  }
  return marks.join('');
};

export const distanceMarkup = (distances: ReadonlyArray<Distance>): string =>
  distances
    .map(({ x1, y1, x2, y2, value }) => {
      const label = `${Math.round(value * 10) / 10}`;
      const x = (x1 + x2) / 2;
      const y = (y1 + y2) / 2;
      const horizontal = y1 === y2;
      return `<g stroke="#ef4c6b" fill="none"><path d="M${x1} ${y1}L${x2} ${y2}"/><path d="${horizontal ? `M${x1} ${y1 - 4}v8M${x2} ${y2 - 4}v8` : `M${x1 - 4} ${y1}h8M${x2 - 4} ${y2}h8`}"/></g><rect x="${x - 17}" y="${y - 10}" width="34" height="20" rx="4" fill="#ef4c6b"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="white">${label}</text>`;
    })
    .join('');
