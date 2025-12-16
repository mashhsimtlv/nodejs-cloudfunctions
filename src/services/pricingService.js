const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { CallPlanQuote } = require("../models");

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
    200: 0,   // base
    500: 9,   // +$9 to reach 500 minutes
    1000: 17, // +$17 to reach 1000 minutes
};

const normalizeKey = (val = "") => String(val).trim().toUpperCase();

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

    async calculateCallPlan({
        startTime,
        endTime,
        userId,
        country,
        planType = "incoming_outgoing",
        minutesOption = 200,
    }) {
        if (!userId) {
            throw new Error("userId is required");
        }

        const startDate = parseDate(startTime, "startTime");
        const endDate = parseDate(endTime, "endTime");
        const days = calculateInclusiveDays(startDate, endDate);
        const rate = this.getPriceForCountry(country);

        const minutesOptions = [200, 500, 1000];
        const quotes = {};
        minutesOptions.forEach((minutes) => {
            quotes[minutes] = this.buildQuote({ days, planType, minutes, rate });
        });

        const selectedQuote = quotes[minutesOption];
        if (!selectedQuote) {
            throw new Error("minutesOption must be one of: 200, 500, 1000");
        }

        const record = await CallPlanQuote.create({
            user_id: userId,
            start_time: startDate,
            end_time: endDate,
            country,
            plan_type: planType,
            minutes_option: minutesOption,
            days,
            base_price: selectedQuote.basePrice,
            extra_price: selectedQuote.extraPrice,
            minutes_upgrade_price: selectedQuote.minutesUpgradePrice,
            total_price: selectedQuote.totalPrice,
            per_minute_rate: selectedQuote.perMinuteRate,
            credit_value: selectedQuote.creditValue,
        });

        return {
            quotes,
            selectedQuote: record,
        };
    }
}

module.exports = new PricingService();
