import fs from "node:fs";
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

if (existingReleaseResponse.status === 404) {
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
  giteeRelease = await existingReleaseResponse.json();
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

const attachmentsResponse = await request(
  `${giteeApiBase}/releases/${giteeRelease.id}/attach_files?per_page=100`,
  { headers: giteeHeaders },
);
const attachments = await attachmentsResponse.json();
const existingNames = new Set(
  Array.isArray(attachments)
    ? attachments.map((attachment) => attachment.name).filter(Boolean)
    : [],
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

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(assetPath)]), fileName);
  await request(
    `${giteeApiBase}/releases/${giteeRelease.id}/attach_files`,
    {
      method: "POST",
      headers: giteeHeaders,
      body: form,
    },
    [200, 201],
  );
  console.log(`Uploaded ${fileName} to Gitee.`);
}

console.log(`Gitee mirror is up to date: https://gitee.com/${giteeRepository}/releases/tag/${tag}`);
