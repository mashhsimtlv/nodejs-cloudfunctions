const mysql = require("mysql2/promise");

// Direct write to the Asterisk box's `calling_credentials` table (same DB the
// dialplan reads via func_odbc CALLING_CRED_UID / firebase_lookup.php), so the
// dialplan can resolve which Firebase user owns an inbound phone_number/extension.
//
// firebase_uid is UNIQUE on this table. A user can only ever hold one
// phone_number's row at a time, so before assigning firebase_uid to the row
// matching the target phone_number, any *other* row currently holding that
// firebase_uid is cleared first — otherwise the update on the target row
// collides with the unique constraint.
let pool;
const getPool = () => {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.REVUITY_ASTERISK_DB_HOST,
            port: Number(process.env.REVUITY_ASTERISK_DB_PORT || 3306),
            user: process.env.REVUITY_ASTERISK_DB_USER,
            password: process.env.REVUITY_ASTERISK_DB_PASSWORD,
            database: process.env.REVUITY_ASTERISK_DB_NAME || "asterisk",
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,
        });
    }
    return pool;
};

class CallingCredentialsService {
    async syncCallingCredential({ firebaseUid, phoneNumber }) {
        if (!firebaseUid || !phoneNumber) {
            throw new Error("firebaseUid and phoneNumber are required to sync calling credentials");
        }

        const connection = await getPool().getConnection();
        try {
            // Free this firebase_uid from whatever row it was previously on.
            await connection.execute(
                `UPDATE calling_credentials SET firebase_uid = NULL, updated_at = NOW()
                 WHERE firebase_uid = ? AND phone_number != ?`,
                [firebaseUid, phoneNumber]
            );

            // Assign it to the row matching the target phone number, whether
            // that row's firebase_uid was NULL or already set to something else.
            const [result] = await connection.execute(
                `UPDATE calling_credentials SET firebase_uid = ?, updated_at = NOW()
                 WHERE phone_number = ?`,
                [firebaseUid, phoneNumber]
            );

            if (result.affectedRows === 0) {
                throw new Error(`No calling_credentials row found for phone_number ${phoneNumber}`);
            }

            const [rows] = await connection.execute(
                "SELECT * FROM calling_credentials WHERE phone_number = ? LIMIT 1",
                [phoneNumber]
            );

            return { status: "success", record: rows[0] };
        } finally {
            connection.release();
        }
    }
}

module.exports = new CallingCredentialsService();
