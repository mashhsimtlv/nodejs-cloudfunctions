const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { CallPlanQuote, CallRouteRate, UserCallerNumber } = require("../models");

const PRICE_LIST_PATH = path.resolve(__dirname, "../../Price List.xlsx");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PLAN_CONFIG = {
    incoming: {
        basePrice: 5,
        extraPerTenDays: 1.5,
    },
    incoming_outgoing: {
        basePrice: 12,
        extraPerTenDays: 3.5,
    },
};

const MINUTES_UPGRADE = {
    200: 0,
    500: 9,
    1000: 17,
};

const COUNTRY_ALIASES = {
    US: "UNITED STATES OF AMERICA",
    USA: "UNITED STATES OF AMERICA",
    UK: "UNITED KINGDOM",
};

const normalizeKey = (val = "") => String(val).trim().toUpperCase();

// Non-standard codes that need remapping for Intl/flag lookups
const CODE_TO_ISO2 = { UK: "GB" };

// Reverse map: full country name → ISO2 (for call_plan_quotes.country that stores full names)
const NAME_TO_ISO2 = {
    ISRAEL: "IL",
    "UNITED KINGDOM": "GB",
    "UNITED STATES OF AMERICA": "US",
    "UNITED STATES": "US",
};

function isoToFlag(code) {
    const iso2 = (CODE_TO_ISO2[code?.toUpperCase()] || code || "").toUpperCase();
    if (iso2.length !== 2) return "";
    return String.fromCodePoint(...iso2.split("").map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function isoToName(code) {
    const iso2 = CODE_TO_ISO2[code?.toUpperCase()] || code;
    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2.toUpperCase());
    } catch {
        return code;
    }
}

function countryInfo(code) {
    return { code: code.toUpperCase(), name: isoToName(code) || code, flag: isoToFlag(code) };
}

// Normalize a stored country value (full name or ISO2) to a 2-letter DB key
function normalizeSrcCountry(country) {
    const s = String(country).trim();
    if (s.length === 2) return s.toUpperCase();
    return NAME_TO_ISO2[s.toUpperCase()] || s.slice(0, 2).toUpperCase();
}

const parseDate = (value, label) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid ${label}; expected a date string/number`);
    }
    return parsed;
};

const calculateInclusiveDays = (start, end) => {
    const diff = Math.floor((end - start) / MS_PER_DAY) + 1;
    if (diff <= 0) {
        throw new Error("endTime must be after startTime");
    }
    return diff;
};

class PricingService {
    constructor() {
        this.priceMap = null;
    }

    loadPriceList() {
        if (this.priceMap) {
            return this.priceMap;
        }

        if (!fs.existsSync(PRICE_LIST_PATH)) {
            throw new Error("Price list file not found at project root (Price List.xlsx)");
        }

        const workbook = xlsx.readFile(PRICE_LIST_PATH);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

        const headers = Array.isArray(rows[0]) ? rows[0].map(normalizeKey) : [];
        const countryIdx = headers.indexOf("COUNTRY");
        const rateIdx = headers.indexOf("AVERAGESELLPRICE");
        if (countryIdx === -1 || rateIdx === -1) {
            throw new Error("Price list is missing required headers: Country, AverageSellPrice");
        }

        const map = new Map();
        rows.slice(1).forEach((row) => {
            const countryName = normalizeKey(row[countryIdx]);
            const rateValue = Number(row[rateIdx]);
            if (countryName && Number.isFinite(rateValue)) {
                map.set(countryName, rateValue);
            }
        });

        this.priceMap = map;
        return map;
    }

    getPriceForCountry(countryInput) {
        if (!countryInput) {
            throw new Error("country is required");
        }

        const map = this.loadPriceList();
        const normalized = normalizeKey(countryInput);

        if (map.has(normalized)) {
            return map.get(normalized);
        }

        const alias = COUNTRY_ALIASES[normalized];
        if (alias && map.has(alias)) {
            return map.get(alias);
        }

        // Allow ISO country codes (e.g., IL -> Israel) using Intl region names.
        let resolvedName;
        if (normalized.length === 2) {
            try {
                const intl = new Intl.DisplayNames(["en"], { type: "region" });
                resolvedName = normalizeKey(intl.of(normalized));
            } catch {
                resolvedName = null;
            }
        }

        if (resolvedName && map.has(resolvedName)) {
            return map.get(resolvedName);
        }

        const resolvedAlias = resolvedName ? COUNTRY_ALIASES[resolvedName] : null;
        if (resolvedAlias && map.has(resolvedAlias)) {
            return map.get(resolvedAlias);
        }

        throw new Error(`No price found for country "${countryInput}" in price list`);
    }

    buildQuote({ days, planType, minutes, rate }) {
        const config = PLAN_CONFIG[planType];
        if (!config) {
            throw new Error(`Unsupported planType. Use one of: ${Object.keys(PLAN_CONFIG).join(", ")}`);
        }

        const minutesUpgradePrice = MINUTES_UPGRADE[minutes];
        if (minutesUpgradePrice === undefined) {
            throw new Error("minutes must be one of: 200, 500, 1000");
        }

        const extraDays = Math.max(days - 30, 0);
        const extraBlocks = Math.ceil(extraDays / 10);
        const extraPrice = extraBlocks * config.extraPerTenDays;
        const totalPrice = config.basePrice + extraPrice + minutesUpgradePrice;

        return {
            planType,
            minutes,
            days,
            basePrice: Number(config.basePrice.toFixed(2)),
            extraDays,
            extraBlocks,
            extraPrice: Number(extraPrice.toFixed(2)),
            minutesUpgradePrice: Number(minutesUpgradePrice.toFixed(2)),
            totalPrice: Number(totalPrice.toFixed(2)),
            perMinuteRate: Number(rate),
            creditValue: Number((minutes * rate).toFixed(2)),
        };
    }

    getNumberPrice({ startTime, endTime, country }) {
        const startDate = parseDate(startTime, "startTime");
        const endDate   = parseDate(endTime, "endTime");
        const days      = calculateInclusiveDays(startDate, endDate);
        const rate      = this.getPriceForCountry(country);

        const minutesOptions = [200, 500, 1000];
        const planTypes      = Object.keys(PLAN_CONFIG);

        const quotes = {};
        planTypes.forEach((plan) => {
            quotes[plan] = {};
            minutesOptions.forEach((minutes) => {
                quotes[plan][minutes] = this.buildQuote({ days, planType: plan, minutes, rate });
            });
        });

        return { days, rate, quotes };
    }

    async getCallRates({ userId, dstCountry }) {
        if (!userId) throw new Error("userId is required");

        const plan = await CallPlanQuote.findOne({
            where: { user_id: userId },
            order: [["start_time", "DESC"]],
        });

        if (!plan) throw new Error("No call plan found for this user");

        const srcCountry = normalizeSrcCountry(plan.country);

        // Live remaining balance from user_caller_numbers (deducted per call)
        const userCallerNumber = await UserCallerNumber.findOne({
            where: { user_id: userId, end_time: null },
            order: [["start_time", "DESC"], ["id", "DESC"]],
        });
        const currentBalance = userCallerNumber ? parseFloat(userCallerNumber.current_balance) : 0;

        const where = { src_country: srcCountry, is_active: true };
        if (dstCountry) where.dst_country = dstCountry.toUpperCase();

        const rates = await CallRouteRate.findAll({ where, order: [["dst_country", "ASC"]] });

        const planRate = parseFloat(plan.per_minute_rate);
        const remainingMinutes = planRate > 0 ? Math.floor(currentBalance / planRate) : 0;

        return {
            src_country: countryInfo(srcCountry),
            plan: {
                minutes_option: plan.minutes_option,
                credit_value: parseFloat(plan.credit_value),
                current_balance: currentBalance,
                remaining_minutes: remainingMinutes,
            },
            destinations: rates.map((r) => {
                const ratePerMin = parseFloat(r.rate_per_min);
                return {
                    ...countryInfo(r.dst_country),
                    per_min_price: ratePerMin,
                    currency: r.currency || "USD",
                    available_minutes: Math.floor(currentBalance / ratePerMin),
                };
            }),
        };
    }

    async calculateCallPlan({
        startTime,
        endTime,
        userId,
        country,
        planType,
        minutesOption,
    }) {
        if (!userId) {
            throw new Error("userId is required");
        }

        const startDate = parseDate(startTime, "startTime");
        const endDate = parseDate(endTime, "endTime");
        const days = calculateInclusiveDays(startDate, endDate);
        const rate = this.getPriceForCountry(country);

        const minutesOptions = [200, 500, 1000];
        const planTypes      = Object.keys(PLAN_CONFIG);

        const quotes = {};
        planTypes.forEach((plan) => {
            quotes[plan] = {};
            minutesOptions.forEach((minutes) => {
                quotes[plan][minutes] = this.buildQuote({ days, planType: plan, minutes, rate });
            });
        });

        let selectedQuote = null;
        if (planType && minutesOption != null) {
            const normalizedMinutes = Number(minutesOption);
            const planQuotes = quotes[planType];
            if (!planQuotes || !planQuotes[normalizedMinutes]) {
                throw new Error("Invalid planType or minutesOption");
            }
            const quote = planQuotes[normalizedMinutes];

            selectedQuote = await CallPlanQuote.create({
                user_id: userId,
                start_time: startDate,
                end_time: endDate,
                country,
                plan_type: planType,
                minutes_option: normalizedMinutes,
                days,
                base_price: quote.basePrice,
                extra_price: quote.extraPrice,
                minutes_upgrade_price: quote.minutesUpgradePrice,
                total_price: quote.totalPrice,
                per_minute_rate: quote.perMinuteRate,
                credit_value: quote.creditValue,
            });
        }

        return {
            quotes,
            selectedQuote,
        };
    }
}

module.exports = new PricingService();
