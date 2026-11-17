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

/**
 * Two-step send: the API creates the campaign and returns a pre-signed S3
 * URL; the browser then uploads the CSV straight to S3, and that upload is
 * what triggers the sender Lambda.
 */
export async function createAndUpload({ name, subject, template, csvFile }) {
  const { campaign_id, upload_url } = await request("/campaigns", {
    method: "POST",
    body: JSON.stringify({ name, subject, template }),
  });

  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "text/csv" },
    body: csvFile,
  });
  if (!put.ok) throw new Error(`CSV upload to S3 failed (${put.status})`);
  return campaign_id;
}
