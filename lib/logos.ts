import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "logos";

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const MAX_BYTES = 1_000_000; // 1MB is plenty for a 28px board tile

/**
 * Store a founder-uploaded logo in the public "logos" bucket and return its
 * public URL. The bucket is created on first use (service role); uploads are
 * validated for type and size and namespaced per user.
 */
export async function storeLogo(
  admin: SupabaseClient,
  userId: string,
  file: unknown
): Promise<{ url?: string; error?: string }> {
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Pick an image file." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "Logo must be under 1MB." };
  }
  const ext = LOGO_TYPES[file.type];
  if (!ext) {
    return { error: "PNG, JPG, or WebP only." };
  }

  try {
    // idempotent: fails harmlessly once the bucket exists
    await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: Object.keys(LOGO_TYPES),
    });
  } catch {
    // already exists
  }

  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) {
    return { error: "Upload failed — try a smaller image." };
  }
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
