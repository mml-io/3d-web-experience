type MMLDocumentConfig = { url: string; [key: string]: unknown };

/**
 * Normalize protocol-relative WebSocket URLs. `ws:///path` resolves to ws: or
 * wss: based on the page protocol. `wss:///path` is left as-is (secure only).
 */
export function normalizeDocumentProtocols(
  mmlDocuments: { [key: string]: MMLDocumentConfig } | undefined,
  pageProtocol: string,
): { [key: string]: MMLDocumentConfig } | undefined {
  if (!mmlDocuments) return mmlDocuments;
  const wsProtocol = pageProtocol === "https:" ? "wss:" : "ws:";
  const result: { [key: string]: MMLDocumentConfig } = {};
  for (const [key, doc] of Object.entries(mmlDocuments)) {
    let url = doc.url;
    if (url.startsWith("ws:///")) {
      // ws:/// is protocol-relative — resolve to ws: or wss: based on page protocol
      const path = url.slice("ws:///".length);
      url = `${wsProtocol}///${path}`;
    }
    // wss:/// is left as-is — it explicitly requests a secure connection
    result[key] = { ...doc, url };
  }
  return result;
}
