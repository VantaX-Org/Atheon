// TASK-016: API Versioning middleware
// Supports v1 (current) with forward-compatibility headers

import type { Context, Next } from 'hono';
import type { AppBindings } from '../types';

export const API_CURRENT_VERSION = 'v1';
export const API_SUPPORTED_VERSIONS = ['v1'];

/**
 * API versioning middleware.
 * Adds version headers to all responses and validates version in URL.
 */
export function apiVersioning() {
  return async (c: Context<AppBindings>, next: Next) => {
    // Add version headers
    c.header('X-API-Version', API_CURRENT_VERSION);
    c.header('X-API-Supported-Versions', API_SUPPORTED_VERSIONS.join(', '));
    
    // Extract version from URL path
    const path = c.req.path;
    const versionMatch = path.match(/\/api\/(v\d+)\//);
    
    if (versionMatch) {
      const requestedVersion = versionMatch[1];
      if (!API_SUPPORTED_VERSIONS.includes(requestedVersion)) {
        return c.json({
          error: 'Unsupported API version',
          message: `API version '${requestedVersion}' is not supported. Supported versions: ${API_SUPPORTED_VERSIONS.join(', ')}`,
          current_version: API_CURRENT_VERSION,
        }, 400);
      }
    }

    await next();
  };
}

/**
 * Deprecation header for endpoints being phased out.
 */
export function deprecated(sunset: string, replacement?: string) {
  return async (c: Context<AppBindings>, next: Next) => {
    c.header('Deprecation', 'true');
    c.header('Sunset', sunset);
    if (replacement) {
      c.header('Link', `<${replacement}>; rel="successor-version"`);
    }
    await next();
  };
}
