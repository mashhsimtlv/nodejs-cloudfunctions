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
    100: 2,   // base
    200: 5,   // base
    500: 9,   // +$9 to reach 500 minutes
    1000: 17, // +$17 to reach 1000 minutes
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
            throw new Error("minutes must be one of: 100, 200, 500, 1000");
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

        const minutesOptions = [100, 200, 500, 1000];
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

        // Coin system (client's rate book, rule #1: "the customer sees coins
        // only — 1 coin = 1 minute to Israel"). Balances are stored in USD;
        // 1 coin = ₪0.20 at the book's app rate of ₪3.00/$ → $0.0667/coin.
        // Coins are the DISPLAY unit; billing continues to deduct USD.
        const USD_PER_COIN = parseFloat(process.env.USD_PER_COIN || String(0.20 / 3.0));
        const balanceCoins = Math.round((currentBalance / USD_PER_COIN) * 10) / 10;

        // Destination prices come from country_call_rates — one row per ISO-2
        // country with BOTH units (coins_per_min straight from the client's
        // sheet, usd_per_min derived), generated from the client's full rate
        // sheet (230 countries) by
        // proxy-firebase/generalScripts/generateCountryCallRates.js.
        const replacements = {};
        let destSql = `SELECT iso2, usd_per_min, coins_per_min FROM country_call_rates WHERE is_active = 1`;
        if (dstCountry) {
            destSql += ` AND iso2 = :iso2`;
            replacements.iso2 = dstCountry.toUpperCase();
        }
        destSql += ` ORDER BY iso2 ASC`;
        const rates = await CallRouteRate.sequelize.query(destSql, {
            replacements,
            type: CallRouteRate.sequelize.QueryTypes.SELECT,
        });

        const planRate = parseFloat(plan.per_minute_rate);
        const remainingMinutes = planRate > 0 ? Math.floor(currentBalance / planRate) : 0;

        return {
            src_country: countryInfo(srcCountry),
            plan: {
                minutes_option: plan.minutes_option,
                credit_value: parseFloat(plan.credit_value),
                // COINS in the existing field: the shipped app build renders
                // these values verbatim under a "Coins" label (its own
                // usd→coins multiplier is hardcoded to 1), and mobile cannot
                // ship a new build right now — so the display unit has to be
                // delivered server-side. USD kept alongside for the backend's
                // own consumers and future app builds.
                current_balance: balanceCoins,
                current_balance_usd: currentBalance,
                usd_per_coin: USD_PER_COIN,
                remaining_minutes: remainingMinutes,
            },
            destinations: rates.map((r) => {
                const ratePerMin = parseFloat(r.usd_per_min);
                const coinsPerMin = parseFloat(r.coins_per_min);
                return {
                    ...countryInfo(r.iso2),
                    // per_min_price now carries COINS (Israel = 1.0) — see note
                    // on plan.current_balance above.
                    per_min_price: coinsPerMin,
                    usd_per_min: ratePerMin,
                    coins_per_min: coinsPerMin,
                    currency: "COIN",
                    available_minutes: coinsPerMin > 0
                        ? Math.floor(balanceCoins / coinsPerMin)
                        : (ratePerMin > 0 ? Math.floor(currentBalance / ratePerMin) : 0),
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

        const minutesOptions = [100, 200, 500, 1000];
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
