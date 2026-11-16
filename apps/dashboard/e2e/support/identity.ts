// Thin wrapper: the DynamoDB seeding lives under test/ (Rule 10.5 keeps
// @aws-sdk/* out of e2e/).
export {
  deleteStoredIdentity,
  seedStoredIdentity,
} from "../../test/fixtures/e2e-identity-seed";
