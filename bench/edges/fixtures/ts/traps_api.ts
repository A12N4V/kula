export function normalize(x: string): string {
  return x.trim();
}
export default (x: string) => normalize(x) + "!";
