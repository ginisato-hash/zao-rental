/** Staff password length rule, shared by the server (better-auth minPasswordLength/maxPasswordLength, validPassword) and the
 * staff screens (create staff, own password change, Staff Q&A). Owner decision 2026-11-21: at least 6 characters (max 128).
 * Brute force is limited by the existing lockout and Argon2id hashing; this module has no dependencies so client code can
 * import it. */
export const passwordPolicy={min:6,max:128} as const;
