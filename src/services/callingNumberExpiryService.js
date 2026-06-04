const { sequelize, UserCallerNumber, CallNumber } = require("../models");
const Sequelize = require("sequelize");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

class CallingNumberExpiryService {
    constructor() {
        this.timer = null;
        this.initialTimer = null;
        this.isRunning = false;
    }

    async releaseExpiredNumbers() {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        const transaction = await sequelize.transaction();

        try {
            const now = new Date();
            const expiredMappings = await UserCallerNumber.findAll({
                where: {
                    end_time: {
                        [Sequelize.Op.ne]: null,
                        [Sequelize.Op.lte]: now,
                    },
                },
                include: [
                    {
                        model: CallNumber,
                        as: "callingNumber",
                        where: { is_occupied: true },
                        required: true,
                    },
                ],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (expiredMappings.length === 0) {
                await transaction.commit();
                return;
            }

            const releasedIds = [];
            for (const mapping of expiredMappings) {
                if (!mapping.callingNumber) {
                    continue;
                }

                await mapping.callingNumber.update(
                    { is_occupied: false },
                    { transaction }
                );
                releasedIds.push(mapping.calling_number_id);
            }

            await transaction.commit();
            console.log("Released expired calling numbers:", releasedIds);
        } catch (err) {
            await transaction.rollback();
            console.error("Failed to release expired calling numbers:", err.message);
        } finally {
            this.isRunning = false;
        }
    }

    getDelayUntilNextMidnight() {
        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 0, 0);
        return nextMidnight.getTime() - now.getTime();
    }

    start() {
        if (this.timer || this.initialTimer) {
            return this.timer || this.initialTimer;
        }

        this.releaseExpiredNumbers();
        const delay = this.getDelayUntilNextMidnight();

        this.initialTimer = setTimeout(() => {
            this.releaseExpiredNumbers();
            this.timer = setInterval(() => {
                this.releaseExpiredNumbers();
            }, ONE_DAY_MS);
            this.initialTimer = null;
        }, delay);

        console.log(`Calling number expiry job started. Next run in ${delay}ms, then every ${ONE_DAY_MS}ms at midnight.`);
        return this.initialTimer;
    }
}

module.exports = new CallingNumberExpiryService();
