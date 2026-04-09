export const DEFAULT_COUNTRY = "Nepal";
export const DEFAULT_COUNTRY_ROUTE = "nepal";
export const DEFAULT_SITE_NAME = "AboutMySchool";
export const DEFAULT_SITE_ORIGIN = "https://aboutmyschool.com";
export const DIRECTORY_BRAND = DEFAULT_SITE_NAME;
export const DIRECTORY_TAGLINE = "Nepal's educational directory";
export const DEFAULT_SITE_DESCRIPTION =
  "AboutMySchool is Nepal's online educational directory for schools, colleges, universities, technical institutes, and training centers with photos, videos, programs, facilities, maps, and contact details.";

export const DEFAULT_FILTERS = Object.freeze({
  search: "",
  type: "all",
  field: "all",
  level: "all",
  province: "all",
  district: "all",
  affiliation: "all",
  savedOnly: false,
});

const INDEXABLE_ROUTE_KEYS = new Set(["province", "district", "type", "field"]);
const ROUTE_QUERY_PRIORITY = ["province", "district", "type", "field"];
const FILTER_QUERY_KEYS = ["type", "field", "level", "province", "district", "affiliation"];

export function cloneDefaultFilters() {
  return { ...DEFAULT_FILTERS };
}

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeRouteSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBasePath(value) {
  const raw = String(value || "/")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function normalizeSiteOrigin(value) {
  const raw = String(value || DEFAULT_SITE_ORIGIN).trim();
  if (!raw) {
    return DEFAULT_SITE_ORIGIN;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

export function parseLocationRoute(pathname, hash, basePath) {
  const segments = getRouteSegments(pathname, basePath);
  if (!segments.length && hash) {
    const legacyRoute = parseLegacyHashRoute(hash);
    if (legacyRoute) {
      return {
        ...legacyRoute,
        legacyHash: true,
      };
    }
  }

  if (normalizeRouteSlug(segments[0]) !== DEFAULT_COUNTRY_ROUTE) {
    return createHomeRoute();
  }

  if (normalizeText(segments[1]) === "institutions") {
    return {
      pageType: "detail",
      selectedSlug: normalizeRouteSlug(segments[2]),
      listingKey: "",
      listingSlug: "",
      legacyHash: false,
    };
  }

  if (INDEXABLE_ROUTE_KEYS.has(normalizeText(segments[1]))) {
    return {
      pageType: normalizeText(segments[1]),
      selectedSlug: "",
      listingKey: normalizeText(segments[1]),
      listingSlug: normalizeRouteSlug(segments[2]),
      legacyHash: false,
    };
  }

  return createHomeRoute();
}

export function createHomeRoute() {
  return {
    pageType: "directory",
    selectedSlug: "",
    listingKey: "",
    listingSlug: "",
    legacyHash: false,
  };
}

export function buildHomePath(basePath = "/") {
  return appendBasePath(basePath, `/${DEFAULT_COUNTRY_ROUTE}/`);
}

export function buildBusinessPath(slug, basePath = "/") {
  const normalizedSlug = normalizeRouteSlug(slug);
  if (!normalizedSlug) {
    return buildHomePath(basePath);
  }

  return appendBasePath(basePath, `/${DEFAULT_COUNTRY_ROUTE}/institutions/${normalizedSlug}/`);
}

export function buildCollectionPath(routeKey, slug, basePath = "/") {
  const normalizedKey = normalizeText(routeKey);
  const normalizedSlug = normalizeRouteSlug(slug);
  if (!INDEXABLE_ROUTE_KEYS.has(normalizedKey) || !normalizedSlug) {
    return buildHomePath(basePath);
  }

  return appendBasePath(basePath, `/${DEFAULT_COUNTRY_ROUTE}/${normalizedKey}/${normalizedSlug}/`);
}

export function buildListingUrl(filters, basePath = "/") {
  const normalizedFilters = normalizeFilters(filters);
  const indexableRoute = deriveIndexableRouteFromFilters(normalizedFilters);
  const navigableRoute = indexableRoute.listingKey
    ? indexableRoute
    : deriveNavigableRouteFromFilters(normalizedFilters);
  const baseRoutePath = navigableRoute.listingKey
    ? buildCollectionPath(navigableRoute.listingKey, navigableRoute.listingSlug, basePath)
    : buildHomePath(basePath);
  const queryString = buildFilterQueryString(normalizedFilters, navigableRoute.listingKey);
  return appendQueryString(baseRoutePath, queryString);
}

export function deriveIndexableRouteFromFilters(filters) {
  const normalizedFilters = normalizeFilters(filters);
  const blockingFilterActive =
    Boolean(normalizedFilters.search) ||
    Boolean(normalizedFilters.savedOnly) ||
    normalizedFilters.level !== "all" ||
    normalizedFilters.affiliation !== "all";

  const routeEntries = [
    ["province", normalizedFilters.province],
    ["district", normalizedFilters.district],
    ["type", normalizedFilters.type],
    ["field", normalizedFilters.field],
  ].filter(([, value]) => value !== "all");

  if (blockingFilterActive || routeEntries.length !== 1) {
    return createHomeRoute();
  }

  const [listingKey, rawValue] = routeEntries[0];
  return {
    pageType: listingKey,
    selectedSlug: "",
    listingKey,
    listingSlug: normalizeRouteSlug(rawValue),
    legacyHash: false,
  };
}

export function resolveFiltersFromRoute(route, businesses, search = "") {
  const nextFilters = cloneDefaultFilters();
  if (route && route.pageType !== "detail" && route.pageType !== "directory") {
    const routeValue = findFilterValue(route.listingKey, route.listingSlug, businesses);
    if (routeValue) {
      nextFilters[route.listingKey] = routeValue;
    }
  }

  return applyQueryFilters(nextFilters, search, businesses);
}

export function buildCanonicalUrl(siteOrigin, path) {
  return new URL(normalizeCanonicalPath(path), normalizeSiteOrigin(siteOrigin)).toString();
}

export function normalizeCanonicalPath(value) {
  const normalized = String(value || "/")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  if (!normalized) {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function buildPageSeoData({
  siteName = DEFAULT_SITE_NAME,
  siteOrigin = DEFAULT_SITE_ORIGIN,
  pagePath = "/",
  route = createHomeRoute(),
  selectedBusiness = null,
  filters = cloneDefaultFilters(),
  filteredBusinessCount = 0,
  totalBusinessCount = 0,
}) {
  const canonicalUrl = buildCanonicalUrl(siteOrigin, pagePath);
  const safeSiteName = String(siteName || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;
  const safeTotalCount = Number.isFinite(Number(totalBusinessCount)) ? Number(totalBusinessCount) : 0;
  const safeFilteredCount = Number.isFinite(Number(filteredBusinessCount))
    ? Number(filteredBusinessCount)
    : 0;

  if (selectedBusiness) {
    const title = [
      selectedBusiness.name,
      buildBusinessTitleSuffix(selectedBusiness),
      safeSiteName,
    ]
      .filter(Boolean)
      .join(" | ");
    const description = truncateDescription(
      selectedBusiness.description ||
        `${selectedBusiness.name} is a ${selectedBusiness.type || "educational institute"} in ${
          [selectedBusiness.district, selectedBusiness.province_name, DEFAULT_COUNTRY]
            .filter(Boolean)
            .join(", ")
        }. Explore programs, facilities, contact details, photos, videos, map location, and admission-ready profile details on ${safeSiteName}.`
    );

    return {
      title,
      description,
      canonicalUrl,
      robots: "index,follow",
      image: selectedBusiness.cover || selectedBusiness.logo || "",
    };
  }

  const normalizedFilters = normalizeFilters(filters);
  const routeSeo = {
    province: {
      label: normalizedFilters.province,
      noun: "educational institutes",
    },
    district: {
      label: normalizedFilters.district,
      noun: "educational institutes",
    },
    type: {
      label: normalizedFilters.type,
      noun: "institutes",
    },
    field: {
      label: normalizedFilters.field,
      noun: "educational institutes",
    },
  }[route.pageType];

  if (routeSeo && routeSeo.label && routeSeo.label !== "all") {
    const title =
      route.pageType === "type"
        ? `${routeSeo.label} in Nepal | ${safeSiteName}`
        : route.pageType === "field"
          ? `${routeSeo.label} Institutes in Nepal | ${safeSiteName}`
          : `Educational Institutes in ${routeSeo.label}, Nepal | ${safeSiteName}`;
    const description = truncateDescription(
      `Browse ${safeFilteredCount || safeTotalCount} ${routeSeo.noun} ${
        route.pageType === "type"
          ? `for ${routeSeo.label} in ${DEFAULT_COUNTRY}`
          : route.pageType === "field"
            ? `focused on ${routeSeo.label} in ${DEFAULT_COUNTRY}`
            : `in ${routeSeo.label}, ${DEFAULT_COUNTRY}`
      }. Compare programs, affiliation, contact details, photos, videos, facilities, and maps on ${safeSiteName}.`
    );

    return {
      title,
      description,
      canonicalUrl,
      robots: "index,follow",
      image: "",
    };
  }

  const nonIndexableFiltersActive =
    Boolean(normalizedFilters.search) ||
    Boolean(normalizedFilters.savedOnly) ||
    normalizedFilters.level !== "all" ||
    normalizedFilters.affiliation !== "all" ||
    activeFilterCount(normalizedFilters) > 1;

  if (nonIndexableFiltersActive) {
    return {
      title: `Filtered Educational Institutes in Nepal | ${safeSiteName}`,
      description: truncateDescription(
        `Filter schools, colleges, universities, technical institutes, and training centers across ${DEFAULT_COUNTRY} on ${safeSiteName}.`
      ),
      canonicalUrl,
      robots: "noindex,follow",
      image: "",
    };
  }

  return {
    title: `${safeSiteName} | Nepal Educational Directory`,
    description: truncateDescription(DEFAULT_SITE_DESCRIPTION),
    canonicalUrl,
    robots: "index,follow",
    image: "",
  };
}

export function buildStructuredData({
  siteName = DEFAULT_SITE_NAME,
  siteOrigin = DEFAULT_SITE_ORIGIN,
  basePath = "/",
  pagePath = "/",
  route = createHomeRoute(),
  selectedBusiness = null,
  filters = cloneDefaultFilters(),
}) {
  const canonicalUrl = buildCanonicalUrl(siteOrigin, pagePath);
  const homeUrl = buildCanonicalUrl(siteOrigin, buildHomePath(basePath));
  const items = [];

  if (selectedBusiness) {
    const breadcrumbItems = [
      {
        "@type": "ListItem",
        position: 1,
        name: siteName,
        item: homeUrl,
      },
    ];

    if (selectedBusiness.province_name) {
      breadcrumbItems.push({
        "@type": "ListItem",
        position: 2,
        name: `${selectedBusiness.province_name} institutes`,
        item: buildCanonicalUrl(
          siteOrigin,
          buildCollectionPath("province", selectedBusiness.province_name, basePath)
        ),
      });
    }

    breadcrumbItems.push({
      "@type": "ListItem",
      position: breadcrumbItems.length + 1,
      name: selectedBusiness.name,
      item: canonicalUrl,
    });

    items.push({
      "@context": "https://schema.org",
      "@type": inferOrganizationType(selectedBusiness),
      name: selectedBusiness.name,
      description: selectedBusiness.description || undefined,
      url: canonicalUrl,
      image: collectBusinessImages(selectedBusiness),
      email: normalizeString(selectedBusiness.contact?.email),
      telephone: firstString(selectedBusiness.contact?.phone),
      sameAs: collectBusinessLinks(selectedBusiness),
      address: buildPostalAddress(selectedBusiness),
    });

    items.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems,
    });

    return items;
  }

  const normalizedFilters = normalizeFilters(filters);
  const simpleRoute = route.pageType !== "directory" && route.pageType !== "detail";

  items.push({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteName,
    url: homeUrl,
    description: DEFAULT_SITE_DESCRIPTION,
    areaServed: DEFAULT_COUNTRY,
  });

  items.push({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteName,
    url: homeUrl,
    description: DEFAULT_SITE_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${homeUrl}${homeUrl.includes("?") ? "&" : "?"}search={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  });

  if (simpleRoute) {
    const routeLabel = normalizedFilters[route.pageType];
    items.push({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${routeLabel} educational institutes`,
      url: canonicalUrl,
      description: buildPageSeoData({
        siteName,
        siteOrigin,
        pagePath,
        route,
        filters,
      }).description,
      isPartOf: {
        "@type": "WebSite",
        name: siteName,
        url: homeUrl,
      },
    });
  }

  return items;
}

export function buildLegacyRedirectPath(hash, basePath) {
  const route = parseLegacyHashRoute(hash);
  if (!route) {
    return "";
  }
  return route.pageType === "detail"
    ? buildBusinessPath(route.selectedSlug, basePath)
    : buildHomePath(basePath);
}

function parseLegacyHashRoute(hash) {
  const segments = String(hash || "")
    .replace(/^#\/?/, "")
    .split("/")
    .map((segment) => decodeURIComponent(segment || "").trim())
    .filter(Boolean);

  if (
    normalizeRouteSlug(segments[0]) === DEFAULT_COUNTRY_ROUTE &&
    normalizeText(segments[1]) === "institutions"
  ) {
    return {
      pageType: "detail",
      selectedSlug: normalizeRouteSlug(segments[2]),
      listingKey: "",
      listingSlug: "",
      legacyHash: true,
    };
  }

  if (normalizeText(segments[0]) === "institutions") {
    return {
      pageType: "detail",
      selectedSlug: normalizeRouteSlug(segments[1]),
      listingKey: "",
      listingSlug: "",
      legacyHash: true,
    };
  }

  return null;
}

function getRouteSegments(pathname, basePath) {
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedPathname = normalizeCanonicalPath(pathname).replace(/\/+$/, "/");
  const basePathPrefix = normalizedBasePath === "/" ? "/" : normalizedBasePath.slice(0, -1);

  let relativePath = normalizedPathname;
  if (basePathPrefix !== "/" && normalizedPathname.startsWith(basePathPrefix)) {
    relativePath = normalizedPathname.slice(basePathPrefix.length) || "/";
  }

  return relativePath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function appendBasePath(basePath, routePath) {
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedRoutePath = normalizeCanonicalPath(routePath);
  if (normalizedBasePath === "/") {
    return normalizedRoutePath;
  }
  return `${normalizedBasePath.replace(/\/$/, "")}${normalizedRoutePath}`;
}

function appendQueryString(path, queryString) {
  if (!queryString) {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}${queryString}`;
}

function normalizeFilters(filters) {
  return {
    search: String(filters?.search || "").trim(),
    type: String(filters?.type || "all").trim() || "all",
    field: String(filters?.field || "all").trim() || "all",
    level: String(filters?.level || "all").trim() || "all",
    province: String(filters?.province || "all").trim() || "all",
    district: String(filters?.district || "all").trim() || "all",
    affiliation: String(filters?.affiliation || "all").trim() || "all",
    savedOnly: Boolean(filters?.savedOnly),
  };
}

function deriveNavigableRouteFromFilters(filters) {
  const normalizedFilters = normalizeFilters(filters);
  const activeRouteEntry = ROUTE_QUERY_PRIORITY.map((routeKey) => [routeKey, normalizedFilters[routeKey]]).find(
    ([, value]) => value !== "all"
  );

  if (!activeRouteEntry) {
    return createHomeRoute();
  }

  const [listingKey, rawValue] = activeRouteEntry;
  return {
    pageType: listingKey,
    selectedSlug: "",
    listingKey,
    listingSlug: normalizeRouteSlug(rawValue),
    legacyHash: false,
  };
}

function buildFilterQueryString(filters, excludedRouteKey = "") {
  const normalizedFilters = normalizeFilters(filters);
  const params = new URLSearchParams();
  const excludedKeys = new Set([excludedRouteKey].filter(Boolean));

  if (normalizedFilters.search) {
    params.set("search", normalizedFilters.search);
  }

  if (normalizedFilters.savedOnly) {
    params.set("saved", "1");
  }

  for (const filterKey of FILTER_QUERY_KEYS) {
    if (excludedKeys.has(filterKey)) {
      continue;
    }

    const value = normalizedFilters[filterKey];
    if (value !== "all") {
      params.set(filterKey, value);
    }
  }

  return params.toString();
}

function applyQueryFilters(baseFilters, search, businesses) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (!params.size) {
    return baseFilters;
  }

  const nextFilters = {
    ...baseFilters,
  };

  if (params.has("search")) {
    nextFilters.search = String(params.get("search") || "").trim();
  }

  if (params.has("saved")) {
    nextFilters.savedOnly = parseBooleanParam(params.get("saved"));
  }

  for (const filterKey of FILTER_QUERY_KEYS) {
    if (!params.has(filterKey)) {
      continue;
    }

    const routeValue = findFilterValue(filterKey, params.get(filterKey), businesses);
    nextFilters[filterKey] = routeValue || "all";
  }

  if (nextFilters.province === "all") {
    nextFilters.district = "all";
  }

  return nextFilters;
}

function findFilterValue(filterKey, routeValue, businesses) {
  if (!filterKey || !routeValue) {
    return "";
  }

  const sourceValues =
    filterKey === "province"
      ? businesses.map((business) => business.province_name || business.province)
      : filterKey === "district"
        ? businesses.map((business) => business.district)
        : filterKey === "type"
          ? businesses.map((business) => business.type)
          : filterKey === "field"
            ? businesses.flatMap((business) => business.field || [])
            : filterKey === "level"
              ? businesses.flatMap((business) => business.level || [])
              : businesses.map((business) => business.affiliation);

  return [...new Set(sourceValues.map((value) => String(value || "").trim()).filter(Boolean))].find(
    (value) =>
      normalizeRouteSlug(value) === normalizeRouteSlug(routeValue) ||
      normalizeText(value) === normalizeText(routeValue)
  );
}

function parseBooleanParam(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function buildBusinessTitleSuffix(business) {
  const parts = [
    business.type,
    [business.district, business.province_name].filter(Boolean).join(", "),
  ].filter(Boolean);
  return parts.join(" in ");
}

function activeFilterCount(filters) {
  return ["type", "field", "level", "province", "district", "affiliation"].reduce(
    (count, key) => count + (filters[key] !== "all" ? 1 : 0),
    0
  );
}

function inferOrganizationType(business) {
  const typeLabel = normalizeText(business?.type);
  if (typeLabel.includes("school")) {
    return "School";
  }
  if (
    typeLabel.includes("college") ||
    typeLabel.includes("university") ||
    typeLabel.includes("polytechnic")
  ) {
    return "CollegeOrUniversity";
  }
  return "EducationalOrganization";
}

function buildPostalAddress(business) {
  const address = normalizeString(business?.contact?.address);
  const locality = normalizeString(business?.district);
  const region = normalizeString(business?.province_name);

  if (!address && !locality && !region) {
    return undefined;
  }

  return {
    "@type": "PostalAddress",
    streetAddress: address || undefined,
    addressLocality: locality || undefined,
    addressRegion: region || undefined,
    addressCountry: "NP",
  };
}

function collectBusinessImages(business) {
  const images = [
    business?.cover,
    business?.logo,
    business?.media?.cover,
    business?.media?.logo,
    ...(Array.isArray(business?.media?.gallery) ? business.media.gallery : []),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return images.length ? [...new Set(images)] : undefined;
}

function collectBusinessLinks(business) {
  const links = [
    business?.contact?.website,
    business?.social?.facebook,
    business?.social?.instagram,
    business?.social?.youtube,
    business?.social?.twitter,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return links.length ? [...new Set(links)] : undefined;
}

function truncateDescription(value, limit = 165) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function firstString(values) {
  return Array.isArray(values) ? values.map((value) => normalizeString(value)).find(Boolean) : undefined;
}
