import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DIR = path.resolve(__dirname, "..");
const ROOT_DIR = path.resolve(USER_DIR, "..");
const OUTPUT_FILE = path.join(USER_DIR, "src", "seo-generated.js");
const ABOUT_FILE = resolveExistingFile([
  path.join(USER_DIR, "about.txt"),
  path.join(ROOT_DIR, "about.txt"),
]);
const KEYWORD_FILES = [
  resolveExistingFile([
    path.join(USER_DIR, "aboutmyschool_1000_keywords.txt"),
    path.join(ROOT_DIR, "aboutmyschool_1000_keywords.txt"),
  ]),
  resolveExistingFile([
    path.join(USER_DIR, "new_keywords.txt"),
    path.join(ROOT_DIR, "new_keywords.txt"),
  ]),
].filter(Boolean);

const HOME_SECTION_CONFIGS = [
  {
    match: "OVERVIEW",
    title: "A complete education directory for Nepal",
    sentences: 1,
    maxLength: 220,
  },
  {
    match: "WHAT IS ABOUTMYSCHOOL?",
    title: "Detailed institutional profiles in one place",
    sentences: 2,
    maxLength: 280,
  },
  {
    match: "THE SEARCH SYSTEM",
    title: "Fast search built for real school discovery",
    sentences: 1,
    maxLength: 220,
  },
  {
    match: "FILTER SYSTEM",
    title: "Filters for district, type, field, and affiliation",
    sentences: 2,
    maxLength: 280,
  },
  {
    match: "TECHNICAL HIGHLIGHTS",
    title: "Structured pages that search engines can understand",
    sentences: 1,
    maxLength: 230,
  },
];

const AFFILIATION_HINTS = [
  "tribhuvan university",
  "tu ",
  "tu affiliated",
  "kathmandu university",
  "ku ",
  "ku affiliated",
  "pokhara university",
  "pu ",
  "pu affiliated",
  "purbanchal university",
  "mid-western university",
  "mid western university",
  "far-western university",
  "far western university",
  "lumbini buddhist university",
  "agriculture and forestry university",
  "afu ",
  "nepal open university",
  "ctevt",
  "neb",
  "cdc",
  "affiliation",
  "सम्बद्ध",
  "सम्बन्धन",
];

const FIELD_HINTS = [
  "science",
  "management",
  "humanities",
  "arts",
  "commerce",
  "engineering",
  "medical",
  "mbbs",
  "bds",
  "nursing",
  "pharmacy",
  "public health",
  "health science",
  "paramedical",
  "law",
  "llb",
  "llm",
  "it",
  "computer",
  "software",
  "information technology",
  "bca",
  "bbs",
  "bba",
  "bsc csit",
  "bit",
  "agriculture",
  "forestry",
  "veterinary",
  "hotel management",
  "tourism",
  "journalism",
  "mass communication",
  "social work",
  "psychology",
  "sociology",
  "economics",
  "fine arts",
  "music",
  "sports science",
  "development studies",
  "विज्ञान",
  "व्यवस्थापन",
  "मानविकी",
  "इञ्जिनियरिङ",
  "इन्जिनियरिङ",
  "चिकित्सा",
  "नर्सिङ",
  "कानून",
  "सूचना प्रविधि",
  "कृषि",
  "वन विज्ञान",
  "फार्मेसी",
  "होटल व्यवस्थापन",
  "पर्यटन",
  "पत्रकारिता",
  "ललित कला",
  "सार्वजनिक स्वास्थ्य",
];

const DETAIL_HINTS = [
  "admission",
  "fee",
  "fees",
  "tuition",
  "contact",
  "phone",
  "email",
  "website",
  "map",
  "address",
  "photos",
  "photo",
  "images",
  "image",
  "gallery",
  "video",
  "videos",
  "review",
  "rating",
  "ranking",
  "scholarship",
  "facilities",
  "facility",
  "profile",
  "information",
  "details",
  "curriculum",
  "syllabus",
  "result",
  "exam",
  "admission open",
  "virtual tour",
  "social media",
  "facebook",
  "youtube",
  "instagram",
  "gallery",
  "भर्ना",
  "शुल्क",
  "सम्पर्क",
  "ठेगाना",
  "फोन",
  "इमेल",
  "वेबसाइट",
  "नक्सा",
  "फोटो",
  "भिडियो",
  "छात्रवृत्ति",
  "सुविधा",
  "प्रोफाइल",
  "जानकारी",
  "विवरण",
  "पाठ्यक्रम",
  "नतिजा",
];

const TYPE_HINTS = [
  "school",
  "schools",
  "college",
  "colleges",
  "university",
  "universities",
  "campus",
  "institute",
  "institutes",
  "training center",
  "training institute",
  "technical school",
  "technical institute",
  "vocational school",
  "boarding school",
  "community school",
  "government school",
  "private school",
  "international school",
  "higher secondary",
  "plus two",
  "+2",
  "primary school",
  "secondary school",
  "विद्यालय",
  "कलेज",
  "विश्वविद्यालय",
  "संस्था",
  "प्राथमिक विद्यालय",
  "माध्यमिक विद्यालय",
  "उच्च माध्यमिक विद्यालय",
  "प्लस टु कलेज",
];

const HOME_HINTS = [
  "aboutmyschool",
  "directory",
  "finder",
  "portal",
  "search",
  "listing",
  "database",
  "profile",
  "institution",
  "education website",
  "education platform",
  "शैक्षिक निर्देशिका",
  "शिक्षा पोर्टल",
  "विद्यालय सूची",
  "कलेज सूची",
  "विद्यालय खोज",
  "कलेज खोज",
];

const PROVINCE_HINTS = [
  "province",
  "प्रदेश",
  "koshi",
  "madhesh",
  "bagmati",
  "gandaki",
  "lumbini",
  "karnali",
  "sudurpashchim",
  "कोशी",
  "मधेश",
  "बागमती",
  "गण्डकी",
  "लुम्बिनी",
  "कर्णाली",
  "सुदूरपश्चिम",
];

const LOCATION_SUPPORT_HINTS = [
  "near me",
  "location",
  "map",
  "address",
  "contact number",
  "phone number",
  "directory",
  "finder",
  "search",
  "portal",
  "map nepal",
  "location map",
  "district school count",
  "province college list",
  "विद्यालय नक्सा",
  "विद्यालय ठेगाना",
  "कलेज ठेगाना",
  "सम्पर्क नम्बर",
  "विद्यालय जानकारी",
  "कलेज जानकारी",
];

const CORE_FEATURE_PATTERNS = [
  ["program", "programs"],
  ["affiliation", "affiliations"],
  ["facility", "facilities"],
  ["contact", "contact details"],
  ["map", "maps"],
  ["photo", "photos"],
  ["video", "videos"],
];

const FALLBACK_SITE_DESCRIPTION =
  "AboutMySchool is Nepal's educational directory for schools, colleges, universities, technical institutes, and training centers with searchable profiles, affiliations, facilities, contact details, maps, photos, and videos.";

main();

function main() {
  const keywordItems = dedupeKeywords(KEYWORD_FILES.flatMap(readKeywordFile));
  const aboutText = readTextFile(ABOUT_FILE);
  const englishAboutText = extractEnglishAboutText(aboutText);
  const aboutSections = parseAboutSections(englishAboutText);
  const keywordBuckets = buildKeywordBuckets(keywordItems);
  const siteDescription = buildSiteDescription(aboutSections, englishAboutText, keywordBuckets);
  const homeSections = buildHomeSections(aboutSections, keywordBuckets);

  const generated = {
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      about: normalizeOutputPath(ABOUT_FILE),
      keywords: KEYWORD_FILES.map(normalizeOutputPath),
    },
    stats: {
      totalKeywords: keywordItems.length,
      bucketSizes: Object.fromEntries(
        Object.entries(keywordBuckets).map(([key, values]) => [key, values.length])
      ),
      aboutSections: Object.keys(aboutSections).length,
    },
    siteDescription,
    siteKeywords: keywordBuckets.home.slice(0, 16),
    homeSections,
    pageTypeKeywords: keywordBuckets,
  };

  const output = [
    "/* This file is auto-generated by scripts/generate-seo-content.mjs. */",
    "/* Do not edit it by hand; update the source keyword files or about.txt instead. */",
    `export const GENERATED_SEO_CONTENT = Object.freeze(${JSON.stringify(generated, null, 2)});`,
    "",
    "export const GENERATED_SITE_DESCRIPTION = GENERATED_SEO_CONTENT.siteDescription;",
    "export const GENERATED_SITE_KEYWORDS = Object.freeze(GENERATED_SEO_CONTENT.siteKeywords);",
    "export const GENERATED_HOME_SEO_SECTIONS = Object.freeze(GENERATED_SEO_CONTENT.homeSections);",
    "export const GENERATED_PAGE_TYPE_KEYWORDS = Object.freeze(GENERATED_SEO_CONTENT.pageTypeKeywords);",
    "",
  ].join("\n");

  fs.writeFileSync(OUTPUT_FILE, output, "utf8");
  console.log(
    `Generated ${path.relative(USER_DIR, OUTPUT_FILE)} from ${keywordItems.length} deduped keywords.`
  );
}

function readKeywordFile(filePath) {
  const raw = readTextFile(filePath);
  return raw
    .split(/[\n,]/)
    .map((part) => cleanKeyword(part))
    .filter(Boolean);
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function cleanKeyword(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKeywords(items) {
  const seen = new Set();
  const next = [];

  for (const item of items) {
    const key = normalizeKeywordKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }

  return next;
}

function normalizeKeywordKey(value) {
  return cleanKeyword(value)
    .toLowerCase()
    .replace(/[|/]+/g, " ")
    .replace(/[^\w\u0900-\u097F+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEnglishAboutText(text) {
  const marker = "ABOUTMYSCHOOL.COM — सम्पूर्ण";
  const index = String(text || "").indexOf(marker);
  return index === -1 ? String(text || "") : String(text || "").slice(0, index);
}

function parseAboutSections(text) {
  const sections = {};
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let currentHeading = "";
  let currentLines = [];

  function commitSection() {
    const heading = cleanKeyword(currentHeading);
    const content = cleanSectionBody(currentLines.join("\n"));
    if (heading && content) {
      sections[heading] = content;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const nextLine = String(lines[index + 1] || "").trim();

    if (isAboutHeadingLine(line) && /^-+$/.test(nextLine)) {
      if (currentHeading) {
        commitSection();
      }
      currentHeading = line;
      currentLines = [];
      index += 1;
      continue;
    }

    if (currentHeading) {
      currentLines.push(lines[index]);
    }
  }

  if (currentHeading) {
    commitSection();
  }

  return sections;
}

function cleanSectionBody(text) {
  return String(text || "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*-\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

function buildKeywordBuckets(keywords) {
  const buckets = {
    home: [],
    province: [],
    district: [],
    type: [],
    field: [],
    detail: [],
    affiliation: [],
  };

  for (const keyword of keywords) {
    const normalized = normalizeKeywordKey(keyword);
    const locationSpecific = isLocationSpecificKeyword(normalized);

    if (matchesAny(normalized, AFFILIATION_HINTS)) {
      pushKeyword(buckets.affiliation, keyword);
      continue;
    }

    if (!locationSpecific && matchesAny(normalized, FIELD_HINTS)) {
      pushKeyword(buckets.field, keyword);
      continue;
    }

    if (matchesAny(normalized, PROVINCE_HINTS)) {
      pushKeyword(buckets.province, keyword);
      continue;
    }

    if (matchesAny(normalized, DETAIL_HINTS)) {
      pushKeyword(buckets.detail, keyword);
      continue;
    }

    if (!locationSpecific && matchesAny(normalized, HOME_HINTS)) {
      pushKeyword(buckets.home, keyword);
      continue;
    }

    if (!locationSpecific && matchesAny(normalized, TYPE_HINTS)) {
      pushKeyword(buckets.type, keyword);
      continue;
    }

    if (matchesAny(normalized, LOCATION_SUPPORT_HINTS)) {
      pushKeyword(buckets.district, keyword);
    }
  }

  const homeDefaults = [
    "AboutMySchool Nepal",
    "Nepal school directory",
    "Nepal college directory",
    "Nepal university directory",
    "Nepal education directory",
    "find schools in Nepal",
    "find colleges in Nepal",
    "नेपाल शिक्षा निर्देशिका",
    "विद्यालय खोज नेपाल",
    "कलेज खोज नेपाल",
  ];
  const provinceDefaults = [
    "schools in Nepal provinces",
    "colleges in Nepal provinces",
    "province education directory Nepal",
    "कोशी प्रदेशका विद्यालयहरू",
    "बागमती प्रदेशका विद्यालयहरू",
  ];
  const districtDefaults = [
    "school address Nepal",
    "college address Nepal",
    "school location map Nepal",
    "college contact number Nepal",
    "विद्यालय ठेगाना नेपाल",
    "कलेज सम्पर्क नम्बर नेपाल",
  ];
  const typeDefaults = [
    "school in Nepal",
    "college in Nepal",
    "university in Nepal",
    "technical institute Nepal",
    "higher secondary school Nepal",
    "प्राथमिक विद्यालय नेपाल",
  ];
  const fieldDefaults = [
    "science college Nepal",
    "management college Nepal",
    "engineering college Nepal",
    "medical college Nepal",
    "law college Nepal",
    "विज्ञान कलेज नेपाल",
  ];
  const detailDefaults = [
    "school admission Nepal",
    "college admission Nepal",
    "institution profile Nepal",
    "school fees Nepal",
    "college map Nepal",
    "विद्यालय भर्ना नेपाल",
  ];
  const affiliationDefaults = [
    "Tribhuvan University affiliated college",
    "Kathmandu University affiliated college",
    "Pokhara University college",
    "CTEVT institute Nepal",
    "NEB affiliated school",
    "त्रिभुवन विश्वविद्यालय सम्बद्ध कलेज",
  ];

  return {
    home: finalizeBucket(buckets.home.filter(isHomeFriendlyKeyword), homeDefaults, 18),
    province: finalizeBucket(
      [
        ...buckets.province.filter(isProvinceFriendlyKeyword),
        ...buckets.district.filter((item) => matchesAny(normalizeKeywordKey(item), ["province", "प्रदेश"])),
      ],
      provinceDefaults,
      24
    )
      .filter(
        (item) =>
          isProvinceFriendlyKeyword(item) ||
          provinceDefaults.some((fallback) => normalizeKeywordKey(fallback) === normalizeKeywordKey(item))
      )
      .slice(0, 18),
    district: finalizeBucket(buckets.district.filter(isDistrictFriendlyKeyword), districtDefaults, 18),
    type: finalizeBucket(buckets.type.filter(isTypeFriendlyKeyword), typeDefaults, 18),
    field: finalizeBucket(buckets.field.filter(isFieldFriendlyKeyword), fieldDefaults, 24)
      .filter(
        (item) =>
          isFieldFriendlyKeyword(item) ||
          fieldDefaults.some((fallback) => normalizeKeywordKey(fallback) === normalizeKeywordKey(item))
      )
      .slice(0, 18),
    detail: finalizeBucket(buckets.detail.filter(isDetailFriendlyKeyword), detailDefaults, 18),
    affiliation: finalizeBucket(
      buckets.affiliation.filter(isAffiliationFriendlyKeyword),
      affiliationDefaults,
      18
    ),
  };
}

function buildSiteDescription(sections, aboutText, keywordBuckets) {
  const featureLabels = CORE_FEATURE_PATTERNS.filter(([pattern]) =>
    String(aboutText || "").toLowerCase().includes(pattern)
  ).map(([, label]) => label);
  const features = joinNaturalList(featureLabels.slice(0, 7));
  const nouns = joinNaturalList([
    "schools",
    "colleges",
    "universities",
    "technical institutes",
    "training centers",
  ]);

  const result = truncateText(
    `AboutMySchool is Nepal's educational directory for ${nouns} with searchable profiles${features ? `, ${features}` : ""}.`,
    190
  );

  return result || FALLBACK_SITE_DESCRIPTION;
}

function buildHomeSections(sections, keywordBuckets) {
  const result = [];

  for (const sectionConfig of HOME_SECTION_CONFIGS) {
    const bodySource = findAboutSectionByPrefix(sections, sectionConfig.match);
    if (!bodySource) {
      continue;
    }

    const body = summarizeSectionBody(bodySource, sectionConfig);
    if (!body) {
      continue;
    }

    result.push({
      title: sectionConfig.title || toTitleCase(sectionConfig.match),
      body,
    });
  }

  if (result.length) {
    return result.slice(0, 4);
  }

  return [
    {
      title: "A complete education directory for Nepal",
      body:
        "AboutMySchool helps students, parents, and institutions discover schools, colleges, universities, and training centers across Nepal with searchable public profiles.",
    },
    {
      title: "Profiles built for comparison",
      body:
        "Each listing can include programs, affiliations, facilities, contact details, maps, photos, and videos so families can compare institutions faster.",
    },
    {
      title: "Search by district, type, and field",
      body: `The platform supports keyword search and route-based browsing for ${joinNaturalList(
        keywordBuckets.type.slice(0, 3)
      )} with province, district, and field filters.`,
    },
  ];
}

function summarizeSectionBody(text, options = {}) {
  const compact = cleanParagraphText(text);
  if (!compact) {
    return "";
  }

  if (options.match === "FILTER SYSTEM") {
    return buildFilterSummary(compact);
  }

  return takeSentences(compact, options.sentences || 1, options.maxLength || 260);
}

function cleanParagraphText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s*([,.;:!?])/g, "$1")
    .trim();
}

function takeSentences(text, count, maxLength = 260) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const merged = sentences.slice(0, count).join(" ").trim();
  return truncateText(merged || String(text || "").trim(), maxLength);
}

function firstSentence(text) {
  return takeSentences(text, 1, 220);
}

function truncateText(text, maxLength) {
  const compact = String(text || "").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function joinNaturalList(items) {
  const values = items.filter(Boolean);
  if (!values.length) {
    return "";
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function isLocationSpecificKeyword(value) {
  const text = String(value || "");

  if (matchesAny(text, PROVINCE_HINTS)) {
    return true;
  }

  return (
    /\b(school|schools|college|colleges|university|universities)\s+in\s+[a-z]/.test(text) &&
    !/\bin nepal\b/.test(text)
  );
}

function matchesAny(text, hints) {
  return hints.some((hint) => containsHint(text, hint));
}

function pushKeyword(target, value) {
  if (target.length >= 48) {
    return;
  }

  const key = normalizeKeywordKey(value);
  if (!key || target.some((item) => normalizeKeywordKey(item) === key)) {
    return;
  }

  target.push(value);
}

function finalizeBucket(primary, fallback, limit) {
  const merged = dedupeKeywords([...(primary || []), ...(fallback || [])]);
  return merged.slice(0, limit);
}

function normalizeOutputPath(value) {
  return path.relative(ROOT_DIR, value).replace(/\\/g, "/");
}

function resolveExistingFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return "";
}

function containsHint(text, hint) {
  const normalizedText = normalizeKeywordKey(text);
  const normalizedHint = normalizeKeywordKey(hint);
  if (!normalizedText || !normalizedHint) {
    return false;
  }

  if (/[\u0900-\u097F]/u.test(normalizedHint)) {
    return normalizedText.includes(normalizedHint);
  }

  if (/^[a-z0-9+]{1,4}$/i.test(normalizedHint)) {
    return new RegExp(`(^|\\s)${escapeRegex(normalizedHint)}(\\s|$)`, "i").test(normalizedText);
  }

  return normalizedText.includes(normalizedHint);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAboutHeadingLine(value) {
  return /^[A-Z0-9&'()/,?+\- —]{3,}$/.test(String(value || "").trim());
}

function findAboutSectionByPrefix(sections, prefix) {
  const target = cleanKeyword(prefix);
  return Object.entries(sections).find(([heading]) => heading.startsWith(target))?.[1] || "";
}

function isHomeFriendlyKeyword(value) {
  const text = normalizeKeywordKey(value);
  return matchesAny(text, HOME_HINTS) && !isLocationSpecificKeyword(text);
}

function isProvinceFriendlyKeyword(value) {
  const text = normalizeKeywordKey(value);
  return (
    !/\bnear\b/.test(text) &&
    /(\bprovince\b|प्रदेश|\bkoshi\b|\bmadhesh\b|\bbagmati\b|\bgandaki\b|\blumbini\b|\bkarnali\b|\bsudurpashchim\b)/u.test(text) &&
    /(\bschool\b|\bschools\b|\bcollege\b|\bcolleges\b|\beducation\b|\bdirectory\b|\bfilter\b|विद्यालय|कलेज|शिक्षा)/u.test(text)
  );
}

function isDistrictFriendlyKeyword(value) {
  const text = normalizeKeywordKey(value);
  return matchesAny(text, LOCATION_SUPPORT_HINTS);
}

function isTypeFriendlyKeyword(value) {
  const text = normalizeKeywordKey(value);
  return matchesAny(text, TYPE_HINTS) && !isLocationSpecificKeyword(text);
}

function isFieldFriendlyKeyword(value) {
  const text = normalizeKeywordKey(value);
  return (
    matchesAny(text, FIELD_HINTS) &&
    !/^(school|schools|college|colleges|university|universities)\s+in\s+nepal$/i.test(text)
  );
}

function isDetailFriendlyKeyword(value) {
  return matchesAny(normalizeKeywordKey(value), DETAIL_HINTS);
}

function isAffiliationFriendlyKeyword(value) {
  return matchesAny(normalizeKeywordKey(value), AFFILIATION_HINTS);
}

function buildFilterSummary(text) {
  const filters = [
    /province|प्रदेश/i.test(text) ? "province" : "",
    /district|जिल्ला/i.test(text) ? "district" : "",
    /\btype\b|प्रकार/i.test(text) ? "institution type" : "",
    /\bfield\b|विषय/i.test(text) ? "academic field" : "",
    /\blevel\b|तह/i.test(text) ? "level" : "",
    /affiliation|सम्बन्धन|सम्बद्ध/i.test(text) ? "affiliation" : "",
  ].filter(Boolean);

  if (!filters.length) {
    return takeSentences(text, 1, 220);
  }

  return truncateText(
    `Users can narrow results by ${joinNaturalList(filters)} to compare relevant institutes faster.`,
    220
  );
}
