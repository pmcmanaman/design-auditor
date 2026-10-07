const REDACTED = '[REDACTED]';

// Query parameters whose values are likely to be credentials or session tokens
const SENSITIVE_PARAM =
  /([?&](?:access_token|id_token|refresh_token|token|code|session|sessionid|sid|auth|key|api_key|apikey|password|secret|signature|sig)=)[^&#\s"']*/gi;

// Remove known secret values (and their URL-encoded form) plus sensitive
// query parameters from text that may end up in logs or reports.
export function redactSecrets(
  text: string,
  secrets: Array<string | undefined> = []
): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(variant).join(REDACTED);
    }
  }
  return out.replace(SENSITIVE_PARAM, `$1${REDACTED}`);
}
