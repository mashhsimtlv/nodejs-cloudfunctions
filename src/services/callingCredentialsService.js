const axios = require("axios");

// PHP endpoint on the Asterisk box (same host as assign_number.php / auth.php),
// upserting into calling_credentials keyed on its unique firebase_uid column. Kept
// current so the dialplan (func_odbc CALLING_CRED_UID / firebase_lookup.php) can
// resolve which Firebase user owns an inbound phone_number/extension.
const ASTERISK_API_URL = process.env.ASTERISK_API_URL || "https://global.revuity.com/api/calling_credentials.php";
const ASTERISK_API_KEY = process.env.ASTERISK_API_KEY || "nb12345";

class CallingCredentialsService {
    async syncCallingCredential({ firebaseUid, phoneNumber, extension }) {
        if (!firebaseUid || !phoneNumber) {
            throw new Error("firebaseUid and phoneNumber are required to sync calling credentials");
        }

        const response = await axios.post(
            ASTERISK_API_URL,
            new URLSearchParams({
                firebase_uid: firebaseUid,
                phone_number: phoneNumber,
                extension: extension || phoneNumber,
            }),
            { headers: { apikey: ASTERISK_API_KEY } }
        );

        if (response.data?.status !== "success") {
            throw new Error(response.data?.message || "calling_credentials sync failed");
        }

        return response.data;
    }
}

module.exports = new CallingCredentialsService();
