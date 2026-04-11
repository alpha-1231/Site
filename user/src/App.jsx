import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import {
  fetchBusinessDetail,
  fetchBusinessDirectory,
  fetchBusinessListStatus,
} from "./data-source";
import {
  DEFAULT_COUNTRY,
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_ORIGIN,
  DIRECTORY_BRAND,
  DIRECTORY_TAGLINE,
  buildBusinessPath,
  buildCanonicalPagePath,
  buildCollectionPath,
  buildListingUrl,
  buildPageSeoData,
  buildStructuredData,
  buildLegacyRedirectPath,
  cloneDefaultFilters,
  deriveIndexableRouteFromFilters,
  normalizeBasePath,
  normalizeSiteOrigin,
  normalizeText,
  parseLocationRoute,
  resolveFiltersFromRoute,
} from "./site-seo";
import nepalFlagAnimation from "./assets/flag/animations/Nepal_Flag.json?url";

const BASIC_CACHE_KEY = "edudata-user-basic-v6";
const SAVED_CACHE_KEY = "edudata-user-saved-v1";
const LOCALE_STORAGE_KEY = "aboutmyschool-user-locale-v1";
const RESULTS_PAGE_SIZE = 100;
const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL || "/");
const SITE_NAME = String(import.meta.env.VITE_SITE_NAME || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;
const SITE_ORIGIN = normalizeSiteOrigin(import.meta.env.VITE_SITE_ORIGIN || DEFAULT_SITE_ORIGIN);
const SUPPORT_PHONE = String(import.meta.env.VITE_SUPPORT_PHONE || "").trim();
const SUPPORT_EMAIL = String(import.meta.env.VITE_SUPPORT_EMAIL || "").trim();
const SITE_SOCIAL_LINKS = Object.freeze({
  youtube: String(import.meta.env.VITE_SOCIAL_YOUTUBE || "").trim(),
  instagram: String(import.meta.env.VITE_SOCIAL_INSTAGRAM || "").trim(),
  tiktok: String(import.meta.env.VITE_SOCIAL_TIKTOK || "").trim(),
  twitter: String(import.meta.env.VITE_SOCIAL_TWITTER || "").trim(),
  facebook: String(import.meta.env.VITE_SOCIAL_FACEBOOK || "").trim(),
});

export default function App() {
  const initialDirectoryCacheRef = useRef(null);
  const initialRouteAppliedRef = useRef(false);
  const resultsPaneRef = useRef(null);
  if (initialDirectoryCacheRef.current === null) {
    initialDirectoryCacheRef.current = readCacheEntry(BASIC_CACHE_KEY, "local");
  }

  const cachedBusinesses = Array.isArray(initialDirectoryCacheRef.current?.data)
    ? initialDirectoryCacheRef.current.data
    : [];
  const cachedDirectorySyncedAt = String(initialDirectoryCacheRef.current?.saved_at || "");
  const cachedDirectoryStatus = normalizeDirectoryCacheStatus(
    initialDirectoryCacheRef.current,
    cachedBusinesses.length
  );

  const [businesses, setBusinesses] = useState(cachedBusinesses);
  const [savedSlugs, setSavedSlugs] = useState(() => readCache(SAVED_CACHE_KEY, [], "local"));
  const [locale, setLocale] = useState(() => readPreferredLocale());
  const [selectedSlug, setSelectedSlug] = useState(() => getSelectedSlugFromLocation());
  const [activeFooterDialog, setActiveFooterDialog] = useState("");
  const [supportDraft, setSupportDraft] = useState({
    subject: "",
    message: "",
  });
  const [selectedBusinessDetail, setSelectedBusinessDetail] = useState(null);
  const [activeVideo, setActiveVideo] = useState(null);
  const [loading, setLoading] = useState(cachedBusinesses.length === 0);
  const [syncState, setSyncState] = useState(cachedBusinesses.length ? "checking" : "syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState(cachedDirectorySyncedAt);
  const [directoryStatus, setDirectoryStatus] = useState(cachedDirectoryStatus);
  const [errorMessage, setErrorMessage] = useState("");
  const [detailErrorMessage, setDetailErrorMessage] = useState("");
  const [detailLoadingSlug, setDetailLoadingSlug] = useState("");
  const [resultsPage, setResultsPage] = useState(1);
  const [filters, setFilters] = useState(() => cloneDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState(() => cloneDefaultFilters());
  const [filtersArePending, startFilterTransition] = useTransition();
  const [showSyncActivity, setShowSyncActivity] = useState(cachedBusinesses.length === 0);
  const refreshDirectory = useEffectEvent(async ({ forceRefresh = false, cancelledRef = null } = {}) => {
    const hasCachedBusinesses = businesses.length > 0;
    const currentDirectoryStatus = normalizeDirectoryCacheStatus(directoryStatus, businesses.length);
    setSyncState(forceRefresh || !hasCachedBusinesses ? "syncing" : "checking");

    try {
      let nextStatus = null;
      if (!forceRefresh && hasCachedBusinesses) {
        try {
          nextStatus = await fetchBusinessListStatus({ forceRefresh: false });
        } catch {
          if (!cancelledRef?.current) {
            setErrorMessage("");
          }
          return;
        }

        if (cancelledRef?.current) {
          return;
        }

        if (!hasDirectoryChanged(currentDirectoryStatus, nextStatus, businesses.length)) {
          setDirectoryStatus(normalizeDirectoryCacheStatus(nextStatus, businesses.length));
          setErrorMessage("");
          return;
        }
      }

      setSyncState("syncing");
      const payload = await fetchBusinessDirectory({
        forceRefresh: forceRefresh || !hasCachedBusinesses,
        status: nextStatus,
      });
      if (cancelledRef?.current) {
        return;
      }

      const syncedAt = new Date().toISOString();
      const nextDirectoryStatus = normalizeDirectoryCacheStatus(
        payload.status,
        payload.businesses.length
      );
      startTransition(() => {
        setBusinesses(payload.businesses);
      });
      writeCache(BASIC_CACHE_KEY, payload.businesses, "local", syncedAt, nextDirectoryStatus);
      setLastSyncedAt(syncedAt);
      setDirectoryStatus(nextDirectoryStatus);
      setErrorMessage("");
    } catch (error) {
      if (cancelledRef?.current) {
        return;
      }

      setErrorMessage(
        businesses.length
          ? "Live data is unavailable. Showing the last cached directory."
          : error.message || "Unable to load the directory."
      );
    } finally {
      if (!cancelledRef?.current) {
        setSyncState("idle");
        setLoading(false);
      }
    }
  });

  const syncRouteStateFromLocation = useEffectEvent(() => {
    const route = readCurrentRoute();
    if (
      businesses.length === 0 &&
      route.pageType !== "detail" &&
      route.pageType !== "directory"
    ) {
      return;
    }
    const nextFilters = resolveFiltersFromRoute(route, businesses, window.location.search);

    if (route.legacyHash) {
      const legacyRedirectPath = buildLegacyRedirectPath(window.location.hash, APP_BASE_PATH);
      if (legacyRedirectPath) {
        window.history.replaceState(null, "", legacyRedirectPath);
      }
    } else if (route.legacyCountryPath) {
      const replacementPath =
        route.pageType === "detail" && route.selectedSlug
          ? buildBusinessPath(route.selectedSlug, APP_BASE_PATH)
          : buildListingRoute(nextFilters);
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (replacementPath && currentUrl !== replacementPath) {
        window.history.replaceState(null, "", replacementPath);
      }
    }

    setActiveVideo(null);
    setSelectedBusinessDetail(null);
    setDetailErrorMessage("");
    setDetailLoadingSlug("");
    setResultsPage(1);

    startTransition(() => {
      setSelectedSlug(route.selectedSlug || "");
      setFilters(nextFilters);
      setAppliedFilters(nextFilters);
    });
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function handlePopState() {
      syncRouteStateFromLocation();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const cancelledRef = { current: false };
    refreshDirectory({ cancelledRef });

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (syncState === "syncing") {
      setShowSyncActivity(true);
      return undefined;
    }

    if (syncState === "checking") {
      const timerId = window.setTimeout(() => {
        setShowSyncActivity(true);
      }, 220);
      return () => {
        window.clearTimeout(timerId);
      };
    }

    setShowSyncActivity(false);
    return undefined;
  }, [syncState]);

  useEffect(() => {
    if (initialRouteAppliedRef.current) {
      return;
    }

    const currentRoute = readCurrentRoute();
    if (businesses.length === 0 && routeNeedsBusinessLookup(currentRoute, window.location.search)) {
      return;
    }

    initialRouteAppliedRef.current = true;
    syncRouteStateFromLocation();
  }, [businesses.length, syncRouteStateFromLocation]);

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedBusinessDetail(null);
      setDetailErrorMessage("");
      setDetailLoadingSlug("");
      return;
    }

    if (businesses.length && !businesses.some((business) => business.slug === selectedSlug)) {
      setSelectedBusinessDetail(null);
      setDetailErrorMessage("");
      syncBusinessRoute("", { replace: true });
      startTransition(() => {
        setSelectedSlug("");
      });
      return;
    }

    let cancelled = false;
    setSelectedBusinessDetail(null);
    setDetailErrorMessage("");
    setDetailLoadingSlug(selectedSlug);

    fetchBusinessDetail(selectedSlug)
      .then((detail) => {
        if (cancelled || !detail) {
          return;
        }

        setSelectedBusinessDetail(detail);
        setErrorMessage("");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSelectedBusinessDetail(null);
        setDetailErrorMessage(error.message || "Unable to load the selected business.");
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoadingSlug("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSlug, businesses]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    if (selectedSlug || activeVideo || activeFooterDialog) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = previousOverflow || "";
    }

    return () => {
      document.body.style.overflow = previousOverflow || "";
    };
  }, [selectedSlug, activeVideo, activeFooterDialog]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "ne" ? "ne" : "en";
    }

    writePreferredLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof document === "undefined" || (!selectedSlug && !activeVideo && !activeFooterDialog)) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (activeVideo) {
          setActiveVideo(null);
          return;
        }

        if (selectedSlug) {
          closeDetail();
          return;
        }

        if (activeFooterDialog) {
          setActiveFooterDialog("");
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSlug, activeVideo, activeFooterDialog]);

  const savedSlugSet = new Set(savedSlugs);
  const businessSlugSet = new Set(businesses.map((business) => business.slug));
  const deferredSearch = useDeferredValue(appliedFilters.search);
  const displayFilters =
    deferredSearch === appliedFilters.search
      ? appliedFilters
      : {
        ...appliedFilters,
        search: deferredSearch,
      };
  const appliedFilterCriteria = buildFilterCriteria(displayFilters);
  const filtersAreInSync = areDirectoryFiltersEqual(filters, appliedFilters);
  const showResultsUpdateHint = !filtersAreInSync || filtersArePending;
  const deferFilteredList = loading;
  let filteredBusinesses = [];
  if (!deferFilteredList) {
    filteredBusinesses = businesses.filter((business) =>
      matchesFilters(business, appliedFilterCriteria, savedSlugSet)
    );
  }
  const filteredBusinessCount = filteredBusinesses.length;
  const totalResultsPages = Math.max(1, Math.ceil(filteredBusinessCount / RESULTS_PAGE_SIZE));
  const currentResultsPage = Math.min(resultsPage, totalResultsPages);
  const pageStartIndex = (currentResultsPage - 1) * RESULTS_PAGE_SIZE;
  const pagedBusinesses = filteredBusinesses.slice(
    pageStartIndex,
    pageStartIndex + RESULTS_PAGE_SIZE
  );
  const syncStatusLabel =
    syncState === "syncing"
      ? t(locale, "updatingLocalCache")
      : syncState === "checking" && showSyncActivity
        ? t(locale, "checkingForUpdates")
        : lastSyncedAt
          ? t(locale, "cachedAt", { time: formatSyncTimestamp(lastSyncedAt, locale) })
          : t(locale, "readyToBrowse");
  const selectedBusinessSummary = selectedSlug
    ? businesses.find((business) => business.slug === selectedSlug) || null
    : null;
  const selectedBusiness = selectedSlug
    ? mergeBusinessSnapshot(selectedBusinessSummary, selectedBusinessDetail)
    : null;
  const selectedBusinessIsSaved = selectedBusiness ? savedSlugSet.has(selectedBusiness.slug) : false;
  const selectedBusinessCoverImage = selectedBusiness ? getPreferredCoverImage(selectedBusiness) : "";
  const detailIsLoading = detailLoadingSlug === selectedSlug;
  const provinceCount = uniqueValues(
    businesses.map((business) => business.province_name || business.province)
  ).length;
  const fieldCount = uniqueValues(businesses.flatMap((business) => business.field || [])).length;
  const savedCount = savedSlugs.reduce(
    (total, slug) => total + (businessSlugSet.has(slug) ? 1 : 0),
    0
  );
  const currentYear = new Date().getFullYear();
  const footerCacheLabel =
    syncState === "idle" && !lastSyncedAt
      ? t(locale, "cacheVisibleAfterSync")
      : lastSyncedAt
        ? t(locale, "basicListingsCached", {
          time: formatSyncTimestamp(lastSyncedAt, locale),
        })
        : `${syncStatusLabel}.`;
  const typeOptions = uniqueValues(businesses.map((business) => business.type));
  const fieldOptions = uniqueValues(businesses.flatMap((business) => business.field || []));
  const levelOptions = uniqueValues(businesses.flatMap((business) => business.level || []));
  const provinceOptions = uniqueValues(
    businesses.map((business) => business.province_name || business.province)
  );
  const affiliationOptions = uniqueValues(businesses.map((business) => business.affiliation));
  const districtOptions = uniqueValues(
    businesses
      .filter((business) =>
        filters.province === "all"
          ? true
          : (business.province_name || business.province) === filters.province
      )
      .map((business) => business.district)
  );
  const activeListingRoute = deriveIndexableRouteFromFilters(appliedFilters);
  const currentPagePath = selectedSlug
    ? buildBusinessPath(selectedSlug, APP_BASE_PATH)
    : buildListingRoute(appliedFilters);
  const currentSeoRoute = selectedSlug
    ? {
      pageType: "detail",
      selectedSlug,
      listingKey: "",
      listingSlug: "",
      legacyHash: false,
    }
    : activeListingRoute;
  const seoBusiness = selectedBusiness || selectedBusinessSummary || null;
  const canonicalPagePath = buildCanonicalPagePath({
    basePath: APP_BASE_PATH,
    route: currentSeoRoute,
    selectedBusiness: seoBusiness,
    filters: appliedFilters,
  });
  const pageSeo = buildPageSeoData({
    siteName: SITE_NAME,
    siteOrigin: SITE_ORIGIN,
    pagePath: currentPagePath,
    canonicalPath: canonicalPagePath,
    route: currentSeoRoute,
    selectedBusiness: seoBusiness,
    filters: appliedFilters,
    filteredBusinessCount,
    totalBusinessCount: businesses.length,
  });
  const structuredData = buildStructuredData({
    siteName: SITE_NAME,
    siteOrigin: SITE_ORIGIN,
    basePath: APP_BASE_PATH,
    pagePath: currentPagePath,
    canonicalPath: canonicalPagePath,
    route: currentSeoRoute,
    selectedBusiness: seoBusiness,
    filters: appliedFilters,
    filteredBusinessCount,
  });
  useEffect(() => {
    updateDocumentSeo(pageSeo, structuredData);
  }, [pageSeo, structuredData]);
  const isHomeRoute = currentSeoRoute.pageType === "directory" && !selectedSlug;
  const showHomeOverview = isHomeRoute && !hasActiveDirectoryFilters(filters);
  const pageContext = buildPageContext({
    locale,
    route: currentSeoRoute,
    selectedBusiness,
    filteredBusinesses,
    allBusinesses: businesses,
    filteredBusinessCount,
    totalBusinessCount: businesses.length,
    provinceCount,
    fieldCount,
  });
  const showTopQuickBrowse =
    currentSeoRoute.pageType !== "directory" && pageContext.browseSections.length > 0;
  const homeQuickFilters = isHomeRoute ? buildHomeQuickFilters(businesses, locale) : [];
  const showHomeQuickFilters = isHomeRoute && !hasActiveDirectoryFilters(filters) && homeQuickFilters.length > 0;
  const footerDialog = activeFooterDialog
    ? buildFooterDialogContent(activeFooterDialog, {
      locale,
      supportPhone: SUPPORT_PHONE,
      supportEmail: SUPPORT_EMAIL,
    })
    : null;

  function handleSelectBusiness(slug) {
    setSelectedBusinessDetail(null);
    setDetailErrorMessage("");
    syncBusinessRoute(slug, { replace: Boolean(selectedSlug) });
    startTransition(() => {
      setSelectedSlug(slug);
    });
    setErrorMessage("");
  }

  function closeDetail() {
    setActiveVideo(null);
    setSelectedBusinessDetail(null);
    setDetailErrorMessage("");
    syncBusinessRoute("", { replace: true, filters: appliedFilters });
    startTransition(() => {
      setSelectedSlug("");
    });
  }

  function handleFilterChange(key, value) {
    const next = mergeFilterPatch(filters, { [key]: value }, businesses);
    setFilters(next);
    setResultsPage(1);
    syncListingRoute(next, { replace: key === "search" });

    if (key === "search") {
      setAppliedFilters(next);
      return;
    }

    startFilterTransition(() => {
      setAppliedFilters(next);
    });
  }

  function resetFilters() {
    const nextFilters = cloneDefaultFilters();
    setFilters(nextFilters);
    setResultsPage(1);
    syncListingRoute(nextFilters);
    startFilterTransition(() => {
      setAppliedFilters(nextFilters);
    });
  }

  function scrollToToolbar() {
    if (typeof window === "undefined") {
      return;
    }

    const toolbar = document.querySelector(".toolbar");
    if (!toolbar) {
      return;
    }

    const nextTop = toolbar.getBoundingClientRect().top + window.scrollY - 16;
    window.scrollTo({
      top: Math.max(0, nextTop),
      behavior: "smooth",
    });
  }

  function handleBrowseDirectory() {
    scrollToToolbar();
  }

  function handleBrowseSavedInstitutes() {
    if (!filters.savedOnly) {
      handleFilterChange("savedOnly", true);
    }
    scrollToToolbar();
  }

  function scrollResultsToTop() {
    const pane = resultsPaneRef.current;
    if (!pane) {
      return;
    }
    const nextTop = pane.getBoundingClientRect().top + window.scrollY - 10;
    window.scrollTo({
      top: Math.max(0, nextTop),
      behavior: "smooth",
    });
  }

  function changeResultsPage(delta) {
    setResultsPage((current) => {
      const next = current + delta;
      const clamped = Math.max(1, Math.min(totalResultsPages, next));
      if (clamped !== current) {
        window.requestAnimationFrame(scrollResultsToTop);
      }
      return clamped;
    });
  }

  function toggleSavedBusiness(slug) {
    setSavedSlugs((current) => {
      const next = current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [slug, ...current.filter((item) => item !== slug)];
      writeCache(SAVED_CACHE_KEY, next, "local");
      return next;
    });
  }

  function handleOpenVideo(video) {
    setActiveVideo(video);
  }

  function handleHomeQuickFilterSelect(filterKey, value) {
    const nextFilters = cloneDefaultFilters();
    nextFilters[filterKey] = value;
    setFilters(nextFilters);
    setResultsPage(1);
    syncListingRoute(nextFilters);
    startFilterTransition(() => {
      setAppliedFilters(nextFilters);
    });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToToolbar);
    });
  }

  function handleRelatedFilterSelect(filterKey, value) {
    const nextFilters = mergeFilterPatch(filters, { [filterKey]: value }, businesses);
    setFilters(nextFilters);
    setResultsPage(1);
    syncListingRoute(nextFilters);
    startFilterTransition(() => {
      setAppliedFilters(nextFilters);
    });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollToToolbar);
    });
  }

  function handleFooterDialogOpen(dialogKey) {
    setActiveFooterDialog(dialogKey);
  }

  function handleFooterDialogClose() {
    setActiveFooterDialog("");
  }

  function handleSupportDraftChange(key, value) {
    setSupportDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <div className="app-frame">
        <section className="directory-intro glass-panel">
          <div className="directory-intro-copy">
            <p className="eyebrow">{pageContext.eyebrow}</p>
            <h1>{pageContext.title}</h1>
            <p>{pageContext.description}</p>
          </div>
          <HeaderHeroMotion />
        </section>

        <header className="topbar directory-ribbon glass-panel">
          <div className="directory-ribbon-brand">
            <div className="directory-ribbon-copy">
              <strong>aboutmyschool.com</strong>
              <span>{t(locale, "directoryTagline")}</span>
            </div>
          </div>
          <div className="directory-ribbon-actions">
            <div className="directory-ribbon-status" aria-label={t(locale, "directoryStatus")}>
              <span className="directory-ribbon-status-label">{t(locale, "status")}</span>
              <strong title={syncStatusLabel}>{syncStatusLabel}</strong>
            </div>
            <div className="locale-switch" role="group" aria-label={t(locale, "language")}>
              <button
                type="button"
                className={`locale-switch-button ${locale === "en" ? "active" : ""}`}
                onClick={() => setLocale("en")}
                aria-pressed={locale === "en"}
              >
                {t(locale, "english")}
              </button>
              <button
                type="button"
                className={`locale-switch-button ${locale === "ne" ? "active" : ""}`}
                onClick={() => setLocale("ne")}
                aria-pressed={locale === "ne"}
              >
                {t(locale, "nepali")}
              </button>
            </div>
          </div>
        </header>

        <section className="toolbar glass-panel">
          <div className="toolbar-head">
            <div className="search-wrap">
              <span className="search-hint">{t(locale, "search")}</span>
              <input
                className="search-input"
                type="search"
                value={filters.search}
                onChange={(event) => handleFilterChange("search", event.target.value)}
                placeholder={t(locale, "searchPlaceholder")}
              />
            </div>
            <div className="toolbar-actions">
              <button
                type="button"
                className={`saved-filter-button ${filters.savedOnly ? "active" : ""}`}
                onClick={() => handleFilterChange("savedOnly", !filters.savedOnly)}
                aria-pressed={filters.savedOnly}
                aria-label={
                  filters.savedOnly ? t(locale, "showAllInstitutes") : t(locale, "showSavedInstitutesOnly")
                }
                title={
                  filters.savedOnly ? t(locale, "showAllInstitutes") : t(locale, "showSavedInstitutesOnly")
                }
              >
                <span className="saved-filter-icon" aria-hidden="true">
                  {renderActionIcon("bookmark")}
                </span>
                <span className="saved-filter-copy">
                  <strong>{t(locale, "savedInstitutes")}</strong>
                  <small>
                    {savedCount
                      ? t(locale, "savedOnThisDevice", {
                        count: formatLocaleNumber(locale, savedCount),
                      })
                      : t(locale, "noSavedInstitutesYet")}
                  </small>
                </span>
              </button>

              <button
                className="ghost-button danger-button toolbar-reset-button"
                type="button"
                onClick={resetFilters}
                aria-label={t(locale, "resetFilters")}
                title={t(locale, "resetFilters")}
              >
                <span className="toolbar-action-icon" aria-hidden="true">
                  {renderActionIcon("reset")}
                </span>
                <span className="toolbar-action-label">{t(locale, "resetFilters")}</span>
              </button>
            </div>
          </div>

          <div className="toolbar-meta">
            <span>
              {showResultsUpdateHint
                ? t(locale, "updatingResults")
                : t(locale, "institutionsCount", {
                  count: formatLocaleNumber(locale, filteredBusinessCount),
                })}
            </span>
            <span>{t(locale, "savedCount", { count: formatLocaleNumber(locale, savedCount) })}</span>
            <span>{DEFAULT_COUNTRY}</span>
            <span>{t(locale, "provincesCount", { count: formatLocaleNumber(locale, provinceCount) })}</span>
            <span>{t(locale, "fieldsCount", { count: formatLocaleNumber(locale, fieldCount) })}</span>
            <span>{syncStatusLabel}</span>
          </div>

          <div className="filter-grid">
            <FilterSelect
              label={t(locale, "type")}
              value={filters.type}
              onChange={(nextValue) => handleFilterChange("type", nextValue)}
              options={typeOptions}
              emptyLabel={t(locale, "allTypes")}
              selectedLabel={t(locale, "selected")}
            />
            <FilterSelect
              label={t(locale, "field")}
              value={filters.field}
              onChange={(nextValue) => handleFilterChange("field", nextValue)}
              options={fieldOptions}
              emptyLabel={t(locale, "allFields")}
              selectedLabel={t(locale, "selected")}
            />
            <FilterSelect
              label={t(locale, "level")}
              value={filters.level}
              onChange={(nextValue) => handleFilterChange("level", nextValue)}
              options={levelOptions}
              emptyLabel={t(locale, "allLevels")}
              selectedLabel={t(locale, "selected")}
            />
            <FilterSelect
              label={t(locale, "province")}
              value={filters.province}
              onChange={(nextValue) => handleFilterChange("province", nextValue)}
              options={provinceOptions}
              emptyLabel={t(locale, "allProvinces")}
              selectedLabel={t(locale, "selected")}
            />
            <FilterSelect
              label={t(locale, "district")}
              value={filters.district}
              onChange={(nextValue) => handleFilterChange("district", nextValue)}
              options={districtOptions}
              emptyLabel={t(locale, "allDistricts")}
              selectedLabel={t(locale, "selected")}
            />
            <FilterSelect
              label={t(locale, "affiliation")}
              value={filters.affiliation}
              onChange={(nextValue) => handleFilterChange("affiliation", nextValue)}
              options={affiliationOptions}
              emptyLabel={t(locale, "allAffiliations")}
              selectedLabel={t(locale, "selected")}
            />
          </div>
        </section>

        {errorMessage ? <div className="status-banner">{errorMessage}</div> : null}

        <section className="page-context-grid">
          {showHomeOverview ? (
            <section className="page-context-panel glass-panel home-page-context">
              <div className="page-context-head">
                <div>
                  <p className="eyebrow">{t(locale, "pageOverview")}</p>
                  <h2>{pageContext.overviewTitle}</h2>
                </div>
              </div>
              <div className="page-context-copy">
                {pageContext.overviewParagraphs.slice(0, 2).map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <div className="page-context-facts">
                {pageContext.statItems.map((item) => (
                  <div key={`${item.label}:${item.value}`} className="page-context-fact">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {showTopQuickBrowse ? (
            <section className="related-filter-wrap glass-panel">
              <div className="related-filter-wrap-head">
                <p className="eyebrow">{t(locale, "browseQuickly")}</p>
                <h3>{t(locale, "browseQuicklyTitle")}</h3>
              </div>
              <div className="related-filter-bar" role="toolbar" aria-label={t(locale, "browseQuickly")}>
                {pageContext.browseSections.map((section) => (
                  <RelatedFilterSection
                    key={`${section.filterKey}:${section.title}`}
                    locale={locale}
                    section={section}
                    filters={filters}
                    onSelect={handleRelatedFilterSelect}
                  />
                ))}
              </div>
            </section>
          ) : null}

        </section>

        <main className="content-grid">
          <section ref={resultsPaneRef} className={`results-pane ${showResultsUpdateHint ? "is-filtering" : ""}`}>
            {loading ? (
              <div className="card-grid">
                {Array.from({ length: 6 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : null}
            {pagedBusinesses.length ? (
              <>
                <div className="card-grid">
                  {pagedBusinesses.map((business) => (
                    <BusinessCard
                      key={business.slug}
                      business={business}
                      locale={locale}
                      isSelected={business.slug === selectedSlug}
                      isSaved={savedSlugSet.has(business.slug)}
                      onSelect={handleSelectBusiness}
                      onToggleSaved={toggleSavedBusiness}
                    />
                  ))}
                </div>
                {totalResultsPages > 1 ? (
                  <div className="results-pagination glass-panel">
                    <button
                      type="button"
                      className="ghost-button pagination-button"
                      onClick={() => changeResultsPage(-1)}
                      disabled={currentResultsPage === 1}
                    >
                      {t(locale, "previous")}
                    </button>
                    <div className="results-pagination-copy">
                      {t(locale, "paginationSummary", {
                        start: formatLocaleNumber(locale, pageStartIndex + 1),
                        end: formatLocaleNumber(locale, pageStartIndex + pagedBusinesses.length),
                        total: formatLocaleNumber(locale, filteredBusinessCount),
                        page: formatLocaleNumber(locale, currentResultsPage),
                        pages: formatLocaleNumber(locale, totalResultsPages),
                      })}
                    </div>
                    <button
                      type="button"
                      className="ghost-button pagination-button"
                      onClick={() => changeResultsPage(1)}
                      disabled={currentResultsPage === totalResultsPages}
                    >
                      {t(locale, "next")}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-panel glass-panel">
                <h2>
                  {filters.savedOnly
                    ? t(locale, "noSavedResultsTitle")
                    : t(locale, "noResultsTitle")}
                </h2>
                <p>
                  {filters.savedOnly
                    ? t(locale, "noSavedResultsBody")
                    : t(locale, "noResultsBody")}
                </p>
              </div>
            )}
          </section>
        </main>

        {showHomeQuickFilters ? (
          <HomeQuickFilterBar
            locale={locale}
            items={homeQuickFilters}
            filters={filters}
            onSelect={handleHomeQuickFilterSelect}
          />
        ) : null}

        <footer className="app-footer glass-panel">
          <div className="app-footer-main">
            <div className="app-footer-brand">
              <div className="app-footer-brand-row">
                <div className="app-footer-mark" aria-hidden="true">
                  {renderActionIcon("institution")}
                </div>
                <div className="app-footer-copy">
                  <strong>{DIRECTORY_BRAND}</strong>
                  <p>{t(locale, "directoryTagline")}</p>
                </div>
              </div>
              <p className="app-footer-note">
                {t(locale, "footerNote")}
              </p>
            </div>

            <div className="app-footer-column">
              <span className="app-footer-heading">{t(locale, "aboutSection")}</span>
              <div className="app-footer-links">
                <button
                  type="button"
                  className="footer-link-button compact"
                  onClick={() => handleFooterDialogOpen("about")}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("about")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>{t(locale, "aboutLink")}</strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="footer-link-button compact"
                  onClick={() => handleFooterDialogOpen("contact")}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("email")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>{t(locale, "contactUsLink")}</strong>
                  </span>
                </button>
              </div>
            </div>

            <div className="app-footer-column">
              <span className="app-footer-heading">{t(locale, "supportSection")}</span>
              <div className="app-footer-links">
                <button
                  type="button"
                  className="footer-link-button compact"
                  onClick={() => handleFooterDialogOpen("support")}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("help")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>{t(locale, "helpFaqLink")}</strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="footer-link-button compact"
                  onClick={() => handleFooterDialogOpen("pricing")}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("pricing")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>{t(locale, "purchaseLink")}</strong>
                  </span>
                </button>
              </div>
            </div>

            <div className="app-footer-column">
              <span className="app-footer-heading">{t(locale, "legalSection")}</span>
              <div className="app-footer-links">
                <button
                  type="button"
                  className="footer-link-button compact"
                  onClick={() => handleFooterDialogOpen("privacy")}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("shield")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>{t(locale, "privacyLink")}</strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="footer-link-button compact"
                  onClick={() => handleFooterDialogOpen("copyright")}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("copyright")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>{t(locale, "copyrightLink")}</strong>
                  </span>
                </button>
              </div>
            </div>

            <div className="app-footer-column">
              <span className="app-footer-heading">{t(locale, "socialSection")}</span>
              <div className="footer-social-links">
                <FooterSocialLink href={SITE_SOCIAL_LINKS.youtube} label="YouTube" icon="youtube" />
                <FooterSocialLink href={SITE_SOCIAL_LINKS.instagram} label="Instagram" icon="instagram" />
                <FooterSocialLink href={SITE_SOCIAL_LINKS.tiktok} label="TikTok" icon="tiktok" />
                <FooterSocialLink href={SITE_SOCIAL_LINKS.twitter} label="X" icon="twitter" />
                <FooterSocialLink href={SITE_SOCIAL_LINKS.facebook} label="Facebook" icon="facebook" />
              </div>
            </div>
          </div>

          <div className="app-footer-legal">
            <span>
              &copy; {currentYear} {DIRECTORY_BRAND}. {t(locale, "allRightsReserved")}
            </span>
            <span className="app-footer-country">
              <CountryFlagIcon countryName={DEFAULT_COUNTRY} className="app-footer-country-flag" />
              <span>{t(locale, "publicInstitutionDirectory")}</span>
            </span>
            <span>
              {t(locale, "coverageSummary", {
                listings: formatLocaleNumber(locale, businesses.length),
                provinces: formatLocaleNumber(locale, provinceCount),
                fields: formatLocaleNumber(locale, fieldCount),
              })}
            </span>
            <span>{footerCacheLabel}</span>
          </div>
        </footer>

        {selectedBusiness ? (
          <aside className="detail-pane" role="dialog" aria-modal="true" aria-label={selectedBusiness.name}>
            <div className="detail-overlay" onClick={closeDetail} />
            <div className="detail-card glass-panel">
              <section
                className="detail-hero"
                style={{ background: buildGradient(selectedBusiness.slug) }}
              >
                {selectedBusinessCoverImage ? (
                  <img
                    className="detail-cover-image"
                    src={selectedBusinessCoverImage}
                    alt={`${selectedBusiness.name} cover`}
                  />
                ) : null}
                <div className="detail-hero-backdrop" />
                <button
                  type="button"
                  className="detail-back-button"
                  onClick={closeDetail}
                  aria-label={t(locale, "backToResults")}
                >
                  <span className="button-icon" aria-hidden="true">
                    {renderActionIcon("back")}
                  </span>
                  <span>{t(locale, "back")}</span>
                </button>
                <button
                  type="button"
                  className={`save-button detail-save-floating ${selectedBusinessIsSaved ? "saved" : ""}`}
                  onClick={() => toggleSavedBusiness(selectedBusiness.slug)}
                >
                  <span className="button-icon" aria-hidden="true">
                    {renderActionIcon("bookmark")}
                  </span>
                  <span>{selectedBusinessIsSaved ? t(locale, "saved") : t(locale, "save")}</span>
                </button>
              </section>

              <section className="detail-body">
                {detailIsLoading ? (
                  <div className="detail-loading">{t(locale, "loadingFullProfile")}</div>
                ) : null}
                {detailErrorMessage ? (
                  <div className="detail-loading detail-error">{detailErrorMessage}</div>
                ) : null}

                <header className="detail-summary">
                  <div className="detail-summary-main">
                    <div className="detail-logo">{getInitials(selectedBusiness.name)}</div>
                    <div className="detail-head-copy">
                      <h2>{selectedBusiness.name}</h2>
                      <p className="detail-location">{buildBusinessLocationLine(selectedBusiness)}</p>
                      <div className="detail-badges">
                        {selectedBusiness.type ? <span className="meta-badge">{selectedBusiness.type}</span> : null}
                        {isCertifiedBusiness(selectedBusiness) ? (
                          <span className="card-certified-badge detail-certified-badge">
                            <span className="card-certified-icon" aria-hidden="true">
                              ✓
                            </span>
                            <span>{t(locale, "certified")}</span>
                          </span>
                        ) : null}
                        {selectedBusiness.affiliation ? (
                          <span className="meta-badge subdued">{selectedBusiness.affiliation}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </header>

                <SectionBlock title={t(locale, "overview")}>
                  <p className="body-copy">
                    {buildReadableBusinessNarrative(locale, selectedBusiness)}
                  </p>
                  <div className="info-grid">
                    <InfoItem
                      label={t(locale, "affiliation")}
                      value={selectedBusiness.affiliation || t(locale, "notSet")}
                    />
                    <InfoItem
                      label={t(locale, "levels")}
                      value={formatArray(selectedBusiness.level) || t(locale, "notSet")}
                    />
                    <InfoItem
                      label={t(locale, "fields")}
                      value={formatArray(selectedBusiness.field) || t(locale, "notSet")}
                    />
                    <InfoItem
                      label={t(locale, "programs")}
                      value={String(
                        selectedBusiness.stats?.programs_count ||
                        selectedBusiness.programs?.length ||
                        0
                      )}
                    />
                  </div>
                </SectionBlock>

                <SectionBlock title={t(locale, "programs")}>
                  <TagList
                    items={selectedBusiness.programs}
                    emptyLabel={t(locale, "programsNotListed")}
                  />
                </SectionBlock>

                <SectionBlock title={t(locale, "facilities")}>
                  <TagList
                    items={selectedBusiness.facilities}
                    emptyLabel={t(locale, "facilitiesNotListed")}
                  />
                </SectionBlock>

                <SectionBlock title={t(locale, "location")}>
                  <BusinessLocationSection business={selectedBusiness} locale={locale} />
                </SectionBlock>

                <SectionBlock title={t(locale, "gallery")}>
                  <GallerySection items={selectedBusiness.media?.gallery} locale={locale} />
                </SectionBlock>

                <SectionBlock title={t(locale, "videos")}>
                  <VideoSection
                    items={selectedBusiness.media?.videos}
                    onOpenVideo={handleOpenVideo}
                    locale={locale}
                  />
                </SectionBlock>

                <SectionBlock title={t(locale, "contact")}>
                  <div className="contact-stack">
                    <InfoItem
                      label={t(locale, "address")}
                      value={selectedBusiness.contact?.address || t(locale, "addressNotSet")}
                    />
                    <InfoItem
                      label={t(locale, "phone")}
                      value={formatArray(selectedBusiness.contact?.phone) || t(locale, "phoneNotSet")}
                    />
                    <InfoItem
                      label={t(locale, "email")}
                      value={selectedBusiness.contact?.email || t(locale, "emailNotSet")}
                    />
                    <InfoItem
                      label={t(locale, "website")}
                      value={selectedBusiness.contact?.website || t(locale, "websiteNotSet")}
                    />
                  </div>
                  <div className="icon-action-row">
                    <IconActionLink
                      label={t(locale, "call")}
                      href={
                        getPrimaryPhone(selectedBusiness.contact?.phone)
                          ? `tel:${getPrimaryPhone(selectedBusiness.contact?.phone)}`
                          : ""
                      }
                      icon="phone"
                    />
                    <IconActionLink
                      label={t(locale, "email")}
                      href={
                        selectedBusiness.contact?.email
                          ? `mailto:${selectedBusiness.contact.email}`
                          : ""
                      }
                      icon="email"
                    />
                    <IconActionLink
                      label={t(locale, "website")}
                      href={
                        selectedBusiness.contact?.website
                          ? ensureUrl(selectedBusiness.contact.website)
                          : ""
                      }
                      icon="website"
                      external
                    />
                    <IconActionLink
                      label="Map"
                      href={getBusinessMapInfo(selectedBusiness)?.openUrl || ""}
                      icon="map"
                      external
                    />
                  </div>
                </SectionBlock>

                <SectionBlock title={t(locale, "social")}>
                  <div className="icon-action-row">
                    <IconActionLink
                      label="Facebook"
                      href={selectedBusiness.social?.facebook}
                      icon="facebook"
                      external
                    />
                    <IconActionLink
                      label="Instagram"
                      href={selectedBusiness.social?.instagram}
                      icon="instagram"
                      external
                    />
                    <IconActionLink
                      label="YouTube"
                      href={selectedBusiness.social?.youtube}
                      icon="youtube"
                      external
                    />
                    <IconActionLink
                      label="X"
                      href={selectedBusiness.social?.twitter}
                      icon="twitter"
                      external
                    />
                  </div>
                </SectionBlock>
              </section>
            </div>
          </aside>
        ) : null}
        {activeVideo ? (
          <div className="video-lightbox" role="dialog" aria-modal="true" aria-label={activeVideo.title}>
            <div className="video-lightbox-overlay" onClick={() => setActiveVideo(null)} />
            <div className="video-lightbox-card glass-panel">
              <button
                type="button"
                className="video-lightbox-close"
                onClick={() => setActiveVideo(null)}
              >
                Close
              </button>
              <div className="video-lightbox-head">
                <p className="eyebrow">{activeVideo.provider}</p>
                <h3>{activeVideo.title}</h3>
              </div>
              <div className="video-lightbox-player">
                {activeVideo.embedUrl ? (
                  <iframe
                    src={activeVideo.embedUrl}
                    title={activeVideo.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : activeVideo.isDirectVideo ? (
                  <video className="video-modal-player" controls autoPlay preload="metadata">
                    <source src={activeVideo.url} />
                  </video>
                ) : (
                  <div className="video-lightbox-fallback">
                    <p>{t(locale, "videoPopupUnavailable")}</p>
                    <a
                      href={activeVideo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="media-open-button"
                    >
                      {t(locale, "openSource")}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
        {footerDialog ? (
          <InfoDialog
            locale={locale}
            dialog={footerDialog}
            supportDraft={supportDraft}
            supportEmail={SUPPORT_EMAIL}
            supportPhone={SUPPORT_PHONE}
            onSupportDraftChange={handleSupportDraftChange}
            onClose={handleFooterDialogClose}
          />
        ) : null}
      </div>
    </div>
  );
}

function BusinessCard({ business, locale, isSelected, isSaved, onSelect, onToggleSaved }) {
  const coverImage = getPreferredCoverImage(business);
  const address = getBusinessCardAddress(business);
  const phone = getPrimaryPhone(business.contact?.phone);
  const email = String(business.contact?.email || "").trim();
  const website = String(business.contact?.website || "").trim();
  const isCertified = isCertifiedBusiness(business);
  const detailHref = buildBusinessPath(business.slug, APP_BASE_PATH);

  return (
    <article className={`business-card ${isSelected ? "selected" : ""}`}>
      <button
        type="button"
        className={`card-save-badge ${isSaved ? "saved" : ""}`}
        onClick={() => onToggleSaved(business.slug)}
        aria-label={
          isSaved
            ? t(locale, "removeFromSaved", { name: business.name })
            : t(locale, "saveBusiness", { name: business.name })
        }
        aria-pressed={isSaved}
      >
        {renderActionIcon("bookmark")}
      </button>
      <a
        href={detailHref}
        className="business-card-action"
        onClick={(event) => handleInternalRouteClick(event, () => onSelect(business.slug))}
      >
        <div className="card-cover" style={{ background: buildGradient(business.slug) }}>
          {isCertified ? (
            <span
              className="card-certified-dot"
              aria-label={t(locale, "physicallyCertified")}
              title={t(locale, "physicallyCertified")}
            />
          ) : null}
          {coverImage ? (
            <img
              className="card-cover-image"
              src={coverImage}
              alt={`${business.name} cover`}
              loading="lazy"
            />
          ) : null}
          <div className="card-cover-sheen" />
        </div>

        <div className="card-body card-body-compact">
          <div className="card-main">
            <h3 className="card-title card-title-large" title={business.name}>
              {business.name}
            </h3>
            <p className="card-address" title={address}>
              {address}
            </p>
          </div>
        </div>
      </a>

      <div className="card-actions">
        <a
          href={detailHref}
          className="card-link-button primary"
          onClick={(event) => handleInternalRouteClick(event, () => onSelect(business.slug))}
        >
          <span className="card-link-icon" aria-hidden="true">
            {renderActionIcon("open")}
          </span>
          <span>{t(locale, "open")}</span>
        </a>
        <CardActionLink label={t(locale, "call")} href={phone ? `tel:${phone}` : ""} icon="phone" />
        <CardActionLink label={t(locale, "email")} href={email ? `mailto:${email}` : ""} icon="email" />
        <CardActionLink
          label={t(locale, "website")}
          href={website ? ensureUrl(website) : ""}
          icon="website"
          external
        />
      </div>
    </article>
  );
}

function BrowseSection({ locale, title, description, links }) {
  if (!links.length) {
    return null;
  }

  return (
    <section className="homepage-panel glass-panel">
      <div className="homepage-panel-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="homepage-panel-stat">
          {t(locale, "pagesCount", { count: formatLocaleNumber(locale, links.length) })}
        </span>
      </div>
      <div className="browse-link-grid">
        {links.map((link) => (
          <a key={link.href} className="browse-link-card" href={link.href}>
            <span className="browse-link-copy">
              <strong>{link.label}</strong>
              <small>{link.description}</small>
            </span>
            <span className="browse-link-count">{link.count}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function HomeQuickFilterBar({ locale, items, filters, onSelect }) {
  const [openKey, setOpenKey] = useState("");

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        !event.target.closest?.(".quick-filter-item") &&
        !event.target.closest?.(".quick-filter-popup-card")
      ) {
        setOpenKey("");
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpenKey("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!items.length) {
    return null;
  }

  const activeItem = items.find((item) => item.key === openKey) || null;
  const activeSelectedValue = activeItem ? filters[activeItem.key] : "all";
  const activeSelectedOption = activeItem
    ? activeItem.options.find((option) => option.value === activeSelectedValue) ||
    (activeSelectedValue !== "all"
      ? {
        label: activeSelectedValue,
        value: activeSelectedValue,
      }
      : null)
    : null;

  return (
    <section className="home-quick-filters glass-panel">
      <div className="home-quick-filters-head">
        <div>
          <p className="eyebrow">{t(locale, "browseQuickly")}</p>
          <h3>{t(locale, "browseQuicklyTitle")}</h3>
        </div>
      </div>
      <div className="quick-filter-row" role="toolbar" aria-label={t(locale, "browseQuickly")}>
        {items.map((item) => {
          const selectedValue = filters[item.key];
          const selectedOption =
            item.options.find((option) => option.value === selectedValue) ||
            (selectedValue !== "all"
              ? {
                label: selectedValue,
                value: selectedValue,
              }
              : null);
          return (
            <div key={item.key} className="quick-filter-item">
              <button
                type="button"
                className={`quick-filter-trigger ${selectedValue !== "all" ? "selected" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={openKey === item.key}
                onClick={() => setOpenKey((current) => (current === item.key ? "" : item.key))}
              >
                <span className="quick-filter-trigger-copy">
                  <strong>{item.label}</strong>
                  <small>{selectedOption ? selectedOption.label : item.emptyLabel}</small>
                </span>
                <span className="quick-filter-chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {activeItem ? (
        <FilterPopupDialog
          locale={locale}
          kicker={t(locale, "browseQuickly")}
          title={activeItem.label}
          summary={activeSelectedOption ? activeSelectedOption.label : activeItem.emptyLabel}
          currentValue={activeSelectedValue}
          emptyLabel={activeItem.emptyLabel}
          options={activeItem.options}
          onClose={() => setOpenKey("")}
          onSelect={(value) => {
            onSelect(activeItem.key, value);
            setOpenKey("");
          }}
        />
      ) : null}
    </section>
  );
}

function RelatedFilterSection({ locale, section, filters, onSelect }) {
  const [open, setOpen] = useState(false);
  const selectedValue = filters[section.filterKey] || "all";
  const selectedOption =
    section.links.find((link) => link.value === selectedValue) ||
    (selectedValue !== "all"
      ? {
        label: selectedValue,
        value: selectedValue,
      }
      : null);

  return (
    <section className="related-filter-section">
      <button
        type="button"
        className={`related-filter-trigger ${selectedOption ? "selected" : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="quick-filter-trigger-copy">
          <strong>{section.filterLabel}</strong>
          <small>{selectedOption ? selectedOption.label : section.emptyLabel}</small>
        </span>
        <span className="quick-filter-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <FilterPopupDialog
          locale={locale}
          kicker={section.title}
          title={section.filterLabel}
          summary={selectedOption ? selectedOption.label : section.emptyLabel}
          currentValue={selectedValue}
          emptyLabel={section.emptyLabel}
          options={section.links}
          onClose={() => setOpen(false)}
          onSelect={(value) => {
            onSelect(section.filterKey, value);
            setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function HeaderHeroMotion() {
  return (
    <div className="directory-intro-motion" aria-hidden="true">
      <div className="intro-motion-shell">
        <DotLottieReact
          src={nepalFlagAnimation}
          loop
          autoplay
          className="intro-motion-lottie"
        />
      </div>
    </div>
  );
}

function FilterPopupDialog({
  locale,
  kicker,
  title,
  summary,
  currentValue,
  emptyLabel,
  options,
  onClose,
  onSelect,
}) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="quick-filter-popup" role="dialog" aria-modal="true" aria-label={title}>
      <div className="quick-filter-popup-overlay" onClick={onClose} />
      <div className="quick-filter-popup-card glass-panel">
        <div className="quick-filter-popup-head">
          <div>
            <p className="eyebrow">{kicker}</p>
            <h4>{title}</h4>
          </div>
          <button
            type="button"
            className="quick-filter-popup-close"
            onClick={onClose}
            aria-label={t(locale, "close")}
          >
            {renderActionIcon("close")}
          </button>
        </div>
        <p className="quick-filter-popup-summary">{summary}</p>
        <div className="quick-filter-popup-list" role="listbox" aria-label={title}>
          <button
            type="button"
            role="option"
            aria-selected={currentValue === "all"}
            className={`quick-filter-option ${currentValue === "all" ? "selected" : ""}`}
            onClick={() => onSelect("all")}
          >
            <span>{emptyLabel}</span>
          </button>
          {options.map((option) => (
            <button
              key={`${title}:${option.value}`}
              type="button"
              role="option"
              aria-selected={currentValue === option.value}
              className={`quick-filter-option ${currentValue === option.value ? "selected" : ""}`}
              onClick={() => onSelect(option.value)}
            >
              <span>{option.label}</span>
              <strong>{formatLocaleNumber(locale, option.count)}</strong>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function FooterSocialLink({ href, label, icon }) {
  if (!href) {
    return (
      <span className="footer-social-link disabled" aria-disabled="true" title={`${label} not configured`}>
        {renderActionIcon(icon)}
      </span>
    );
  }

  return (
    <a
      className="footer-social-link"
      href={normalizeActionHref(href)}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
    >
      {renderActionIcon(icon)}
    </a>
  );
}

function InfoDialog({
  locale,
  dialog,
  supportDraft,
  supportEmail,
  supportPhone,
  onSupportDraftChange,
  onClose,
}) {
  const supportHref = buildSupportMailtoUrl(supportEmail, supportDraft);

  return (
    <div className="info-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
      <div className="info-dialog-overlay" onClick={onClose} />
      <div className="info-dialog-card glass-panel">
        <button type="button" className="info-dialog-close" onClick={onClose} aria-label={t(locale, "close")}>
          {renderActionIcon("close")}
        </button>
        <div className="info-dialog-head">
          <p className="eyebrow">{dialog.kicker}</p>
          <h3>{dialog.title}</h3>
        </div>
        <div className="info-dialog-copy">
          {dialog.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {dialog.listItems.length ? (
          <ul className="info-dialog-list">
            {dialog.listItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {dialog.key === "contact" ? (
          <div className="info-dialog-actions">
            <a
              className={`info-dialog-action ${supportPhone ? "" : "disabled"}`}
              href={supportPhone ? `tel:${supportPhone}` : undefined}
              aria-disabled={!supportPhone}
            >
              {renderActionIcon("phone")}
              <span>{supportPhone || t(locale, "notConfigured")}</span>
            </a>
            <a
              className={`info-dialog-action ${supportEmail ? "" : "disabled"}`}
              href={supportEmail ? `mailto:${supportEmail}` : undefined}
              aria-disabled={!supportEmail}
            >
              {renderActionIcon("email")}
              <span>{supportEmail || t(locale, "notConfigured")}</span>
            </a>
          </div>
        ) : null}
        {dialog.key === "support" ? (
          <div className="support-form">
            <label className="support-form-field">
              <span>{t(locale, "supportSubject")}</span>
              <input
                type="text"
                value={supportDraft.subject}
                onChange={(event) => onSupportDraftChange("subject", event.target.value)}
                placeholder={t(locale, "supportSubjectPlaceholder")}
              />
            </label>
            <label className="support-form-field">
              <span>{t(locale, "supportMessage")}</span>
              <textarea
                rows="4"
                value={supportDraft.message}
                onChange={(event) => onSupportDraftChange("message", event.target.value)}
                placeholder={t(locale, "supportMessagePlaceholder")}
              />
            </label>
            <a
              className={`info-dialog-action primary ${supportHref ? "" : "disabled"}`}
              href={supportHref || undefined}
              aria-disabled={!supportHref}
            >
              {renderActionIcon("email")}
              <span>{t(locale, "emailSupport")}</span>
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CardActionLink({ label, href, external = false, icon }) {
  const resolvedHref = normalizeActionHref(href);
  const content = (
    <>
      {icon ? (
        <span className="card-link-icon" aria-hidden="true">
          {renderActionIcon(icon)}
        </span>
      ) : null}
      <span>{label}</span>
    </>
  );

  if (!resolvedHref) {
    return (
      <span className={`card-link-button ${icon || ""} disabled`} aria-disabled="true">
        {content}
      </span>
    );
  }

  return (
    <a
      className={`card-link-button ${icon || ""}`}
      href={external ? ensureUrl(resolvedHref) : resolvedHref}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {content}
    </a>
  );
}

function FilterSelect({ label, value, onChange, options, emptyLabel, selectedLabel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionList = [
    { value: "all", label: emptyLabel },
    ...options.map((option) => ({
      value: option,
      label: option,
    })),
  ];
  const selectedOption = optionList.find((option) => option.value === value) || optionList[0];

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleSelect(nextValue) {
    onChange(nextValue);
    setOpen(false);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        focusElementWithoutScroll(triggerRef.current);
      });
    }
  }

  return (
    <div className={`filter-select ${open ? "open" : ""}`} ref={rootRef}>
      <span>{label}</span>
      <div className="select-shell">
        <button
          ref={triggerRef}
          type="button"
          className={`select-trigger ${value === "all" ? "placeholder" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selectedOption.label}</span>
          <span className="select-chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        <div className={`select-menu ${open ? "open" : ""}`} role="listbox" aria-label={label}>
          {optionList.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={`select-option ${value === option.value ? "selected" : ""}`}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(option.value)}
            >
              <span>{option.label}</span>
              {value === option.value ? <strong>{selectedLabel}</strong> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TagList({ items, emptyLabel = "Nothing listed yet.", compact = false, limit = null }) {
  const cleanItems = uniqueValues(items || []);
  if (!cleanItems.length) {
    return <p className="muted">{emptyLabel}</p>;
  }

  const visibleItems = typeof limit === "number" ? cleanItems.slice(0, limit) : cleanItems;
  const remaining = cleanItems.length - visibleItems.length;

  return (
    <div className={`tag-list ${compact ? "compact" : ""}`}>
      {visibleItems.map((item) => (
        <span key={item} className="tag-pill">
          {item}
        </span>
      ))}
      {remaining > 0 ? <span className="tag-pill more-pill">+{remaining} more</span> : null}
    </div>
  );
}

function GallerySection({ items, locale }) {
  const galleryItems = normalizeMediaList(items);
  if (!galleryItems.length) {
    return <p className="muted">{t(locale, "noGalleryLinks")}</p>;
  }

  return (
    <div className="media-grid">
      {galleryItems.map((item) => {
        if (isDirectImageUrl(item)) {
          return (
            <div key={item} className="media-card image-card">
              <img src={ensureUrl(item)} alt="Business gallery preview" loading="lazy" />
              <div className="media-card-body">
                <strong>{t(locale, "image")}</strong>
                <span>{t(locale, "openFullImage")}</span>
                <a
                  className="media-open-button"
                  href={ensureUrl(item)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(locale, "openImage")}
                </a>
              </div>
            </div>
          );
        }

        return (
          <div key={item} className="media-card folder-card">
            <strong>{detectGalleryProvider(item)}</strong>
            <span>{describeGalleryLink(item)}</span>
            <a
              className="media-open-button"
              href={ensureUrl(item)}
              target="_blank"
              rel="noreferrer"
            >
              {t(locale, "openGallery")}
            </a>
          </div>
        );
      })}
    </div>
  );
}

function VideoSection({ items, onOpenVideo, locale }) {
  const videos = normalizeVideoEntries(items);
  if (!videos.length) {
    return <p className="muted">{t(locale, "noVideosYet")}</p>;
  }

  return (
    <div className="video-grid">
      {videos.map((video) => {
        return (
          <button
            key={video.raw}
            type="button"
            className="video-preview-card"
            onClick={() => onOpenVideo(video)}
          >
            <div className="video-preview-thumb">
              {video.thumbnail ? (
                <img src={video.thumbnail} alt={video.title} loading="lazy" />
              ) : (
                <div className="video-preview-fallback">
                  <span>{video.provider}</span>
                </div>
              )}
              <span className="video-play-badge">{t(locale, "play")}</span>
            </div>
            <div className="video-preview-body">
              <strong>{video.title}</strong>
              <span>{video.provider}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function IconActionLink({ label, href, icon, external = false }) {
  if (!href) {
    return null;
  }

  return (
    <a
      className={`icon-action-button ${icon || ""}`}
      href={normalizeActionHref(href)}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      aria-label={label}
      title={label}
    >
      <span className="icon-action-glyph" aria-hidden="true">
        {renderActionIcon(icon)}
      </span>
      <span>{label}</span>
    </a>
  );
}

function SectionBlock({ title, children }) {
  return (
    <section className="section-block">
      <div className="section-head">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function BusinessLocationSection({ business, locale }) {
  const mapInfo = getBusinessMapInfo(business);

  if (!mapInfo) {
    return <p className="muted">{t(locale, "noMapCoordinates")}</p>;
  }

  return (
    <div className="location-panel">
      <div className="location-map-shell">
        <iframe
          src={mapInfo.embedUrl}
          title={`${business.name} location map`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <div className="info-grid location-info-grid">
        <InfoItem
          label={t(locale, "coordinates")}
          value={`${formatCoordinate(mapInfo.lat)}, ${formatCoordinate(mapInfo.lng)}`}
        />
        <InfoItem
          label={t(locale, "coverageLabel")}
          value={business.location_label || business.district || t(locale, "locationNotSet")}
        />
      </div>
      <div className="icon-action-row location-actions">
        <IconActionLink label={t(locale, "openMap")} href={mapInfo.openUrl} icon="map" external />
      </div>
    </div>
  );
}

function InfoItem({ label, value }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="business-card skeleton-card">
      <div className="card-cover skeleton-block" />
      <div className="card-body">
        <div className="skeleton-line wide" />
        <div className="skeleton-line medium" />
        <div className="skeleton-line short" />
      </div>
    </div>
  );
}

function mergeBusinessSnapshot(summary, detail) {
  if (!summary && !detail) {
    return null;
  }

  return {
    ...(summary || {}),
    ...(detail || {}),
    contact: {
      ...(summary?.contact || {}),
      ...(detail?.contact || {}),
    },
    stats: {
      ...(summary?.stats || {}),
      ...(detail?.stats || {}),
    },
    media: {
      ...(summary?.media || {}),
      ...(detail?.media || {}),
    },
    social: {
      ...(summary?.social || {}),
      ...(detail?.social || {}),
    },
    programs: detail?.programs || summary?.programs || [],
    facilities: detail?.facilities || summary?.facilities || [],
    tags: detail?.tags || summary?.tags || [],
  };
}

function matchesFilters(business, criteria, savedSlugSet) {
  if (criteria.savedOnly && !savedSlugSet.has(business.slug)) {
    return false;
  }
  if (criteria.searchTerms.length) {
    const haystack = String(business.search_text || "").toLowerCase();
    if (!criteria.searchTerms.every((term) => haystack.includes(term))) {
      return false;
    }
  }
  if (criteria.type && (business.type_key || normalizeText(business.type)) !== criteria.type) {
    return false;
  }
  if (
    criteria.field &&
    !(business.field || []).some((value) => normalizeText(value) === criteria.field)
  ) {
    return false;
  }
  if (
    criteria.level &&
    !(business.level || []).some((value) => normalizeText(value) === criteria.level)
  ) {
    return false;
  }
  if (criteria.province && (business.province_key || normalizeText(business.province_name || business.province)) !== criteria.province) {
    return false;
  }
  if (criteria.district && (business.district_key || normalizeText(business.district)) !== criteria.district) {
    return false;
  }
  if (criteria.affiliation && (business.affiliation_key || normalizeText(business.affiliation)) !== criteria.affiliation) {
    return false;
  }

  return true;
}

function buildFilterCriteria(filters) {
  return {
    searchTerms: String(filters?.search || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
    type: filters?.type !== "all" ? normalizeText(filters?.type) : "",
    field: filters?.field !== "all" ? normalizeText(filters?.field) : "",
    level: filters?.level !== "all" ? normalizeText(filters?.level) : "",
    province: filters?.province !== "all" ? normalizeText(filters?.province) : "",
    district: filters?.district !== "all" ? normalizeText(filters?.district) : "",
    affiliation: filters?.affiliation !== "all" ? normalizeText(filters?.affiliation) : "",
    savedOnly: Boolean(filters?.savedOnly),
  };
}

function areDirectoryFiltersEqual(left, right) {
  return (
    String(left?.search || "") === String(right?.search || "") &&
    String(left?.type || "") === String(right?.type || "") &&
    String(left?.field || "") === String(right?.field || "") &&
    String(left?.level || "") === String(right?.level || "") &&
    String(left?.province || "") === String(right?.province || "") &&
    String(left?.district || "") === String(right?.district || "") &&
    String(left?.affiliation || "") === String(right?.affiliation || "") &&
    Boolean(left?.savedOnly) === Boolean(right?.savedOnly)
  );
}

function CountryFlagIcon({ countryName, className = "" }) {
  const classes = `country-flag-svg ${className}`.trim();

  if (countryName === DEFAULT_COUNTRY) {
    return (
      <svg
        className={classes}
        viewBox="0 0 36 36"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M7 3v30" fill="none" stroke="#1e40af" strokeWidth="2.6" strokeLinecap="round" />
        <path
          d="M9 4h16l-5.8 8 5.8 8H9V4Z"
          fill="#dc2626"
          stroke="#1e40af"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M9 20h13l-4.6 6.4L22 33H9V20Z"
          fill="#dc2626"
          stroke="#1e40af"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="11.5" r="2.1" fill="#fff" />
        <path d="M15.8 22.5l1.1 2.1 2.3.3-1.7 1.6.4 2.3-2.1-1.1-2.1 1.1.4-2.3-1.7-1.6 2.3-.3Z" fill="#fff" />
      </svg>
    );
  }

  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.8" />
      <path d="M3 12h18" stroke="#2563eb" strokeWidth="1.6" />
      <path d="M12 3a14 14 0 0 1 0 18" stroke="#2563eb" strokeWidth="1.6" />
      <path d="M12 3a14 14 0 0 0 0 18" stroke="#2563eb" strokeWidth="1.6" />
    </svg>
  );
}

function hasActiveDirectoryFilters(filters) {
  return Boolean(
    String(filters?.search || "").trim() ||
    filters?.type !== "all" ||
    filters?.field !== "all" ||
    filters?.level !== "all" ||
    filters?.province !== "all" ||
    filters?.district !== "all" ||
    filters?.affiliation !== "all" ||
    filters?.savedOnly
  );
}

function mergeFilterPatch(currentFilters, patch, businesses) {
  const nextFilters = {
    ...currentFilters,
    ...patch,
  };

  if (Object.prototype.hasOwnProperty.call(patch, "province")) {
    if (
      nextFilters.province !== "all" &&
      nextFilters.district !== "all" &&
      !businesses.some(
        (business) =>
          (business.province_name || business.province) === nextFilters.province &&
          business.district === nextFilters.district
      )
    ) {
      nextFilters.district = "all";
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "district") &&
    nextFilters.district !== "all" &&
    nextFilters.province !== "all"
  ) {
    const districtExistsInProvince = businesses.some(
      (business) =>
        (business.province_name || business.province) === nextFilters.province &&
        business.district === nextFilters.district
    );

    if (!districtExistsInProvince) {
      nextFilters.province = "all";
    }
  }

  return nextFilters;
}

function getSelectedSlugFromLocation() {
  if (typeof window === "undefined") {
    return "";
  }

  return readCurrentRoute().selectedSlug || "";
}

function readCurrentRoute() {
  if (typeof window === "undefined") {
    return parseLocationRoute("/", "", APP_BASE_PATH);
  }

  return parseLocationRoute(window.location.pathname, window.location.hash, APP_BASE_PATH);
}

function buildListingRoute(filters) {
  return buildListingUrl(filters, APP_BASE_PATH);
}

function syncListingRoute(filters, { replace = false } = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = buildListingRoute(filters);
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (currentUrl === nextUrl) {
    return;
  }

  if (replace) {
    window.history.replaceState(null, "", nextUrl);
    return;
  }

  window.history.pushState(null, "", nextUrl);
}

function syncBusinessRoute(slug, { replace = false, filters = null } = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = slug ? buildBusinessPath(slug, APP_BASE_PATH) : buildListingRoute(filters || cloneDefaultFilters());
  const currentUrl = `${window.location.pathname}${window.location.search}`;

  if (currentUrl === nextUrl) {
    return;
  }

  if (replace) {
    window.history.replaceState(null, "", nextUrl);
    return;
  }

  window.history.pushState(null, "", nextUrl);
}

function buildBrowseLinkGroups(businesses, routeKey, getValue, limit, locale = "en") {
  const counts = new Map();

  for (const business of businesses) {
    const resolved = getValue(business);
    const items = Array.isArray(resolved) ? resolved : [resolved];
    for (const item of items) {
      const label = String(item || "").trim();
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
      value: label,
      count,
      href: buildCollectionPath(routeKey, label, APP_BASE_PATH),
      description: buildBrowseLinkDescription(locale, routeKey, label, count),
    }));
}

function buildPageContext({
  locale,
  route,
  selectedBusiness,
  filteredBusinesses,
  allBusinesses,
  filteredBusinessCount,
  totalBusinessCount,
  provinceCount,
  fieldCount,
}) {
  if (route?.pageType === "detail") {
    return buildDetailPageContext({
      locale,
      route,
      selectedBusiness,
      allBusinesses,
    });
  }

  if (route?.pageType && route.pageType !== "directory") {
    return buildCollectionPageContext({
      locale,
      route,
      filteredBusinesses,
      filteredBusinessCount,
      totalBusinessCount,
    });
  }

  return buildHomePageContext({
    locale,
    allBusinesses,
    totalBusinessCount,
    provinceCount,
    fieldCount,
  });
}

function buildHomePageContext({ locale, allBusinesses, totalBusinessCount, provinceCount, fieldCount }) {
  const districtCount = uniqueValues(allBusinesses.map((business) => business.district)).length;

  return {
    eyebrow: "aboutmyschool.com",
    title:
      locale === "ne"
        ? "नेपालभरिका विद्यालय, कलेज र शैक्षिक संस्थाहरू खोज्नुहोस्"
        : "Find schools, colleges, and educational institutes across Nepal.",
    description:
      locale === "ne"
        ? "कार्यक्रम, सम्बन्धन, सुविधा, स्थान, सम्पर्क, फोटो र भिडियो सहितका सार्वजनिक प्रोफाइल एउटै डाइरेक्टरीमा तुलना गर्नुहोस्।"
        : "Compare programs, affiliation, facilities, location, contact details, photos, videos, and public institute profiles in one searchable directory.",
    pillLabel: t(locale, "liveDirectory"),
    pillValue: t(locale, "activeListingsCount", {
      count: formatLocaleNumber(locale, totalBusinessCount),
    }),
    overviewTitle: locale === "ne" ? "डाइरेक्टरी किन उपयोगी छ" : "Why this directory helps",
    overviewParagraphs: [
      locale === "ne"
        ? `${formatLocaleNumber(locale, totalBusinessCount)} वटा सक्रिय सूची, ${formatLocaleNumber(locale, provinceCount)} वटा प्रदेश र ${formatLocaleNumber(locale, districtCount)} वटा जिल्लाबाट सार्वजनिक संस्थाहरू अहिले उपलब्ध छन्।`
        : `${formatLocaleNumber(locale, totalBusinessCount)} active listings are currently published across ${formatLocaleNumber(locale, provinceCount)} provinces and ${formatLocaleNumber(locale, districtCount)} districts.`,
      locale === "ne"
        ? "अभिभावक, विद्यार्थी र संस्थाहरूले अलग-अलग सामाजिक सञ्जाल वा पुराना सूची हेर्नु पर्ने झन्झट बिना एउटै स्थानबाट तुलना गर्न सकून् भनेर यो पेज तयार गरिएको हो।"
        : "This page is designed so families and students can compare institutions without jumping between scattered social posts or outdated lists.",
      locale === "ne"
        ? "प्रकार, क्षेत्र, तह, जिल्ला वा सम्बन्धनका आधारमा नतिजा साँघुर्याउन सकिन्छ, र नयाँ व्यवसायहरू थपिएपछि पुनःबिल्ड हुँदा यिनै संरचनामा नयाँ पेजहरू स्वतः अपडेट हुन्छन्।"
        : "You can narrow results by type, field, level, district, or affiliation, and future listings inherit the same structure automatically when the site rebuilds.",
    ],
    statItems: [
      { label: t(locale, "activeListings"), value: formatLocaleNumber(locale, totalBusinessCount) },
      { label: t(locale, "provincesCovered"), value: formatLocaleNumber(locale, provinceCount) },
      { label: t(locale, "districtsCovered"), value: formatLocaleNumber(locale, districtCount) },
      { label: t(locale, "fieldsRepresented"), value: formatLocaleNumber(locale, fieldCount) },
    ],
    browseSections: [
      {
        title: locale === "ne" ? "प्रदेशअनुसार हेर्नुहोस्" : "Browse by province",
        description:
          locale === "ne"
            ? "प्रदेश-स्तरका पेजहरूले मुख्य स्थानीय सूचीहरू द्रुत रूपमा खोल्छन्।"
            : "Province pages group the strongest regional listing coverage.",
        links: buildBrowseLinkGroups(
          allBusinesses,
          "province",
          (business) => business.province_name || business.province,
          6,
          locale
        ),
      },
      {
        title: locale === "ne" ? "जिल्लाअनुसार हेर्नुहोस्" : "Browse by district",
        description:
          locale === "ne"
            ? "नजिकका विकल्प खोज्न जिल्ला पेजहरू उपयोगी हुन्छन्।"
            : "District pages are useful when users want nearby options first.",
        links: buildBrowseLinkGroups(allBusinesses, "district", (business) => business.district, 6, locale),
      },
      {
        title: locale === "ne" ? "प्रकारअनुसार हेर्नुहोस्" : "Browse by institute type",
        description:
          locale === "ne"
            ? "विद्यालय, कलेज वा अन्य प्रकारका सूचीहरू छुट्याएर तुलना गर्नुहोस्।"
            : "Type pages make it easier to compare similar institutions.",
        links: buildBrowseLinkGroups(allBusinesses, "type", (business) => business.type, 6, locale),
      },
      {
        title: locale === "ne" ? "विषयक्षेत्रअनुसार हेर्नुहोस्" : "Browse by field",
        description:
          locale === "ne"
            ? "एउटै अध्ययन क्षेत्रसँग सम्बन्धित संस्थाहरूलाई केन्द्रित रूपमा खोल्नुहोस्।"
            : "Field pages help users focus on one study area at a time.",
        links: buildBrowseLinkGroups(allBusinesses, "field", (business) => business.field || [], 6, locale),
      },
    ].filter((section) => section?.links?.length),
  };
}

function buildHomeQuickFilters(businesses, locale) {
  return [
    {
      key: "province",
      label: t(locale, "province"),
      emptyLabel: t(locale, "allProvinces"),
      options: buildQuickFilterOptions(
        businesses,
        (business) => business.province_name || business.province
      ),
    },
    {
      key: "district",
      label: t(locale, "district"),
      emptyLabel: t(locale, "allDistricts"),
      options: buildQuickFilterOptions(businesses, (business) => business.district),
    },
    {
      key: "type",
      label: t(locale, "type"),
      emptyLabel: t(locale, "allTypes"),
      options: buildQuickFilterOptions(businesses, (business) => business.type),
    },
    {
      key: "field",
      label: t(locale, "field"),
      emptyLabel: t(locale, "allFields"),
      options: buildQuickFilterOptions(businesses, (business) => business.field || []),
    },
  ].filter((item) => item.options.length);
}

function buildQuickFilterOptions(businesses, getValue, limit = 12) {
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
      value: label,
      count,
    }));
}

function buildCollectionPageContext({
  locale,
  route,
  filteredBusinesses,
  filteredBusinessCount,
  totalBusinessCount,
}) {
  const label = resolveRouteLabel(route, filteredBusinesses);
  const coverage = {
    provinces: uniqueValues(filteredBusinesses.map((business) => business.province_name || business.province)).length,
    districts: uniqueValues(filteredBusinesses.map((business) => business.district)).length,
    types: uniqueValues(filteredBusinesses.map((business) => business.type)).length,
    fields: uniqueValues(filteredBusinesses.flatMap((business) => business.field || [])).length,
  };
  const countLabel = formatLocaleNumber(locale, filteredBusinessCount);

  return {
    eyebrow: buildCollectionEyebrow(locale, route.pageType),
    title: buildCollectionRuntimeTitle(locale, route.pageType, label),
    description: buildCollectionRuntimeDescription(locale, route.pageType, label, filteredBusinessCount),
    pillLabel: locale === "ne" ? "सूची पेज" : "Collection page",
    pillValue:
      locale === "ne"
        ? `${countLabel} परिणाम`
        : `${countLabel} matching listings`,
    overviewTitle: locale === "ne" ? "यस पेजको सन्दर्भ" : "What this page covers",
    overviewParagraphs: [
      locale === "ne"
        ? `यो पेजले ${label} सँग सम्बन्धित ${countLabel} वटा सक्रिय सार्वजनिक सूचीहरू एउटै ठाउँमा समूहबद्ध गर्छ।`
        : `This page groups ${countLabel} active public listings related to ${label} in one place.`,
      locale === "ne"
        ? "प्रयोगकर्ताले पेज छोड्न नपरी थप फिल्टरहरू प्रयोग गरेर क्षेत्र, तह र सम्बन्धन अनुसार नतिजा सानो बनाउन सक्छन्।"
        : "Users can narrow the results further by field, level, and affiliation without leaving the page.",
      locale === "ne"
        ? `डाइरेक्टरीमा अझ धेरै डेटा थपिएपछि पुनःबिल्ड हुँदा यो संरचनाले नयाँ ${label} सम्बन्धित सूचीहरू पनि स्वतः समेट्छ।`
        : `As the directory grows, future rebuilds will keep the same structure and absorb new ${label} listings automatically.`,
      filteredBusinessCount < totalBusinessCount
        ? locale === "ne"
          ? "तलका सम्बन्धित पेजहरू प्रयोग गरेर अर्को जिल्ला, प्रदेश, प्रकार वा विषयक्षेत्रमा जान सकिन्छ।"
          : "Use the related browse panels below to move to nearby districts, provinces, types, or fields."
        : locale === "ne"
          ? "यो पेजले उपलब्ध सार्वजनिक सूचीहरूको प्रमुख भाग समेट्छ।"
          : "This page already covers a broad slice of the public directory.",
    ],
    statItems: [
      { label: t(locale, "listings"), value: countLabel },
      { label: t(locale, "types"), value: formatLocaleNumber(locale, coverage.types) },
      { label: t(locale, "districtsCovered"), value: formatLocaleNumber(locale, coverage.districts) },
      { label: t(locale, "fieldsRepresented"), value: formatLocaleNumber(locale, coverage.fields) },
      { label: t(locale, "provincesCovered"), value: formatLocaleNumber(locale, coverage.provinces) },
    ].filter((item, index, items) => item.value !== "0" || index === 0).slice(0, 4),
    browseSections: buildCollectionBrowseSections(locale, route.pageType, filteredBusinesses),
  };
}

function buildDetailPageContext({ locale, route, selectedBusiness, allBusinesses }) {
  const business = selectedBusiness;
  if (!business) {
    const label = humanizeRouteSlug(route?.selectedSlug || "");
    return {
      eyebrow: locale === "ne" ? "संस्था प्रोफाइल" : "Institution profile",
      title: label || (locale === "ne" ? "संस्था प्रोफाइल" : "Institution profile"),
      description:
        locale === "ne"
          ? "यो संस्थाको विस्तृत सार्वजनिक प्रोफाइल लोड भइरहेको छ।"
          : "The detailed public profile for this institution is loading.",
      pillLabel: locale === "ne" ? "प्रोफाइल" : "Profile",
      pillValue: locale === "ne" ? "लोड हुँदैछ" : "Loading",
      overviewTitle: locale === "ne" ? "पेज सारांश" : "Page summary",
      overviewParagraphs: [
        locale === "ne"
          ? "सम्पूर्ण डाइरेक्टरी सूची उपलब्ध भएपछि यस पेजमा संस्था सम्बन्धी विवरण, स्थान, सम्पर्क र अन्य सार्वजनिक जानकारी देखिन्छ।"
          : "Once the directory data is available, this page shows the institution details, location, contact information, and other public fields.",
      ],
      statItems: [],
      browseSections: [],
    };
  }

  const districtCount = business.district
    ? allBusinesses.filter((item) => item.district === business.district).length
    : 0;
  const typeCount = business.type
    ? allBusinesses.filter((item) => item.type === business.type).length
    : 0;

  return {
    eyebrow: locale === "ne" ? "संस्था प्रोफाइल" : "Institution profile",
    title: business.name,
    description: buildDetailRuntimeDescription(locale, business),
    pillLabel: locale === "ne" ? "प्रोफाइल प्रकार" : "Profile type",
    pillValue: business.type || (locale === "ne" ? "शैक्षिक संस्था" : "Educational institute"),
    overviewTitle: locale === "ne" ? "यस संस्थाको झलक" : "Why this profile matters",
    overviewParagraphs: buildDetailOverviewParagraphs(locale, business),
    statItems: [
      { label: t(locale, "type"), value: business.type || t(locale, "notSet") },
      { label: t(locale, "affiliation"), value: business.affiliation || t(locale, "notSet") },
      { label: t(locale, "levels"), value: formatArray(business.level) || t(locale, "notSet") },
      {
        label: t(locale, "location"),
        value: [business.district, business.province_name].filter(Boolean).join(", ") || t(locale, "locationNotSet"),
      },
    ],
    browseSections: [
      business.district
        ? {
          title: locale === "ne" ? "यस संस्थाको जिल्ला" : "Explore this district",
          description:
            locale === "ne"
              ? "यही जिल्लाभित्रका थप संस्थाहरू फिल्टर गरेर हेर्नुहोस्।"
              : "Apply this district to the directory filters and keep exploring nearby listings.",
          filterKey: "district",
          filterLabel: t(locale, "district"),
          emptyLabel: t(locale, "allDistricts"),
          links: [
            {
              label: business.district,
              value: business.district,
              count: districtCount,
              href: buildCollectionPath("district", business.district, APP_BASE_PATH),
              description: buildBrowseLinkDescription(locale, "district", business.district, districtCount),
            },
          ],
        }
        : null,
      business.type
        ? {
          title: locale === "ne" ? "यस संस्थाको प्रकार" : "Explore this type",
          description:
            locale === "ne"
              ? "यही प्रकारका थप संस्थाहरू राखेर फिल्टर अगाडि बढाउनुहोस्।"
              : "Keep the current directory flow and add this institute type into the active filters.",
          filterKey: "type",
          filterLabel: t(locale, "type"),
          emptyLabel: t(locale, "allTypes"),
          links: [
            {
              label: business.type,
              value: business.type,
              count: typeCount,
              href: buildCollectionPath("type", business.type, APP_BASE_PATH),
              description: buildBrowseLinkDescription(locale, "type", business.type, typeCount),
            },
          ],
        }
        : null,
    ].filter((section) => section.links.length),
  };
}

function buildCollectionBrowseSections(locale, routeKey, businesses) {
  const sectionConfigs = {
    province: [
      {
        title: locale === "ne" ? "यस प्रदेशका प्रमुख जिल्लाहरू" : "Popular districts in this province",
        description:
          locale === "ne"
            ? "प्रदेशभित्रका स्थानीय पेजहरू छिटो खोल्नुहोस्।"
            : "Open the strongest district landing pages in this province.",
        key: "district",
        getValue: (business) => business.district,
      },
      {
        title: locale === "ne" ? "यस प्रदेशका संस्था प्रकार" : "Institute types in this province",
        description:
          locale === "ne"
            ? "यो प्रदेशभित्रका विद्यालय, कलेज र अन्य प्रकार छुट्याएर हेर्नुहोस्।"
            : "Split this province by institute type for cleaner comparisons.",
        key: "type",
        getValue: (business) => business.type,
      },
    ],
    district: [
      {
        title: locale === "ne" ? "यस जिल्लाका संस्था प्रकार" : "Institute types in this district",
        description:
          locale === "ne"
            ? "जिल्लाभित्रका प्रकारगत विकल्पहरू तुलना गर्नुहोस्।"
            : "Compare the main categories available in this district.",
        key: "type",
        getValue: (business) => business.type,
      },
      {
        title: locale === "ne" ? "यस जिल्लाका विषयक्षेत्र" : "Fields linked to this district",
        description:
          locale === "ne"
            ? "अध्ययन क्षेत्रका आधारमा स्थानीय विकल्पहरू हेर्नुहोस्।"
            : "Use field pages to focus on one study area within the district.",
        key: "field",
        getValue: (business) => business.field || [],
      },
    ],
    type: [
      {
        title: locale === "ne" ? "यस प्रकारका जिल्लाहरू" : "Districts with these listings",
        description:
          locale === "ne"
            ? "यो प्रकारका संस्थाहरू धेरै भएका जिल्लाहरू खोल्नुहोस्।"
            : "See where this type has the strongest geographic coverage.",
        key: "district",
        getValue: (business) => business.district,
      },
      {
        title: locale === "ne" ? "यस प्रकारका विषयक्षेत्र" : "Fields linked to this type",
        description:
          locale === "ne"
            ? "यो प्रकारसँग सम्बन्धित अध्ययन क्षेत्रहरूबाट थप पेजहरू खोल्नुहोस्।"
            : "Move from this type page into related study fields.",
        key: "field",
        getValue: (business) => business.field || [],
      },
    ],
    field: [
      {
        title: locale === "ne" ? "यस विषयक्षेत्रका जिल्लाहरू" : "Districts with this field",
        description:
          locale === "ne"
            ? "यो क्षेत्र पढाइ हुने जिल्लाहरू खोज्नुहोस्।"
            : "Open district pages where this field appears most often.",
        key: "district",
        getValue: (business) => business.district,
      },
      {
        title: locale === "ne" ? "यस विषयक्षेत्रका संस्था प्रकार" : "Institute types for this field",
        description:
          locale === "ne"
            ? "यो क्षेत्रसँग सम्बन्धित विद्यालय, कलेज वा अन्य प्रकारका पेजहरू हेर्नुहोस्।"
            : "Split this field into the main institute categories.",
        key: "type",
        getValue: (business) => business.type,
      },
    ],
  }[routeKey] || [];

  return sectionConfigs
    .map((section) => ({
      title: section.title,
      description: section.description,
      filterKey: section.key,
      filterLabel: buildFilterLabel(locale, section.key),
      emptyLabel: buildFilterEmptyLabel(locale, section.key),
      links: buildBrowseLinkGroups(businesses, section.key, section.getValue, 6, locale),
    }))
    .filter((section) => section.links.length);
}

function buildFilterLabel(locale, key) {
  const labelMap = {
    type: t(locale, "type"),
    field: t(locale, "field"),
    level: t(locale, "level"),
    province: t(locale, "province"),
    district: t(locale, "district"),
    affiliation: t(locale, "affiliation"),
  };

  return labelMap[key] || humanizeRouteSlug(key);
}

function buildFilterEmptyLabel(locale, key) {
  const labelMap = {
    type: t(locale, "allTypes"),
    field: t(locale, "allFields"),
    level: t(locale, "allLevels"),
    province: t(locale, "allProvinces"),
    district: t(locale, "allDistricts"),
    affiliation: t(locale, "allAffiliations"),
  };

  return labelMap[key] || (locale === "ne" ? "सबै" : "All");
}

function buildFooterDialogContent(key, { locale, supportPhone, supportEmail }) {
  const dialogs = {
    about: {
      kicker: t(locale, "aboutSection"),
      title: t(locale, "aboutLink"),
      paragraphs:
        locale === "ne"
          ? [
            "AboutMySchool नेपालभरिका सार्वजनिक शैक्षिक संस्थाहरू सजिलै खोज्न, तुलना गर्न र सम्पर्क गर्न बनाइएको निर्देशिका हो।",
            "यो प्लेटफर्मले संस्था प्रोफाइल, स्थान, सम्पर्क, कार्यक्रम, सुविधा, फोटो र भिडियोहरूलाई एउटै स्थानमा राखेर अभिभावक र विद्यार्थीलाई निर्णय गर्न सजिलो बनाउँछ।",
          ]
          : [
            "AboutMySchool is built to help families and students discover, compare, and contact public educational institutions across Nepal.",
            "The platform brings institution profiles, location details, contacts, programs, facilities, photos, and videos into one searchable place.",
          ],
      listItems: [],
    },
    contact: {
      kicker: t(locale, "contact"),
      title: t(locale, "contactUsLink"),
      paragraphs:
        locale === "ne"
          ? [
            "प्रत्यक्ष सम्पर्कका लागि तलका फोन वा इमेल कार्यहरू प्रयोग गर्नुहोस्।",
            supportPhone || supportEmail
              ? "तपाईंको डिभाइसमा उपलब्ध कल वा इमेल एपबाट सिधै सम्पर्क गर्न सकिन्छ।"
              : "सम्पर्क जानकारी अझै कन्फिगर गरिएको छैन।",
          ]
          : [
            "Use the phone or email actions below to contact the AboutMySchool team directly.",
            supportPhone || supportEmail
              ? "The buttons open your device's calling or email app."
              : "Support contact details are not configured yet.",
          ],
      listItems: [],
    },
    support: {
      kicker: t(locale, "supportSection"),
      title: t(locale, "helpFaqLink"),
      paragraphs:
        locale === "ne"
          ? [
            "सामान्य प्रश्न, सूची अद्यावधिक, मूल्य, वा प्राविधिक सहयोगका लागि यो सपोर्ट प्यानल प्रयोग गर्नुहोस्।",
            "तल विषय र सन्देश लेखेर इमेल समर्थन बटन थिच्दा तपाईँको डिफल्ट मेल एप खुल्छ।",
          ]
          : [
            "Use this support panel for common questions, listing updates, pricing questions, or technical help.",
            "Write a subject and message below, then use the email support action to open your default mail app.",
          ],
      listItems:
        locale === "ne"
          ? [
            "प्रायः सोधिने प्रश्न: सूची कसरी थप्ने, अपडेट कहिले देखिन्छ, मूल्य योजना कसरी काम गर्छ।",
          ]
          : [
            "Common questions: how listings are added, when updates go live, and how pricing plans work.",
          ],
    },
    pricing: {
      kicker: t(locale, "supportSection"),
      title: t(locale, "purchaseLink"),
      paragraphs:
        locale === "ne"
          ? [
            "यो प्यानल हालका लागि मूल्य र खरिदसम्बन्धी छोटो जानकारी देखाउन राखिएको छ।",
            "अहिलेलाई वास्तविक भुक्तानी पेज छैन, तर पछि योजना, सुविधा र खरिद बटन यहीँ वा अलग पेजमा जोड्न सकिन्छ।",
          ]
          : [
            "This panel is currently a placeholder for pricing and purchase information.",
            "There is no live payment flow yet, but plans, features, and purchase actions can be connected here or on a dedicated pricing page later.",
          ],
      listItems: [],
    },
    privacy: {
      kicker: t(locale, "legalSection"),
      title: t(locale, "privacyLink"),
      paragraphs:
        locale === "ne"
          ? [
            "यो साइटले सार्वजनिक संस्था विवरण देखाउँछ र डाइरेक्टरी प्रयोग सुधार गर्न आवश्यक न्यूनतम स्थानीय डेटा मात्र प्रयोग गर्छ।",
            "भविष्यमा औपचारिक प्राइभेसी नीतिमा डेटा स्रोत, क्यास, कुकी, र सम्पर्क फारम प्रयोगबारे स्पष्ट विवरण थप्न सकिन्छ।",
          ]
          : [
            "This site shows public institution data and uses only the minimum local device data needed to improve directory browsing.",
            "A formal privacy policy can later expand this into clear sections for data sources, caching, cookies, and contact form handling.",
          ],
      listItems: [],
    },
    copyright: {
      kicker: t(locale, "legalSection"),
      title: t(locale, "copyrightLink"),
      paragraphs:
        locale === "ne"
          ? [
            "साइटको संरचना, पाठ, डिजाइन, र ब्रान्ड सामग्री AboutMySchool वा सम्बन्धित अधिकारधनीको स्वामित्वमा रहन्छ।",
            "संस्थाहरूले उपलब्ध गराएका सार्वजनिक लोगो, फोटो वा सामग्री सम्बन्धित संस्थाको स्वामित्वमा रहन सक्छन्।",
          ]
          : [
            "The site structure, written copy, design, and brand material remain the property of AboutMySchool or the relevant rights holder.",
            "Public logos, photos, and materials supplied by institutions may remain the property of those institutions.",
          ],
      listItems: [],
    },
  };

  return {
    key,
    ...(dialogs[key] || dialogs.about),
    supportPhone,
    supportEmail,
  };
}

function buildSupportMailtoUrl(email, draft) {
  const safeEmail = String(email || "").trim();
  if (!safeEmail) {
    return "";
  }

  const params = new URLSearchParams();
  if (draft?.subject) {
    params.set("subject", draft.subject);
  }
  if (draft?.message) {
    params.set("body", draft.message);
  }

  const query = params.toString();
  return `mailto:${safeEmail}${query ? `?${query}` : ""}`;
}

function buildBrowseLinkDescription(locale, routeKey, label, count) {
  const countLabel = formatLocaleNumber(locale, count);
  if (locale === "ne") {
    if (routeKey === "field") {
      return `${label} सँग सम्बन्धित ${countLabel} वटा सक्रिय सूची हेर्नुहोस्।`;
    }
    if (routeKey === "type") {
      return `${label} प्रकारका पेजमा ${countLabel} वटा सूची खोल्नुहोस्।`;
    }
    return `${label} मा रहेका ${countLabel} वटा सक्रिय सूची हेर्नुहोस्।`;
  }

  if (routeKey === "field") {
    return `View ${countLabel} active institutes covering ${label}.`;
  }
  if (routeKey === "type") {
    return `Open the ${label.toLowerCase()} directory page with ${countLabel} listings.`;
  }
  return `Explore ${countLabel} active institutes in ${label}.`;
}

function buildCollectionEyebrow(locale, routeKey) {
  if (locale === "ne") {
    return routeKey === "type"
      ? "प्रकार पेज"
      : routeKey === "field"
        ? "विषयक्षेत्र पेज"
        : "स्थान पेज";
  }

  return routeKey === "type"
    ? "Type page"
    : routeKey === "field"
      ? "Field page"
      : "Location page";
}

function buildCollectionRuntimeTitle(locale, routeKey, label) {
  if (locale === "ne") {
    if (routeKey === "type") {
      return `नेपालका ${label} सम्बन्धी संस्थाहरू`;
    }
    if (routeKey === "field") {
      return `${label} सम्बन्धी संस्थाहरू`;
    }
    return `${label}, नेपालका शैक्षिक संस्थाहरू`;
  }

  if (routeKey === "type") {
    return `${pluralizeTypeLabel(label)} in Nepal`;
  }
  if (routeKey === "field") {
    return `${label} institutes in Nepal`;
  }
  return `Educational institutes in ${label}, Nepal`;
}

function buildCollectionRuntimeDescription(locale, routeKey, label, count) {
  const countLabel = formatLocaleNumber(locale, count);
  if (locale === "ne") {
    if (routeKey === "type") {
      return `${label} प्रकारका ${countLabel} वटा सक्रिय सार्वजनिक सूचीहरू यस पेजमा समेटिएका छन्।`;
    }
    if (routeKey === "field") {
      return `${label} विषयक्षेत्रसँग सम्बन्धित ${countLabel} वटा सक्रिय सूचीहरू यस पेजमा उपलब्ध छन्।`;
    }
    return `${label} क्षेत्रमा रहेका ${countLabel} वटा सक्रिय सार्वजनिक शैक्षिक सूचीहरू यस पेजमा उपलब्ध छन्।`;
  }

  if (routeKey === "type") {
    return `${countLabel} active public ${label.toLowerCase()} listings are grouped on this page.`;
  }
  if (routeKey === "field") {
    return `${countLabel} active public listings linked to ${label} are grouped on this page.`;
  }
  return `${countLabel} active public educational listings in ${label} are grouped on this page.`;
}

function buildDetailRuntimeDescription(locale, business) {
  const location = [business.district, business.province_name].filter(Boolean).join(", ");
  const safeType = business.type || (locale === "ne" ? "शैक्षिक संस्था" : "educational institute");

  if (locale === "ne") {
    return `${business.name} ${location ? `${location} मा रहेको ` : ""}${safeType} हो। यस पेजमा सम्पर्क, कार्यक्रम, सुविधा, नक्सा र सार्वजनिक प्रोफाइल विवरण एउटै ठाउँमा देखाइन्छ।`;
  }

  return `${business.name} is an ${safeType.toLowerCase()}${location ? ` in ${location}` : ""}. This page brings its contact details, programs, facilities, map, and public profile details together in one place.`;
}

function buildDetailOverviewParagraphs(locale, business) {
  const lines = [];
  const location = [business.district, business.province_name].filter(Boolean).join(", ");
  const levels = formatArray(business.level);
  const fields = formatArray(business.field);
  const facilities = formatArray((business.facilities || []).slice(0, 4));

  if (locale === "ne") {
    lines.push(
      `${business.name}${location ? ` ${location}` : ""} मा रहेको सार्वजनिक प्रोफाइल भएको शैक्षिक सूची हो।`
    );
    lines.push(
      "सूचीमा सम्पर्क विवरण, वेबसाइट, कार्यक्रम, सुविधा, फोटो, भिडियो र नक्सा उपलब्ध भएमा एउटै पेजमा देखाइन्छ।"
    );
    if (levels) {
      lines.push(`यसले ${levels} तहसँग सम्बन्धित जानकारी समेट्छ।`);
    }
    if (fields) {
      lines.push(`विषयक्षेत्रका रूपमा ${fields} उल्लेख गरिएको छ।`);
    }
    if (facilities) {
      lines.push(`उपलब्ध सुविधामा ${facilities} समावेश छन्।`);
    }
    return lines;
  }

  lines.push(
    `${business.name}${location ? ` in ${location}` : ""} has a public profile page inside the Nepal directory.`
  );
  lines.push(
    "When the data is available, the page keeps contact details, website, programs, facilities, photos, videos, and map access together for faster comparison."
  );
  if (levels) {
    lines.push(`The profile currently covers ${levels}.`);
  }
  if (fields) {
    lines.push(`Listed study fields include ${fields}.`);
  }
  if (facilities) {
    lines.push(`Highlighted facilities include ${facilities}.`);
  }
  return lines;
}

function buildReadableBusinessNarrative(locale, business) {
  const narrative = buildDetailOverviewParagraphs(locale, business).slice(0, 2).join(" ");
  if (narrative) {
    return narrative;
  }

  return t(locale, "detailFallbackDescription");
}

function resolveRouteLabel(route, businesses) {
  if (!route?.pageType || route.pageType === "directory" || route.pageType === "detail") {
    return "";
  }

  const first = businesses[0];
  if (!first) {
    return humanizeRouteSlug(route.listingSlug);
  }

  if (route.pageType === "province") {
    return first.province_name || first.province || humanizeRouteSlug(route.listingSlug);
  }
  if (route.pageType === "district") {
    return first.district || humanizeRouteSlug(route.listingSlug);
  }
  if (route.pageType === "type") {
    return first.type || humanizeRouteSlug(route.listingSlug);
  }
  if (route.pageType === "field") {
    return first.field?.find((item) => normalizeRouteSlug(item) === route.listingSlug) || humanizeRouteSlug(route.listingSlug);
  }

  return humanizeRouteSlug(route.listingSlug);
}

function humanizeRouteSlug(value) {
  return String(value || "")
    .trim()
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pluralizeTypeLabel(label) {
  const safeLabel = String(label || "").trim();
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
  if (/s$/i.test(safeLabel)) {
    return safeLabel;
  }
  return `${safeLabel}s`;
}

function handleInternalRouteClick(event, onNavigate) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  onNavigate();
}

function updateDocumentSeo(pageSeo, structuredData) {
  if (typeof document === "undefined") {
    return;
  }

  document.title = pageSeo.title;
  upsertMetaTag("description", pageSeo.description);
  if (Array.isArray(pageSeo.keywords) && pageSeo.keywords.length) {
    upsertMetaTag("keywords", pageSeo.keywords.join(", "));
  } else {
    removeHeadTag('meta[name="keywords"]');
  }
  upsertMetaTag("robots", pageSeo.robots || "index,follow");
  upsertMetaProperty("og:title", pageSeo.title);
  upsertMetaProperty("og:description", pageSeo.description);
  upsertMetaProperty("og:type", "website");
  upsertMetaProperty("og:url", pageSeo.canonicalUrl);
  upsertMetaProperty("og:site_name", SITE_NAME);
  upsertMetaTag("twitter:card", pageSeo.image ? "summary_large_image" : "summary");
  upsertMetaTag("twitter:title", pageSeo.title);
  upsertMetaTag("twitter:description", pageSeo.description);

  if (pageSeo.image) {
    upsertMetaProperty("og:image", pageSeo.image);
    upsertMetaTag("twitter:image", pageSeo.image);
  } else {
    removeHeadTag('meta[property="og:image"]');
    removeHeadTag('meta[name="twitter:image"]');
  }

  upsertCanonicalLink(pageSeo.canonicalUrl);
  upsertStructuredDataScript(structuredData);
}

function routeNeedsBusinessLookup(route, search) {
  if (route?.pageType && route.pageType !== "detail" && route.pageType !== "directory") {
    return true;
  }

  return searchHasResolvableFilterParams(search);
}

function searchHasResolvableFilterParams(search) {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  return ["type", "field", "level", "province", "district", "affiliation"].some((key) =>
    params.has(key)
  );
}

function upsertMetaTag(name, content) {
  let element = document.querySelector(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertMetaProperty(property, content) {
  let element = document.querySelector(`meta[property="${property}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("property", property);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertCanonicalLink(href) {
  let element = document.querySelector('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

function upsertStructuredDataScript(structuredData) {
  let element = document.querySelector('script[data-seo="structured-data"]');
  if (!element) {
    element = document.createElement("script");
    element.type = "application/ld+json";
    element.setAttribute("data-seo", "structured-data");
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(structuredData);
}

function removeHeadTag(selector) {
  const element = document.querySelector(selector);
  if (element) {
    element.remove();
  }
}

function normalizeMediaList(items) {
  return [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeVideoEntries(items) {
  return normalizeMediaList(items)
    .map((item, index) => buildVideoEntry(item, index))
    .filter(Boolean);
}

function buildVideoEntry(raw, index) {
  const { title, url } = splitLabeledUrl(raw);
  const safeUrl = ensureUrl(url);
  const provider = detectVideoProvider(safeUrl);
  const derivedTitle = title || buildVideoTitle(safeUrl, provider, index);

  return {
    raw,
    title: derivedTitle,
    url: safeUrl,
    provider,
    thumbnail: getVideoThumbnailUrl(safeUrl),
    embedUrl: getEmbeddedVideoUrl(safeUrl),
    isDirectVideo: isDirectVideoUrl(safeUrl),
  };
}

function splitLabeledUrl(value) {
  const text = String(value || "").trim();
  const delimiterIndex = text.indexOf("|");

  if (delimiterIndex === -1) {
    return {
      title: "",
      url: text,
    };
  }

  const left = text.slice(0, delimiterIndex).trim();
  const right = text.slice(delimiterIndex + 1).trim();

  if (!right) {
    return {
      title: "",
      url: text,
    };
  }

  return {
    title: left,
    url: right,
  };
}

function buildVideoTitle(url, provider, index) {
  if (isDirectVideoUrl(url)) {
    try {
      const parsed = new URL(url);
      const fileName = parsed.pathname.split("/").filter(Boolean).pop() || "";
      return prettifyText(fileName.replace(/\.[a-z0-9]+$/i, "")) || `Video ${index + 1}`;
    } catch {
      return `Video ${index + 1}`;
    }
  }

  return `${provider} ${index + 1}`;
}

function getVideoThumbnailUrl(url) {
  const youtubeId = getYouTubeVideoId(url);
  if (youtubeId) {
    return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
  }

  return "";
}

function getYouTubeVideoId(url) {
  const safeUrl = ensureUrl(url);

  try {
    const parsed = new URL(safeUrl);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      return parsed.searchParams.get("v") || "";
    }

    if (host === "youtu.be") {
      return parsed.pathname.replace(/\//g, "");
    }
  } catch {
    return "";
  }

  return "";
}

function prettifyText(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function uniqueValues(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

const UI_TEXT = Object.freeze({
  en: {
    updatingLocalCache: "Updating local cache",
    checkingForUpdates: "Checking for updates",
    cachedAt: "Cached {time}",
    readyToBrowse: "Ready to browse",
    cacheVisibleAfterSync: "Directory cache becomes visible after the first successful sync.",
    basicListingsCached: "Basic listings cached {time}.",
    directoryTagline: DIRECTORY_TAGLINE,
    directoryStatus: "Directory status",
    status: "Status",
    language: "Language",
    english: "English",
    nepali: "Nepali",
    search: "Search",
    searchPlaceholder: "Search by name, district, field, program, or affiliation",
    liveDirectory: "Live directory",
    activeListingsCount: "{count} active listings",
    showAllInstitutes: "Show all institutes",
    showSavedInstitutesOnly: "Show saved institutes only",
    savedInstitutes: "Saved institutes",
    noSavedInstitutesYet: "No saved institutes yet",
    savedOnThisDevice: "{count} saved on this device",
    resetFilters: "Reset filters",
    updatingResults: "Updating results...",
    institutionsCount: "{count} institutions",
    savedCount: "{count} saved",
    provincesCount: "{count} provinces",
    fieldsCount: "{count} fields",
    type: "Type",
    field: "Field",
    fields: "Fields",
    level: "Level",
    province: "Province",
    district: "District",
    affiliation: "Affiliation",
    allTypes: "All types",
    allFields: "All fields",
    allLevels: "All levels",
    allProvinces: "All provinces",
    allDistricts: "All districts",
    allAffiliations: "All affiliations",
    selected: "Selected",
    pageOverview: "Page overview",
    previous: "Previous",
    next: "Next",
    paginationSummary: "Showing {start}-{end} of {total} on page {page}/{pages}",
    noSavedResultsTitle: "No saved institutes match this filter set.",
    noResultsTitle: "No institutes match this filter set.",
    noSavedResultsBody: "Use the bookmark buttons to save institutes locally, then they will appear here.",
    noResultsBody: "Try clearing one or two filters, or search with a district, level, or field.",
    footerNote: "Search, save, and compare published institutions faster.",
    aboutSection: "About",
    aboutLink: "About",
    contactUsLink: "Contact us",
    supportSection: "Support",
    helpFaqLink: "Help / FAQ",
    purchaseLink: "Purchase / Pricing",
    legalSection: "Legal",
    privacyLink: "Privacy",
    copyrightLink: "Copyright",
    socialSection: "Social",
    coverageSummary: "{listings} listings • {provinces} provinces • {fields} fields",
    browseQuickly: "Browse quickly",
    browseQuicklyTitle: "Quick filters for the home page",
    explore: "Explore",
    browseDirectory: "Browse directory",
    coverage: "Coverage",
    activeListings: "Active listings",
    provincesCovered: "Provinces covered",
    districtsCovered: "Districts covered",
    fieldsRepresented: "Fields represented",
    savedOnDeviceShort: "Saved on this device",
    allRightsReserved: "All rights reserved.",
    publicInstitutionDirectory: "Nepal public institution directory",
    backToResults: "Back to results",
    back: "Back",
    save: "Save",
    saved: "Saved",
    loadingFullProfile: "Loading the full profile.",
    certified: "Certified",
    overview: "Overview",
    levels: "Levels",
    location: "Location",
    gallery: "Gallery",
    videos: "Videos",
    contact: "Contact",
    social: "Social",
    detailFallbackDescription:
      "A concise profile is not available yet. The listing still includes its location, contact details, programs, and facilities.",
    notSet: "Not set",
    programs: "Programs",
    programsNotListed: "Programs have not been listed yet.",
    facilities: "Facilities",
    facilitiesNotListed: "Facilities have not been listed yet.",
    address: "Address",
    addressNotSet: "Address not set",
    phone: "Phone",
    phoneNotSet: "Phone not set",
    email: "Email",
    emailNotSet: "Email not set",
    website: "Website",
    websiteNotSet: "Website not set",
    call: "Call",
    open: "Open",
    openSource: "Open source",
    close: "Close",
    videoPopupUnavailable: "This video source cannot be played inside the popup.",
    coordinates: "Coordinates",
    coverageLabel: "Coverage",
    locationNotSet: "Location not set",
    openMap: "Open map",
    noMapCoordinates: "Live map coordinates have not been added yet.",
    openImage: "Open image",
    openGallery: "Open gallery",
    noGalleryLinks: "No gallery links have been added yet.",
    image: "Image",
    openFullImage: "Open the full image in a new tab.",
    noVideosYet: "No videos have been added yet.",
    play: "Play",
    removeFromSaved: "Remove {name} from saved",
    saveBusiness: "Save {name}",
    physicallyCertified: "Physically certified",
    supportSubject: "Subject",
    supportSubjectPlaceholder: "How can we help?",
    supportMessage: "Message",
    supportMessagePlaceholder: "Write your question or request here.",
    emailSupport: "Email support",
    notConfigured: "Not configured",
    listings: "Listings",
    types: "Types",
    pagesCount: "{count} pages",
    recently: "recently",
    justNow: "just now",
  },
  ne: {
    updatingLocalCache: "स्थानीय क्यास अद्यावधिक हुँदैछ",
    checkingForUpdates: "अद्यावधिक जाँच हुँदैछ",
    cachedAt: "{time} मा क्यास गरिएको",
    readyToBrowse: "हेर्न तयार",
    cacheVisibleAfterSync: "पहिलो सफल समक्रमणपछि डाइरेक्टरी क्यास देखिन्छ।",
    basicListingsCached: "आधारभूत सूचीहरू {time} मा क्यास गरियो।",
    directoryTagline: "नेपालको शैक्षिक निर्देशिका",
    directoryStatus: "डाइरेक्टरी स्थिति",
    status: "स्थिति",
    language: "भाषा",
    english: "English",
    nepali: "नेपाली",
    search: "खोज",
    searchPlaceholder: "नाम, जिल्ला, विषयक्षेत्र, कार्यक्रम वा सम्बन्धनबाट खोज्नुहोस्",
    liveDirectory: "लाइभ डाइरेक्टरी",
    activeListingsCount: "{count} सक्रिय सूची",
    showAllInstitutes: "सबै संस्था देखाउनुहोस्",
    showSavedInstitutesOnly: "सुरक्षित संस्थाहरू मात्र देखाउनुहोस्",
    savedInstitutes: "सुरक्षित संस्थाहरू",
    noSavedInstitutesYet: "अहिलेसम्म कुनै संस्था सुरक्षित गरिएको छैन",
    savedOnThisDevice: "यो उपकरणमा {count} सुरक्षित",
    resetFilters: "फिल्टर रिसेट गर्नुहोस्",
    updatingResults: "नतिजा अद्यावधिक हुँदैछ...",
    institutionsCount: "{count} संस्था",
    savedCount: "{count} सुरक्षित",
    provincesCount: "{count} प्रदेश",
    fieldsCount: "{count} विषयक्षेत्र",
    type: "प्रकार",
    field: "विषयक्षेत्र",
    fields: "विषयक्षेत्र",
    level: "तह",
    province: "प्रदेश",
    district: "जिल्ला",
    affiliation: "सम्बन्धन",
    allTypes: "सबै प्रकार",
    allFields: "सबै विषयक्षेत्र",
    allLevels: "सबै तह",
    allProvinces: "सबै प्रदेश",
    allDistricts: "सबै जिल्ला",
    allAffiliations: "सबै सम्बन्धन",
    selected: "चयन गरिएको",
    pageOverview: "पेज सारांश",
    previous: "अघिल्लो",
    next: "अर्को",
    paginationSummary: "{page}/{pages} पेजमा {total} मध्ये {start}-{end} देखाइँदै",
    noSavedResultsTitle: "यो फिल्टरमा कुनै सुरक्षित संस्था भेटिएन।",
    noResultsTitle: "यो फिल्टरमा कुनै संस्था भेटिएन।",
    noSavedResultsBody: "बुकमार्क बटन प्रयोग गरेर संस्था सुरक्षित गर्नुहोस्, त्यसपछि यहाँ देखिनेछ।",
    noResultsBody: "एक वा दुई फिल्टर हटाउनुहोस्, वा जिल्ला, तह वा विषयक्षेत्रबाट खोज्नुहोस्।",
    footerNote: "प्रकाशित संस्थाहरू छिटो खोज्न, सुरक्षित गर्न र तुलना गर्न मद्दत गर्दछ।",
    aboutSection: "हाम्रो बारेमा",
    aboutLink: "हाम्रो बारेमा",
    contactUsLink: "सम्पर्क गर्नुहोस्",
    supportSection: "सहयोग",
    helpFaqLink: "सहायता / FAQ",
    purchaseLink: "खरिद / मूल्य",
    legalSection: "कानुनी",
    privacyLink: "गोपनीयता",
    copyrightLink: "कपिराइट",
    socialSection: "सामाजिक",
    coverageSummary: "{listings} सूची • {provinces} प्रदेश • {fields} विषयक्षेत्र",
    browseQuickly: "छिटो हेर्नुहोस्",
    browseQuicklyTitle: "होम पेजका द्रुत फिल्टरहरू",
    explore: "अन्वेषण",
    browseDirectory: "डाइरेक्टरी हेर्नुहोस्",
    coverage: "समेटिएको क्षेत्र",
    activeListings: "सक्रिय सूची",
    provincesCovered: "समेटिएका प्रदेश",
    districtsCovered: "समेटिएका जिल्ला",
    fieldsRepresented: "समेटिएका विषयक्षेत्र",
    savedOnDeviceShort: "यो उपकरणमा सुरक्षित",
    allRightsReserved: "सबै अधिकार सुरक्षित।",
    publicInstitutionDirectory: "नेपाल सार्वजनिक संस्था निर्देशिका",
    backToResults: "नतिजामा फर्कनुहोस्",
    back: "फिर्ता",
    save: "सुरक्षित गर्नुहोस्",
    saved: "सुरक्षित",
    loadingFullProfile: "पूरा प्रोफाइल लोड हुँदैछ।",
    certified: "प्रमाणित",
    overview: "सारांश",
    levels: "तहहरू",
    location: "स्थान",
    gallery: "ग्यालरी",
    videos: "भिडियोहरू",
    contact: "सम्पर्क",
    social: "सामाजिक सञ्जाल",
    detailFallbackDescription:
      "संक्षिप्त प्रोफाइल उपलब्ध छैन, तर स्थान, सम्पर्क, कार्यक्रम र सुविधाहरू अझै सूचीमा समावेश छन्।",
    notSet: "सेट गरिएको छैन",
    programs: "कार्यक्रमहरू",
    programsNotListed: "कार्यक्रमहरू अझै सूचीबद्ध छैनन्।",
    facilities: "सुविधाहरू",
    facilitiesNotListed: "सुविधाहरू अझै सूचीबद्ध छैनन्।",
    address: "ठेगाना",
    addressNotSet: "ठेगाना छैन",
    phone: "फोन",
    phoneNotSet: "फोन छैन",
    email: "इमेल",
    emailNotSet: "इमेल छैन",
    website: "वेबसाइट",
    websiteNotSet: "वेबसाइट छैन",
    call: "कल",
    open: "खोल्नुहोस्",
    openSource: "स्रोत खोल्नुहोस्",
    close: "बन्द गर्नुहोस्",
    videoPopupUnavailable: "यो भिडियो पपअपभित्र चलाउन सकिँदैन।",
    coordinates: "निर्देशांक",
    coverageLabel: "कभरेज",
    locationNotSet: "स्थान छैन",
    openMap: "नक्सा खोल्नुहोस्",
    noMapCoordinates: "लाइभ नक्सा निर्देशांक थपिएको छैन।",
    openImage: "तस्बिर खोल्नुहोस्",
    openGallery: "ग्यालरी खोल्नुहोस्",
    noGalleryLinks: "ग्यालरी लिङ्कहरू अझै थपिएका छैनन्।",
    image: "तस्बिर",
    openFullImage: "पूरा तस्बिर नयाँ ट्याबमा खोल्नुहोस्।",
    noVideosYet: "भिडियोहरू अझै थपिएका छैनन्।",
    play: "चलाउनुहोस्",
    removeFromSaved: "{name} सुरक्षित सूचीबाट हटाउनुहोस्",
    saveBusiness: "{name} सुरक्षित गर्नुहोस्",
    physicallyCertified: "भौतिक रूपमा प्रमाणित",
    supportSubject: "विषय",
    supportSubjectPlaceholder: "हामी कसरी सहयोग गर्न सक्छौं?",
    supportMessage: "सन्देश",
    supportMessagePlaceholder: "आफ्नो प्रश्न वा अनुरोध यहाँ लेख्नुहोस्।",
    emailSupport: "इमेल समर्थन",
    notConfigured: "कन्फिगर गरिएको छैन",
    listings: "सूचीहरू",
    types: "प्रकारहरू",
    pagesCount: "{count} पेज",
    recently: "हालै",
    justNow: "अहिले",
  },
});

function formatSyncTimestamp(value, locale = "en") {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return t(locale, "recently");
  }

  const now = Date.now();
  const diffMs = now - parsed.getTime();
  const formatter = new Intl.RelativeTimeFormat(getLocaleTag(locale), {
    numeric: "auto",
  });

  if (diffMs < 60_000) {
    return t(locale, "justNow");
  }
  if (diffMs < 3_600_000) {
    return formatter.format(-Math.max(1, Math.round(diffMs / 60_000)), "minute");
  }
  if (diffMs < 86_400_000) {
    return formatter.format(-Math.max(1, Math.round(diffMs / 3_600_000)), "hour");
  }

  return parsed.toLocaleDateString(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function formatLocaleNumber(locale, value) {
  const safeNumber = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat(getLocaleTag(locale)).format(safeNumber);
}

function resolveLocale(value) {
  return String(value || "").toLowerCase().startsWith("ne") ? "ne" : "en";
}

function getLocaleTag(locale) {
  return resolveLocale(locale) === "ne" ? "ne-NP" : "en-US";
}

function t(locale, key, params = {}) {
  const normalizedLocale = resolveLocale(locale);
  const template =
    UI_TEXT[normalizedLocale]?.[key] ??
    UI_TEXT.en[key] ??
    key;

  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

function readPreferredLocale() {
  if (typeof window === "undefined") {
    return "en";
  }

  try {
    const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (savedLocale) {
      return resolveLocale(savedLocale);
    }
  } catch {
    // Ignore storage errors.
  }

  return resolveLocale(window.navigator?.language || "en");
}

function writePreferredLocale(locale) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, resolveLocale(locale));
  } catch {
    // Ignore storage errors.
  }
}

function normalizeRouteSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isCertifiedBusiness(business) {
  const rawValue = business?.is_certified;
  if (typeof rawValue === "string") {
    return ["true", "1", "yes", "certified"].includes(normalizeText(rawValue));
  }
  return Boolean(rawValue);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function readCache(key, fallback, storageType = "session") {
  const entry = readCacheEntry(key, storageType);
  return entry?.data ?? fallback;
}

function readCacheEntry(key, storageType = "session") {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = storageType === "local" ? window.localStorage : window.sessionStorage;
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(
  key,
  data,
  storageType = "session",
  savedAt = new Date().toISOString(),
  metadata = null
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storage = storageType === "local" ? window.localStorage : window.sessionStorage;
    const nextEntry = {
      saved_at: savedAt,
      data,
    };

    if (metadata) {
      nextEntry.version = String(metadata.version || "").trim();
      nextEntry.updated_at = String(metadata.updated_at || "").trim();
      nextEntry.count = Number.isFinite(Number(metadata.count)) ? Number(metadata.count) : null;
    }

    storage.setItem(
      key,
      JSON.stringify(nextEntry)
    );
  } catch {
    // Ignore storage errors.
  }
}

function normalizeDirectoryCacheStatus(source, fallbackCount = 0) {
  return {
    version: String(source?.version || "").trim(),
    updated_at: String(source?.updated_at || "").trim(),
    count: Number.isFinite(Number(source?.count)) ? Number(source.count) : fallbackCount,
  };
}

function hasDirectoryChanged(currentStatus, nextStatus, fallbackCount = 0) {
  const current = normalizeDirectoryCacheStatus(currentStatus, fallbackCount);
  const next = normalizeDirectoryCacheStatus(nextStatus, fallbackCount);

  if (next.version && current.version) {
    return next.version !== current.version;
  }
  if (next.updated_at && current.updated_at) {
    return next.updated_at !== current.updated_at;
  }
  if (Number.isFinite(next.count) && Number.isFinite(current.count) && next.count !== current.count) {
    return true;
  }

  return !(current.version || current.updated_at);
}

function getInitials(name) {
  return String(name || "Institute")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function focusElementWithoutScroll(element) {
  if (!element) {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function buildGradient(seed) {
  const hash = String(seed || "edu")
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 72% 80%), hsl(${(hue + 48) % 360} 68% 66%))`;
}

function formatArray(items) {
  return (items || []).filter(Boolean).join(", ");
}

function getBusinessCardAddress(business) {
  return business.contact?.address || business.location_label || "Address not set";
}

function buildBusinessLocationLine(business) {
  const mapInfo = getBusinessMapInfo(business);
  if (mapInfo) {
    return `${business.district || business.location_label || "Location"} · ${formatCoordinate(
      mapInfo.lat
    )}, ${formatCoordinate(mapInfo.lng)}`;
  }

  return business.location_label || "Location not set";
}

function getBusinessMapInfo(business) {
  const lat = numberOrNull(business?.contact?.map?.lat);
  const lng = numberOrNull(business?.contact?.map?.lng);

  if (lat === null || lng === null) {
    return null;
  }

  return {
    lat,
    lng,
    embedUrl: buildMapEmbedUrl(lat, lng),
    openUrl: buildMapOpenUrl(lat, lng),
  };
}

function buildMapEmbedUrl(lat, lng) {
  const zoomDelta = 0.018;
  const west = encodeURIComponent((lng - zoomDelta).toFixed(6));
  const south = encodeURIComponent((lat - zoomDelta).toFixed(6));
  const east = encodeURIComponent((lng + zoomDelta).toFixed(6));
  const north = encodeURIComponent((lat + zoomDelta).toFixed(6));
  const marker = `${encodeURIComponent(lat.toFixed(6))}%2C${encodeURIComponent(lng.toFixed(6))}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${marker}`;
}

function buildMapOpenUrl(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(
    lat.toFixed(6)
  )}&mlon=${encodeURIComponent(lng.toFixed(6))}#map=15/${encodeURIComponent(
    lat.toFixed(6)
  )}/${encodeURIComponent(lng.toFixed(6))}`;
}

function formatCoordinate(value) {
  return Number(value).toFixed(4);
}

function getPrimaryPhone(items) {
  return (items || []).map((item) => String(item || "").trim()).find(Boolean) || "";
}

function ensureUrl(url) {
  if (!url) {
    return "#";
  }
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function normalizeActionHref(url) {
  const value = String(url || "").trim();
  if (!value) {
    return "";
  }
  return /^(https?:|mailto:|tel:)/i.test(value) ? value : ensureUrl(value);
}

function stripUrlLabel(value) {
  return String(value || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function isDirectImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url);
}

function isDirectVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}

function getPreferredCoverImage(business) {
  const candidates = normalizeMediaList([
    business?.cover,
    business?.media?.cover,
    business?.logo,
    business?.media?.logo,
    ...(business?.media?.gallery || []),
  ]);
  const directImage = candidates.find((item) => isDirectImageUrl(item));
  return directImage ? ensureUrl(directImage) : "";
}

function detectGalleryProvider(url) {
  if (/drive\.google\.com/i.test(url)) {
    return "Google Drive gallery";
  }
  if (/mega\.(nz|io)/i.test(url)) {
    return "MEGA gallery";
  }
  if (/dropbox\.com/i.test(url)) {
    return "Dropbox gallery";
  }
  return "Open gallery";
}

function detectVideoProvider(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) {
    return "YouTube video";
  }
  if (/vimeo\.com/i.test(url)) {
    return "Vimeo video";
  }
  if (isDirectVideoUrl(url)) {
    return "Direct video";
  }
  return "External video";
}

function renderActionIcon(icon) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (icon) {
    case "bookmark":
      return (
        <svg {...common}>
          <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "institution":
      return (
        <svg {...common}>
          <path d="m3 9 9-5 9 5-9 5-9-5Z" />
          <path d="M7 11.5v4a1 1 0 0 0 .7 1 14 14 0 0 0 8.6 0 1 1 0 0 0 .7-1v-4" />
          <path d="M19 10v4.5" />
        </svg>
      );
    case "about":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6" />
          <path d="M12 7.5h.01" />
        </svg>
      );
    case "phone":
      return (
        <svg {...common}>
          <path d="M6.8 4.5h3.1l1.2 3.2-1.8 1.9a14.8 14.8 0 0 0 5.1 5.1l1.9-1.8 3.2 1.2v3.1c0 .9-.7 1.6-1.6 1.6A15.1 15.1 0 0 1 5.2 6.1c0-.9.7-1.6 1.6-1.6Z" />
        </svg>
      );
    case "help":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-.9.6-1.5 1.2-1.5 2.5" />
          <path d="M12 17h.01" />
        </svg>
      );
    case "pricing":
      return (
        <svg {...common}>
          <path d="M6 7h12" />
          <path d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7" />
          <rect x="4" y="7" width="16" height="13" rx="2" />
          <path d="M8 12h8" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3Z" />
        </svg>
      );
    case "copyright":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9.5a4 4 0 1 0 0 5" />
        </svg>
      );
    case "reset":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 1-2.3-5.7" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    case "sync":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      );
    case "back":
      return (
        <svg {...common}>
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </svg>
      );
    case "open":
      return (
        <svg {...common}>
          <path d="M14 5h5v5" />
          <path d="M10 14 19 5" />
          <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6 18 18" />
          <path d="M18 6 6 18" />
        </svg>
      );
    case "email":
      return (
        <svg {...common}>
          <path d="M4 7h16v10H4z" />
          <path d="m5 8 7 5 7-5" />
        </svg>
      );
    case "website":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18" />
          <path d="M12 3a15 15 0 0 0 0 18" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path d="M12 21s6-5.1 6-10a6 6 0 1 0-12 0c0 4.9 6 10 6 10Z" />
          <circle cx="12" cy="11" r="2.5" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M14 8h3V4h-3c-2.2 0-4 1.8-4 4v3H7v4h3v5h4v-5h3l1-4h-4V8c0-.6.4-1 1-1Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M16.5 7.5h.01" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <path d="M21 12s0-3.2-.4-4.7a2.4 2.4 0 0 0-1.7-1.7C17.4 5 12 5 12 5s-5.4 0-6.9.6a2.4 2.4 0 0 0-1.7 1.7C3 8.8 3 12 3 12s0 3.2.4 4.7a2.4 2.4 0 0 0 1.7 1.7C6.6 19 12 19 12 19s5.4 0 6.9-.6a2.4 2.4 0 0 0 1.7-1.7C21 15.2 21 12 21 12Z" />
          <path d="m10 15 5-3-5-3z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "twitter":
      return (
        <svg {...common}>
          <path d="M4 4 20 20" />
          <path d="M20 4 4 20" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14 5v8.2a3.2 3.2 0 1 1-2.6-3.1" />
          <path d="M14 5c1 .9 2.2 1.5 3.6 1.6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

function describeGalleryLink(url) {
  if (/folders/i.test(url)) {
    return "Open folder";
  }
  try {
    return new URL(ensureUrl(url)).hostname.replace(/^www\./, "");
  } catch {
    return "Open link";
  }
}

function getEmbeddedVideoUrl(url) {
  const safeUrl = ensureUrl(url);

  try {
    const parsed = new URL(safeUrl);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = parsed.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }

    if (host === "youtu.be") {
      const videoId = parsed.pathname.replace(/\//g, "");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    }

    if (host === "vimeo.com") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      return videoId ? `https://player.vimeo.com/video/${videoId}` : "";
    }
  } catch {
    return "";
  }

  return "";
}
