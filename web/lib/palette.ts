/** One stable hue per region, shared by the cloud and the strip so a
 * region's color is its identity everywhere on the surface. */
export function regionHue(regionId: number): number {
  return (regionId * 137.508) % 360;
}

export function regionColor(regionId: number, lightness = 62): string {
  return `hsl(${regionHue(regionId).toFixed(1)} 72% ${lightness}%)`;
}
