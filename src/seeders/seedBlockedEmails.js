"use strict";

require("dotenv").config();

const { sequelize, BlockedEmail } = require("../models");

// Patterns previously hardcoded in paymentService intent methods.
// Substring match: domains block every address on them, full addresses block one user.
const patterns = [
    { pattern: "@boticuk.com", reason: "fraud domain" },
    { pattern: "@blumai.site", reason: "fraud domain" },
    { pattern: "msjsiee3@gmail.com", reason: "fraud account" },
    { pattern: "tutu68863@gmail.com", reason: "fraud account" },
    { pattern: "rendrapramuja@gmail.com", reason: "fraud account" },
    { pattern: "berkahjayaelektronik55@gmail.com", reason: "fraud account" },
    { pattern: "diriku462@gmail.com", reason: "fraud account" },
    { pattern: "jajarijajari0@gmail.com", reason: "fraud account" },
    { pattern: "gaha85712@gmail.com", reason: "fraud account" },
    { pattern: "budihartono9110@gmail.com", reason: "fraud account" },
    { pattern: "megabajabintaro540@gmail.com", reason: "fraud account" },
    { pattern: "stokcilzsuga8@gmail.com", reason: "fraud account" },
    { pattern: "adirojak883@gmail.com", reason: "fraud account" },
    { pattern: "zeaardelia9@gmail.com", reason: "fraud account" },
    { pattern: "reada1370@gmail.com", reason: "fraud account" },
    { pattern: "nathel.0101@gmail.com", reason: "fraud account" },
    { pattern: "barubaru45600@gmail.com", reason: "fraud account" },
];

(async () => {
    try {
        await sequelize.authenticate();
        await BlockedEmail.sync(); // creates blocked_emails table if it doesn't exist

        for (const item of patterns) {
            const [, created] = await BlockedEmail.findOrCreate({
                where: { pattern: item.pattern },
                defaults: item,
            });
            console.log(created ? `+ added   ${item.pattern}` : `= exists  ${item.pattern}`);
        }

        console.log(`✅ Blocked emails seeded (${patterns.length} patterns)`);
        process.exit(0);
    } catch (err) {
        console.error("❌ Seeding failed:", err.message);
        process.exit(1);
    }
})();
