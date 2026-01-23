/**
 * URL validation for SSRF protection
 *
 * Validates tunnel URLs to prevent:
 * - Private IP access (localhost, 10.x, 192.168.x, 172.16-31.x)
 * - Cloud metadata endpoints (169.254.169.254)
 * - Non-HTTPS connections
 */

// Private IP ranges that should never be forwarded to
const PRIVATE_IP_PATTERNS = [
  /^127\./,                    // Loopback
  /^10\./,                     // Class A private
  /^192\.168\./,               // Class C private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private (172.16-31.x)
  /^169\.254\./,               // Link-local / cloud metadata
  /^0\./,                      // Current network
  /^::1$/,                     // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,          // IPv6 unique local
  /^fe80:/i,                   // IPv6 link-local
];

// Hostnames that should never be forwarded to
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
]);

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a tunnel URL is safe to forward requests to
 */
export function validateTunnelUrl(url: string): ValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS URLs are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: `Hostname ${hostname} is not allowed` };
  }

  // Block private IP addresses
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Private IP addresses are not allowed' };
    }
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URLs with credentials are not allowed' };
  }

  // Block non-standard ports for known tunnel services
  // (Tailscale Funnel, Localtunnel, etc. always use port 443)
  if (parsed.port && parsed.port !== '443') {
    return { valid: false, reason: 'Only port 443 is allowed for tunnel URLs' };
  }

  return { valid: true };
}

/**
 * Extract safe domain for logging (no full URL for privacy)
 */
export function getSafeDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'invalid-url';
  }
}
