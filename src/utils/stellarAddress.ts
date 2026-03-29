const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

export function isValidStellarPublicKey(address: string): boolean {
  return STELLAR_PUBLIC_KEY_REGEX.test(address);
}
