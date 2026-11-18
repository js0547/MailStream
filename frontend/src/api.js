const API_URL = (
  import.meta.env.VITE_API_URL ||
  window.MAILSTREAM_CONFIG?.apiUrl ||
  ""
).replace(/\/$/, "");

async function request(path, options = {}) {
  if (!API_URL) {
    throw new Error("API URL is not configured. Deploy with Terraform or set VITE_API_URL.");
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const getConfig = () => request("/config");
export const listCampaigns = () => request("/campaigns").then((d) => d.campaigns);
export const getCampaign = (id) => request(`/campaigns/${id}`);

async function putToS3(url, file, contentType, label) {
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  if (!res.ok) throw new Error(`Upload of ${label} to S3 failed (${res.status})`);
}

/**
 * The API creates the campaign and returns pre-signed S3 URLs. The browser
 * uploads any attachments first, then the CSV: the CSV upload is what
 * triggers the sender Lambda, so the files must already be in S3 by then.
 */
export async function createAndUpload({ name, subject, template, csvFile, attachments = [] }, onProgress = () => {}) {
  const res = await request("/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name,
      subject,
      template,
      attachments: attachments.map((f) => ({ name: f.name, size: f.size })),
    }),
  });

  for (let i = 0; i < res.attachments.length; i++) {
    const meta = res.attachments[i];
    onProgress(`Uploading attachment ${i + 1} of ${res.attachments.length}...`);
    await putToS3(meta.upload_url, attachments[i], meta.content_type, attachments[i].name);
  }

  onProgress("Uploading recipients...");
  await putToS3(res.upload_url, csvFile, "text/csv", "the CSV");
  return res.campaign_id;
}
