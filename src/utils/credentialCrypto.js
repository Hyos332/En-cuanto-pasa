const crypto = require('crypto');

const ENCRYPTION_PREFIX = 'enc:v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
    const rawSecret = process.env.KRONOS_CREDENTIALS_SECRET;

    if (!rawSecret || rawSecret.trim().length < 16) {
        throw new Error('KRONOS_CREDENTIALS_SECRET must be set with at least 16 characters.');
    }

    return crypto.createHash('sha256').update(rawSecret).digest();
}

function encryptSecret(secretValue) {
    if (typeof secretValue !== 'string' || secretValue.length === 0) {
        return secretValue;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(secretValue, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return `${ENCRYPTION_PREFIX}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(secretValue) {
    if (typeof secretValue !== 'string' || secretValue.length === 0) {
        return secretValue;
    }

    if (!secretValue.startsWith(`${ENCRYPTION_PREFIX}:`)) {
        return secretValue;
    }

    const parts = secretValue.split(':');
    if (parts.length !== 5) {
        throw new Error('Encrypted credential has an invalid format.');
    }

    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encrypted = Buffer.from(parts[4], 'hex');

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]).toString('utf8');
}

module.exports = {
    encryptSecret,
    decryptSecret
};
