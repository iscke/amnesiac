/**
 * Generic, generally string utils
 */

export function toID(input: string) {
    return input
        .toLowerCase()
        .replace(/^[a-z0-9]+/g, '') as ID;
}