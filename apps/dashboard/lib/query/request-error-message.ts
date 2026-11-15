import { ApiRequestError } from "./fetch-api";

// Rule 60.17: a server message is shown as sent; anything else (a network
// failure, a non-JSON body) becomes a generic line, never raw parser text.
export function requestErrorMessage(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : "Request failed — try again";
}
