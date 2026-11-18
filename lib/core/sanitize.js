// Text cleaning shared by every layer.

/**
 * Error details with secrets masked (the Mac's redactSecrets, ADR-001 §6.4, F7):
 * `Authorization`, `x-api-key` and `api-key` values, Bearer tokens, keys in a URL query
 * (`key=`, `api_key=`, `token=`, `access_token=`, `auth=`), `sk-…`-style and `AIza…` keys,
 * and any token HeadsUp knows, each become "••••".
 */
export function redactSecrets(text, known = []) {
    let result = String(text);
    for (const token of known) {
        if (token.length >= 4)
            result = result.split(token).join('••••');
    }
    return result
        .replace(/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi, '$1$2••••')
        .replace(/([?&](api[_-]?key|key|token|access_token|auth)=)[^&\s#]+/gi, '$1••••')
        .replace(/(?<![?&])((x-)?api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1••••')
        .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '••••')
        .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{4,}/gi, '$1••••')
        .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/g, '••••');
}
