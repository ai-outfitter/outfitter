/**
 * PostHog project configuration. An empty key makes telemetry completely inert.
 *
 * This is a PostHog project API key: write-only, safe to ship in client code, and useless for
 * reading any project data. It belongs to the `ai-outfitter` organization, project 562393, on
 * PostHog Cloud US — so `POSTHOG_HOST` must stay a US endpoint or events are accepted nowhere.
 */
export const POSTHOG_API_KEY = 'phc_v9FGDjtEC7h9UvLxHdJKaHFtFfMN7UZwpJ2weRTFoqvz';
export const POSTHOG_HOST = 'https://us.i.posthog.com';
export const TELEMETRY_SHUTDOWN_BUDGET_MS = 1000;
