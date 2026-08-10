const configuredPublicApiOrigin = process.env.NEXT_PUBLIC_PRIXRADAR_API_URL || "";

export function publicApiUrl(pathname: string) {
  const safePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return configuredPublicApiOrigin ? new URL(safePath, `${configuredPublicApiOrigin}/`).href : safePath;
}
