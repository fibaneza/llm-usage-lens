# POC: dashboard on one EC2 instance with Docker Compose

An isolated, manually operated proof of concept. It runs the existing
dashboard image on a small EC2 instance with Docker Compose, pulls the image
from a private ECR repository, and is administered only through AWS Systems
Manager (SSM) Session Manager.

Everything for the POC lives in `poc/`. Nothing outside this directory was
changed. This is **not** the project's deployment path: that is ECS Fargate
with the CDK app in `infra/`
([Platform spec](../docs/specs/2026-11-10-platform.md),
[deployment guide](../docs/guides/dashboard-deployment.md)). The POC uses
neither and does not replace them.

| File                                                 | Purpose                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [`cloudformation.yml`](cloudformation.yml)           | EC2 instance, security group, IAM role, private ECR repository, optional S3 read |
| [`docker-compose.yml`](docker-compose.yml)           | `app`, `s3-config`, `dynamodb-local`, `dynamodb-admin`, all from ECR |
| [`.env.example`](.env.example)                       | Runtime environment template (placeholders only)                     |
| [`config/config.yaml`](config/config.yaml)           | Template of the app's `config.yaml`, served from the S3 bucket       |
| [`stack.env.example`](stack.env.example)                   | Template for `stack.env`, the gitignored deploy configuration  |
| [`scripts/deploy-stack.sh`](scripts/deploy-stack.sh)       | Local: create or update the CloudFormation stack               |
| [`scripts/alb-security-group.sh`](scripts/alb-security-group.sh) | Local: attach/detach the POC security group on the existing ALB |
| [`scripts/build-and-push.sh`](scripts/build-and-push.sh)   | Local: build the image and push `latest` to ECR                |
| [`scripts/mirror-images.sh`](scripts/mirror-images.sh)     | Local: copy `dynamodb-local`, `dynamodb-admin` and `aws-cli` into the same ECR repository |
| [`scripts/make-ec2-bundle.sh`](scripts/make-ec2-bundle.sh) | Local: print one command that copies the runtime files to EC2  |
| [`scripts/init-dynamodb.sh`](scripts/init-dynamodb.sh)     | EC2: create the table in DynamoDB Local                        |

## Architecture

```
developer machine                          existing VPC / subnet
┌───────────────────────┐ push app image   ┌──────────────────────────────┐
│ build-and-push.sh     │ ───────────────▶ │ private ECR (one repository) │
│ mirror-images.sh      │ ───────────────▶ │ app, dynamodb-*, aws-cli     │
│                       │ mirror images    └──────────────┬───────────────┘
│ aws s3 cp             │ config.yaml,     ┌──────────────┴───────────────┐
│                       │ ───────────────▶ │ S3 artifact bucket (optional)│
└──────────┬────────────┘ Compose binary   └──────────────┬───────────────┘
           │                                              │ pull / read
           │ SSM Session Manager         ┌────────────────▼───────────────┐
           └───────────────────────────▶ │ EC2 (Amazon Linux 2023)        │
                                         │  Docker Compose, network "poc" │
                                         │   s3-config ─▶ config.yaml     │
                                         │   app ───────▶ dynamodb-local  │
                                         │   dynamodb-admin ─▶ (same)     │
                                         └────────────────┬───────────────┘
                                                          │ HTTPS/HTTP (outbound)
                                                 ┌────────▼────────┐
                                                 │ external LiteLLM│  (not part of the POC)
                                                 └─────────────────┘
```

- CloudFormation installs Docker, the Compose plugin (the Amazon Linux
  package, else the binary staged in the S3 bucket, else GitHub) and the SSM
  Agent. It never pulls or starts the application; that is a manual step.
- Every container image comes from the POC's own ECR repository: the app
  image, plus `dynamodb-local`, `dynamodb-admin` and `aws-cli` mirrored into
  the same repository by `mirror-images.sh`. The instance never pulls from
  Docker Hub.
- An optional, **existing** S3 bucket (stack parameter `ArtifactBucketName`)
  carries the app's `config.yaml` and the Docker Compose binary. The
  instance may only read under one key prefix; the stack never creates,
  changes or deletes the bucket.
- No SSH, no key pair, no inbound rule by default. Browsers reach the app
  through SSM port forwarding.
- Optionally, the stack adds a listener and a target group to an **existing**
  Application Load Balancer (*Publish through an existing load balancer*),
  with a **new** security group of its own for that load balancer. It never
  creates a load balancer and never reuses, edits or deletes the load
  balancer's existing security groups.

### What repository inspection found

| Question                 | Finding                                                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dockerfile and context   | [`apps/dashboard/Dockerfile`](../apps/dashboard/Dockerfile), built from the **repository root**. Next.js standalone output; starts `node apps/dashboard/server.js`.                                                                                               |
| Port                     | The container listens on `3000` (`PORT=3000`, `HOSTNAME=0.0.0.0`).                                                                                                                                                                                                  |
| Health endpoint          | `GET /api/health`: no session needed; `200` while the process serves; the body says `ok` or `degraded` (DynamoDB unreachable). Its `litellm` field is always `not-configured`, so it does not prove LiteLLM connectivity.                                           |
| Architecture             | The base image `node:22-alpine` is multi-architecture and the app has no native build step, so both `linux/arm64` and `linux/amd64` work. The POC defaults to **arm64** (`t4g.small`, Graviton).                                                                    |
| DynamoDB                 | **Required.** The app stores all its data in one DynamoDB table and is developed against DynamoDB Local. The hostname `dynamodb-local` is one the app recognises as local ([`lib/dynamodb.ts`](../apps/dashboard/lib/dynamodb.ts)), so it uses no AWS credentials. |
| DynamoDB Admin           | Included: the devcontainer already uses `aaronshaf/dynamodb-admin` for the same purpose.                                                                                                                                                                            |
| Configuration file       | The image bakes in an all-commented [`config.yaml`](../apps/dashboard/config/config.yaml) (no settings); `APP_CONFIG_FILE` points the app at another file. The POC's `s3-config` service copies one from S3 and sets `APP_CONFIG_FILE`; with no bucket it writes an empty file, which behaves the same as the built-in one. |
| Runtime environment      | Validated at start by [`apps/dashboard/env.ts`](../apps/dashboard/env.ts); the variable names in [`.env.example`](.env.example) come from that schema.                                                                                                              |
| LiteLLM settings         | `LITELLM_ALLOWED_HOSTS` (host or `host:port` allowlist) and `LITELLM_SERVICE_KEY` (Bearer key) are environment variables. The **base URL is not an environment variable**: an administrator enters it in **Settings → LiteLLM**, and it is stored in DynamoDB.     |
| LiteLLM model/deployment | **There is none.** The dashboard administers LiteLLM (teams, users, keys, spend) and never calls a model, so no model or deployment setting exists.                                                                                                                  |
| Sign-in                  | The image runs with `NODE_ENV=production`, where the no-password dev login is rejected. The POC signs in with the **master user** (username + Argon2id hash) or Microsoft Entra ID.                                                                                 |
| Other Compose services   | The devcontainer's OpenTelemetry, Prometheus, Loki and Grafana are optional for the app and are left out.                                                                                                                                                            |

## Prerequisites

On the developer machine:

- AWS CLI v2, signed in (`aws sso login`); no static access keys.
- Docker with Buildx (used for the cross-platform build) and Docker Compose
  (only to validate `docker-compose.yml` locally).
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
  for the AWS CLI.
- Node.js and the repository's dependencies, only to generate the master
  password hash and (optionally) to load seed data.

In AWS:

- An existing VPC ID and subnet ID. The stack creates no network resources.
- Permission to deploy the stack: CloudFormation; EC2 instances and security
  groups; IAM roles and instance profiles including `iam:PassRole` (the
  deploy command needs `CAPABILITY_IAM`); ECR repositories and lifecycle
  policies; `ssm:GetParameters` on the public Amazon Linux AMI parameter;
  with the load balancer option, `elasticloadbalancing` listener and target
  group actions, plus `elasticloadbalancing:DescribeLoadBalancers` and
  `elasticloadbalancing:SetSecurityGroups` for the attach/detach script.
- Permission to connect: `ssm:StartSession` on the instance and on the
  `AWS-StartPortForwardingSession` document.
- Permission to push images, for the **developer identity only**:
  `ecr:GetAuthorizationToken` plus, on the repository,
  `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`,
  `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`,
  `ecr:BatchGetImage` and `ecr:DescribeRepositories`; also
  `cloudformation:DescribeStacks` and `sts:GetCallerIdentity` for the script.
  `mirror-images.sh` needs the same permissions. The EC2 role gets none of
  the push or delete permissions.
- With the S3 bucket: an **existing** bucket in the stack's region, and
  `s3:PutObject` on `<bucket>/<prefix>/*` for the developer identity. If the
  bucket uses SSE-KMS, the instance role also needs `kms:Decrypt` on that
  key, which the stack does not grant: use SSE-S3 for the POC bucket, or add
  the grant yourself.

Outbound connectivity the subnet must already provide (internet egress
through a NAT or internet gateway, or VPC endpoints; the POC adds neither):

| Destination                                                        | Needed for                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| SSM: `ssm`, `ssmmessages`, `ec2messages` (HTTPS)                   | Session Manager                                               |
| ECR: `ecr.api`, `ecr.dkr` (HTTPS)                                  | `docker login`, `docker compose pull` of the app image        |
| S3 in the same region (HTTPS)                                      | ECR image layers; Amazon Linux package repositories; the artifact bucket |
| `github.com` and its release CDN                                   | Compose plugin, only if neither the AL2023 repositories nor the bucket provide it |
| The external LiteLLM endpoint (its host and port)                  | The dashboard's LiteLLM administration                        |

Docker Hub is needed **only on the developer machine**, by
`mirror-images.sh`. So a subnet with VPC endpoints only and no internet
(`ssm`, `ssmmessages`, `ec2messages`, `ecr.api`, `ecr.dkr`, plus an S3
gateway endpoint) can run the whole POC, provided you mirror the images and
stage the Compose binary in the bucket (*Install Docker Compose from S3*).
The POC creates none of those endpoints.

For LiteLLM you also need its base URL, a service key
([LiteLLM runbook](../docs/guides/litellm-admin.md)) and network reachability
from the instance (see *Configure the application*).

## Deploy infrastructure

All commands run from the repository root. Set the shared values once:

```bash
export AWS_REGION=ap-southeast-2
export STACK_NAME=llm-usage-lens-poc
```

Deploy with the script (replace the VPC and subnet IDs). It checks your
credentials, validates the template, creates or updates the stack and prints
the outputs and next steps. It never builds, pushes or starts the application:

```bash
poc/scripts/deploy-stack.sh --region "$AWS_REGION" --stack-name "$STACK_NAME" --vpc-id vpc-0123456789abcdef0 --subnet-id subnet-0123456789abcdef0
```

Instead of passing options each time, keep them in a configuration file:

```bash
cp poc/stack.env.example poc/stack.env
```

Edit `poc/stack.env`: replace the `<placeholders>` you need (at least
`VpcId` and `SubnetId`) and leave the rest empty or at their defaults. Then:

```bash
poc/scripts/deploy-stack.sh
```

- `poc/stack.env` is gitignored ([`poc/.gitignore`](.gitignore)): it holds
  your account's IDs and ARNs. It holds no secrets.
- Keys are the template parameter names plus `AWS_PROFILE`, `AWS_REGION` and
  `STACK_NAME`. The file is parsed as `KEY=VALUE` lines and never executed.
- Precedence: command-line option, then the file, then the environment
  (`AWS_PROFILE`, `AWS_REGION`) and the template defaults. For example
  `poc/scripts/deploy-stack.sh --instance-type t4g.medium` overrides only
  that value.
- An empty value means "not set". A value that still contains a
  `<placeholder>` stops the script before any AWS call.
- `--config <path>` reads another file.

Every template parameter has a flag (`poc/scripts/deploy-stack.sh --help`),
`--profile` selects an AWS CLI profile, and `--parameter Key=Value` passes
any other parameter. Re-run it to update the stack: parameters you do not
pass keep their current values. All parameters except the VPC and subnet
have defaults; the ECR repository is `llm-usage-lens-poc` unless you pass
`--ecr-repository-name`.

The same thing with the plain AWS CLI:

```bash
aws cloudformation validate-template --template-body file://poc/cloudformation.yml --region "$AWS_REGION"
```

```bash
aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --template-file poc/cloudformation.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId=vpc-0123456789abcdef0 \
    SubnetId=subnet-0123456789abcdef0 \
    InstanceName=llm-usage-lens-poc \
    InstanceType=t4g.small \
    InstanceArchitecture=arm64 \
    RootVolumeSizeGiB=20 \
    EcrRepositoryName=llm-usage-lens-poc \
    AppPort=3000 \
    AllowedInboundCidr=""
```

| Parameter                    | Default              | Notes                                                                                                     |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| `VpcId`, `SubnetId`          | none (required)      | Existing network; not modified.                                                                           |
| `InstanceName`               | `llm-usage-lens-poc` | `Name` tag.                                                                                               |
| `InstanceType`               | `t4g.small`          | 2 GiB memory or more.                                                                                     |
| `InstanceArchitecture`       | `arm64`              | `arm64` or `x86_64`; must match `InstanceType`. Selects the AMI and the `ImagePlatform` output.           |
| `RootVolumeSizeGiB`          | `20`                 | Encrypted gp3, deleted with the instance.                                                                 |
| `ComposeVersion`             | `v2.32.4`            | Used only when the Amazon Linux repositories have no Compose plugin package: from the bucket first, then GitHub. |
| `ArtifactBucketName`         | empty                | Optional **existing** S3 bucket; the instance may read objects under `ArtifactKeyPrefix/`. Empty: no S3 access. |
| `ArtifactKeyPrefix`          | `llm-usage-lens-poc` | Key prefix in that bucket, without leading or trailing slash.                                             |
| `AppPort`                    | `3000`               | Host port; only matters with `AllowedInboundCidr`.                                                        |
| `AllowedInboundCidr`         | empty                | Empty: no inbound rule at all. A trusted IPv4 CIDR opens `AppPort` to it. `0.0.0.0/0` is rejected.        |
| `ExistingAlbArn`             | empty                | Optional existing Application Load Balancer; see *Publish through an existing load balancer*.             |
| `AlbAllowedInboundCidr`      | empty                | Optional CIDR the new load balancer security group allows on `AlbListenerPort`.                           |
| `AlbListenerPort`            | `443`                | Port of the listener the stack adds; must be free on the load balancer.                                   |
| `AlbCertificateArn`          | empty                | ACM certificate: set gives an HTTPS listener, empty gives HTTP.                                           |
| `EcrRepositoryName`          | `llm-usage-lens-poc` | Private repository created (and deleted) by the stack.                                                    |
| `UntaggedImageRetentionDays` | `7`                  | Lifecycle: days before untagged images expire.                                                            |

Read the outputs:

```bash
aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
```

Outputs: `InstanceId`, `InstancePrivateIp`, `InstanceSecurityGroupId`,
`EcrRepositoryUri`, `EcrRepositoryName`, `ImagePlatform`, `AppPort`, `Region`,
`AccountId`, with a bucket `ArtifactBucketName` and `ArtifactKeyPrefix`, and
with the load balancer option `AlbArn`,
`AlbSecurityGroupId`, `AlbListenerArn` and `AlbTargetGroupArn`. Keep the instance ID for the later commands:

```bash
export INSTANCE_ID=$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue | [0]" --output text)
```

The instance installs its prerequisites on first boot (a few minutes). The
log is `/var/log/cloud-init-output.log` on the instance.

## Build and push the image

```bash
poc/scripts/build-and-push.sh --region "$AWS_REGION" --stack-name "$STACK_NAME"
```

The script builds `apps/dashboard/Dockerfile` with the repository root as
context **on your machine**, tags the result `<EcrRepositoryUri>:latest` and
pushes that one tag. It reads the repository URI and the target platform from
the stack outputs, discovers the account with STS, and logs Docker in to ECR
with `aws ecr get-login-password`. It never prints or stores credentials.

Other forms:

```bash
poc/scripts/build-and-push.sh --profile my-sso-profile --region ap-southeast-2 --stack-name llm-usage-lens-poc
```

```bash
poc/scripts/build-and-push.sh --region "$AWS_REGION" --stack-name "$STACK_NAME" --platform linux/amd64
```

```bash
poc/scripts/build-and-push.sh --region "$AWS_REGION" --platform linux/arm64 --repository-uri 000000000000.dkr.ecr.ap-southeast-2.amazonaws.com/llm-usage-lens-poc
```

Platform: `linux/arm64` for Graviton instance types (the default
`t4g.small`), `linux/amd64` for x86 types. If you change the instance type to
another architecture, update the stack with the matching
`InstanceArchitecture`; the script then follows the `ImagePlatform` output.
`--platform` overrides it. Building for the other architecture than your
machine's uses emulation and is slow.

## Mirror the third-party images

The Compose stack pulls **every** image from the POC's ECR repository. Copy
the three third-party images into it once, and again whenever you change a
tag:

```bash
poc/scripts/mirror-images.sh --region "$AWS_REGION" --stack-name "$STACK_NAME"
```

| Source image               | ECR tag (same repository as the app) | `.env` variable      |
| -------------------------- | ------------------------------------ | -------------------- |
| `amazon/dynamodb-local`    | `dynamodb-local-<tag>`               | `DYNAMODB_LOCAL_TAG` |
| `aaronshaf/dynamodb-admin` | `dynamodb-admin-<tag>`               | `DYNAMODB_ADMIN_TAG` |
| `amazon/aws-cli`           | `aws-cli-<tag>`                      | `AWS_CLI_TAG`        |

The default tag is `latest`. To pin versions, pass them and set the same
values in `.env`:

```bash
poc/scripts/mirror-images.sh --region "$AWS_REGION" --stack-name "$STACK_NAME" --dynamodb-local-tag 2.6.0 --aws-cli-tag 2.22.0
```

The script takes the same `--profile`, `--platform` and `--repository-uri`
options as `build-and-push.sh`. It copies registry to registry with
`docker buildx imagetools` (nothing is pulled into your local Docker), and it
copies only the target platform's image: the repository's lifecycle rule
expires untagged images, which would break a multi-platform copy. The ECR
tags never start with `latest`, so the rule that keeps one `latest` image
does not touch them. Docker Hub's anonymous pull limits apply to your
machine; `docker login` first if you hit them.

## S3 artifact bucket (optional)

One **existing** bucket carries two things to the instance: the app's
`config.yaml` and, when needed, the Docker Compose binary. Deploy the stack
with `ArtifactBucketName` (and optionally `ArtifactKeyPrefix`) so the
instance role may read under `<prefix>/`:

```bash
poc/scripts/deploy-stack.sh --artifact-bucket my-poc-artifacts --artifact-prefix llm-usage-lens-poc
```

Layout under the prefix:

```
s3://<bucket>/<prefix>/
├── config/config.yaml                                   read by the s3-config service
└── compose/<ComposeVersion>/docker-compose-linux-<arch>  read at first boot or by hand
    compose/<ComposeVersion>/docker-compose-linux-<arch>.sha256
```

Upload the configuration file (edit [`config/config.yaml`](config/config.yaml)
first; it ships with every setting commented out):

```bash
aws s3 cp poc/config/config.yaml "s3://$S3_BUCKET/$S3_KEY_PREFIX/config/config.yaml" --region "$AWS_REGION"
```

On the instance, set `S3_BUCKET` and `S3_KEY_PREFIX` in `.env` to the same
values. At every `docker compose up`, the one-shot `s3-config` service
copies the file into the `app-config` volume and the app reads it at start.
With `S3_BUCKET` empty, `s3-config` writes an empty `config.yaml` instead
(the same as the image's built-in one), so S3 stays optional. A bucket that
is set but unreadable stops the app from starting; `docker compose logs
s3-config` shows why.

## Install Docker Compose from S3

Needed only when the instance has no internet and the Amazon Linux
repositories do not provide the `docker-compose-plugin` package. Check on
the instance first:

```bash
docker compose version
```

If that fails, stage the release binary through the bucket. On the
**developer machine** (set `ARCH` to `aarch64` for Graviton/`arm64`
instances, `x86_64` for `x86_64` ones, and use the stack's `ComposeVersion`):

```bash
export COMPOSE_VERSION=v2.32.4 ARCH=aarch64
```

```bash
curl -fsSLO "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$ARCH"
```

```bash
curl -fsSLO "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$ARCH.sha256"
```

```bash
shasum -a 256 -c "docker-compose-linux-$ARCH.sha256"
```

```bash
aws s3 cp "docker-compose-linux-$ARCH" "s3://$S3_BUCKET/$S3_KEY_PREFIX/compose/$COMPOSE_VERSION/" --region "$AWS_REGION"
```

```bash
aws s3 cp "docker-compose-linux-$ARCH.sha256" "s3://$S3_BUCKET/$S3_KEY_PREFIX/compose/$COMPOSE_VERSION/" --region "$AWS_REGION"
```

A new instance installs it from there at first boot (the boot script tries
the package, then the bucket, then GitHub). On an instance that is already
running, install it by hand, as root:

```bash
export S3_BUCKET=my-poc-artifacts S3_KEY_PREFIX=llm-usage-lens-poc COMPOSE_VERSION=v2.32.4 ARCH=$(uname -m)
```

```bash
cd "$(mktemp -d)"
```

```bash
aws s3 cp "s3://$S3_BUCKET/$S3_KEY_PREFIX/compose/$COMPOSE_VERSION/docker-compose-linux-$ARCH" .
```

```bash
aws s3 cp "s3://$S3_BUCKET/$S3_KEY_PREFIX/compose/$COMPOSE_VERSION/docker-compose-linux-$ARCH.sha256" .
```

```bash
sha256sum -c "docker-compose-linux-$ARCH.sha256"
```

```bash
install -D -m 0755 "docker-compose-linux-$ARCH" /usr/libexec/docker/cli-plugins/docker-compose
```

```bash
docker compose version
```

`/usr/libexec/docker/cli-plugins` is where Amazon Linux's Docker looks for
plugins. The checksum file names the binary, so the two must keep their
release names.

## Connect to EC2

SSH is not used: there is no key pair and port 22 is closed.

```bash
aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION"
```

Session Manager logs you in as `ssm-user`. Become root for the rest (Docker
and `/opt/llm-usage-lens-poc` are root-only):

```bash
sudo -i
```

Copy the runtime files to the instance. On the **developer machine**:

```bash
poc/scripts/make-ec2-bundle.sh
```

It prints one long command (a base64 archive of `docker-compose.yml`,
`.env.example` and `scripts/init-dynamodb.sh`; no secrets). Paste that command
into the Session Manager shell. It creates:

```
/opt/llm-usage-lens-poc/
├── docker-compose.yml
├── .env.example
└── scripts/init-dynamodb.sh
```

Repeat this step whenever those three files change. `config.yaml` is not
in the bundle: it comes from the S3 bucket (*S3 artifact bucket*).

## Configure the application

On the instance (as root):

```bash
cd /opt/llm-usage-lens-poc && cp -n .env.example .env && chmod 600 .env
```

Edit `.env` (`nano .env` or `vi .env`). Required values:

| Variable                               | Value                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ECR_REPOSITORY_URI`                   | Stack output `EcrRepositoryUri` (no tag).                                                                                          |
| `IMAGE_TAG`                            | `latest`.                                                                                                                          |
| `APP_ENV`                              | `dev`. (`prod` additionally requires a KMS key, TOTP and an `https` LiteLLM URL, which this POC does not provide.)                 |
| `AUTH_SECRET`                          | A new random value: `openssl rand -base64 33`. The repository's local placeholder is rejected.                                     |
| `AUTH_URL`, `NEXT_PUBLIC_APP_URL`      | The URL the browser uses. `http://localhost:3000` with port forwarding (default).                                                  |
| `AUTH_MASTER_USERNAME`                 | A username for the master sign-in, for example `poc-admin`. Not a secret.                                                          |
| `AUTH_MASTER_PASSWORD_HASH`            | Argon2id hash of the password, **in single quotes** (it contains `$`).                                                             |
| `AWS_REGION`, `DYNAMODB_TABLE_NAME`    | Keep the defaults (`ap-southeast-2`, `bedrock-usage`).                                                                             |
| `LITELLM_ALLOWED_HOSTS`                | Host of the external LiteLLM, with `:port` unless it is the scheme's default port. Example: `litellm.example.internal:4000`.       |
| `LITELLM_SERVICE_KEY`                  | The LiteLLM service key. Leave empty to run without LiteLLM.                                                                       |

`DYNAMODB_ENDPOINT` is fixed in `docker-compose.yml` to
`http://dynamodb-local:8000` (the Compose service name, not `localhost`).

Generate the password hash on the **developer machine**, from
`apps/dashboard` (same command as the
[auth guide](../docs/guides/auth-setup.md), *Master user and break-glass*),
then clear it from your shell history:

```bash
node -e "require('hash-wasm').argon2id({password: process.argv[1], salt: require('crypto').randomBytes(16), parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'encoded'}).then(console.log)" '<password>'
```

The master user is always `internal-admin`, its session lasts one hour, and
five failed attempts lock it for 15 minutes.

Never commit `.env`, never paste secrets into CloudFormation parameters or
UserData, and never configure AWS access keys on the instance: the instance
role is its only AWS identity.

### LiteLLM (external)

LiteLLM is already deployed elsewhere. The POC neither runs nor manages it,
and `docker-compose.yml` has no LiteLLM service.

1. Put its host in `LITELLM_ALLOWED_HOSTS` and its service key in
   `LITELLM_SERVICE_KEY`, then start or restart the app.
2. Sign in, open **Settings → LiteLLM**, enter the base URL (for example
   `http://litellm.example.internal:4000`; `APP_ENV=dev` accepts `http` and
   `https`) and run the connection test. The URL saves only when the test
   passes, and only when its host is in `LITELLM_ALLOWED_HOSTS`.

Network prerequisites, none of which the POC creates:

- **DNS:** the instance must resolve the LiteLLM hostname. A private hosted
  zone must be associated with this VPC.
- **Routing:** a route from the subnet to the endpoint (same VPC, peering,
  Transit Gateway, VPN, or internet egress for a public endpoint). Do not
  assume the endpoint is public.
- **Firewalls:** the LiteLLM side must allow its port from this instance:
  allow the stack output `InstanceSecurityGroupId` (same VPC or peered VPC),
  or the instance's private IP / NAT address. The instance's own security
  group already allows all outbound traffic. Check network ACLs too.

## Start the application

On the instance, as root, in `/opt/llm-usage-lens-poc`. Log Docker in to ECR
with the instance role (replace the registry host with the part of
`ECR_REPOSITORY_URI` before the first `/`):

```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin 000000000000.dkr.ecr.ap-southeast-2.amazonaws.com
```

Pull and start:

```bash
docker compose pull
```

```bash
docker compose up -d
```

Create the table (first start, and after a data reset; sign-in needs it,
because the master user's attempt counter is stored there):

```bash
bash scripts/init-dynamodb.sh
```

Check:

```bash
docker compose ps
```

```bash
curl -s http://127.0.0.1:3000/api/health
```

Expected: `{"data":{"status":"ok","dependencies":{"dynamodb":"ok","litellm":"not-configured"}}}`.
`"degraded"` before `init-dynamodb.sh` has run is normal.

Services and how they talk:

| Service          | Image                              | Host port        | Notes                                                             |
| ---------------- | ---------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `s3-config`      | `${ECR_REPOSITORY_URI}:aws-cli-<tag>`        | none             | One-shot, host network: copies `config.yaml` from S3 (or writes an empty one) into the `app-config` volume, then exits |
| `app`            | `${ECR_REPOSITORY_URI}:latest`               | `127.0.0.1:3000` | Starts after `s3-config` succeeds; reads `/config/config.yaml`; reaches DynamoDB at `http://dynamodb-local:8000` on network `poc` |
| `dynamodb-local` | `${ECR_REPOSITORY_URI}:dynamodb-local-<tag>` | `127.0.0.1:8000` | Data in the named volume `dynamodb-data`                          |
| `dynamodb-admin` | `${ECR_REPOSITORY_URI}:dynamodb-admin-<tag>` | `127.0.0.1:8001` | Reaches DynamoDB at `http://dynamodb-local:8000`                  |

`app`, `dynamodb-local` and `dynamodb-admin` share the dedicated network
`llm-usage-lens-poc`; `s3-config` runs on the host network, the only way a
container can use the instance role (the metadata hop limit is 1). All host
ports bind to loopback, so nothing is reachable from the network.
`docker compose ps -a` lists `s3-config` as `Exited (0)` after a good start.

### Open the app in a browser

From the developer machine, forward local port 3000 to the instance:

```bash
aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION" --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
```

Then open <http://localhost:3000> and sign in with the master user.

Direct access instead (only if needed): redeploy the stack with
`AllowedInboundCidr=<your trusted CIDR>`, set `APP_BIND_ADDRESS=0.0.0.0` and
`AUTH_URL` / `NEXT_PUBLIC_APP_URL` to `http://<instance address>:3000` in
`.env`, and run `docker compose up -d`. The traffic is then plain HTTP;
prefer port forwarding. The instance needs an address your network can reach.

### Publish through an existing load balancer (optional)

The stack can attach the app to an Application Load Balancer you already
have. It creates, and later deletes, only its own resources:

| Created by the stack                 | Purpose                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Listener on the existing ALB         | `AlbListenerPort`, HTTPS with `AlbCertificateArn` or HTTP without; forwards to the target group           |
| Target group                         | The instance on `AppPort`; health check `GET /api/health`                                                 |
| **New** security group for the ALB   | Outbound: `AppPort` to the instance only. Inbound: `AlbListenerPort` from `AlbAllowedInboundCidr`, if set |
| Inbound rule on the instance's group | `AppPort` from the new ALB security group only                                                            |

It does **not** create, change or delete the load balancer, the load
balancer's existing security groups, its other listeners, its certificates,
its subnets or DNS. The existing security groups are not reused: the
instance trusts only the new group.

CloudFormation cannot attach a security group to a load balancer the stack
does not own, so that one step is a script. It **adds** the new group to the
groups already on the load balancer; it never replaces them.

Requirements on the existing resources:

- An Application Load Balancer in the same VPC as the instance, whose subnets
  can route to the instance's subnet, with fewer than five security groups.
- `AlbListenerPort` is not used by another listener on it.
- For HTTPS, an ACM certificate in the same region for the hostname you use.
  The stack references the certificate; it never deletes it.
- Inbound access to the new listener: either set `AlbAllowedInboundCidr`, or
  rely on a rule the load balancer's existing groups already have.

1. Deploy (or update) the stack with the load balancer parameters:

   ```bash
   poc/scripts/deploy-stack.sh --region "$AWS_REGION" --stack-name "$STACK_NAME" --vpc-id vpc-0123456789abcdef0 --subnet-id subnet-0123456789abcdef0 --alb-arn arn:aws:elasticloadbalancing:ap-southeast-2:000000000000:loadbalancer/app/my-alb/0123456789abcdef --alb-listener-port 443 --alb-certificate-arn arn:aws:acm:ap-southeast-2:000000000000:certificate/00000000-0000-0000-0000-000000000000 --alb-allowed-inbound-cidr 203.0.113.0/24
   ```

2. Attach the new security group to the load balancer:

   ```bash
   poc/scripts/alb-security-group.sh attach --region "$AWS_REGION" --stack-name "$STACK_NAME"
   ```

   `status` instead of `attach` shows the load balancer's groups without
   changing anything. The script reads the current groups, appends the POC
   group and writes the combined list back.

3. On the instance, edit `.env` and run `docker compose up -d`:

   | Variable                          | Value                                                                               |
   | --------------------------------- | ----------------------------------------------------------------------------------- |
   | `APP_BIND_ADDRESS`                | `0.0.0.0`, so the load balancer can reach the published port.                       |
   | `APP_PORT`                        | The stack's `AppPort` (default `3000`).                                             |
   | `AUTH_URL`, `NEXT_PUBLIC_APP_URL` | The URL users open, for example `https://poc.example.com` (add `:port` if not 443). |

4. Check the target. It is healthy once the group is attached and the app
   answers `/api/health`:

   ```bash
   aws elbv2 describe-target-health --region "$AWS_REGION" --target-group-arn "$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='AlbTargetGroupArn'].OutputValue | [0]" --output text)"
   ```

Notes:

- Until step 2 is done the target stays unhealthy: the instance accepts the
  app port only from the new group.
- With an empty `AlbCertificateArn` the listener is plain HTTP; use that only
  on an internal load balancer.
- The listener forwards **every** request on its port to the app. If the
  load balancer already serves other applications on that port, use another
  port; the POC does not add rules to an existing listener.
- Security groups on a load balancer are additive: the new group's inbound
  rule adds to whatever the existing groups allow, and the existing groups'
  outbound rules still apply to the other targets.
- Removing the load balancer option later: run the `detach` command from
  *Cleanup* first, then update the stack with `--alb-arn ""`.

### Load sample data (optional)

The table starts empty. To load the repository's seed data, forward the
instance's DynamoDB Local port to your machine (stop a local DynamoDB Local on
port 8000 first):

```bash
aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION" --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["8000"],"localPortNumber":["8000"]}'
```

In another terminal, from the repository root:

```bash
pnpm db:seed
```

The seed scripts only ever target a local endpoint (`http://localhost:8000`).

## Update the application

1. Change code locally.
2. `poc/scripts/build-and-push.sh --region "$AWS_REGION" --stack-name "$STACK_NAME"`
3. `aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION"`, then `sudo -i` and `cd /opt/llm-usage-lens-poc`.
4. `docker compose pull` (log in to ECR again first if the 12-hour token expired).
5. `docker compose up -d`
6. `docker compose ps`, `curl -s http://127.0.0.1:3000/api/health`, `docker compose logs --tail 100 app`.

There is no automatic deployment, polling or pipeline. If
`docker-compose.yml` or `.env.example` changed, repeat the bundle step in
*Connect to EC2* first.

To change `config.yaml`: upload the new file (*S3 artifact bucket*), then
`docker compose up -d --force-recreate s3-config app`. To change a mirrored
image tag: re-run `mirror-images.sh` with the new tag, set it in `.env`, then
`docker compose pull` and `docker compose up -d`. Old image layers stay on disk until pruned:
`docker image prune -f`.

## Verify and troubleshoot

On the instance, as root, in `/opt/llm-usage-lens-poc`:

| Task                                   | Command                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| List containers and health             | `docker compose ps`                                                                                  |
| Logs                                   | `docker compose logs --tail 200 app` (add `-f` to follow; other services: `dynamodb-local`, `dynamodb-admin`) |
| Health state of the app container      | `docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)"`                   |
| App health endpoint                    | `curl -s http://127.0.0.1:3000/api/health`                                                           |
| Restart one service                    | `docker compose restart app`                                                                         |
| Stop / start everything                | `docker compose stop` / `docker compose up -d`                                                       |
| Docker disk usage                      | `docker system df` and `df -h /`                                                                     |
| Image used by the running app          | `docker inspect --format '{{.Config.Image}} {{.Image}}' "$(docker compose ps -q app)"`               |
| Digest of the pulled image             | `docker image inspect --format '{{index .RepoDigests 0}}' "$(docker compose config --images \| grep ecr)"` |
| Tables in DynamoDB Local               | `bash scripts/init-dynamodb.sh` (reports "already exists") or DynamoDB Admin                         |
| Host setup log                         | `tail -n 50 /var/log/cloud-init-output.log`                                                          |

The app exits at start when its environment is invalid; the log line names
the variables (never their values), for example
`Invalid environment variables: AUTH_SECRET`.

**DynamoDB Admin** is bound to loopback on the instance. Forward it:

```bash
aws ssm start-session --target "$INSTANCE_ID" --region "$AWS_REGION" --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["8001"],"localPortNumber":["8001"]}'
```

Then open <http://localhost:8001>. It can edit and delete data, so it is never
published on the network and the security group has no rule for it.

**LiteLLM connectivity**, without printing the key (set `LITELLM_HOST` to the
host and port, and use the right scheme):

```bash
LITELLM_HOST=litellm.example.internal:4000
```

```bash
getent hosts "${LITELLM_HOST%%:*}"
```

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 10 "http://$LITELLM_HOST/health/liveliness"
```

```bash
docker compose exec app wget -q -O /dev/null -T 10 "http://$LITELLM_HOST/health/liveliness" && echo "reachable from the app container"
```

- No DNS answer: fix resolution (private hosted zone association).
- Timeout: routing, security group or network ACL on the path.
- `HTTP 200`: the network path works. The key and its allowed routes are then
  checked by the connection test in **Settings → LiteLLM**.
- "The base URL is not permitted": the host (and port) is missing from
  `LITELLM_ALLOWED_HOSTS`; fix `.env` and run `docker compose up -d`.

`/health/liveliness` is LiteLLM's unauthenticated liveness route; if your
deployment disables it, any HTTP status code still proves reachability.

## Cleanup

These are four separate things:

| Step                               | Command                                                                 | Removes                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Stop and remove containers         | `docker compose down`                                                   | Containers and the network. **Keeps** the `dynamodb-data` volume.       |
| Also delete DynamoDB Local data    | `docker compose down -v`                                                | The above **and all table data**. Run `init-dynamodb.sh` after the next start. |
| Delete images on the instance      | `docker image prune -a -f`                                              | Unused local images only. ECR is untouched.                             |
| Delete images on your machine      | `docker image rm <EcrRepositoryUri>:latest`                             | The local build result only.                                            |
| Delete the AWS infrastructure      | `aws cloudformation delete-stack --region "$AWS_REGION" --stack-name "$STACK_NAME"` then `aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name "$STACK_NAME"` | Everything the stack created (below). |

To inspect the data volume: `docker volume inspect llm-usage-lens-poc_dynamodb-data`.
To keep a copy before deleting, export the items you need with DynamoDB Admin;
the POC has no backup.

If the stack was deployed with `ExistingAlbArn`, **detach the POC security
group from the load balancer before deleting the stack**. A security group
that is still attached cannot be deleted, so the stack deletion would stop
at `DELETE_FAILED` (nothing external is harmed; detach and delete again):

```bash
poc/scripts/alb-security-group.sh detach --region "$AWS_REGION" --stack-name "$STACK_NAME"
```

The script removes only the POC group from the load balancer and leaves its
other security groups attached.

The S3 bucket is **never** touched by the stack. Remove the POC's objects
yourself when you no longer need them, for example with
`aws s3 rm "s3://$S3_BUCKET/$S3_KEY_PREFIX/" --recursive` (check the prefix
first: it deletes everything under it).

Deleting the stack removes **only what the stack created**: the instance and
its root volume, its security group and IAM role, the ECR repository (with
the app image and the mirrored images), and
with the load balancer option the POC listener, target group and the new
security group. It never deletes the existing load balancer, that load
balancer's own security groups or other listeners, the ACM certificate, the
VPC or the subnet.

> **Warning: deleting the stack permanently deletes the ECR repository and
> every image in it.** The repository is created with `EmptyOnDelete: true`
> and has no `Retain` policy, so CloudFormation force-deletes it together
> with its images. There is no extra step and no undo.

Deleting the stack also terminates the instance and deletes its root EBS
volume (`DeleteOnTermination: true`), which holds the Docker images, the
logs, `.env` and the `dynamodb-data` volume: **the DynamoDB Local data is
lost with the instance.** The same happens if a stack update replaces the
instance (for example when a newer Amazon Linux AMI is resolved, or the
architecture changes).

`EmptyOnDelete` is a documented property of `AWS::ECR::Repository`. If stack
deletion ever fails on a non-empty repository (for example in a partition
without the property), delete the repository by hand and delete the stack
again:

```bash
aws ecr delete-repository --repository-name llm-usage-lens-poc --region "$AWS_REGION" --force
```

Not owned by the stack, with their own lifecycle: the VPC and subnet, the
existing load balancer with its security groups and certificate, the
external LiteLLM deployment and its service key (revoke the key in LiteLLM if
the POC is finished), CloudTrail records of the sessions, and any EBS
snapshot you took by hand.

## Cost and security considerations

Cost (no prices quoted here; see the linked pages):

- **EC2 and EBS:** the instance is billed while it runs and the gp3 root
  volume is billed while it exists, including while the instance is stopped
  ([EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/),
  [EBS pricing](https://aws.amazon.com/ebs/pricing/)). Stop the instance or
  delete the stack when the POC is idle.
- **ECR:** storage per GB-month for the stored image layers
  ([ECR pricing](https://aws.amazon.com/ecr/pricing/)). The lifecycle policy
  keeps this to roughly one image.
- **Data transfer:** pulls from ECR in the same region are not charged for
  transfer, but traffic through a NAT gateway is charged per GB by the NAT
  gateway, and internet egress is charged
  ([data transfer](https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer)).
  Interface VPC endpoints, where the network uses them, have their own hourly
  and per-GB charges ([PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/)).
- **Systems Manager:** Session Manager has no additional charge for EC2
  instances ([Systems Manager pricing](https://aws.amazon.com/systems-manager/pricing/)).
- **Load balancer:** the existing load balancer is already billed; the added
  listener and target group add no fixed charge, but traffic through them
  counts towards its capacity units
  ([ELB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)).
- **Public IPv4:** if the subnet assigns a public IPv4 address, AWS charges
  for it hourly ([VPC pricing](https://aws.amazon.com/vpc/pricing/)).

Security:

- **Exposure:** no SSH, no key pair, no inbound rule unless
  `AllowedInboundCidr` or `ExistingAlbArn` is set, and `0.0.0.0/0` is
  rejected. With the load balancer option the only new inbound source on the
  instance is the POC's own load balancer security group, but the app is then as reachable as that
  load balancer is. All container
  ports bind to loopback by default. DynamoDB Admin and DynamoDB Local are
  never published. Outbound traffic is unrestricted (needed for SSM, ECR,
  S3 and LiteLLM; GitHub only for the Compose fallback).
- **Instance role:** `AmazonSSMManagedInstanceCore` plus ECR pull on this
  one repository (`ecr:GetAuthorizationToken` on `*` as AWS requires;
  `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`
  on the repository ARN). It cannot push, delete images or delete the
  repository. With `ArtifactBucketName`, also `s3:GetObject` under
  `<bucket>/<prefix>/*` and `s3:ListBucket` limited to that prefix; no
  write. IMDSv2 is required with hop limit 1, so containers on the Compose
  network cannot read the instance credentials. The one exception is
  `s3-config`, which runs on the host network to read `config.yaml`; it is a
  one-shot `aws-cli` container that exits after the copy.
- **Developer identity:** needs the push permissions listed in
  *Prerequisites*; they are not granted by this stack.
- **Session Manager:** anyone with `ssm:StartSession` on the instance gets a
  root-capable shell and can read `.env`. Restrict that permission, and
  enable session logging in your account if required.
- **Secrets:** `AUTH_SECRET`, the master password hash and the LiteLLM
  service key exist only in `/opt/llm-usage-lens-poc/.env` (mode 600, root)
  on the encrypted root volume. They are not in Git, CloudFormation or
  UserData. This is weaker than the project's production design (SSM
  SecureString parameters under a KMS key) and is acceptable for a POC only.
  Use a LiteLLM service key dedicated to the POC so it can be revoked alone.
- **Plain HTTP:** the app is served over HTTP. With port forwarding the
  traffic is inside the encrypted SSM tunnel; with `AllowedInboundCidr` it
  is not encrypted.
- **Data:** DynamoDB Local holds no real billing data unless you load some;
  it has no authentication of its own, which is why it stays on loopback.
- **Disk:** the default 20 GiB volume holds the OS, three images and their
  logs with room to spare. Container logs are capped at 3 × 10 MB per
  service. Each update leaves the previous app image on disk until
  `docker image prune -f`. Watch `df -h /` and `docker system df`.
- **ECR lifecycle:** a new `latest` push leaves the previous image untagged;
  untagged images expire after `UntaggedImageRetentionDays` (7). A second
  rule keeps at most one image tagged `latest`; with a single mutable tag it
  is a safeguard that normally has nothing to do. Scan-on-push is enabled.
- **Third-party images:** `amazon/dynamodb-local`,
  `aaronshaf/dynamodb-admin` and `amazon/aws-cli` are mirrored into the POC
  repository and default to `latest`, as in the devcontainer. A mirrored tag
  does not change until you re-run `mirror-images.sh`; pin versions with its
  tag options and the matching `.env` values for repeatable pulls.
  Scan-on-push covers the mirrored images too.

## Assumptions and limits

- **Not tested against AWS.** The stack has not been deployed, no image has
  been pushed, and connectivity and stack deletion have not been exercised.
  See *Validation status* below.
- The Compose plugin install tries the Amazon Linux package first, then the
  binary staged in the bucket, then the GitHub release named by
  `ComposeVersion` (checksum verified either way). Which path runs depends on
  the AMI's repositories and the network at boot. If none works, the boot
  still finishes; install Compose by hand (*Install Docker Compose from S3*).
- The `dynamodb-local` health check opens a TCP connection with `bash`
  inside that image. It could not be run here (no Docker daemon). If the
  service stays `unhealthy` while `curl -s http://127.0.0.1:8000` on the
  instance answers, the image lacks `bash`: replace the `test` line, since
  `app` waits for this check.
- `APP_ENV=dev` is deliberate. Master-user TOTP enrolment and other
  KMS-backed features need `TOTP_KMS_KEY_ID` and KMS permissions, which the
  POC does not provide.
- The audit-log copy to CloudWatch (`AUDIT_LOG_GROUP_NAME`) and OpenTelemetry
  export are left unset.
- Single instance, no TLS, no backups, no high availability.

### Validation status

| Check                                                                 | Result                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `bash -n` on all six scripts; `shellcheck` on `mirror-images.sh`      | Passed                                                      |
| `mirror-images.sh` platform lookup against the public images          | Passed: `docker buildx imagetools inspect` returns the arm64 digest of all three images (multi-platform indexes) |
| `mirror-images.sh` copy into ECR (`imagetools create`)                | **Not run** (no AWS session)                                 |
| `s3-config` run locally (public `amazon/aws-cli` image)               | Passed: empty `S3_BUCKET` writes an empty read-only `config.yaml` and exits 0; a bucket it cannot read exits 1, so `app` does not start |
| S3 changes to `cloudformation.yml` (parsed YAML)                      | Passed: the S3 read policy, outputs and boot-script substitutions resolve to declared parameters. Service-side validation and the S3 Compose install at boot **not run** |
| `deploy-stack.sh` and `alb-security-group.sh` against a stub AWS CLI  | Passed: attach keeps existing groups, detach removes only the POC group, limits and missing parameters are refused; `stack.env` values load, command-line options override them, unfilled placeholders are refused |
| `docker compose config` with `.env.example`                           | Passed; four services, all images from `ECR_REPOSITORY_URI`, all host ports on `127.0.0.1` |
| Resources, outputs and IAM actions as described                       | Checked by reading the parsed YAML                          |
| Lifecycle policy text is valid JSON with the two intended rules       | Passed                                                      |
| Prettier on `cloudformation.yml` and `docker-compose.yml`             | Passed                                                      |
| `make-ec2-bundle.sh` output decodes to the three runtime files        | Passed                                                      |
| Template validated offline against the CloudFormation resource schema | Passed, no findings (`aws-cdk-lib` 2.275.0 `CfnInclude` + synth-time "CloudFormation Validate"; a deliberately broken copy was rejected). Confirms `EmptyOnDelete` is a valid `AWS::ECR::Repository` property |
| `aws cloudformation validate-template` (service-side)                 | **Not run** (no usable AWS session when the POC was written). Run the command in *Deploy infrastructure* before deploying |
| Containers started locally (health checks, `init-dynamodb.sh`)        | **Not run** (no Docker daemon)                              |
| Image build, push, stack create/delete, sign-in, LiteLLM connectivity | **Not run**                                                 |
