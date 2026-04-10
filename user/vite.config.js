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
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_ORIGIN,
  buildBusinessPath,
  buildCollectionPath,
  buildHomePath,
  buildPageSeoData,
  buildStructuredData,
  normalizeBasePath,
  normalizeCanonicalPath,
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
const PUBLIC_SECURITY_HEADERS = [
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'; connect-src 'self' https:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-src 'self' https://www.openstreetmap.org https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
];

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

      for (const page of allPages) {
        writeRenderedPage(distDir, templateHtml, page, basePath);
      }
      writeRootEntryPage(distDir, templateHtml, homePage);

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
      writeStaticHostSupportFiles(distDir, homePage.path, basePath);
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
  const coverageFacts = buildDirectoryCoverageFacts(businesses);
  const overviewParagraphs = buildHomeOverviewParagraphs(businesses);
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
      `<p class="seo-lead">${escapeHtml(overviewParagraphs[0])}</p>`,
      renderSeoTextSection("Directory overview", overviewParagraphs.slice(1), "h2"),
      renderSeoFactSection("Coverage snapshot", coverageFacts, "h3"),
      renderSeoLinkSection("Browse by province", provinceLinks, "h3"),
      renderSeoLinkSection("Browse by district", districtLinks, "h3"),
      renderSeoLinkSection("Browse by institute type", typeLinks, "h3"),
      renderSeoLinkSection("Browse by field", fieldLinks, "h3"),
      renderSeoBusinessList("Active institutions", featured, basePath, "h3"),
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
      const overviewParagraphs = buildCollectionOverviewParagraphs(routeKey, label, entries, businesses);
      const factItems = buildCollectionFactItems(routeKey, label, entries);
      const relatedLinks = buildRelatedCollectionSections(routeKey, entries, basePath);
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
          filteredBusinessCount: entries.length,
        }),
        updatedAt: findLatestUpdatedAt(entries),
        bodyHtml: [
          `<main class="seo-fallback">`,
          `<p class="seo-kicker">aboutmyschool.com</p>`,
          `<h1>${escapeHtml(buildCollectionHeading(routeKey, label))}</h1>`,
          `<p class="seo-lead">${escapeHtml(overviewParagraphs[0])}</p>`,
          renderSeoTextSection("Page overview", overviewParagraphs.slice(1), "h2"),
          renderSeoFactSection("Quick facts", factItems, "h3"),
          ...relatedLinks.map((section) =>
            renderSeoLinkSection(section.title, section.links, "h3")
          ),
          renderSeoBusinessList(`Top listings for ${label}`, entries.slice(0, 24), basePath, "h3"),
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
  const overviewParagraphs = buildBusinessOverviewParagraphs(business);
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
      `<p class="seo-lead">${escapeHtml(overviewParagraphs[0])}</p>`,
      renderSeoTextSection("Institution overview", overviewParagraphs.slice(1), "h2"),
      renderSeoFactGrid(business),
      renderSeoBusinessLinks(business, "h3"),
      renderSeoMediaList("Programs", business.programs, "h3"),
      renderSeoMediaList("Facilities", business.facilities, "h3"),
      renderSeoMediaLinks("Gallery and media", [
        ...(Array.isArray(business.media?.gallery) ? business.media.gallery : []),
        ...(Array.isArray(business.media?.videos) ? business.media.videos : []),
      ], "h3"),
      `</main>`,
    ].join(""),
  };
}

function writeRenderedPage(distDir, templateHtml, page, basePath) {
  const outputPath = path.join(distDir, resolveDistRouteFile(page.path, basePath));

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

function writeRootEntryPage(distDir, templateHtml, homePage) {
  const rootIndexPath = path.join(distDir, "index.html");
  const targetPath = normalizeCanonicalPath(homePage.path);

  if (targetPath === "/") {
    fs.writeFileSync(
      rootIndexPath,
      renderHtmlPage(templateHtml, {
        seo: homePage.seo,
        structuredData: homePage.structuredData,
        bodyHtml: homePage.bodyHtml,
      }),
      "utf8"
    );
    return;
  }

  fs.writeFileSync(
    rootIndexPath,
    renderRedirectHtml(targetPath, homePage.seo.canonicalUrl),
    "utf8"
  );
}

function renderHtmlPage(templateHtml, { seo, structuredData, bodyHtml }) {
  let html = String(templateHtml || "");
  html = html.replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  html = replaceMetaTag(html, "description", seo.description);
  html = replaceMetaTag(
    html,
    "keywords",
    Array.isArray(seo.keywords) ? seo.keywords.join(", ") : ""
  );
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

function renderRedirectHtml(targetPath, canonicalUrl) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "    <title>Redirecting…</title>",
    `    <meta http-equiv="refresh" content="0; url=${escapeAttribute(targetPath)}" />`,
    '    <meta name="robots" content="noindex,follow" />',
    `    <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`,
    "  </head>",
    "  <body>",
    `    <p>Redirecting to <a href="${escapeAttribute(targetPath)}">${escapeHtml(targetPath)}</a>.</p>`,
    `    <script>window.location.replace(${JSON.stringify(targetPath)});</script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function renderSeoTextSection(title, paragraphs, headingTag = "h2") {
  const items = ensureArray(paragraphs).filter(Boolean);
  if (!items.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<${headingTag}>${escapeHtml(title)}</${headingTag}>`,
    ...items.map((paragraph) => `<p class="seo-copy">${escapeHtml(paragraph)}</p>`),
    `</section>`,
  ].join("");
}

function renderSeoLinkSection(title, links, headingTag = "h2") {
  if (!links.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<${headingTag}>${escapeHtml(title)}</${headingTag}>`,
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

function renderSeoFactSection(title, items, headingTag = "h2") {
  const values = ensureArray(items).filter((item) => item?.label && item?.value);
  if (!values.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<${headingTag}>${escapeHtml(title)}</${headingTag}>`,
    `<div class="seo-fact-grid">`,
    ...values.map(
      (item) =>
        `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`
    ),
    `</div>`,
    `</section>`,
  ].join("");
}

function renderSeoBusinessList(title, businesses, basePath, headingTag = "h2") {
  if (!businesses.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<${headingTag}>${escapeHtml(title)}</${headingTag}>`,
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

function renderSeoBusinessLinks(business, headingTag = "h2") {
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
    `<${headingTag}>Contact and links</${headingTag}>`,
    `<div class="seo-inline-links">${links.join("")}</div>`,
    `</section>`,
  ].join("");
}

function renderSeoMediaList(title, items, headingTag = "h2") {
  const values = ensureArray(items).filter(Boolean);
  if (!values.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<${headingTag}>${escapeHtml(title)}</${headingTag}>`,
    `<ul class="seo-chip-list">`,
    ...values.map((item) => `<li>${escapeHtml(item)}</li>`),
    `</ul>`,
    `</section>`,
  ].join("");
}

function renderSeoMediaLinks(title, items, headingTag = "h2") {
  const values = ensureArray(items).filter(Boolean);
  if (!values.length) {
    return "";
  }

  return [
    `<section class="seo-section">`,
    `<${headingTag}>${escapeHtml(title)}</${headingTag}>`,
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
    return `Browse ${count} active institutes in Nepal connected to ${label}.`;
  }
  if (routeKey === "type") {
    return `Browse ${count} active ${label.toLowerCase()} listings across Nepal.`;
  }
  return `Browse ${count} active institutes in ${label}, Nepal.`;
}

function buildHomeOverviewParagraphs(businesses) {
  const coverage = buildCoverageSnapshot(businesses);
  return [
    `Find schools, colleges, universities, and training centers across Nepal from one directory.`,
    `${DEFAULT_SITE_NAME} currently lists ${coverage.total} active institutions across ${coverage.districts} districts and ${coverage.provinces} provinces.`,
    `Each public profile can show contacts, programs, facilities, photos, videos, and map details. This helps families compare options faster.`,
    `Start with a province, district, type, or field page. Then open an institution profile for the full public details.`,
  ];
}

function buildDirectoryCoverageFacts(businesses) {
  const coverage = buildCoverageSnapshot(businesses);
  return [
    { label: "Active listings", value: String(coverage.total) },
    { label: "Provinces", value: String(coverage.provinces) },
    { label: "Districts", value: String(coverage.districts) },
    { label: "Types", value: String(coverage.types) },
    { label: "Fields", value: String(coverage.fields) },
  ];
}

function buildCollectionOverviewParagraphs(routeKey, label, entries, allBusinesses) {
  const coverage = buildCoverageSnapshot(entries);
  const total = entries.length;
  const topAffiliations = summarizeTopLabels(entries.map((business) => business.affiliation), 2);
  const topLevels = summarizeTopLabels(entries.flatMap((business) => business.level || []), 3);
  const allCoverage = buildCoverageSnapshot(allBusinesses);
  const lines = [buildCollectionLead(routeKey, label, total)];

  if (routeKey === "province") {
    lines.push(`This province page helps users review institutes in ${label} without jumping between many sources.`);
  } else if (routeKey === "district") {
    lines.push(`This district page is useful when families want local options in ${label} and need a quick shortlist.`);
  } else if (routeKey === "type") {
    lines.push(`This type page groups similar institutions, so it is easier to compare ${label.toLowerCase()} listings across Nepal.`);
  } else if (routeKey === "field") {
    lines.push(`This field page groups institutions connected to ${label}, so users can focus on one study area first.`);
  }

  lines.push(
    `The current set covers ${coverage.types} type${coverage.types === 1 ? "" : "s"}, ${coverage.fields} field${coverage.fields === 1 ? "" : "s"}, and ${coverage.districts} district${coverage.districts === 1 ? "" : "s"}.`
  );

  if (topAffiliations.length) {
    lines.push(`Common affiliations here include ${topAffiliations.join(", ")}.`);
  } else if (topLevels.length) {
    lines.push(`Common learning levels here include ${topLevels.join(", ")}.`);
  }

  lines.push(
    `As the public business list grows, this page will keep the same structure and will rebuild with the newest matching listings and counts.`
  );

  if (allCoverage.total > total) {
    lines.push(`Use the related browse links below to move from ${label} to other parts of the Nepal directory.`);
  }

  return lines;
}

function buildCollectionFactItems(routeKey, label, entries) {
  const coverage = buildCoverageSnapshot(entries);
  const items = [
    { label: "Listings", value: String(entries.length) },
    { label: "Types", value: String(coverage.types) },
    { label: "Fields", value: String(coverage.fields) },
    { label: "Affiliations", value: String(coverage.affiliations) },
  ];

  if (routeKey !== "province") {
    items.push({ label: "Provinces", value: String(coverage.provinces) });
  }

  if (routeKey !== "district") {
    items.push({ label: "Districts", value: String(coverage.districts) });
  }

  return dedupeFactItems(items).slice(0, 6);
}

function buildRelatedCollectionSections(routeKey, entries, basePath) {
  const sectionConfigs = {
    province: [
      { title: "Popular districts in this province", key: "district", getValue: (business) => business.district, limit: 6 },
      { title: "Popular institute types here", key: "type", getValue: (business) => business.type, limit: 6 },
    ],
    district: [
      { title: "Institute types in this district", key: "type", getValue: (business) => business.type, limit: 6 },
      { title: "Fields linked to this district", key: "field", getValue: (business) => business.field || [], limit: 6 },
    ],
    type: [
      { title: "Districts with these listings", key: "district", getValue: (business) => business.district, limit: 6 },
      { title: "Fields linked to this type", key: "field", getValue: (business) => business.field || [], limit: 6 },
    ],
    field: [
      { title: "Districts with this field", key: "district", getValue: (business) => business.district, limit: 6 },
      { title: "Institute types for this field", key: "type", getValue: (business) => business.type, limit: 6 },
    ],
  }[routeKey] || [];

  return sectionConfigs
    .map((config) => ({
      title: config.title,
      links: buildSeoBrowseLinks(entries, config.key, config.getValue, config.limit, basePath),
    }))
    .filter((section) => section.links.length);
}

function buildBusinessOverviewParagraphs(business) {
  const safeName = stringOrDefault(business?.name, "This institution");
  const safeType = stringOrDefault(business?.type, "educational institute");
  const location = [business?.district, business?.province_name].filter(Boolean).join(", ");
  const levels = cleanStringArray(business?.level);
  const fields = cleanStringArray(business?.field);
  const facilities = cleanStringArray(business?.facilities);
  const programs = cleanStringArray(business?.programs);
  const lines = [
    `${safeName} is a ${safeType.toLowerCase()}${location ? ` in ${location}` : ` in ${DEFAULT_COUNTRY}`}.`,
    `${DEFAULT_SITE_NAME} shows its public contact details, facility list, media, and map information in one place.`,
  ];

  if (levels.length) {
    lines.push(`It serves ${joinReadableList(levels)}.`);
  }

  if (fields.length) {
    lines.push(`Its listed fields include ${joinReadableList(fields)}.`);
  } else if (programs.length) {
    lines.push(`Its listed programs include ${joinReadableList(programs.slice(0, 4))}.`);
  }

  if (facilities.length) {
    lines.push(`Reported facilities include ${joinReadableList(facilities.slice(0, 4))}.`);
  }

  return lines;
}

function buildCoverageSnapshot(businesses) {
  return {
    total: ensureArray(businesses).length,
    provinces: countUniqueLabels(ensureArray(businesses).map((business) => business.province_name || business.province)),
    districts: countUniqueLabels(ensureArray(businesses).map((business) => business.district)),
    types: countUniqueLabels(ensureArray(businesses).map((business) => business.type)),
    fields: countUniqueLabels(ensureArray(businesses).flatMap((business) => business.field || [])),
    affiliations: countUniqueLabels(ensureArray(businesses).map((business) => business.affiliation)),
  };
}

function summarizeTopLabels(values, limit = 3) {
  const counts = new Map();
  for (const value of ensureArray(values)) {
    const label = stringOrDefault(value);
    if (!label) {
      continue;
    }
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label]) => label);
}

function countUniqueLabels(values) {
  return new Set(
    ensureArray(values)
      .map((value) => stringOrDefault(value))
      .filter(Boolean)
  ).size;
}

function joinReadableList(values) {
  const items = ensureArray(values).filter(Boolean);
  if (!items.length) {
    return "";
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function dedupeFactItems(items) {
  const seen = new Set();
  return ensureArray(items).filter((item) => {
    const key = `${item?.label}:${item?.value}`;
    if (!item?.label || !item?.value || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

function writeStaticHostSupportFiles(distDir, homePath, basePath) {
  const homeEntryPath = path.join(distDir, resolveDistRouteFile(homePath, basePath));
  if (fs.existsSync(homeEntryPath)) {
    fs.copyFileSync(homeEntryPath, path.join(distDir, "404.html"));
  }

  const fallbackFile = `/${resolveDistRouteFile(homePath, basePath).replace(/\\/g, "/")}`;
  fs.writeFileSync(path.join(distDir, ".htaccess"), buildApacheFallbackFile(fallbackFile), "utf8");
  fs.writeFileSync(path.join(distDir, "web.config"), buildIisFallbackFile(fallbackFile), "utf8");
  fs.writeFileSync(path.join(distDir, "_redirects"), buildStaticRedirectsFile(homePath, fallbackFile), "utf8");
  fs.writeFileSync(path.join(distDir, "_headers"), buildStaticHeadersFile(), "utf8");
}

function buildApacheFallbackFile(fallbackFile) {
  return [
    "Options -MultiViews",
    "<IfModule mod_rewrite.c>",
    "RewriteEngine On",
    "RewriteCond %{REQUEST_FILENAME} -f [OR]",
    "RewriteCond %{REQUEST_FILENAME} -d",
    "RewriteRule ^ - [L]",
    `RewriteRule . ${String(fallbackFile || "/index.html").replace(/^\//, "")} [L]`,
    "</IfModule>",
    "",
  ].join("\n");
}

function buildIisFallbackFile(fallbackFile) {
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
    `          <action type="Rewrite" url="${escapeAttribute(
      String(fallbackFile || "/index.html").replace(/^\//, "")
    )}" />`,
    "        </rule>",
    "      </rules>",
    "    </rewrite>",
    "  </system.webServer>",
    "</configuration>",
    "",
  ].join("\n");
}

function buildStaticHeadersFile() {
  return [
    "/*",
    ...PUBLIC_SECURITY_HEADERS.map((header) => `  ${header.key}: ${header.value}`),
    "",
  ].join("\n");
}

function buildStaticRedirectsFile(homePath, fallbackFile) {
  const lines = [];
  const normalizedHomePath = normalizeCanonicalPath(homePath);
  if (normalizedHomePath !== "/") {
    lines.push(`/ ${normalizedHomePath} 308`);
  }
  lines.push(`/* ${fallbackFile || "/index.html"} 200`);
  lines.push("");
  return lines.join("\n");
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
.seo-fallback h3{margin:0 0 12px;font-size:18px;letter-spacing:-.02em}
.seo-lead{max-width:860px;margin:16px 0 0;color:#4f5d72;line-height:1.7}
.seo-copy{max-width:860px;margin:12px 0 0;color:#4f5d72;line-height:1.72}
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
