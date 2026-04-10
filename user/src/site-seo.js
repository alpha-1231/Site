import {
  GENERATED_HOME_SEO_SECTIONS,
  GENERATED_PAGE_TYPE_KEYWORDS,
  GENERATED_SITE_DESCRIPTION,
  GENERATED_SITE_KEYWORDS,
} from "./seo-generated";

export const DEFAULT_COUNTRY = "Nepal";
export const DEFAULT_COUNTRY_ROUTE = "nepal";
export const DEFAULT_SITE_NAME = "AboutMySchool";
export const DEFAULT_SITE_ORIGIN = "https://www.aboutmyschool.com";
export const DIRECTORY_BRAND = DEFAULT_SITE_NAME;
export const DIRECTORY_TAGLINE = "Nepal's educational directory";
const FALLBACK_SITE_DESCRIPTION =
  "AboutMySchool is Nepal's educational directory for schools, colleges, universities, technical institutes, and training centers with searchable profiles, affiliations, facilities, maps, photos, videos, and contact details.";
const FALLBACK_SITE_KEYWORDS = Object.freeze([
  "AboutMySchool Nepal",
  "Nepal school directory",
  "Nepal college directory",
  "Nepal university directory",
  "Nepal education directory",
  "find schools in Nepal",
  "find colleges in Nepal",
  "school admission Nepal",
  "college admission Nepal",
  "विद्यालय खोज नेपाल",
  "कलेज खोज नेपाल",
  "नेपाल शिक्षा निर्देशिका",
]);
const FALLBACK_HOME_SEO_SECTIONS = Object.freeze([
  {
    title: "A complete education directory for Nepal",
    body:
      "AboutMySchool helps students, parents, teachers, and institutions discover educational institutes across Nepal with structured profiles that are easier to compare than scattered social media pages or outdated lists.",
  },
  {
    title: "Admission-ready profiles in one place",
    body:
      "Each profile can include programs, affiliation, facilities, location, phone numbers, email, website, photos, videos, and map information so families can shortlist institutions faster before they call or visit.",
  },
  {
    title: "Search by district, field, type, and affiliation",
    body:
      "The directory is built for fast filtering across provinces, districts, institute types, academic fields, education levels, and major affiliations such as TU, KU, PU, CTEVT, and NEB.",
  },
]);

export const DEFAULT_SITE_DESCRIPTION =
  String(GENERATED_SITE_DESCRIPTION || "").trim() || FALLBACK_SITE_DESCRIPTION;
export const DEFAULT_SITE_KEYWORDS = Object.freeze(
  Array.isArray(GENERATED_SITE_KEYWORDS) && GENERATED_SITE_KEYWORDS.length
    ? GENERATED_SITE_KEYWORDS
    : FALLBACK_SITE_KEYWORDS
);
export const DEFAULT_HOME_SEO_SECTIONS = Object.freeze(
  Array.isArray(GENERATED_HOME_SEO_SECTIONS) && GENERATED_HOME_SEO_SECTIONS.length
    ? GENERATED_HOME_SEO_SECTIONS
    : FALLBACK_HOME_SEO_SECTIONS
);

const PAGE_TYPE_KEYWORDS = Object.freeze({
  home: DEFAULT_SITE_KEYWORDS,
  province: resolveGeneratedKeywords("province"),
  district: resolveGeneratedKeywords("district"),
  type: resolveGeneratedKeywords("type"),
  field: resolveGeneratedKeywords("field"),
  detail: resolveGeneratedKeywords("detail"),
  affiliation: resolveGeneratedKeywords("affiliation"),
});

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
const SEO_TITLE_LIMIT = 60;
const SEO_DESCRIPTION_LIMIT = 150;

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

export function buildCanonicalPagePath({
  basePath = "/",
  route = createHomeRoute(),
  selectedBusiness = null,
  filters = cloneDefaultFilters(),
}) {
  if (selectedBusiness?.slug) {
    return buildBusinessPath(selectedBusiness.slug, basePath);
  }

  if (route?.pageType === "detail" && route?.selectedSlug) {
    return buildBusinessPath(route.selectedSlug, basePath);
  }

  const normalizedFilters = normalizeFilters(filters);
  const indexableRoute = deriveIndexableRouteFromFilters(normalizedFilters);
  if (indexableRoute.listingKey && normalizedFilters[indexableRoute.listingKey] !== "all") {
    return buildCollectionPath(
      indexableRoute.listingKey,
      normalizedFilters[indexableRoute.listingKey],
      basePath
    );
  }

  const fallbackRoute = deriveNavigableRouteFromFilters(normalizedFilters);
  if (fallbackRoute.listingKey && normalizedFilters[fallbackRoute.listingKey] !== "all") {
    return buildCollectionPath(
      fallbackRoute.listingKey,
      normalizedFilters[fallbackRoute.listingKey],
      basePath
    );
  }

  return buildHomePath(basePath);
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
  canonicalPath = "",
  route = createHomeRoute(),
  selectedBusiness = null,
  filters = cloneDefaultFilters(),
  filteredBusinessCount = 0,
  totalBusinessCount = 0,
}) {
  const canonicalUrl = buildCanonicalUrl(siteOrigin, canonicalPath || pagePath);
  const safeSiteName = String(siteName || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;
  const safeTotalCount = Number.isFinite(Number(totalBusinessCount)) ? Number(totalBusinessCount) : 0;
  const safeFilteredCount = Number.isFinite(Number(filteredBusinessCount))
    ? Number(filteredBusinessCount)
    : 0;
  const keywords = buildPageKeywords({ route, selectedBusiness, filters });

  if (selectedBusiness) {
    const title = buildBusinessSeoTitle(selectedBusiness, safeSiteName);
    const description = buildBusinessSeoDescription(selectedBusiness, safeSiteName);

    return {
      title,
      description,
      canonicalUrl,
      robots: "index,follow",
      image: selectedBusiness.cover || selectedBusiness.logo || "",
      keywords,
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
    const routeCount = safeFilteredCount || safeTotalCount;
    const title = buildCollectionSeoTitle(route.pageType, routeSeo.label, safeSiteName);
    const description = buildCollectionSeoDescription(
      route.pageType,
      routeSeo.label,
      routeCount,
      safeSiteName
    );

    return {
      title,
      description,
      canonicalUrl,
      robots: "index,follow",
      image: "",
      keywords,
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
      title: composeSeoTitle("Filtered Institutes in Nepal", safeSiteName),
      description: truncateDescription(
        `Filter schools, colleges, universities, and training centers across ${DEFAULT_COUNTRY} on ${safeSiteName}.`,
        SEO_DESCRIPTION_LIMIT
      ),
      canonicalUrl,
      robots: "noindex,follow",
      image: "",
      keywords,
    };
  }

  return {
    title: `${safeSiteName} Nepal Directory`,
    description: buildHomeSeoDescription(safeSiteName),
    canonicalUrl,
    robots: "index,follow",
    image: "",
    keywords,
  };
}

export function buildStructuredData({
  siteName = DEFAULT_SITE_NAME,
  siteOrigin = DEFAULT_SITE_ORIGIN,
  basePath = "/",
  pagePath = "/",
  canonicalPath = "",
  route = createHomeRoute(),
  selectedBusiness = null,
  filters = cloneDefaultFilters(),
  filteredBusinessCount = 0,
}) {
  const canonicalUrl = buildCanonicalUrl(siteOrigin, canonicalPath || pagePath);
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
      name:
        route.pageType === "type"
          ? `${pluralizeLabel(routeLabel)} in ${DEFAULT_COUNTRY}`
          : route.pageType === "field"
            ? `${routeLabel} institutes in ${DEFAULT_COUNTRY}`
            : `${routeLabel} institutes`,
      url: canonicalUrl,
      description: buildPageSeoData({
        siteName,
        siteOrigin,
        pagePath,
        route,
        filters,
        filteredBusinessCount,
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

function buildBusinessSeoTitle(business, siteName) {
  return composeSeoTitle(business?.name || "Institution profile", siteName);
}

function buildBusinessSeoDescription(business, siteName) {
  const safeName = normalizeString(business?.name) || "This institution";
  const safeType = normalizeString(business?.type).toLowerCase() || "educational institute";
  const location = [business?.district, business?.province_name].filter(Boolean).join(", ");
  const lead = `${safeName} is a ${safeType}${location ? ` in ${location}` : ` in ${DEFAULT_COUNTRY}`}.`;
  const followUp = `View contacts, levels, facilities, photos, and map details on ${siteName}.`;
  return truncateDescription(`${lead} ${followUp}`, SEO_DESCRIPTION_LIMIT);
}

function buildCollectionSeoTitle(routeType, label, siteName) {
  const safeLabel = normalizeString(label) || "Institutes";
  if (routeType === "type") {
    return composeSeoTitle(`${pluralizeLabel(safeLabel)} in Nepal`, siteName);
  }
  if (routeType === "field") {
    return composeSeoTitle(`${safeLabel} Institutes`, siteName);
  }
  return composeSeoTitle(`${safeLabel} Institutes`, siteName);
}

function buildCollectionSeoDescription(routeType, label, count, siteName) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  const listingLabel = `${safeCount} ${safeCount === 1 ? "listing" : "listings"}`;
  const safeLabel = normalizeString(label) || "Nepal";

  if (routeType === "type") {
    return truncateDescription(
      `Browse ${listingLabel} for ${pluralizeLabel(safeLabel).toLowerCase()} in Nepal. View contacts, programs, facilities, photos, and maps on ${siteName}.`,
      SEO_DESCRIPTION_LIMIT
    );
  }

  if (routeType === "field") {
    return truncateDescription(
      `Browse ${listingLabel} for ${safeLabel.toLowerCase()} institutes in Nepal. View contacts, programs, facilities, photos, and maps on ${siteName}.`,
      SEO_DESCRIPTION_LIMIT
    );
  }

  return truncateDescription(
    `Browse ${listingLabel} for institutes in ${safeLabel}, Nepal. View contacts, programs, facilities, photos, and maps on ${siteName}.`,
    SEO_DESCRIPTION_LIMIT
  );
}

function buildHomeSeoDescription(siteName) {
  return truncateDescription(
    `Find schools, colleges, universities, and training centers in Nepal with contacts, programs, facilities, photos, and maps on ${siteName}.`,
    SEO_DESCRIPTION_LIMIT
  );
}

function buildPageKeywords({ route, selectedBusiness, filters }) {
  const homeKeywords = PAGE_TYPE_KEYWORDS.home;

  if (selectedBusiness) {
    return mergeKeywords([
      selectedBusiness.name,
      `${selectedBusiness.name} Nepal`,
      selectedBusiness.type
        ? `${selectedBusiness.type} in ${selectedBusiness.district || DEFAULT_COUNTRY}`
        : "",
      selectedBusiness.affiliation
        ? `${selectedBusiness.affiliation} affiliated institute`
        : "",
      `${selectedBusiness.name} contact`,
      `${selectedBusiness.name} admission`,
      ...PAGE_TYPE_KEYWORDS.detail,
      ...PAGE_TYPE_KEYWORDS.affiliation.slice(0, 4),
      ...homeKeywords.slice(0, 6),
    ]);
  }

  if (route?.pageType && route.pageType !== "directory" && route.pageType !== "detail") {
    const routeLabel = String(filters?.[route.pageType] || "").trim();
    const pageKeywords =
      PAGE_TYPE_KEYWORDS[route.pageType] || PAGE_TYPE_KEYWORDS.home;

    return mergeKeywords([
      buildRouteKeyword(route.pageType, routeLabel, "primary"),
      buildRouteKeyword(route.pageType, routeLabel, "secondary"),
      buildRouteKeyword(route.pageType, routeLabel, "tertiary"),
      route.pageType === "province" || route.pageType === "district"
        ? `${routeLabel} educational institutes`
        : "",
      route.pageType === "province" || route.pageType === "district"
        ? `${routeLabel} education directory`
        : "",
      ...pageKeywords,
      ...homeKeywords.slice(0, 4),
    ]);
  }

  return mergeKeywords(homeKeywords);
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

function truncateDescription(value, limit = SEO_DESCRIPTION_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) {
    return text;
  }
  const clipped = text.slice(0, Math.max(0, limit - 1));
  const boundary = clipped.lastIndexOf(" ");
  const safeClip = boundary > limit * 0.55 ? clipped.slice(0, boundary) : clipped;
  return `${safeClip.trimEnd()}…`;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function firstString(values) {
  return Array.isArray(values) ? values.map((value) => normalizeString(value)).find(Boolean) : undefined;
}

function buildRouteKeyword(routeType, label, variant) {
  const safeLabel = String(label || "").trim();
  if (!safeLabel) {
    return "";
  }

  if (routeType === "type") {
    return variant === "primary"
      ? `${safeLabel} in Nepal`
      : variant === "secondary"
        ? `${safeLabel} directory Nepal`
        : `${safeLabel} colleges Nepal`;
  }

  if (routeType === "field") {
    return variant === "primary"
      ? `${safeLabel} institutes Nepal`
      : variant === "secondary"
        ? `${safeLabel} college Nepal`
        : `${safeLabel} education Nepal`;
  }

  return variant === "primary"
    ? `schools in ${safeLabel}`
    : variant === "secondary"
      ? `colleges in ${safeLabel}`
      : `education directory ${safeLabel}`;
}

function mergeKeywords(items, limit = 18) {
  return [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))].slice(
    0,
    limit
  );
}

function composeSeoTitle(primary, siteName, limit = SEO_TITLE_LIMIT) {
  const safePrimary = normalizeString(primary) || siteName;
  const safeSiteName = normalizeString(siteName) || DEFAULT_SITE_NAME;
  const suffix = ` | ${safeSiteName}`;

  if (`${safePrimary}${suffix}`.length <= limit) {
    return `${safePrimary}${suffix}`;
  }

  const available = Math.max(12, limit - suffix.length - 1);
  return `${truncateText(safePrimary, available)}${suffix}`;
}

function truncateText(value, limit) {
  const text = normalizeString(value);
  if (text.length <= limit) {
    return text;
  }

  const clipped = text.slice(0, Math.max(0, limit - 1));
  const boundary = clipped.lastIndexOf(" ");
  const safeClip = boundary > limit * 0.55 ? clipped.slice(0, boundary) : clipped;
  return `${safeClip.trimEnd()}…`;
}

function pluralizeLabel(label) {
  const safeLabel = normalizeString(label);
  if (!safeLabel) {
    return "Institutes";
  }

  if (/school$/i.test(safeLabel)) {
    return safeLabel.replace(/school$/i, "Schools");
  }

  if (/college$/i.test(safeLabel)) {
    return safeLabel.replace(/college$/i, "Colleges");
  }

  if (/university$/i.test(safeLabel)) {
    return safeLabel.replace(/university$/i, "Universities");
  }

  if (/institute$/i.test(safeLabel)) {
    return safeLabel.replace(/institute$/i, "Institutes");
  }

  if (/s$/i.test(safeLabel)) {
    return safeLabel;
  }

  return `${safeLabel}s`;
}

function resolveGeneratedKeywords(key) {
  const values = GENERATED_PAGE_TYPE_KEYWORDS?.[key];
  return Array.isArray(values) && values.length ? values : [];
}
