import fs from "fs";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  decoratePublicRecord as seoDecoratePublicRecord,
  isPublicRecordVisible as seoIsPublicRecordVisible,
} from "./src/directory-records.js";
import {
  DEFAULT_COUNTRY,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_ORIGIN,
  buildBusinessPath,
  buildCollectionPath,
  buildHomePath,
  buildPageSeoData,
  buildStructuredData,
  normalizeBasePath,
  normalizeRouteSlug,
  normalizeSiteOrigin,
} from "./src/site-seo.js";

const APP_DIR = __dirname;
const MONOREPO_ROOT_DIR = path.resolve(APP_DIR, "..");
const BASIC_INDEX_FILE = resolveExistingFile([
  path.join(APP_DIR, "basic", "_cards.json"),
  path.join(APP_DIR, "admin", "data", "basic", "_cards.json"),
  path.join(MONOREPO_ROOT_DIR, "basic", "_cards.json"),
  path.join(MONOREPO_ROOT_DIR, "admin", "data", "basic", "_cards.json"),
]);
const DETAILED_DIR = resolveExistingDirectory([
  path.join(APP_DIR, "detailed"),
  path.join(APP_DIR, "admin", "data", "detailed"),
  path.join(MONOREPO_ROOT_DIR, "detailed"),
  path.join(MONOREPO_ROOT_DIR, "admin", "data", "detailed"),
]);
const PROVINCE_NAMES = {
  "1": "Koshi",
  "2": "Madhesh",
  "3": "Bagmati",
  "4": "Gandaki",
  "5": "Lumbini",
  "6": "Karnali",
  "7": "Sudurpashchim",
};

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const devPort = normalizePort(env.VITE_DEV_PORT, 5173);
  const devHost = normalizeString(env.VITE_DEV_HOST) || "0.0.0.0";
  const adminOrigin = normalizeOrigin(env.VITE_ADMIN_API_ORIGIN) || "http://localhost:3000";
  const publicDataRoot = normalizeString(env.VITE_PUBLIC_DATA_ROOT);
  const basePath = normalizeBase(env.VITE_USER_BASE || "/");
  const siteName = normalizeString(env.VITE_SITE_NAME) || DEFAULT_SITE_NAME;
  const siteOrigin = normalizeSiteOrigin(env.VITE_SITE_ORIGIN || DEFAULT_SITE_ORIGIN);

  return {
    base: command === "build" ? basePath : "/",
    define: {
      "import.meta.env.VITE_PUBLIC_DATA_ROOT": JSON.stringify(publicDataRoot),
    },
    plugins: [
      react(),
      localPublicApiPlugin(),
      seoBuildPlugin({
        enabled: command === "build",
        basePath,
        siteName,
        siteOrigin,
        publicDataRoot,
      }),
    ],
    server: {
      host: devHost,
      port: devPort,
      proxy: {
        "/api": {
          target: adminOrigin,
          changeOrigin: true,
        },
      },
    },
  };
});

function localPublicApiPlugin() {
  return {
    name: "local-public-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];

        if (url === "/api/public/list") {
          const list = loadPublicBusinessList();
          sendJson(res, {
            success: true,
            data: list,
            meta: loadPublicDirectoryMeta(list),
          });
          return;
        }

        if (url === "/api/public/meta") {
          sendJson(res, {
            success: true,
            data: loadPublicDirectoryMeta(),
          });
          return;
        }

        const detailMatch = url.match(/^\/api\/public\/get\/([^/]+)$/);
        if (detailMatch) {
          const record = loadPublicBusinessDetail(detailMatch[1]);
          if (!record) {
            res.statusCode = 404;
            sendJson(res, { success: false, error: "Not found" });
            return;
          }

          sendJson(res, {
            success: true,
            data: record,
          });
          return;
        }

        next();
      });
    },
  };
}

function seoBuildPlugin({ enabled, basePath, siteName, siteOrigin, publicDataRoot }) {
  return {
    name: "seo-static-pages",
    async closeBundle() {
      if (!enabled) {
        return;
      }

      const distDir = path.join(__dirname, "dist");
      const templatePath = path.join(distDir, "index.html");
      if (!fs.existsSync(templatePath)) {
        return;
      }

      const templateHtml = fs.readFileSync(templatePath, "utf8");
      const businesses = await loadSeoBusinesses(publicDataRoot);
      const homePath = buildHomePath(basePath);
      const homePage = createHomePageModel({
        businesses,
        siteName,
        siteOrigin,
        basePath,
        homePath,
      });
      const collectionPages = createCollectionPageModels({
        businesses,
        siteName,
        siteOrigin,
        basePath,
      });
      const detailPages = businesses.map((business) =>
        createBusinessPageModel({
          business,
          siteName,
          siteOrigin,
          basePath,
        })
      );
      const allPages = [homePage, ...collectionPages, ...detailPages];

      writeRenderedPage(distDir, templateHtml, homePage, basePath, true);
      for (const page of allPages) {
        writeRenderedPage(distDir, templateHtml, page, basePath, false);
      }

      fs.writeFileSync(path.join(distDir, "robots.txt"), buildRobotsTxt(siteOrigin), "utf8");
      fs.writeFileSync(path.join(distDir, "sitemap.xml"), buildSitemapXml(allPages), "utf8");
      fs.writeFileSync(
        path.join(distDir, "prerender-manifest.json"),
        JSON.stringify(
          {
            generated_at: new Date().toISOString(),
            page_count: allPages.length,
            pages: allPages.map((page) => ({
              path: page.path,
              title: page.seo.title,
            })),
          },
          null,
          2
        ),
        "utf8"
      );
      writeStaticPublicData(distDir, businesses);
      writeStaticHostSupportFiles(distDir);
    },
  };
}

async function loadSeoBusinesses(publicDataRoot = "") {
  const cards = await loadSeoBasicCards(publicDataRoot);
  const visibleCards = cards.filter(seoIsPublicRecordVisible);
  const businesses = await Promise.all(
    visibleCards.map(async (card) => {
      const slug = sanitizeSlug(card.slug);
      const detail = slug ? await loadSeoDetailedRecord(slug, publicDataRoot) : null;
      return seoDecoratePublicRecord({ ...card, ...(detail || {}) });
    })
  );

  return businesses
    .filter((business) => business.slug)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadSeoBasicCards(publicDataRoot = "") {
  const localCards = loadBasicCards();
  if (localCards.length) {
    return localCards;
  }

  return fetchRemoteJson(buildExternalDataUrl(publicDataRoot, "basic/_cards.json"), []);
}

async function loadSeoDetailedRecord(slug, publicDataRoot = "") {
  const localRecord = readDetailedRecord(slug);
  if (localRecord) {
    return localRecord;
  }

  return fetchRemoteJson(buildExternalDataUrl(publicDataRoot, `detailed/${slug}.json`), null);
}

function createHomePageModel({ businesses, siteName, siteOrigin, basePath, homePath }) {
  const featured = businesses.slice(0, 12);
  const provinceLinks = buildSeoBrowseLinks(businesses, "province", (business) => business.province_name || business.province, 7, basePath);
  const districtLinks = buildSeoBrowseLinks(businesses, "district", (business) => business.district, 12, basePath);
  const typeLinks = buildSeoBrowseLinks(businesses, "type", (business) => business.type, 8, basePath);
  const fieldLinks = buildSeoBrowseLinks(businesses, "field", (business) => business.field || [], 10, basePath);
  const seo = buildPageSeoData({
    siteName,
    siteOrigin,
    pagePath: homePath,
    totalBusinessCount: businesses.length,
  });
  const structuredData = buildStructuredData({
    siteName,
    siteOrigin,
    basePath,
    pagePath: homePath,
  });

  return {
    path: homePath,
    seo,
    structuredData,
    updatedAt: findLatestUpdatedAt(businesses),
    bodyHtml: [
      `<main class="seo-fallback">`,
      `<p class="seo-kicker">aboutmyschool.com</p>`,
      `<h1>Find educational institutes across Nepal</h1>`,
      `<p class="seo-lead">${escapeHtml(DEFAULT_SITE_DESCRIPTION)}</p>`,
      renderSeoLinkSection("Browse by province", provinceLinks),
      renderSeoLinkSection("Browse by district", districtLinks),
      renderSeoLinkSection("Browse by institute type", typeLinks),
      renderSeoLinkSection("Browse by field", fieldLinks),
      renderSeoBusinessList("Active institutions", featured, basePath),
      `</main>`,
    ].join(""),
  };
}

function createCollectionPageModels({ businesses, siteName, siteOrigin, basePath }) {
  return [
    ...createCollectionPagesForKey(businesses, "province", (business) => business.province_name || business.province, siteName, siteOrigin, basePath),
    ...createCollectionPagesForKey(businesses, "district", (business) => business.district, siteName, siteOrigin, basePath),
    ...createCollectionPagesForKey(businesses, "type", (business) => business.type, siteName, siteOrigin, basePath),
    ...createCollectionPagesForKey(businesses, "field", (business) => business.field || [], siteName, siteOrigin, basePath),
  ];
}

function createCollectionPagesForKey(businesses, routeKey, getValues, siteName, siteOrigin, basePath) {
  const grouped = new Map();

  for (const business of businesses) {
    const resolved = getValues(business);
    const values = Array.isArray(resolved) ? resolved : [resolved];

    for (const value of values) {
      const label = String(value || "").trim();
      if (!label) {
        continue;
      }
      if (!grouped.has(label)) {
        grouped.set(label, []);
      }
      grouped.get(label).push(business);
    }
  }

  return [...grouped.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([label, entries]) => {
      const filters = buildSeoFilters(routeKey, label);
      const pagePath = buildCollectionPath(routeKey, label, basePath);
      return {
        path: pagePath,
        seo: buildPageSeoData({
          siteName,
          siteOrigin,
          pagePath,
          route: {
            pageType: routeKey,
            selectedSlug: "",
            listingKey: routeKey,
            listingSlug: normalizeRouteSlug(label),
            legacyHash: false,
          },
          filters,
          filteredBusinessCount: entries.length,
          totalBusinessCount: businesses.length,
        }),
        structuredData: buildStructuredData({
          siteName,
          siteOrigin,
          basePath,
          pagePath,
          route: {
            pageType: routeKey,
            selectedSlug: "",
            listingKey: routeKey,
            listingSlug: normalizeRouteSlug(label),
            legacyHash: false,
          },
          filters,
        }),
        updatedAt: findLatestUpdatedAt(entries),
        bodyHtml: [
          `<main class="seo-fallback">`,
          `<p class="seo-kicker">aboutmyschool.com</p>`,
          `<h1>${escapeHtml(buildCollectionHeading(routeKey, label))}</h1>`,
          `<p class="seo-lead">${escapeHtml(buildCollectionLead(routeKey, label, entries.length))}</p>`,
          renderSeoBusinessList(`Top listings for ${label}`, entries.slice(0, 24), basePath),
          `</main>`,
        ].join(""),
      };
    });
}

function createBusinessPageModel({ business, siteName, siteOrigin, basePath }) {
  const pagePath = buildBusinessPath(business.slug, basePath);
  const seo = buildPageSeoData({
    siteName,
    siteOrigin,
    pagePath,
    selectedBusiness: business,
  });
  const structuredData = buildStructuredData({
    siteName,
    siteOrigin,
    basePath,
    pagePath,
    route: {
      pageType: "detail",
      selectedSlug: business.slug,
      listingKey: "",
      listingSlug: "",
      legacyHash: false,
    },
    selectedBusiness: business,
  });

  return {
    path: pagePath,
    seo,
    structuredData,
    updatedAt: business.updated_at || business.created_at || "",
    bodyHtml: [
      `<main class="seo-fallback">`,
      `<nav class="seo-breadcrumbs">`,
      `<a href="${escapeAttribute(buildHomePath(basePath))}">Home</a>`,
      business.province_name
        ? `<span>/</span><a href="${escapeAttribute(
            buildCollectionPath("province", business.province_name, basePath)
          )}">${escapeHtml(business.province_name)}</a>`
        : "",
      `<span>/</span><strong>${escapeHtml(business.name)}</strong>`,
      `</nav>`,
      `<p class="seo-kicker">${escapeHtml([business.type, business.affiliation].filter(Boolean).join(" · "))}</p>`,
      `<h1>${escapeHtml(business.name)}</h1>`,
      `<p class="seo-lead">${escapeHtml(
        business.description ||
          `${business.name} is listed on AboutMySchool with contact details, program areas, facilities, photos, videos, and location information for students and families in Nepal.`
      )}</p>`,
      renderSeoFactGrid(business),
      renderSeoBusinessLinks(business),
      renderSeoMediaList("Programs", business.programs),
      renderSeoMediaList("Facilities", business.facilities),
      renderSeoMediaLinks("Gallery and media", [
        ...(Array.isArray(business.media?.gallery) ? business.media.gallery : []),
        ...(Array.isArray(business.media?.videos) ? business.media.videos : []),
      ]),
      `</main>`,
    ].join(""),
  };
}

function writeRenderedPage(distDir, templateHtml, page, basePath, rootDuplicate) {
  const outputPath = rootDuplicate
    ? path.join(distDir, "index.html")
    : path.join(distDir, resolveDistRouteFile(page.path, basePath));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    renderHtmlPage(templateHtml, {
      seo: page.seo,
      structuredData: page.structuredData,
      bodyHtml: page.bodyHtml,
    }),
    "utf8"
  );
}

function renderHtmlPage(templateHtml, { seo, structuredData, bodyHtml }) {
  let html = String(templateHtml || "");
  html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  html = replaceMetaTag(html, "description", seo.description);
  html = replaceMetaTag(html, "robots", seo.robots || "index,follow");
  html = replaceMetaProperty(html, "og:title", seo.title);
  html = replaceMetaProperty(html, "og:description", seo.description);
  html = replaceMetaProperty(html, "og:type", "website");
  html = replaceMetaProperty(html, "og:url", seo.canonicalUrl);
  html = replaceMetaProperty(html, "og:site_name", DEFAULT_SITE_NAME);
  html = replaceMetaTag(html, "twitter:card", seo.image ? "summary_large_image" : "summary");
  html = replaceMetaTag(html, "twitter:title", seo.title);
  html = replaceMetaTag(html, "twitter:description", seo.description);

  if (seo.image) {
    const absoluteImageUrl = toAbsoluteUrl(seo.canonicalUrl, seo.image);
    html = replaceMetaProperty(html, "og:image", absoluteImageUrl);
    html = replaceMetaTag(html, "twitter:image", absoluteImageUrl);
  }

  if (html.includes('rel="canonical"')) {
    html = html.replace(
      /<link[^>]+rel="canonical"[^>]*>/i,
      `<link rel="canonical" href="${escapeAttribute(seo.canonicalUrl)}" />`
    );
  } else {
    html = html.replace(
      "</head>",
      `<link rel="canonical" href="${escapeAttribute(seo.canonicalUrl)}" />\n</head>`
    );
  }

  html = html.replace(
    "</head>",
    `<style data-seo-fallback>${SEO_FALLBACK_STYLE}</style>\n<script type="application/ld+json" data-seo="prerender">${safeJsonLd(
      structuredData
    )}</script>\n</head>`
  );
  html = html.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
  return html;
}

function renderSeoLinkSection(title, links) {
  if (!links.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<ul class="seo-link-list">`,
    ...links.map(
      (link) =>
        `<li><a href="${escapeAttribute(link.href)}">${escapeHtml(link.label)}</a><span>${escapeHtml(
          `${link.count} listings`
        )}</span></li>`
    ),
    `</ul>`,
    `</section>`,
  ].join("");
}

function renderSeoBusinessList(title, businesses, basePath) {
  if (!businesses.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<ul class="seo-business-list">`,
    ...businesses.map((business) => {
      const summary = [business.type, business.district, business.province_name].filter(Boolean).join(" · ");
      return `<li><a href="${escapeAttribute(buildBusinessPath(business.slug, basePath))}">${escapeHtml(
        business.name
      )}</a><span>${escapeHtml(summary)}</span></li>`;
    }),
    `</ul>`,
    `</section>`,
  ].join("");
}

function renderSeoFactGrid(business) {
  const items = [
    ["Type", business.type || "Educational institute"],
    ["Affiliation", business.affiliation || "Not specified"],
    ["Levels", ensureArray(business.level).join(", ") || "Not specified"],
    ["Fields", ensureArray(business.field).join(", ") || "Not specified"],
    ["Location", [business.district, business.province_name, DEFAULT_COUNTRY].filter(Boolean).join(", ")],
    ["Address", business.contact?.address || "Not specified"],
  ].filter(([, value]) => value);

  return [
    `<section class="seo-section">`,
    `<div class="seo-fact-grid">`,
    ...items.map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    ),
    `</div>`,
    `</section>`,
  ].join("");
}

function renderSeoBusinessLinks(business) {
  const links = [
    business.contact?.website ? `<a href="${escapeAttribute(ensureUrl(business.contact.website))}">Official website</a>` : "",
    business.contact?.email ? `<a href="mailto:${escapeAttribute(business.contact.email)}">Email</a>` : "",
    ensureArray(business.contact?.phone)
      .slice(0, 1)
      .map((phone) => `<a href="tel:${escapeAttribute(phone)}">Call ${escapeHtml(phone)}</a>`)
      .join(""),
  ].filter(Boolean);

  if (!links.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<h2>Contact and links</h2>`,
    `<div class="seo-inline-links">${links.join("")}</div>`,
    `</section>`,
  ].join("");
}

function renderSeoMediaList(title, items) {
  const values = ensureArray(items).filter(Boolean);
  if (!values.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<ul class="seo-chip-list">`,
    ...values.map((item) => `<li>${escapeHtml(item)}</li>`),
    `</ul>`,
    `</section>`,
  ].join("");
}

function renderSeoMediaLinks(title, items) {
  const values = ensureArray(items).filter(Boolean);
  if (!values.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<ul class="seo-business-list">`,
    ...values.slice(0, 12).map((item, index) => {
      const href = ensureUrl(item);
      return `<li><a href="${escapeAttribute(href)}">Media ${index + 1}</a><span>${escapeHtml(href)}</span></li>`;
    }),
    `</ul>`,
    `</section>`,
  ].join("");
}

function buildSeoBrowseLinks(businesses, routeKey, getValue, limit, basePath) {
  const counts = new Map();

  for (const business of businesses) {
    const resolved = getValue(business);
    const values = Array.isArray(resolved) ? resolved : [resolved];
    for (const value of values) {
      const label = String(value || "").trim();
      if (!label) {
        continue;
      }
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      href: buildCollectionPath(routeKey, label, basePath),
    }));
}

function buildSeoFilters(routeKey, label) {
  return {
    search: "",
    type: routeKey === "type" ? label : "all",
    field: routeKey === "field" ? label : "all",
    level: "all",
    province: routeKey === "province" ? label : "all",
    district: routeKey === "district" ? label : "all",
    affiliation: "all",
    savedOnly: false,
  };
}

function buildCollectionHeading(routeKey, label) {
  if (routeKey === "field") {
    return `${label} institutes in Nepal`;
  }
  if (routeKey === "type") {
    return `${label} directory in Nepal`;
  }
  return `Educational institutes in ${label}, Nepal`;
}

function buildCollectionLead(routeKey, label, count) {
  if (routeKey === "field") {
    return `Browse ${count} active educational institutes in Nepal connected to ${label}.`;
  }
  if (routeKey === "type") {
    return `Browse ${count} active ${label.toLowerCase()} listings across Nepal with profile details, media, and contact information.`;
  }
  return `Browse ${count} active educational institutes in ${label}, Nepal with photos, videos, facilities, and full contact details.`;
}

function buildRobotsTxt(siteOrigin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${normalizeSiteOrigin(siteOrigin)}/sitemap.xml\n`;
}

function buildSitemapXml(pages) {
  const urls = pages.map((page) => {
    const lastmod = page.updatedAt ? `<lastmod>${escapeXml(formatDateOnly(page.updatedAt))}</lastmod>` : "";
    return `<url><loc>${escapeXml(page.seo.canonicalUrl)}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

function writeStaticPublicData(distDir, businesses) {
  const publicDataDir = path.join(distDir, "public-data");
  const detailsDir = path.join(publicDataDir, "details");
  const directoryMeta = {
    version: [
      businesses.length,
      findLatestUpdatedAt(businesses),
    ]
      .filter(Boolean)
      .join(":"),
    count: businesses.length,
    updated_at: findLatestUpdatedAt(businesses),
  };

  fs.mkdirSync(detailsDir, { recursive: true });
  fs.writeFileSync(path.join(publicDataDir, "list.json"), JSON.stringify(businesses, null, 2), "utf8");
  fs.writeFileSync(path.join(publicDataDir, "meta.json"), JSON.stringify(directoryMeta, null, 2), "utf8");

  for (const business of businesses) {
    if (!business?.slug) {
      continue;
    }

    fs.writeFileSync(
      path.join(detailsDir, `${business.slug}.json`),
      JSON.stringify(business, null, 2),
      "utf8"
    );
  }
}

function writeStaticHostSupportFiles(distDir) {
  const indexPath = path.join(distDir, "index.html");
  if (fs.existsSync(indexPath)) {
    fs.copyFileSync(indexPath, path.join(distDir, "404.html"));
  }

  fs.writeFileSync(path.join(distDir, ".htaccess"), buildApacheFallbackFile(), "utf8");
  fs.writeFileSync(path.join(distDir, "web.config"), buildIisFallbackFile(), "utf8");
  fs.writeFileSync(path.join(distDir, "_redirects"), "/* /index.html 200\n", "utf8");
}

function buildApacheFallbackFile() {
  return [
    "Options -MultiViews",
    "<IfModule mod_rewrite.c>",
    "RewriteEngine On",
    "RewriteCond %{REQUEST_FILENAME} -f [OR]",
    "RewriteCond %{REQUEST_FILENAME} -d",
    "RewriteRule ^ - [L]",
    "RewriteRule . index.html [L]",
    "</IfModule>",
    "",
  ].join("\n");
}

function buildIisFallbackFile() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<configuration>",
    "  <system.webServer>",
    "    <rewrite>",
    "      <rules>",
    '        <rule name="SPA Fallback" stopProcessing="true">',
    '          <match url=".*" />',
    '          <conditions logicalGrouping="MatchAll">',
    '            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />',
    '            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />',
    "          </conditions>",
    '          <action type="Rewrite" url="index.html" />',
    "        </rule>",
    "      </rules>",
    "    </rewrite>",
    "  </system.webServer>",
    "</configuration>",
    "",
  ].join("\n");
}

function resolveDistRouteFile(pagePath, basePath) {
  const normalizedBasePath = normalizeBasePath(basePath);
  const basePrefix = normalizedBasePath === "/" ? "/" : normalizedBasePath.slice(0, -1);
  let relativePath = pagePath;

  if (basePrefix !== "/" && relativePath.startsWith(basePrefix)) {
    relativePath = relativePath.slice(basePrefix.length) || "/";
  }

  const cleaned = relativePath.replace(/^\/+|\/+$/g, "");
  return cleaned ? path.join(cleaned, "index.html") : "index.html";
}

function findLatestUpdatedAt(records) {
  return ensureArray(records).reduce((latest, record) => {
    const value = String(record?.updated_at || record?.created_at || "").trim();
    if (!value) {
      return latest;
    }
    return new Date(value).getTime() > new Date(latest || 0).getTime() ? value : latest;
  }, "");
}

function toAbsoluteUrl(baseUrl, value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMetaTag(html, name, content) {
  const nextTag = `<meta name="${name}" content="${escapeAttribute(content)}" />`;
  const pattern = new RegExp(`<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]*>`, "i");
  return pattern.test(html) ? html.replace(pattern, nextTag) : html.replace("</head>", `${nextTag}\n</head>`);
}

function replaceMetaProperty(html, property, content) {
  const nextTag = `<meta property="${property}" content="${escapeAttribute(content)}" />`;
  const pattern = new RegExp(`<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]*>`, "i");
  return pattern.test(html) ? html.replace(pattern, nextTag) : html.replace("</head>", `${nextTag}\n</head>`);
}

function formatDateOnly(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeXml(value) {
  return escapeHtml(value);
}

function safeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const SEO_FALLBACK_STYLE = `
.seo-fallback{max-width:1120px;margin:0 auto;padding:28px 16px 48px;color:#152238;font-family:Manrope,Avenir Next,sans-serif}
.seo-kicker{margin:0 0 12px;color:#2458d8;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
.seo-fallback h1{margin:0;font-size:clamp(30px,4vw,52px);line-height:1.02;letter-spacing:-.05em}
.seo-fallback h2{margin:0 0 12px;font-size:22px;letter-spacing:-.03em}
.seo-lead{max-width:860px;margin:16px 0 0;color:#4f5d72;line-height:1.7}
.seo-section{margin-top:28px;padding:22px;border:1px solid rgba(24,45,77,.1);border-radius:24px;background:rgba(255,255,255,.82);box-shadow:0 14px 30px rgba(18,35,64,.06)}
.seo-link-list,.seo-business-list,.seo-chip-list{display:grid;gap:12px;padding:0;margin:0;list-style:none}
.seo-link-list li,.seo-business-list li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(24,45,77,.08)}
.seo-link-list span,.seo-business-list span{color:#5c687d}
.seo-link-list a,.seo-business-list a,.seo-inline-links a,.seo-breadcrumbs a{color:#1f6ff2;text-decoration:none}
.seo-inline-links{display:flex;flex-wrap:wrap;gap:12px}
.seo-inline-links a{display:inline-flex;min-height:40px;align-items:center;padding:0 14px;border-radius:999px;background:rgba(226,237,255,.94);border:1px solid rgba(46,107,212,.14)}
.seo-chip-list{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.seo-chip-list li{padding:10px 12px;border-radius:14px;background:#fff;border:1px solid rgba(24,45,77,.08)}
.seo-fact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.seo-fact-grid div{padding:14px;border-radius:18px;background:#fff;border:1px solid rgba(24,45,77,.08)}
.seo-fact-grid span{display:block;margin-bottom:6px;color:#5c687d;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.seo-fact-grid strong{font-size:15px;line-height:1.5}
.seo-breadcrumbs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;color:#5c687d}
`;

function loadPublicBusinessList() {
  return loadBasicCards().filter(isPublicRecordVisible).map(decoratePublicRecord);
}

function loadPublicDirectoryMeta(list = null) {
  const publicList = Array.isArray(list) ? list : loadPublicBusinessList();
  const basicIndexStat = safeStat(BASIC_INDEX_FILE);
  const sourceUpdatedAt =
    getLatestRecordTimestamp(publicList) ||
    (basicIndexStat ? new Date(basicIndexStat.mtimeMs).toISOString() : "");
  const version = [
    basicIndexStat ? Math.round(basicIndexStat.mtimeMs) : "",
    publicList.length,
    sourceUpdatedAt,
  ]
    .filter(Boolean)
    .join(":");

  return {
    version: version || `count:${publicList.length}`,
    count: publicList.length,
    updated_at: sourceUpdatedAt,
  };
}

function loadPublicBusinessDetail(slug) {
  const normalizedSlug = sanitizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const basicCards = loadBasicCards();
  const basic = basicCards.find((item) => item.slug === normalizedSlug) || {};
  const detailed = readDetailedRecord(normalizedSlug);
  const mergedSource = { ...basic, ...(detailed || {}) };
  const merged = decoratePublicRecord(mergedSource);

  if (!merged.slug || !isPublicRecordVisible(mergedSource)) {
    return null;
  }

  return merged;
}

function loadBasicCards() {
  const cards = BASIC_INDEX_FILE ? readJson(BASIC_INDEX_FILE, []) : [];
  return Array.isArray(cards) ? cards : [];
}

function readDetailedRecord(slug) {
  if (!DETAILED_DIR) {
    return null;
  }

  return readJson(path.join(DETAILED_DIR, `${slug}.json`), null);
}

function decoratePublicRecord(record) {
  const provinceName =
    stringOrDefault(record?.province_name) ||
    PROVINCE_NAMES[String(record?.province || "")] ||
    stringOrDefault(record?.province);
  const locationLabel = [record?.district, provinceName].filter(Boolean).join(", ");

  return {
    id: stringOrDefault(record?.id),
    slug: sanitizeSlug(record?.slug),
    name: stringOrDefault(record?.name),
    name_np: stringOrDefault(record?.name_np),
    type: stringOrDefault(record?.type),
    type_key: normalizeText(record?.type),
    level: cleanStringArray(record?.level),
    field: cleanStringArray(record?.field),
    affiliation: stringOrDefault(record?.affiliation),
    affiliation_key: normalizeText(record?.affiliation),
    district: stringOrDefault(record?.district),
    district_key: normalizeText(record?.district),
    province: stringOrDefault(record?.province),
    province_name: provinceName,
    province_key: normalizeText(provinceName || record?.province),
    location_label: locationLabel,
    logo: stringOrDefault(record?.logo || record?.media?.logo),
    cover: stringOrDefault(record?.cover || record?.media?.cover),
    description: stringOrDefault(record?.description),
    programs: cleanStringArray(record?.programs),
    facilities: cleanStringArray(record?.facilities),
    contact: {
      address: stringOrDefault(record?.contact?.address),
      phone: cleanStringArray(record?.contact?.phone),
      email: stringOrDefault(record?.contact?.email),
      website: stringOrDefault(record?.contact?.website),
      map: {
        lat: numberOrNull(record?.contact?.map?.lat),
        lng: numberOrNull(record?.contact?.map?.lng),
      },
    },
    stats: {
      students: integerOrNull(record?.stats?.students),
      faculty: integerOrNull(record?.stats?.faculty),
      rating: numberOrNull(record?.stats?.rating),
      programs_count: integerOrNull(record?.stats?.programs_count),
    },
    media: {
      logo: stringOrDefault(record?.media?.logo || record?.logo),
      cover: stringOrDefault(record?.media?.cover || record?.cover),
      gallery: cleanStringArray(record?.media?.gallery),
      videos: cleanStringArray(record?.media?.videos),
    },
    social: {
      facebook: stringOrDefault(record?.social?.facebook),
      instagram: stringOrDefault(record?.social?.instagram),
      youtube: stringOrDefault(record?.social?.youtube),
      twitter: stringOrDefault(record?.social?.twitter),
    },
    search_text: buildSearchText(record, provinceName),
  };
}

function isPublicRecordVisible(record) {
  return normalizeStatus(record?.subscription?.payment_status) === "active";
}

function buildSearchText(record, provinceName) {
  return [
    record?.name,
    record?.slug,
    record?.type,
    ...(record?.level || []),
    ...(record?.field || []),
    ...(record?.programs || []),
    record?.district,
    provinceName,
    record?.affiliation,
    record?.contact?.address,
    ...(record?.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "active" ? "active" : normalized === "expired" ? "expired" : "pending";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeStat(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function getLatestRecordTimestamp(records) {
  let latestTime = 0;

  for (const record of Array.isArray(records) ? records : []) {
    const time = new Date(record?.updated_at || record?.created_at || "").getTime() || 0;
    if (time > latestTime) {
      latestTime = time;
    }
  }

  return latestTime ? new Date(latestTime).toISOString() : "";
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function stringOrDefault(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function sendJson(res, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function normalizeString(value) {
  const text = String(value || "").trim();
  return text || "";
}

function normalizeOrigin(value) {
  const text = normalizeString(value);
  return text ? text.replace(/\/+$/, "") : "";
}

function normalizePort(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBase(value) {
  const raw = normalizeString(value) || "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function resolveExistingFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return "";
}

function resolveExistingDirectory(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return "";
}

function buildExternalDataUrl(root, relativePath) {
  const normalizedRoot = normalizeExternalDataRoot(root);
  if (!normalizedRoot) {
    return "";
  }

  return `${normalizedRoot}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

function normalizeExternalDataRoot(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return "";
  }

  return normalizeGithubDataRoot(raw).replace(/\/+$/, "");
}

function normalizeGithubDataRoot(value) {
  try {
    const url = new URL(value);
    const hostname = String(url.hostname || "").toLowerCase();
    if (hostname !== "github.com" && hostname !== "www.github.com") {
      return value;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 4) {
      return value;
    }

    const marker = segments[2];
    if (marker !== "tree" && marker !== "blob") {
      return value;
    }

    const owner = segments[0];
    const repo = segments[1];
    const branch = segments[3];
    const rest = segments.slice(4).join("/");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}${rest ? `/${rest}` : ""}`;
  } catch {
    return value;
  }
}

async function fetchRemoteJson(url, fallback) {
  if (!url) {
    return fallback;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return fallback;
    }

    return await response.json();
  } catch {
    return fallback;
  }
}
