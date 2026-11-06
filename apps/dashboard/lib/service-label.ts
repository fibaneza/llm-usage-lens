export const UNTAGGED_SERVICE = "_untagged";

// `_untagged` is the stored key for usage without a service tag (Rule 20.10);
// people read "Untagged".
export function serviceLabel(serviceName: string): string {
  return serviceName === UNTAGGED_SERVICE ? "Untagged" : serviceName;
}
