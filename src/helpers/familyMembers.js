// A manual/unregistered family member (added via the CRM, or by a parent, with no email) has no
// Firebase account: nothing to log in with, no app-registered-users doc, no wallet. Their SIM
// credit is still tracked as THEIRS under a synthetic id derived from their family_members row —
// stable and unique, but never a real uid, so it must never be used for Auth/Firestore lookups.
const MANUAL_MEMBER_PREFIX = "manual-fm-";

const manualMemberId = (familyMemberRowId) => `${MANUAL_MEMBER_PREFIX}${familyMemberRowId}`;

const isPlaceholderUid = (uid) => typeof uid === "string" && uid.startsWith(MANUAL_MEMBER_PREFIX);

module.exports = { MANUAL_MEMBER_PREFIX, manualMemberId, isPlaceholderUid };
