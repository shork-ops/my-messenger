import { publicIpv4, publicPage } from "../functions/_shared/publicPage.ts";
Deno.test("preview rejects private, reserved and IPv6 destinations", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    if (publicIpv4(ip)) throw new Error(`Allowed ${ip}`);
  }
  if (!publicIpv4("8.8.8.8")) throw new Error("Public IPv4 refused");
  for (const url of ["http://127.0.0.1/", "http://[::ffff:127.0.0.1]/", "ftp://example.com/", "https://example.com:8080/", "https://user:pass@example.com/"]) {
    let refused = false;
    try { await publicPage(new URL(url), 512, 100); } catch { refused = true; }
    if (!refused) throw new Error(`Allowed ${url}`);
  }
});
