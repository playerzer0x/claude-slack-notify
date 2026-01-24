/**
 * URL validation for SSRF protection
 *
 * Validates tunnel URLs to prevent:
 * - Private IP access (localhost, 10.x, 192.168.x, 172.16-31.x)
 * - Cloud metadata endpoints (169.254.169.254)
 * - Non-HTTPS connections
 */

import type { ValidationResult } from './types.js';

// Private IP ranges that should never be forwarded to
const PRIVATE_IP_PATTERNS = [
  /^127\./,                    // Loopback
  /^10\./,                     // Class A private
  /^192\.168\./,               // Class C private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private (172.16-31.x)
  /^169\.254\./,               // Link-local / cloud metadata (AWS/Azure/GCP/DO/OCI)
  /^0\./,                      // Current network
  /^100\.100\.100\./,          // Alibaba Cloud metadata (100.100.100.200)
  /^::1$/,                     // IPv6 loopback
  /^fc[0-9a-f]{2}:/i,          // IPv6 unique local
  /^fe80:/i,                   // IPv6 link-local
  /^fd[0-9a-f]{2}:/i,          // IPv6 unique local (fd00::/8)
];

// Hostnames that should never be forwarded to
const BLOCKED_HOSTNAMES = new Set([
  // Loopback
  'localhost',
  'localhost.localdomain',

  // AWS metadata endpoints
  '169.254.169.254',                    // AWS EC2 metadata
  '169.254.170.2',                      // AWS ECS task metadata

  // GCP metadata endpoints
  'metadata.google.internal',
  'metadata',

  // Azure metadata endpoints
  '169.254.169.254',                    // Azure IMDS (same as AWS)
  'metadata.azure.com',

  // DigitalOcean metadata
  '169.254.169.254',                    // DigitalOcean (same IP)

  // Oracle Cloud metadata
  '169.254.169.254',                    // OCI (same IP)

  // Alibaba Cloud metadata
  '100.100.100.200',

  // Kubernetes
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

// Additional hostname patterns to block (checked via regex)
const BLOCKED_HOSTNAME_PATTERNS = [
  /\.internal$/,                        // Any .internal domain
  /^metadata\./,                        // Any metadata.* subdomain
  /\.metadata\./,                       // Any *.metadata.* domain
];

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
    return { valid: false, reason: `Hostname '${hostname}' is not allowed (metadata/internal endpoint)` };
  }

  // Block hostname patterns (metadata subdomains, .internal TLD)
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: `Hostname '${hostname}' matches blocked pattern (internal/metadata)` };
    }
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
