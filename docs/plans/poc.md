# Implementation Prompt: AWS EC2 + ECR Docker Compose POC

You are working in an existing application repository. Implement an isolated proof-of-concept (POC) deployment solution under a new `poc/` directory.

The POC must deploy the existing application to a small Amazon EC2 instance using Docker Compose. Build the application image locally and push it to a private Amazon ECR repository. Connect to the EC2 instance manually using AWS Systems Manager (SSM) Session Manager.

Keep all POC-specific infrastructure, scripts, configuration and documentation inside `poc/`. Avoid changing the existing application or development workflow unless a change is strictly necessary. Inspect the repository before implementing anything; follow its existing conventions and reuse its Dockerfile, build context, configuration and service definitions where practical.

## 1. Goals and architecture

Implement this workflow:

1. CloudFormation provisions an EC2 instance, its security group and IAM instance role, plus a private ECR repository.
2. The developer builds the application image on their local machine and pushes it to ECR using the `latest` tag.
3. The developer connects to EC2 using SSM Session Manager.
4. On EC2, Docker authenticates to ECR using the instance role, pulls the `latest` image and starts the application with Docker Compose.
5. Docker Compose starts the application and its required local supporting services.
6. The application connects to an already deployed, external LiteLLM service. LiteLLM is not deployed or managed by this POC.

The application deployment must be manual. CloudFormation may install and configure the host prerequisites, but must not automatically deploy or start the application.

## 2. Inspect the existing project first

Before making changes:

- Identify the application's entry point, Dockerfile, build context, runtime configuration and required environment variables.
- Inspect existing Docker Compose files and identify the services the application genuinely requires.
- Determine whether the application uses DynamoDB and whether DynamoDB Local is appropriate for this POC.
- Identify the project's existing LiteLLM client configuration, including the expected base URL, authentication mechanism and model/deployment setting.
- Determine the architecture supported by the application image and select a compatible EC2 architecture.
- Identify the application's listening port and any required health endpoint.
- Preserve existing application behaviour and avoid introducing duplicate or unnecessary configuration.

Do not guess environment variable names, ports, health endpoints, Dockerfile paths or build contexts. Derive them from the repository and document any assumptions that cannot be verified.

## 3. Docker Compose

Create `poc/docker-compose.yml` to run the existing application and the local supporting services it requires.

### Application service

- Reuse the existing application Dockerfile and build process to produce the image locally.
- On EC2, run the image from the ECR repository created by CloudFormation.
- Configure the image reference using environment variables, including the ECR repository URI and image tag.
- Use `latest` as the deployment tag.
- Do not build the application on EC2.
- Configure application settings through environment variables or an environment file.
- Add an appropriate restart policy and a health check if the application provides a suitable health endpoint.

### DynamoDB Local and DynamoDB Admin

If repository inspection confirms that the application requires DynamoDB for the POC, include:

- **DynamoDB Local** as a Compose service.
- **DynamoDB Admin** as a Compose service for browsing and managing local DynamoDB tables.

Configure DynamoDB Admin to connect to DynamoDB Local over the Compose network. Configure the application's DynamoDB endpoint to use the Compose service name and port, rather than `localhost`.

Use a persistent volume for DynamoDB Local data if persistence is required. Document how to inspect, preserve and reset this data.

Bind the DynamoDB Admin host port to localhost on the EC2 instance by default. If remote access is genuinely required, restrict it to an explicitly configured trusted CIDR. Never expose the administration interface publicly.

If the application does not require DynamoDB, do not add these services merely because they are listed here. Explain the finding in the README.

### LiteLLM is an external dependency

LiteLLM has already been deployed separately. The application must connect to that existing deployment.

**Do not include LiteLLM in Docker Compose.** Specifically, do not create a LiteLLM service or container, pull a LiteLLM image, add a `depends_on` entry for LiteLLM, install LiteLLM on EC2, or add a local LiteLLM health check.

Use the actual configuration variables and formats supported by the application. They may include:

- LiteLLM base URL.
- API key or other authentication setting.
- Model or deployment name.

Provide safe placeholders in `poc/.env.example` where appropriate. Never commit real API keys, credentials or production environment files.

Document that the EC2 instance must be able to resolve and reach the external LiteLLM endpoint. Explain any required routing, DNS, firewall, security group or VPC connectivity prerequisites. Do not assume that the endpoint is publicly accessible.

### General Compose requirements

- Include only services required by the application and POC.
- Use a dedicated Compose network for the application and its local dependencies.
- Configure persistent volumes only where useful and document their lifecycle.
- Expose only required application ports.
- Restrict administrative interfaces to localhost or a trusted CIDR.
- Add useful health checks and service dependencies for local services where supported.
- Do not make the application depend on LiteLLM being a Compose service.
- Keep resource usage appropriate for a small EC2 instance.
- Do not introduce Kubernetes, ECS or another orchestration platform.

## 4. CloudFormation infrastructure

Create a CloudFormation template under `poc/` that provisions the minimum AWS resources required.

### Resources to create

Create:

- One EC2 instance.
- One security group.
- An IAM role and instance profile for EC2.
- Systems Manager permissions for Session Manager.
- Least-privilege ECR permissions allowing the EC2 instance to pull from the repository created by this stack.
- One private ECR repository for the application.
- An EBS root volume configuration, with a configurable size.

Do not create:

- A VPC or subnet.
- Internet gateways, NAT gateways or route tables.
- VPC endpoints.
- ECS resources.
- Load balancers.
- RDS databases.
- S3 buckets.
- Other networking infrastructure.

Use an existing VPC and subnet supplied as CloudFormation parameters. Do not modify the existing network.

### Parameters

Provide parameters for at least:

- Existing VPC ID.
- Existing subnet ID.
- EC2 instance type, with a small POC-friendly default.
- EC2 root volume size.
- EC2 instance name.
- ECR repository name.
- Application port.
- Allowed inbound CIDR, if inbound application access is required.

Validate parameter values where practical and provide clear descriptions.

### EC2 requirements

- Prefer Amazon Linux 2023.
- Use a configurable instance type.
- Install Docker Engine.
- Install the Docker Compose plugin.
- Enable and start Docker.
- Ensure the SSM Agent is installed and running.
- Attach the EC2 instance profile.
- Do not require SSH access or create an SSH key pair.
- Do not place AWS credentials, API keys or application secrets in UserData.
- Do not pull or start the application image from UserData.

Use UserData only for host prerequisites such as installing and enabling Docker and ensuring SSM is available.

### ECR repository requirements

Create a private `AWS::ECR::Repository` with:

- Image tag mutability set to `MUTABLE`, so the `latest` tag can be updated.
- Image scanning on push enabled where supported.
- Default ECR encryption unless a customer-managed key is required for a documented reason.
- A lifecycle policy that removes untagged images after a defined retention period.
- A lifecycle policy that retains only the required recent image(s) tagged `latest`, where compatible with ECR lifecycle policy rules.

The normal build-and-push workflow must publish only the `latest` tag. Do not add commit-SHA, timestamp, semantic-version or other tags.

### ECR deletion behaviour

Deleting the CloudFormation stack must also delete the ECR repository, including its stored images.

- Verify the current CloudFormation resource specification for support of `EmptyOnDelete` on `AWS::ECR::Repository`.
- If supported, configure `EmptyOnDelete: true`.
- Do not use `DeletionPolicy: Retain` or `UpdateReplacePolicy: Retain` for the repository.
- If the property is not supported in the target environment, clearly document the limitation and provide the required manual cleanup command:

  ```bash
  aws ecr delete-repository --repository-name <REPOSITORY_NAME> --region <AWS_REGION> --force
  ```

- Ensure the README explains the correct cleanup sequence for the implemented approach.

Clearly warn that deleting the stack permanently deletes the ECR repository and all images stored in it.

### IAM permissions

Attach `AmazonSSMManagedInstanceCore` to the EC2 instance role, or an equivalent least-privilege policy if there is a clear reason.

Allow the EC2 instance to pull images from the ECR repository created by this stack. Include:

- `ecr:GetAuthorizationToken` with `Resource: "*"`, as required by AWS.
- `ecr:BatchCheckLayerAvailability`.
- `ecr:GetDownloadUrlForLayer`.
- `ecr:BatchGetImage`.

Scope repository-specific actions to the ARN of the repository created by the stack.

The EC2 instance role must not have permissions to push images or delete the ECR repository.

The developer's local AWS identity must have the permissions needed to authenticate to ECR and push images. Document these prerequisites; do not grant these permissions to the EC2 instance.

### Security group and network requirements

- Do not expose SSH port 22.
- Do not create SSH key pairs.
- Use Session Manager for administration.
- Restrict inbound application traffic to the minimum required.
- Do not use `0.0.0.0/0` as the default allowed CIDR for application or administration ports.
- Do not expose DynamoDB Admin publicly.
- Use least-privilege IAM permissions.
- Do not create networking resources.

Document that the existing subnet and VPC must provide the required connectivity. The EC2 instance needs access to:

- Systems Manager endpoints.
- ECR API and Docker registry endpoints over HTTPS.
- The S3 service endpoint used by ECR for image layers, as required by the network configuration.
- The external LiteLLM endpoint.
- Any other external services required by the application.

The existing network may provide internet egress or suitable VPC endpoints. Do not create or change routes or endpoints in this POC. Describe any missing connectivity as a deployment prerequisite.

## 5. Local image build and ECR push

Create `poc/scripts/build-and-push.sh`.

The script must build the existing application image locally and push it directly to the ECR repository created by CloudFormation.

It should:

1. Accept configurable AWS CLI profile, AWS region, CloudFormation stack name and target platform.
2. Discover the AWS account ID using STS; do not hardcode it.
3. Discover the ECR repository URI from the CloudFormation stack output where practical, or accept an explicit repository URI.
4. Verify that required tools, Docker daemon, AWS credentials, stack and repository are available.
5. Authenticate Docker to ECR using `aws ecr get-login-password`.
6. Build the application using the actual Dockerfile and build context identified during project inspection.
7. Build for the EC2 instance architecture.
8. Tag the image as `<ECR_REPOSITORY_URI>:latest`.
9. Push only the `latest` tag.
10. Print clear progress and error messages and fail on errors.

Use safe shell practices, including `set -euo pipefail`. Do not print or persist credentials.

Choose the target platform to match the EC2 architecture:

- `linux/amd64` for x86-based instances.
- `linux/arm64` for ARM-based Graviton instances.

Use Docker Buildx if needed. Document the selected architecture and how to override it if the EC2 instance type changes.

Do not build the application on EC2.

## 6. Manual deployment on EC2

The application must be deployed manually after infrastructure creation and image publication.

The workflow is:

1. Deploy the CloudFormation stack.
2. Build and push the application image locally.
3. Retrieve the EC2 instance ID from the stack outputs.
4. Connect using SSM Session Manager.
5. Authenticate Docker to ECR using the EC2 instance role.
6. Configure the application's runtime environment, including external LiteLLM settings.
7. Pull the application image.
8. Start the application and required local dependencies using Docker Compose.
9. Verify the application, local services and external LiteLLM connectivity.

Example connection command:

```bash
aws ssm start-session --target <INSTANCE_ID> --region <AWS_REGION>
```

On EC2, authenticate to ECR using the instance role:

```bash
aws ecr get-login-password --region <AWS_REGION> \
  | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

Then pull and start the services:

```bash
docker compose pull
docker compose up -d
```

Use the actual Compose file location and environment file conventions implemented in the POC. Do not configure long-lived AWS access keys on EC2.

CloudFormation must not automatically deploy or start the application.

## 7. Documentation

Create a clear, self-contained `poc/README.md` with exact commands that match the implemented files and configuration.

Include the following sections.

### Prerequisites

Document:

- AWS CLI.
- Docker and Docker Buildx, if required.
- Docker Compose.
- AWS Systems Manager Session Manager plugin.
- AWS permissions to deploy the CloudFormation stack and push images to ECR.
- Existing VPC and subnet IDs.
- Required outbound connectivity from the EC2 instance.
- Access to the external LiteLLM endpoint and any required credentials.

### Deploy infrastructure

Provide exact AWS CLI commands to deploy the CloudFormation stack, including all required parameters.

Explain how to retrieve the stack outputs, including:

- EC2 instance ID.
- ECR repository URI.
- ECR repository name.
- AWS region and account ID where useful.

### Build and push the image

Document how to run `poc/scripts/build-and-push.sh`, including examples for selecting an AWS profile, region, stack and target platform.

Explain that the script builds locally and publishes the `latest` tag to ECR.

### Connect to EC2

Provide the exact SSM Session Manager command using the instance ID and region.

Explain that SSH is not required.

### Configure the application

Document the required runtime environment variables and how to create the environment file on EC2.

Explain how to configure the application to reach the already deployed external LiteLLM service. Use the actual variable names found in the repository. Do not include real secrets.

Document the network prerequisites for reaching LiteLLM.

### Start the application

Provide the exact commands to authenticate to ECR, pull the image and start Compose services.

Explain which local supporting services are included and how they communicate over the Compose network.

### Update the application

Document the repeatable manual update process:

1. Make code changes locally.
2. Run the build-and-push script.
3. Connect to EC2 through Session Manager.
4. Run `docker compose pull`.
5. Run `docker compose up -d`.
6. Check container status, health and logs.

Do not add automatic deployment, polling, CI/CD pipelines or deployment triggers.

### Verify and troubleshoot

Include commands to:

- List running containers.
- Inspect container logs.
- Check health status.
- Restart or stop services.
- Check Docker disk usage.
- Inspect the image used by the running container.
- Diagnose connectivity to the external LiteLLM endpoint without printing secrets.
- Check DynamoDB Local and DynamoDB Admin if they are included.

### Cleanup

Explain how to:

- Stop and remove Compose containers.
- Decide whether to preserve or remove persistent DynamoDB data.
- Delete local Docker images if desired.
- Delete the CloudFormation stack.
- Delete the ECR repository and its images using the supported approach.
- Identify any EBS or external data that has a separate lifecycle.

Clearly distinguish between removing containers, deleting local images, deleting persistent application data and deleting AWS infrastructure.

## 8. Cost and security considerations

Document the main cost and security considerations:

- EC2 instance and EBS storage costs.
- ECR image storage costs.
- Data transfer charges where applicable.
- Systems Manager prerequisites.
- Network egress and VPC endpoint requirements.
- Security group exposure.
- IAM permissions for the EC2 role and local developer identity.
- Docker image and log storage on a small instance.
- ECR lifecycle policy behaviour.
- The destructive effect of deleting the stack on the ECR repository and images.
- Protection of application secrets and LiteLLM credentials.

Do not invent exact prices. Link to official AWS pricing or service documentation where useful.

## 9. Implementation constraints

- Keep all POC-specific files under `poc/`.
- Keep the POC isolated from the existing application.
- Reuse existing application code and Docker configuration.
- Do not change application functionality.
- Do not modify existing CI/CD pipelines.
- Do not create VPC, subnet, routing or endpoint resources.
- Do not use SSH.
- Do not store credentials or secrets in Git.
- Do not configure long-lived AWS credentials on EC2.
- Do not publish image tags other than `latest`.
- Do not build the application on EC2.
- Include DynamoDB Local and DynamoDB Admin only if repository inspection confirms they are required.
- Do not include or deploy LiteLLM; configure the application to connect to the separately deployed external service.
- Do not automatically deploy or start the application from CloudFormation UserData.
- Keep scripts readable, maintainable and consistent with repository conventions.
- Prefer simplicity, low cost, security and maintainability over production-grade complexity.

## 10. Validation and completion criteria

Before finishing:

- Validate the CloudFormation template.
- Verify the ECR lifecycle policy syntax and intended retention behaviour.
- Verify the repository deletion behaviour, including the handling of images.
- Validate the Docker Compose configuration.
- Run shell syntax checks on all scripts.
- Verify the Dockerfile path and build context.
- Verify that the image repository URI and `latest` tag are consistent across the script and Compose configuration.
- Verify that the build platform matches the EC2 instance architecture.
- Verify that EC2 IAM permissions allow ECR pulls but not pushes or repository deletion.
- Verify that the local developer identity has the permissions required to push images.
- Verify that the security group does not expose unnecessary ports.
- Verify that DynamoDB Local and DynamoDB Admin are correctly configured if included.
- Verify that LiteLLM is not defined as a Compose service and that the application's external LiteLLM settings are configurable.
- Ensure the README commands match the actual scripts, template outputs and Compose configuration.
- Check that the instance has adequate disk space for the application image, containers, logs and any persistent local data.

Do not claim that AWS deployment, image publication, external connectivity or stack deletion has been tested unless those actions have actually been performed.

## 11. Final response

When implementation is complete, provide:

1. A summary of the files created under `poc/`.
2. A concise explanation of the architecture.
3. The commands to deploy the CloudFormation stack.
4. The command to build and push the `latest` image.
5. The commands to connect to EC2 and start the application.
6. The manual update procedure.
7. The cleanup procedure, including ECR repository deletion.
8. Any assumptions, prerequisites, security considerations or limitations.

The result must be a self-contained, manually operated POC deployment solution that does not disrupt the existing development workflow.
