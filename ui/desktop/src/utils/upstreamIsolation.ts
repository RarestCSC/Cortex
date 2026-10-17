export function isUpstreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      host === 'goose-docs.ai' ||
      host.endsWith('.goose-docs.ai') ||
      host === 'goose.ai' ||
      host.endsWith('.goose.ai') ||
      host.endsWith('.posthog.com') ||
      host === 'posthog.com' ||
      host === 'cash-f.squarecdn.com' ||
      ((host === 'github.com' ||
        host === 'api.github.com' ||
        host === 'raw.githubusercontent.com') &&
        /^\/(?:repos\/)?(?:aaif-goose|block)\/goose(?:\/|$)/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}
