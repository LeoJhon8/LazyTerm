import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const [tag, assetsDirectory] = process.argv.slice(2);
const giteeToken = process.env.GITEE_TOKEN;
const giteeRepository = process.env.GITEE_REPOSITORY;
const githubRepository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;

if (!tag || !assetsDirectory) {
  throw new Error("Usage: node scripts/mirror-release-to-gitee.js <tag> <assets-directory>");
}

if (!giteeToken || !giteeRepository || !githubRepository || !githubToken) {
  throw new Error(
    "GITEE_TOKEN, GITEE_REPOSITORY, GITHUB_REPOSITORY, and GITHUB_TOKEN are required",
  );
}

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(giteeRepository)) {
  throw new Error(`Invalid GITEE_REPOSITORY: ${giteeRepository}`);
}

if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Invalid release tag: ${tag}`);
}

const [giteeOwner, giteeRepo] = giteeRepository.split("/");
const giteeApiBase = `https://gitee.com/api/v5/repos/${encodeURIComponent(giteeOwner)}/${encodeURIComponent(giteeRepo)}`;
const githubApiBase = `https://api.github.com/repos/${githubRepository}`;

async function request(url, options = {}, acceptedStatuses = [200]) {
  const response = await fetch(url, options);
  if (!acceptedStatuses.includes(response.status)) {
    const responseText = await response.text();
    throw new Error(
      `${options.method ?? "GET"} ${url} returned ${response.status}: ${responseText.slice(0, 500)}`,
    );
  }
  return response;
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getGiteeAttachmentNames(releaseId, headers) {
  const response = await request(
    `${giteeApiBase}/releases/${releaseId}/attach_files?per_page=100`,
    { headers },
  );
  const attachments = await response.json();
  return new Set(
    Array.isArray(attachments)
      ? attachments.map((attachment) => attachment.name).filter(Boolean)
      : [],
  );
}

function uploadGiteeAsset(releaseId, headers, assetPath) {
  const fileName = path.basename(assetPath);
  const escapedFileName = fileName.replace(/["\r\n]/g, "_");
  const boundary = `----LazyTermRelease${Date.now().toString(16)}`;
  const prefix = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${escapedFileName}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const contentLength =
    prefix.length + fs.statSync(assetPath).size + suffix.length;
  const uploadUrl = new URL(
    `${giteeApiBase}/releases/${releaseId}/attach_files`,
  );

  return new Promise((resolve, reject) => {
    const uploadRequest = https.request(
      uploadUrl,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": contentLength,
        },
        timeout: 30 * 60 * 1000,
      },
      (response) => {
        const responseChunks = [];
        response.on("data", (chunk) => responseChunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(responseChunks).toString("utf8");
          if (response.statusCode === 200 || response.statusCode === 201) {
            resolve();
            return;
          }
          reject(
            new Error(
              `POST ${uploadUrl} returned ${response.statusCode}: ${responseBody.slice(0, 500)}`,
            ),
          );
        });
      },
    );

    uploadRequest.on("timeout", () => {
      uploadRequest.destroy(
        new Error(`Uploading ${fileName} timed out after 30 minutes`),
      );
    });
    uploadRequest.on("error", reject);
    uploadRequest.write(prefix);

    const assetStream = fs.createReadStream(assetPath);
    assetStream.on("error", (error) => uploadRequest.destroy(error));
    assetStream.on("end", () => uploadRequest.end(suffix));
    assetStream.pipe(uploadRequest, { end: false });
  });
}

const githubReleaseResponse = await request(
  `${githubApiBase}/releases/tags/${encodeURIComponent(tag)}`,
  {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
);
const githubRelease = await githubReleaseResponse.json();

const giteeHeaders = {
  Accept: "application/json",
  Authorization: `Bearer ${giteeToken}`,
};

let giteeRelease;
const existingReleaseResponse = await fetch(
  `${giteeApiBase}/releases/tags/${encodeURIComponent(tag)}`,
  { headers: giteeHeaders },
);
const existingRelease = existingReleaseResponse.ok
  ? await existingReleaseResponse.json()
  : null;

if (
  existingReleaseResponse.status === 404 ||
  (existingReleaseResponse.ok && existingRelease === null)
) {
  const createBody = new URLSearchParams({
    tag_name: tag,
    name: githubRelease.name || `LazyTerm ${tag.slice(1)}`,
    body: githubRelease.body || "",
    target_commitish: githubRelease.target_commitish || "main",
    prerelease: String(Boolean(githubRelease.prerelease)),
  });
  const createResponse = await request(
    `${giteeApiBase}/releases`,
    {
      method: "POST",
      headers: {
        ...giteeHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: createBody,
    },
    [200, 201],
  );
  giteeRelease = await createResponse.json();
  console.log(`Created Gitee release ${tag}.`);
} else if (existingReleaseResponse.ok) {
  giteeRelease = existingRelease;
  const updateBody = new URLSearchParams({
    tag_name: tag,
    name: githubRelease.name || `LazyTerm ${tag.slice(1)}`,
    body: githubRelease.body || "",
    prerelease: String(Boolean(githubRelease.prerelease)),
  });
  const updateResponse = await request(
    `${giteeApiBase}/releases/${giteeRelease.id}`,
    {
      method: "PATCH",
      headers: {
        ...giteeHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: updateBody,
    },
  );
  giteeRelease = await updateResponse.json();
  console.log(`Updated existing Gitee release ${tag}.`);
} else {
  const responseText = await existingReleaseResponse.text();
  throw new Error(
    `Unable to query Gitee release ${tag}: ${existingReleaseResponse.status} ${responseText.slice(0, 500)}`,
  );
}

const existingNames = await getGiteeAttachmentNames(
  giteeRelease.id,
  giteeHeaders,
);

const assetPaths = fs
  .readdirSync(assetsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(assetsDirectory, entry.name))
  .sort();

if (assetPaths.length === 0) {
  throw new Error(`No release assets found in ${assetsDirectory}`);
}

for (const assetPath of assetPaths) {
  const fileName = path.basename(assetPath);
  if (existingNames.has(fileName)) {
    console.log(`Skipping existing Gitee asset ${fileName}.`);
    continue;
  }

  const assetSize = fs.statSync(assetPath).size;
  console.log(`Uploading ${fileName} (${assetSize} bytes) to Gitee.`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await uploadGiteeAsset(giteeRelease.id, giteeHeaders, assetPath);
      existingNames.add(fileName);
      console.log(`Uploaded ${fileName} to Gitee.`);
      break;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `Upload attempt ${attempt}/3 for ${fileName} failed: ${errorMessage}`,
      );

      try {
        const refreshedNames = await getGiteeAttachmentNames(
          giteeRelease.id,
          giteeHeaders,
        );
        if (refreshedNames.has(fileName)) {
          existingNames.add(fileName);
          console.log(`Gitee received ${fileName} despite the upload error.`);
          break;
        }
      } catch (refreshError) {
        const refreshErrorMessage =
          refreshError instanceof Error
            ? refreshError.message
            : String(refreshError);
        console.warn(
          `Unable to verify ${fileName} after the upload error: ${refreshErrorMessage}`,
        );
      }

      if (attempt === 3) {
        throw error;
      }
      await sleep(attempt * 10_000);
    }
  }
}

console.log(`Gitee mirror is up to date: https://gitee.com/${giteeRepository}/releases/tag/${tag}`);
