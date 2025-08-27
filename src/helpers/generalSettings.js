const crypto = require('crypto');
require('dotenv').config();
const admin = require('../helpers/firebase');

const ENCRYPTION_KEY = crypto.createHash('sha256').update("mySuperSecretKey123").digest('hex').substr(0, 32);
const IV_LENGTH = 16;

const encrypt = (text) => {
    const iv = crypto.randomBytes(IV_LENGTH);  // Generate a random IV
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf-8'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;  // Return IV + encrypted text
};

const decrypt = (encryptedText) => {
    const [ivHex, encryptedData] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'utf-8'), iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

const getToken = async () => {
    const doc = await admin.firestore().collection('secrets').doc('storeKeyDoc').get();

    if (!doc.exists) {
        return false;
    }

    const encryptedKey = doc.data().encryptedKey;

    return decrypt(encryptedKey);
}

const getUserByUid = async (uid) => {
    const querySnapshot = await admin.firestore()
        .collection('app-registered-users')
        .where('uid', '==', uid) // Filtering by uid
        .get();

    if (querySnapshot.empty) {
        return false; // No user found with the provided uid
    }

    // Assuming there will only be one document with the given uid
    const user = querySnapshot.docs[0].data();
    return user; // This returns the user data
}
const getUserByICCID = async (iccid) => {
    const querySnapshot = await admin.firestore()
        .collection('app-registered-users')
        .where('iccid', '==', iccid) // Filtering by iccid
        .get();

    if (querySnapshot.empty) {
        return false; // No user found with the provided uid
    }

    // Assuming there will only be one document with the given uid
    const user = querySnapshot.docs[0].data();
    return user; // This returns the user data
}

const getMainToken = async () => {
    const doc = await admin.firestore().collection('mainAccount').doc('storeKeyDoc').get();

    if (!doc.exists) {
        return false;
    }

    const encryptedKey = doc.data().encryptedKey;

    return decrypt(encryptedKey);
}

module.exports = { decrypt, encrypt  , getToken , getMainToken , getUserByUid , getUserByICCID};
