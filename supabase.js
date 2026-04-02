import { createClient } from '@supabase/supabase-js'

const SB_URL = import.meta.env.VITE_SUPABASE_URL || 'https://olyvsqdtwxjenihlrnjt.supabase.co'
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9seXZzcWR0d3hqZW5paGxybmp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMTIyNDYsImV4cCI6MjA4ODg4ODI0Nn0.fEyWJabxTssKikd5Qf9lK4BpGJMktPcNr8-zVV3-lpw'

export const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
})

// ── AUTH ──────────────────────────────────────────────────────────────────────
export const sbSignIn = async (email, password) => {
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) return { user: null, error: error.message }
  return { user: data.user, error: null }
}

export const sbSignOut = async () => { await sb.auth.signOut() }

export const sbGetUser = async () => {
  const { data: { session } } = await sb.auth.getSession()
  return session?.user || null
}

export const sbGetProfile = async (userId) => {
  const { data } = await sb.from('km_profiles').select('*').eq('user_id', userId).single()
  return data
}

export const sbInviteStaff = async (email, role, propertyIds, ownerUserId) => {
  // Owner creates a staff record; staff resets password via email
  const { data, error } = await sb.auth.admin?.inviteUserByEmail(email).catch(() => ({ error: 'admin_not_available' }))
  // Fallback: store pending invite in km_profiles for non-admin flow
  if (error || !data) {
    const { error: pErr } = await sb.from('km_profiles').upsert({
      email, role, property_ids: propertyIds, owner_id: ownerUserId,
      status: 'pending', invited_at: new Date().toISOString()
    }, { onConflict: 'email' })
    return { error: pErr?.message || null }
  }
  return { error: null }
}

// ── DATA (per-user JSONB store) ───────────────────────────────────────────────
export const dbGet = async (key) => {
  const { data, error } = await sb.from('km_data').select('value').eq('key', key).limit(1).single()
  if (error) return null
  return data?.value ?? null
}

export const dbSet = async (key, value) => {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return false
  const { error } = await sb.from('km_data').upsert(
    { key, value, user_id: user.id },
    { onConflict: 'user_id,key' }
  )
  if (error) { console.error('dbSet:', error.message); return false }
  return true
}

// ── STORAGE (photos) ─────────────────────────────────────────────────────────
export const uploadPhoto = async (file, path) => {
  const { data, error } = await sb.storage.from('km-photos').upload(path, file, {
    cacheControl: '3600', upsert: true, contentType: file.type
  })
  if (error) return null
  const { data: { publicUrl } } = sb.storage.from('km-photos').getPublicUrl(data.path)
  return publicUrl
}

export const deletePhoto = async (path) => {
  await sb.storage.from('km-photos').remove([path])
}

export const resizeAndUpload = async (file, folder) => {
  // Resize first, then upload
  const resized = await new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        const maxW = 1200
        const scale = Math.min(1, maxW / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => res(blob), 'image/jpeg', 0.8)
      }
      img.onerror = rej
      img.src = e.target.result
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
  const filename = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  return uploadPhoto(resized, filename)
}
