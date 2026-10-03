// Resolves an asset path against the folder the page is served from, so the
// site also works from a subfolder (for example /community-site/deltarune-app/).
export const asset = (path: string): string => new URL(path.replace(/^\//, ''), document.baseURI).href;
