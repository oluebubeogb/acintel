/* Mirror of apps/api/src/ai.ts stripExportLinks — also cleans older stored replies. */
/** Remove raw export links ("Download link: [/api/ai/exports/…](…)", bare URLs) — the file is offered as a download button instead. */
export function stripExportLinks(text: string): string {
  if (!text || !text.includes('/ai/exports/')) return text;
  const LINK_ONLY = /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:download(?:\s+(?:link|it|here|the\s+csv|csv))?|link|file|url)?(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(?:\[[^\]]*\]\([^)]*\/ai\/exports\/[^)]*\)|<?\S*\/ai\/exports\/\S*?>?)\s*\.?\s*$/i;
  return text.split('\n').filter((l) => !LINK_ONLY.test(l)).map((l) => {
    if (!l.includes('/ai/exports/')) return l;
    return l.replace(/\[([^\]]*)\]\([^)]*\/ai\/exports\/[^)]*\)/g, (_m, t: string) => (t.includes('/ai/exports/') ? '' : t))
      .replace(/<?(?:https?:\/\/[^\s/]+)?\/api\/ai\/exports\/[A-Za-z0-9_-]+>?/g, '')
      .replace(/\(\s*\)/g, '').replace(/\s+([.,;!?])/g, '$1').replace(/(?:download\s+link|link|here)?\s*:\s*$/i, '').replace(/\s{2,}/g, ' ').trimEnd();
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
