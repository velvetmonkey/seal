// SPDX-License-Identifier: Apache-2.0
//
// Stable identifiers for the three Seal-family entry routes shown on the docs
// homepage and reused by FamilyRoutes.astro. This module intentionally holds
// only names, repository URLs and route destinations — it is not a second
// release or proof-status database. Release facts stay in the generated
// release-doc path; proof-status prose stays in the authored Markdown pages.
export interface FamilyRoute {
  /** Card heading / primary action label. */
  action: string;
  /** Secondary project label shown under the action. */
  project: string;
  /** Exact route description, per the docs-site specification. */
  description: string;
  /** Destination href. Site-relative paths are resolved against BASE_URL by the caller. */
  href: string;
  /** True when the destination leaves the docs site (a sibling repository or its hosted app). */
  external: boolean;
}

export const familyRoutes: FamilyRoute[] = [
  {
    action: 'Install the gate',
    project: 'Seal',
    description: 'Install Seal, run the demo, then choose the tool calls that need approval.',
    href: 'start/install/',
    external: false,
  },
  {
    action: 'Check a receipt',
    project: 'seal-check',
    description: 'Open the browser checker to inspect the checks supported for your decision receipt.',
    href: 'https://velvetmonkey.github.io/seal-check/',
    external: true,
  },
  {
    action: 'Review the evidence',
    project: 'seal-assurance-kit',
    description: 'Run receipt, policy-coverage and conformance checks from the command line.',
    href: 'verify/cli/',
    external: false,
  },
];

export const repositories = {
  seal: 'https://github.com/velvetmonkey/seal',
  sealCheck: 'https://github.com/velvetmonkey/seal-check',
  sealAssuranceKit: 'https://github.com/velvetmonkey/seal-assurance-kit',
};

export const sealCheckUrl = 'https://velvetmonkey.github.io/seal-check/';
