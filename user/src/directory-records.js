const PROVINCE_NAMES = {
  "1": "Koshi",
  "2": "Madhesh",
  "3": "Bagmati",
  "4": "Gandaki",
  "5": "Lumbini",
  "6": "Karnali",
  "7": "Sudurpashchim",
};

export function processPublicBusinessRecords(
  records,
  { sourceIsPublic = false, summary = true } = {}
) {
  const normalizedRecords = Array.isArray(records) ? records : [];
  const visibleRecords = sourceIsPublic
    ? normalizedRecords
    : normalizedRecords.filter(isPublicRecordVisible);

  return visibleRecords
    .map((record) => (summary ? createPublicBusinessSummary(record) : decoratePublicRecord(record)))
    .sort(sortPublicBusinesses);
}

export function decoratePublicRecord(record) {
  const provinceName =
    stringOrDefault(record?.province_name) || PROVINCE_NAMES[String(record?.province || "")] || "";
  const locationLabel =
    stringOrDefault(record?.location_label) ||
    [record?.district, provinceName].filter(Boolean).join(", ");

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
    is_verified: Boolean(record?.is_verified),
    is_certified: Boolean(record?.is_certified),
    tags: sanitizeBusinessTags(record?.tags),
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
    created_at: stringOrDefault(record?.created_at),
    updated_at: stringOrDefault(record?.updated_at),
    search_text: buildSearchText(record, provinceName),
  };
}

function createPublicBusinessSummary(record) {
  const decorated = decoratePublicRecord(record);

  return {
    id: decorated.id,
    slug: decorated.slug,
    name: decorated.name,
    name_np: decorated.name_np,
    type: decorated.type,
    type_key: decorated.type_key,
    level: decorated.level,
    field: decorated.field,
    affiliation: decorated.affiliation,
    affiliation_key: decorated.affiliation_key,
    district: decorated.district,
    district_key: decorated.district_key,
    province: decorated.province,
    province_name: decorated.province_name,
    province_key: decorated.province_key,
    location_label: decorated.location_label,
    is_verified: decorated.is_verified,
    is_certified: decorated.is_certified,
    tags: decorated.tags,
    logo: decorated.logo,
    cover: decorated.cover,
    contact: {
      address: decorated.contact.address,
      phone: decorated.contact.phone,
      email: decorated.contact.email,
      website: decorated.contact.website,
      map: decorated.contact.map,
    },
    media: {
      logo: decorated.media.logo,
      cover: decorated.media.cover,
    },
    created_at: decorated.created_at,
    updated_at: decorated.updated_at,
    search_text: decorated.search_text,
  };
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
    ...sanitizeBusinessTags(record?.tags),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sortPublicBusinesses(left, right) {
  const nameCompare = String(left?.name || "").localeCompare(String(right?.name || ""));
  return nameCompare || String(left?.slug || "").localeCompare(String(right?.slug || ""));
}

export function isPublicRecordVisible(record) {
  const subscription = record?.subscription || {};
  const expiresAt = subscription?.expires_at ? new Date(subscription.expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime())) {
    return expiresAt.getTime() > Date.now();
  }

  return String(subscription?.payment_status || "").trim().toLowerCase() === "active";
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

function sanitizeBusinessTags(value) {
  return cleanStringArray(value).filter(
    (tag) => String(tag || "").trim().toLowerCase() !== "featured-campus"
  );
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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}
