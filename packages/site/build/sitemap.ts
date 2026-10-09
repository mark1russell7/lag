function escapeXml(text : string) : string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * The sitemap of the site (https://www.sitemaps.org/protocol.html): one entry
 * for each absolute URL. The URLs must be below the folder of the sitemap,
 * thus the build writes the file at the root of the site.
 */
export function sitemapXml(urls : readonly string[]) : string {
    const entries = [...new Set(urls)].map(url => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`);
    return [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">",
        ...entries,
        "</urlset>",
        "",
    ].join("\n");
}

/**
 * The `robots.txt` file of the site. It lets all crawlers read all pages,
 * and it gives the absolute URL of the sitemap. A crawler reads this file
 * only at the root of a host. Thus this file applies when the site has its
 * own domain. Below a path on GitHub Pages, the crawlers find the sitemap
 * through the `<link rel="sitemap">` of each page and through Search Console.
 */
export function robotsTxt(sitemapUrl : string) : string {
    return ["User-agent: *", "Allow: /", "", `Sitemap: ${sitemapUrl}`, ""].join("\n");
}
