# LiteLLM administration runbook

Operator and user steps for connecting LLM Usage Lens to an existing LiteLLM
proxy. The design is in the [LiteLLM spec](../specs/2026-11-10-litellm.md);
general operations (alarms, redeploys) are in [operations.md](operations.md).
Nothing here is automated by the dashboard, and the dashboard never holds the
LiteLLM master key.

## 1. Prerequisites (user)

- The company's LiteLLM is **≥ 1.104.0** (`reset_budget`; past the
  CVE-2026-47101 `allowed_routes` fix in 1.83.14). **Confirmed 2026-11-10:**
  the company runs the latest release. Record the exact version here when
  known: `<version>`.
- At each LiteLLM upgrade, check the LiteLLM security advisories for the new
  version and note the date checked here.
- `dev` runs LiteLLM OSS (no SSO); `prod` runs LiteLLM Enterprise with Entra
  ID SSO. The dashboard derives the edition from `APP_ENV`.
- The internal hostname (and port) of LiteLLM, reachable from the dashboard
  subnets over the existing VPC / Transit Gateway path.

## 2. Create the dashboard service user and key (LiteLLM operators)

Run with the **master key**, from an operator workstation, never from the
dashboard, its CI or its AWS account. `$LITELLM` is the proxy base URL.

1. Create the service user:

   ```sh
   curl -sS -X POST "$LITELLM/user/new" \
     -H "Authorization: Bearer $MASTER_KEY" -H 'Content-Type: application/json' \
     -d '{"user_id":"svc-llm-usage-lens","user_role":"proxy_admin",
          "auto_create_key":false,"send_invite_email":false}'
   ```

2. Create its key, with `allowed_routes` set to **exactly** the list in §3,
   a `key_alias` and no `models`:

   ```sh
   curl -sS -X POST "$LITELLM/key/generate" \
     -H "Authorization: Bearer $MASTER_KEY" -H 'Content-Type: application/json' \
     -d '{"user_id":"svc-llm-usage-lens","key_alias":"llm-usage-lens-<env>",
          "allowed_routes":[ …the §3 list… ]}'
   ```

   The response's `key` is shown once. Put it straight into SSM (§4); do not
   save it anywhere else.

3. **Verify the restriction.** With the new key, a non-allowlisted read such
   as `GET /model/info` must return `403`, and `GET /team/list` must return
   `200`. Also confirm whether the templated routes in §3 (`{team_id}`,
   `{user_id}`, `{key}`) match as written; if LiteLLM needs a pattern form,
   record the form used here and tell the dashboard maintainers (the
   allowlist test compares this list with the gateway).

4. **Hardening recommendation.** Review the proxy's route-restriction
   settings (for example any admin-only route configuration) so that
   ordinary user keys cannot reach management routes.

## 3. `allowed_routes` (must equal the gateway allowlist)

```
/team/new
/team/update
/team/info
/team/list
/team/member_add
/team/member_update
/team/member_delete
/team/{team_id}/member/{user_id}/reset_spend
/team/{team_id}/member/{user_id}/reset_budget
/team/daily/activity/aggregated
/user/new
/user/info
/user/list
/user/daily/activity
/key/generate
/key/update
/key/delete
/key/block
/key/unblock
/key/info
/key/list
/key/{key}/regenerate
/spend/logs/v2
/models
/global/spend/report
```

## 4. Store the key in SSM (user, by hand)

```sh
aws ssm put-parameter --name /llm-usage-lens/<env>/litellm/service-key \
  --type SecureString --key-id <project CMK ARN or alias> --value '<key>'
```

- Standard tier (no charge); encrypted with the project CMK, which the task
  execution role can already decrypt (the CMK's usage is an accepted,
  existing cost).
- No CDK, script or app code writes this parameter; the DashboardServiceStack only
  references its ARN in the task definition's `secrets`.
- Keep the value out of shell history (for example, read it from a prompt).

## 5. Configure the dashboard (user)

1. Set `LITELLM_ALLOWED_HOSTS` in the deploy configuration to the LiteLLM
   hostname only (with `:port` if not 443).
2. If LiteLLM listens on a port other than 443, supply `litellmEgressCidrs`
   (LiteLLM's address range) so L1's egress rule can be synthesised.
3. Deploy the DashboardServiceStack (`cdk deploy`, user action).
4. As `internal-admin`, open **Settings → LiteLLM**: enter the `https` base
   URL, run the connection test (it must report `ok` before the URL saves),
   check the edition shown, then link dashboard teams to LiteLLM teams.
5. Review the operation toggles. Destructive operations (remove member,
   reset spend, delete key) and self-service key requests start **off**.

## 6. Rotate the service key

1. Create a new service key (§2 step 2) with the same `allowed_routes`.
2. Update the SSM parameter by hand (§4, with `--overwrite`).
3. Force a new ECS deployment so new tasks read it — ECS resolves
   `valueFrom` only at task start:
   `aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment`.
4. Run the connection test in Settings.
5. Block, then delete, the old key in LiteLLM (`/key/block`, `/key/delete`,
   with the master key).

Connection-test results: `unauthorised` means LiteLLM returned `401` — the
service key was rejected: rotate and redeploy (the dashboard never retries
with another key). `routes out of date` means a `403` on an allowlisted
route — compare the key's `allowed_routes` with §3.

## 7. Edition change and identity links

Changing a deployment's edition (OSS ↔ Enterprise) changes how LiteLLM user
ids are assigned. After the change, an `internal-admin` re-resolves the
identity links (`litellmUserId`) in Settings; each re-link is audited.

**Confirmed 2026-11-10:** on the company's Enterprise deployment, the
`user_id` LiteLLM assigns at SSO sign-in is the **email**. The dashboard
still looks the user up by email and stores the `user_id` LiteLLM returns.
If LiteLLM's SSO mapping is ever changed, re-resolve the links as above.

## 8. Gateway principals (for combined totals, L6)

Identify the IAM role names (or canonical usage keys) LiteLLM uses to call
Bedrock, and the gateway account id(s), and enter them in Settings. Until
then, combined totals are hidden from Viewers and Leads and Admins see a
"gateway not configured" warning.
