import "server-only"
import { supabaseAdmin } from "./supabaseAdmin"

import { AVATAR_BUCKET, RESUME_BUCKET } from "@/lib/constants/storage"

export async function uploadFileToSupabase(file: File | Blob, fileName: string): Promise<{ url: string; path: string }> {
  const contentType = (file as any)?.type || undefined
  let body: any = file
  try {
    if (typeof (file as any)?.arrayBuffer === "function") {
      const ab = await (file as any).arrayBuffer()
      body = Buffer.from(ab)
    }
  } catch {
    body = file
  }
  const { data, error } = await supabaseAdmin.storage
    .from(RESUME_BUCKET)
    .upload(fileName, body, { cacheControl: "3600", upsert: true, ...(contentType ? { contentType } : {}) })
  if (error) throw error
  const { data: urlData } = supabaseAdmin.storage.from(RESUME_BUCKET).getPublicUrl(data.path)
  return { url: urlData.publicUrl, path: data.path }
}

export async function uploadAvatarToSupabase(file: File | Blob, fileName: string): Promise<{ url: string; path: string }> {
  const contentType = (file as any)?.type || undefined
  let body: any = file
  try {
    if (typeof (file as any)?.arrayBuffer === "function") {
      const ab = await (file as any).arrayBuffer()
      body = Buffer.from(ab)
    }
  } catch {
    body = file
  }
  const { data, error } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(fileName, body, { cacheControl: "3600", upsert: true, ...(contentType ? { contentType } : {}) })
  if (error) throw error
  const { data: urlData } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(data.path)
  return { url: urlData.publicUrl, path: data.path }
}
