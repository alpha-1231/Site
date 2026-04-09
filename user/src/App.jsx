import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";
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

const BASIC_CACHE_KEY = "edudata-user-basic-v6";
const SAVED_CACHE_KEY = "edudata-user-saved-v1";
const RESULTS_PAGE_SIZE = 100;
const APP_BASE_PATH = normalizeBasePath(import.meta.env.BASE_URL || "/");
const SITE_NAME = String(import.meta.env.VITE_SITE_NAME || DEFAULT_SITE_NAME).trim() || DEFAULT_SITE_NAME;
const SITE_ORIGIN = normalizeSiteOrigin(import.meta.env.VITE_SITE_ORIGIN || DEFAULT_SITE_ORIGIN);

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
  const [selectedSlug, setSelectedSlug] = useState(() => getSelectedSlugFromLocation());
  const [selectedBusinessDetail, setSelectedBusinessDetail] = useState(null);
  const [activeVideo, setActiveVideo] = useState(null);
  const [loading, setLoading] = useState(cachedBusinesses.length === 0);
  const [syncState, setSyncState] = useState(cachedBusinesses.length ? "checking" : "syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState(cachedDirectorySyncedAt);
  const [directoryStatus, setDirectoryStatus] = useState(cachedDirectoryStatus);
  const [errorMessage, setErrorMessage] = useState("");
  const [detailErrorMessage, setDetailErrorMessage] = useState("");
  const [detailLoadingSlug, setDetailLoadingSlug] = useState("");
  const [filterLoading, setFilterLoading] = useState(false);
  const [resultsPage, setResultsPage] = useState(1);
  const [filters, setFilters] = useState(() => cloneDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState(() => cloneDefaultFilters());
  const [filtersArePending, startFilterTransition] = useTransition();
  const [showSyncActivity, setShowSyncActivity] = useState(cachedBusinesses.length === 0);
  const filterApplyTimerRef = useRef(0);
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
    }

    setActiveVideo(null);
    setSelectedBusinessDetail(null);
    setDetailErrorMessage("");
    setDetailLoadingSlug("");
    setResultsPage(1);
    setFilterLoading(false);

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
    return () => {
      if (filterApplyTimerRef.current) {
        window.clearTimeout(filterApplyTimerRef.current);
      }
    };
  }, []);

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
    if (selectedSlug || activeVideo) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = previousOverflow || "";
    }

    return () => {
      document.body.style.overflow = previousOverflow || "";
    };
  }, [selectedSlug, activeVideo]);

  useEffect(() => {
    if (typeof document === "undefined" || (!selectedSlug && !activeVideo)) {
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
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSlug, activeVideo]);

  const savedSlugSet = new Set(savedSlugs);
  const businessSlugSet = new Set(businesses.map((business) => business.slug));
  const appliedFilterCriteria = buildFilterCriteria(appliedFilters);
  const hasActiveFilters = hasActiveDirectoryFilters(filters);
  const filtersAreInSync = areDirectoryFiltersEqual(filters, appliedFilters);
  const isFiltering = filterLoading || !filtersAreInSync || filtersArePending;
  const deferFilteredList = loading || isFiltering;
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
      ? "Updating local cache"
      : syncState === "checking" && showSyncActivity
        ? "Checking for updates"
        : lastSyncedAt
          ? `Cached ${formatSyncTimestamp(lastSyncedAt)}`
          : "Ready to browse";
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
    syncStatusLabel === "Ready to browse"
      ? "Directory cache becomes visible after the first successful sync."
      : syncStatusLabel.startsWith("Cached ")
        ? `Basic listings ${syncStatusLabel.toLowerCase()}.`
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
  const seoBusiness = selectedBusiness || selectedBusinessSummary || null;
  const pageSeo = buildPageSeoData({
    siteName: SITE_NAME,
    siteOrigin: SITE_ORIGIN,
    pagePath: currentPagePath,
    route: selectedSlug
      ? {
          pageType: "detail",
          selectedSlug,
          listingKey: "",
          listingSlug: "",
          legacyHash: false,
        }
      : activeListingRoute,
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
    route: selectedSlug
      ? {
          pageType: "detail",
          selectedSlug,
          listingKey: "",
          listingSlug: "",
          legacyHash: false,
        }
      : activeListingRoute,
    selectedBusiness: seoBusiness,
    filters: appliedFilters,
  });
  useEffect(() => {
    updateDocumentSeo(pageSeo, structuredData);
  }, [pageSeo, structuredData]);

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
    const next = {
      ...filters,
      [key]: value,
      ...(key === "province" ? { district: "all" } : {}),
    };
    setFilters(next);
    setResultsPage(1);
    setFilterLoading(true);
    syncListingRoute(next, { replace: key === "search" });

    if (filterApplyTimerRef.current) {
      window.clearTimeout(filterApplyTimerRef.current);
    }

    filterApplyTimerRef.current = window.setTimeout(() => {
      filterApplyTimerRef.current = 0;
      startFilterTransition(() => {
        setAppliedFilters(next);
        setFilterLoading(false);
      });
    }, 0);
  }

  function resetFilters() {
    const nextFilters = cloneDefaultFilters();
    setFilters(nextFilters);
    setResultsPage(1);
    setFilterLoading(true);
    syncListingRoute(nextFilters);
    if (filterApplyTimerRef.current) {
      window.clearTimeout(filterApplyTimerRef.current);
    }
    filterApplyTimerRef.current = window.setTimeout(() => {
      filterApplyTimerRef.current = 0;
      startFilterTransition(() => {
        setAppliedFilters(nextFilters);
        setFilterLoading(false);
      });
    }, 0);
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

  return (
    <div className="app-shell">
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <div className="app-frame">
        <section className="directory-intro glass-panel">
          <div className="directory-intro-copy">
            <p className="eyebrow">aboutmyschool.com</p>
            <h1>
              Find schools, colleges, universities, technical institutes, and training centers
              across Nepal.
            </h1>
            <p>
              Compare programs, affiliation, facilities, location, contact details, photos,
              videos, and complete public institute profiles in one searchable educational
              directory.
            </p>
          </div>
          <div className="directory-intro-pill">
            <span>Live directory</span>
            <strong>{businesses.length} active listings</strong>
          </div>
        </section>

        <header className="topbar directory-ribbon glass-panel">
          <div className="directory-ribbon-brand">
            <div className="directory-ribbon-copy">
              <strong>aboutmyschool.com</strong>
              <span>{DIRECTORY_TAGLINE}</span>
            </div>
          </div>
          <div className="directory-ribbon-status" aria-label="Directory status">
            <span className="directory-ribbon-status-label">Status</span>
            <strong title={syncStatusLabel}>{syncStatusLabel}</strong>
          </div>
        </header>

        <section className="toolbar glass-panel">
          <div className="toolbar-head">
            <div className="search-wrap">
              <span className="search-hint">Search</span>
              <input
                className="search-input"
                type="search"
                value={filters.search}
                onChange={(event) => handleFilterChange("search", event.target.value)}
                placeholder="Search by name, district, field, program, or affiliation"
              />
            </div>
            <div className="toolbar-actions">
              <button
                type="button"
                className={`saved-filter-button ${filters.savedOnly ? "active" : ""}`}
                onClick={() => handleFilterChange("savedOnly", !filters.savedOnly)}
                aria-pressed={filters.savedOnly}
                aria-label={filters.savedOnly ? "Show all institutes" : "Show saved institutes only"}
                title={filters.savedOnly ? "Show all institutes" : "Show saved institutes only"}
              >
                <span className="saved-filter-icon" aria-hidden="true">
                  {renderActionIcon("bookmark")}
                </span>
                <span className="saved-filter-copy">
                  <strong>Saved institutes</strong>
                  <small>
                    {savedCount ? `${savedCount} saved on this device` : "No saved institutes yet"}
                  </small>
                </span>
              </button>

              <button
                className="ghost-button danger-button toolbar-reset-button"
                type="button"
                onClick={resetFilters}
                aria-label="Reset filters"
                title="Reset filters"
              >
                <span className="toolbar-action-icon" aria-hidden="true">
                  {renderActionIcon("reset")}
                </span>
                <span className="toolbar-action-label">Reset filters</span>
              </button>
            </div>
          </div>

          <div className="toolbar-meta">
            <span>{isFiltering ? "Filtering..." : `${filteredBusinessCount} institutions`}</span>
            <span>{savedCount} saved</span>
            <span>{DEFAULT_COUNTRY}</span>
            <span>{provinceCount} provinces</span>
            <span>{fieldCount} fields</span>
            <span>{syncStatusLabel}</span>
          </div>

          <div className="filter-grid">
            <FilterSelect
              label="Type"
              value={filters.type}
              onChange={(nextValue) => handleFilterChange("type", nextValue)}
              options={typeOptions}
              emptyLabel="All types"
            />
            <FilterSelect
              label="Field"
              value={filters.field}
              onChange={(nextValue) => handleFilterChange("field", nextValue)}
              options={fieldOptions}
              emptyLabel="All fields"
            />
            <FilterSelect
              label="Level"
              value={filters.level}
              onChange={(nextValue) => handleFilterChange("level", nextValue)}
              options={levelOptions}
              emptyLabel="All levels"
            />
            <FilterSelect
              label="Province"
              value={filters.province}
              onChange={(nextValue) => handleFilterChange("province", nextValue)}
              options={provinceOptions}
              emptyLabel="All provinces"
            />
            <FilterSelect
              label="District"
              value={filters.district}
              onChange={(nextValue) => handleFilterChange("district", nextValue)}
              options={districtOptions}
              emptyLabel="All districts"
            />
            <FilterSelect
              label="Affiliation"
              value={filters.affiliation}
              onChange={(nextValue) => handleFilterChange("affiliation", nextValue)}
              options={affiliationOptions}
              emptyLabel="All affiliations"
            />
          </div>
        </section>

        {errorMessage ? <div className="status-banner">{errorMessage}</div> : null}

        <main className="content-grid">
          <section ref={resultsPaneRef} className={`results-pane ${isFiltering ? "is-filtering" : ""}`}>
            {loading ? (
              <div className="card-grid">
                {Array.from({ length: 6 }).map((_, index) => (
                  <SkeletonCard key={index} />
                ))}
              </div>
            ) : isFiltering ? (
              <div className="filter-loading-indicator" role="status" aria-live="polite">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Filtering institutions...</span>
              </div>
            ) : null}
            {pagedBusinesses.length ? (
              <>
                <div className="card-grid">
                  {pagedBusinesses.map((business) => (
                    <BusinessCard
                      key={business.slug}
                      business={business}
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
                      Previous
                    </button>
                    <div className="results-pagination-copy">
                      Showing {pageStartIndex + 1}-{pageStartIndex + pagedBusinesses.length} of{" "}
                      {filteredBusinessCount} on page {currentResultsPage}/{totalResultsPages}
                    </div>
                    <button
                      type="button"
                      className="ghost-button pagination-button"
                      onClick={() => changeResultsPage(1)}
                      disabled={currentResultsPage === totalResultsPages}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-panel glass-panel">
                <h2>
                  {filters.savedOnly
                    ? "No saved institutes match this filter set."
                    : "No institutes match this filter set."}
                </h2>
                <p>
                  {filters.savedOnly
                    ? "Use the bookmark buttons to save institutes locally, then they will appear here."
                    : "Try clearing one or two filters, or search with a district, level, or field."}
                </p>
              </div>
            )}
          </section>
        </main>

        <footer className="app-footer glass-panel">
          <div className="app-footer-main">
            <div className="app-footer-brand">
              <div className="app-footer-brand-row">
                <div className="app-footer-mark" aria-hidden="true">
                  {renderActionIcon("institution")}
                </div>
                <div className="app-footer-copy">
                  <strong>{DIRECTORY_BRAND}</strong>
                  <p>{DIRECTORY_TAGLINE}</p>
                </div>
              </div>
              <p className="app-footer-note">
                Search, save, and compare published institutions faster.
              </p>
            </div>

            <div className="app-footer-column">
              <span className="app-footer-heading">Explore</span>
              <div className="app-footer-links">
                <button type="button" className="footer-link-button" onClick={handleBrowseDirectory}>
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("institution")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>Browse directory</strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="footer-link-button"
                  onClick={handleBrowseSavedInstitutes}
                >
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("bookmark")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>Saved institutes</strong>
                  </span>
                </button>
                <button type="button" className="footer-link-button" onClick={resetFilters}>
                  <span className="footer-link-icon" aria-hidden="true">
                    {renderActionIcon("reset")}
                  </span>
                  <span className="footer-link-copy">
                    <strong>Reset filters</strong>
                  </span>
                </button>
              </div>
            </div>

            <div className="app-footer-column">
              <span className="app-footer-heading">Coverage</span>
              <div className="app-footer-metrics">
                <div className="footer-metric">
                  <strong>{businesses.length}</strong>
                  <span>Active listings</span>
                </div>
                <div className="footer-metric">
                  <strong>{provinceCount}</strong>
                  <span>Provinces covered</span>
                </div>
                <div className="footer-metric">
                  <strong>{fieldCount}</strong>
                  <span>Fields represented</span>
                </div>
                <div className="footer-metric">
                  <strong>{savedCount}</strong>
                  <span>Saved on this device</span>
                </div>
              </div>
            </div>
          </div>

          <div className="app-footer-legal">
            <span>
              &copy; {currentYear} {DIRECTORY_BRAND}. All rights reserved.
            </span>
            <span className="app-footer-country">
              <CountryFlagIcon countryName={DEFAULT_COUNTRY} className="app-footer-country-flag" />
              <span>{DEFAULT_COUNTRY} public institution directory</span>
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
                  aria-label="Back to results"
                >
                  <span className="button-icon" aria-hidden="true">
                    {renderActionIcon("back")}
                  </span>
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  className={`save-button detail-save-floating ${selectedBusinessIsSaved ? "saved" : ""}`}
                  onClick={() => toggleSavedBusiness(selectedBusiness.slug)}
                >
                  <span className="button-icon" aria-hidden="true">
                    {renderActionIcon("bookmark")}
                  </span>
                  <span>{selectedBusinessIsSaved ? "Saved" : "Save"}</span>
                </button>
              </section>

              <section className="detail-body">
                {detailIsLoading ? (
                  <div className="detail-loading">Loading the full profile.</div>
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
                            <span>Certified</span>
                          </span>
                        ) : null}
                        {selectedBusiness.affiliation ? (
                          <span className="meta-badge subdued">{selectedBusiness.affiliation}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </header>

                <SectionBlock title="Overview">
                  <p className="body-copy">
                    {selectedBusiness.description ||
                      "A concise profile is not available yet. The listing still includes its location, contact details, programs, and facilities."}
                  </p>
                  <div className="info-grid">
                    <InfoItem
                      label="Affiliation"
                      value={selectedBusiness.affiliation || "Not set"}
                    />
                    <InfoItem
                      label="Levels"
                      value={formatArray(selectedBusiness.level) || "Not set"}
                    />
                    <InfoItem
                      label="Fields"
                      value={formatArray(selectedBusiness.field) || "Not set"}
                    />
                    <InfoItem
                      label="Programs"
                      value={String(
                        selectedBusiness.stats?.programs_count ||
                          selectedBusiness.programs?.length ||
                          0
                      )}
                    />
                  </div>
                </SectionBlock>

                <SectionBlock title="Programs">
                  <TagList
                    items={selectedBusiness.programs}
                    emptyLabel="Programs have not been listed yet."
                  />
                </SectionBlock>

                <SectionBlock title="Facilities">
                  <TagList
                    items={selectedBusiness.facilities}
                    emptyLabel="Facilities have not been listed yet."
                  />
                </SectionBlock>

                <SectionBlock title="Location">
                  <BusinessLocationSection business={selectedBusiness} />
                </SectionBlock>

                <SectionBlock title="Gallery">
                  <GallerySection items={selectedBusiness.media?.gallery} />
                </SectionBlock>

                <SectionBlock title="Videos">
                  <VideoSection
                    items={selectedBusiness.media?.videos}
                    onOpenVideo={handleOpenVideo}
                  />
                </SectionBlock>

                <SectionBlock title="Contact">
                  <div className="contact-stack">
                    <InfoItem
                      label="Address"
                      value={selectedBusiness.contact?.address || "Address not set"}
                    />
                    <InfoItem
                      label="Phone"
                      value={formatArray(selectedBusiness.contact?.phone) || "Phone not set"}
                    />
                    <InfoItem
                      label="Email"
                      value={selectedBusiness.contact?.email || "Email not set"}
                    />
                    <InfoItem
                      label="Website"
                      value={selectedBusiness.contact?.website || "Website not set"}
                    />
                  </div>
                  <div className="icon-action-row">
                    <IconActionLink
                      label="Call"
                      href={
                        getPrimaryPhone(selectedBusiness.contact?.phone)
                          ? `tel:${getPrimaryPhone(selectedBusiness.contact?.phone)}`
                          : ""
                      }
                      icon="phone"
                    />
                    <IconActionLink
                      label="Email"
                      href={
                        selectedBusiness.contact?.email
                          ? `mailto:${selectedBusiness.contact.email}`
                          : ""
                      }
                      icon="email"
                    />
                    <IconActionLink
                      label="Website"
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

                <SectionBlock title="Social">
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
                    <p>This video source cannot be played inside the popup.</p>
                    <a
                      href={activeVideo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="media-open-button"
                    >
                      Open source
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BusinessCard({ business, isSelected, isSaved, onSelect, onToggleSaved }) {
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
        aria-label={isSaved ? `Remove ${business.name} from saved` : `Save ${business.name}`}
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
          {isCertified ? <span className="card-certified-dot" aria-label="Physically certified" title="Physically certified" /> : null}
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
            <h2 className="card-title card-title-large" title={business.name}>
              {business.name}
            </h2>
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
          <span>Open</span>
        </a>
        <CardActionLink label="Call" href={phone ? `tel:${phone}` : ""} icon="phone" />
        <CardActionLink label="Email" href={email ? `mailto:${email}` : ""} icon="email" />
        <CardActionLink label="Website" href={website ? ensureUrl(website) : ""} icon="website" external />
      </div>
    </article>
  );
}

function BrowseSection({ title, description, links }) {
  if (!links.length) {
    return null;
  }

  return (
    <section className="homepage-panel glass-panel">
      <div className="homepage-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="homepage-panel-stat">{links.length} pages</span>
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

function FilterSelect({ label, value, onChange, options, emptyLabel }) {
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
              {value === option.value ? <strong>Selected</strong> : null}
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

function GallerySection({ items }) {
  const galleryItems = normalizeMediaList(items);
  if (!galleryItems.length) {
    return <p className="muted">No gallery links have been added yet.</p>;
  }

  return (
    <div className="media-grid">
      {galleryItems.map((item) => {
        if (isDirectImageUrl(item)) {
          return (
            <div key={item} className="media-card image-card">
              <img src={ensureUrl(item)} alt="Business gallery preview" loading="lazy" />
              <div className="media-card-body">
                <strong>Image</strong>
                <span>Open the full image in a new tab.</span>
                <a
                  className="media-open-button"
                  href={ensureUrl(item)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open image
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
              Open gallery
            </a>
          </div>
        );
      })}
    </div>
  );
}

function VideoSection({ items, onOpenVideo }) {
  const videos = normalizeVideoEntries(items);
  if (!videos.length) {
    return <p className="muted">No videos have been added yet.</p>;
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
              <span className="video-play-badge">Play</span>
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

function BusinessLocationSection({ business }) {
  const mapInfo = getBusinessMapInfo(business);

  if (!mapInfo) {
    return <p className="muted">Live map coordinates have not been added yet.</p>;
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
          label="Coordinates"
          value={`${formatCoordinate(mapInfo.lat)}, ${formatCoordinate(mapInfo.lng)}`}
        />
        <InfoItem
          label="Coverage"
          value={business.location_label || business.district || "Location not set"}
        />
      </div>
      <div className="icon-action-row location-actions">
        <IconActionLink label="Open Map" href={mapInfo.openUrl} icon="map" external />
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

function buildBrowseLinkGroups(businesses, routeKey, getValue, limit) {
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
      count,
      href: buildCollectionPath(routeKey, label, APP_BASE_PATH),
      description:
        routeKey === "field"
          ? `View ${count} active institutes covering ${label}.`
          : routeKey === "type"
            ? `Open the Nepal ${label.toLowerCase()} directory page.`
            : `Explore ${count} active institutes in ${label}.`,
    }));
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

function formatSyncTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return "recently";
  }

  const now = Date.now();
  const diffMs = now - parsed.getTime();

  if (diffMs < 60_000) {
    return "just now";
  }
  if (diffMs < 3_600_000) {
    return `${Math.max(1, Math.round(diffMs / 60_000))} min ago`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.max(1, Math.round(diffMs / 3_600_000))} hr ago`;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
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
    case "phone":
      return (
        <svg {...common}>
          <path d="M6.8 4.5h3.1l1.2 3.2-1.8 1.9a14.8 14.8 0 0 0 5.1 5.1l1.9-1.8 3.2 1.2v3.1c0 .9-.7 1.6-1.6 1.6A15.1 15.1 0 0 1 5.2 6.1c0-.9.7-1.6 1.6-1.6Z" />
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
