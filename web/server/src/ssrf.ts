import { lookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// SSRF guard — block requests to private/internal IPs
// ---------------------------------------------------------------------------
const PRIVATE_IP_RANGES = [
  /^127\./, // loopback
  /^10\./, // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
  /^192\.168\./, // RFC 1918
  /^169\.254\./, // link-local
  /^0\./, // "this" network
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 ULA
  /^fd/i, // IPv6 ULA
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

export async function assertPublicHostname(hostname: string): Promise<void> {
  // Resolve to IP first to prevent DNS rebinding
  const { address } = await lookup(hostname);
  if (isPrivateIp(address)) {
    throw new Error(`Blocked request to private IP ${address} (hostname: ${hostname})`);
  }
}
