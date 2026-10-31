/** Compare hashes rather than leaking the first mismatching byte of a maintenance key. */
export async function maintenanceAuthorized(header: string | null, secret: string): Promise<boolean> {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header.slice(7))),
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ]);
  const a = new Uint8Array(actual), b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
