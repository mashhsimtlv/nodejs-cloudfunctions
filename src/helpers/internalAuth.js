// Auth header for calls into firebasetracking-app (app-link.simtlv.co.il). Its
// internal routes are gated by verifyInternalKey and reject calls without
// "Authorization: Bearer <INTERNAL_API_KEY>" — set the same key in this .env.
const internalAuthHeaders = () => {
    const key = process.env.INTERNAL_API_KEY;
    if (!key) {
        console.warn("INTERNAL_API_KEY is not set — app-link internal calls will be rejected (401)");
        return { "Content-Type": "application/json" };
    }
    return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
};

module.exports = { internalAuthHeaders };
