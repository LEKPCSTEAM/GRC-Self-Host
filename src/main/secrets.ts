import { safeStorage } from 'electron';

/** Returns a warning when tokens would be stored without real encryption. */
export function storageWarning(): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return 'OS encryption is unavailable: tokens are stored in plain text.';
  }
  if (
    process.platform === 'linux' &&
    safeStorage.getSelectedStorageBackend() === 'basic_text'
  ) {
    return 'No keyring (GNOME Keyring / KWallet) found: tokens are only obfuscated, not encrypted.';
  }
  return null;
}

export function seal(plain: string): {
  token: string;
  tokenEncrypted: boolean;
} {
  if (!safeStorage.isEncryptionAvailable()) {
    return { token: plain, tokenEncrypted: false };
  }
  return {
    token: safeStorage.encryptString(plain).toString('base64'),
    tokenEncrypted: true,
  };
}

export function unseal(rec: {
  token: string;
  tokenEncrypted: boolean;
}): string {
  return rec.tokenEncrypted
    ? safeStorage.decryptString(Buffer.from(rec.token, 'base64'))
    : rec.token;
}
