// SPDX-License-Identifier: Apache-2.0
import { setTimeout as delay } from 'node:timers/promises';

const retryableStatuses = new Set([429, 500, 502, 503, 504]);

export async function fetchPublishedAsset(url) {
  // Three attempts give transient failures two retries, with bounded backoff.
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (error) {
      if (attempt === 3) throw error;
    }
    if (response) {
      // Return the actual response, including permanent errors for the caller's
      // assertion. Never consume or reconstruct the successful response body.
      if (!retryableStatuses.has(response.status) || attempt === 3) return response;
      // Release the discarded error body before issuing another request.
      await response.body?.cancel().catch(() => {});
    }
    await delay(500 * attempt);
  }
}
